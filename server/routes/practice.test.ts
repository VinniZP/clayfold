import { beforeEach, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { openDb } from "../db";
import { updateMasteryAfterAttempt } from "../review/mastery";
import { giveUp, submitAttempt } from "./grading";
import { learnerStatus, lessonSummary, type LessonRow } from "./lesson-summary";
import { practiceResults, practiceScope, startPractice } from "./practice";
import { publicStep, type StepRow } from "./public";
import { insertStep, items, seed } from "./test-fixtures";

let database: Database;
let sent: { conversationId: string; text: string; display?: string | null }[];
const run = (turn: (typeof sent)[number]) => void sent.push(turn);

beforeEach(() => {
  database = openDb(":memory:");
  seed(database); // lesson ls1 on node a, novice
  sent = [];
});

/** A practice set on node a with two published items, as startPractice creates it and step_submit fills it. */
function practiceSet(): { lessonId: string; itemIds: string[] } {
  const { lessonId } = startPractice({ from: { topicId: "tp1", nodeId: "a" }, size: 3, focus: "same" }, database, run);
  const itemIds = [
    ...insertStep(database, 0, { kind: "practice", title: "First", item: items.single("p1") }, lessonId).itemIds,
    ...insertStep(database, 1, { kind: "practice", title: "Second", item: items.number("p2", "b") }, lessonId).itemIds,
  ];
  return { lessonId, itemIds };
}

const lessonRow = (id: string) => database.query<LessonRow, [string]>("SELECT * FROM lessons WHERE id = ?").get(id)!;

test("a set started from an item covers its node, keeps the item as its seed and starts a practice-set run", () => {
  const seedItem = insertStep(database, 0, { kind: "practice", title: "P", item: items.single("seed", "b") }).itemIds[0]!;
  const res = startPractice({ from: { itemId: seedItem }, size: 5, focus: "harder" }, database, run);
  expect(res.lessonId).not.toBeNull();
  expect(sent).toEqual([{ conversationId: res.conversationId, text: `/clayfold:practice-set ${res.lessonId}`, display: null }]);
  expect(database.query("SELECT kind, lesson_id FROM conversations WHERE id = ?").get(res.conversationId)).toEqual({ kind: "lesson", lesson_id: res.lessonId });

  const row = lessonRow(res.lessonId);
  expect(JSON.parse(row.practice!)).toEqual({ focus: "harder", seedItemId: seedItem });
  expect(JSON.parse(row.node_ids)).toEqual(["b"]);
  expect(row.title).toBe("Practice: Node B");
  expect(row.level).toBe("novice");
  expect((JSON.parse(row.outline) as { kind: string }[]).map((o) => o.kind)).toEqual(Array(5).fill("practice"));
  expect(lessonSummary(row, database)).toMatchObject({ practice: { size: 5, focus: "harder" }, status: "generating", stepsTotal: 5, sourcesStale: false });
});

test("a set from a lesson covers the lesson's nodes; unknown targets are refused", () => {
  database.query(`UPDATE lessons SET node_ids = '["a","c","gone"]', level = 'advanced' WHERE id = 'ls1'`).run();
  expect(practiceScope({ lessonId: "ls1" }, database).nodes).toEqual([
    { id: "a", title: "Node A" },
    { id: "c", title: "Node C" },
  ]);
  const { lessonId } = startPractice({ from: { lessonId: "ls1" }, size: 3, focus: "same" }, database, run);
  expect(lessonRow(lessonId).level).toBe("advanced");
  expect(() => practiceScope({ topicId: "tp1", nodeId: "zz" }, database)).toThrow("node not found");
  expect(() => practiceScope({ itemId: "nope" }, database)).toThrow("item not found");
});

test("the mistakes focus needs a wrong answer on the nodes; prequestion answers do not count", async () => {
  const [pre] = insertStep(database, 0, { kind: "activate", title: "Before", items: [items.single("a1"), items.single("a2")] }).itemIds;
  const practice = insertStep(database, 1, { kind: "practice", title: "P", item: items.single("p1") }).itemIds[0]!;
  await submitAttempt(pre!, { answer: { format: "single", choice: 0 }, hintsUsed: 0, durationMs: 1000, context: "activate" }, { database });
  expect(practiceScope({ topicId: "tp1", nodeId: "a" }, database).mistakes).toBe(0);
  expect(() => startPractice({ from: { topicId: "tp1", nodeId: "a" }, size: 3, focus: "mistakes" }, database, run)).toThrow("no wrong answers");

  giveUp(practice, { database });
  expect(practiceScope({ topicId: "tp1", nodeId: "a" }, database).mistakes).toBe(1);
  expect(startPractice({ from: { topicId: "tp1", nodeId: "a" }, size: 3, focus: "mistakes" }, database, run).lessonId).not.toBeNull();
});

test("results count first tries per node; the set is completed once every item is solved or given up", async () => {
  const { lessonId, itemIds } = practiceSet();
  const [single, number] = itemIds as [string, string];
  expect(learnerStatus(lessonId, database, true)).toBe("not_started");

  // Display order is reversed, so display 2 is the key (authoring index 0).
  await submitAttempt(single, { answer: { format: "single", choice: 2 }, hintsUsed: 0, durationMs: 4000, context: "practice" }, { database });
  await submitAttempt(number, { answer: { format: "number", value: 1 }, hintsUsed: 0, durationMs: 4000, context: "practice" }, { database });
  expect(learnerStatus(lessonId, database, true)).toBe("in_progress");
  await submitAttempt(number, { answer: { format: "number", value: 9137.25 }, hintsUsed: 1, durationMs: 4000, context: "practice" }, { database });

  expect(practiceResults(lessonId, database)).toEqual({
    total: 2,
    answered: 2,
    firstTry: 1,
    solved: 2,
    nodes: [
      { nodeId: "a", title: "Node A", total: 1, firstTry: 1, solved: 1 },
      { nodeId: "b", title: "Node B", total: 1, firstTry: 0, solved: 1 },
    ],
  });
  expect(learnerStatus(lessonId, database, true)).toBe("completed");
});

test("practice sets neither supersede lessons nor pass the exit check (L12)", async () => {
  const { lessonId, itemIds } = practiceSet();
  database.query("UPDATE lessons SET status = 'finished'").run();
  expect(lessonSummary(lessonRow("ls1"), database).supersededBy).toBeNull();
  expect(lessonSummary(lessonRow(lessonId), database).supersededBy).toBeNull();

  const res = await submitAttempt(itemIds[0]!, { answer: { format: "single", choice: 2 }, hintsUsed: 0, durationMs: 4000, context: "practice" }, { database });
  expect(res.correct).toBe(true);
  const attempt = database.query<{ id: string }, []>("SELECT id FROM attempts ORDER BY rowid DESC LIMIT 1").get()!;
  expect(updateMasteryAfterAttempt(attempt.id, database)).toBe("learning");
});

test("the browser views of a practice set carry no keys (L7)", () => {
  const { lessonId } = practiceSet();
  const steps = database.query<StepRow, [string]>("SELECT * FROM steps WHERE lesson_id = ?").all(lessonId);
  const json = JSON.stringify([
    steps.map((s) => publicStep(s, database)),
    lessonSummary(lessonRow(lessonId), database),
    practiceResults(lessonId, database),
    practiceScope({ lessonId: lessonId }, database),
  ]);
  for (const secret of ["SECRET-", "9137.25", '"correct"', '"solution"', '"hints"', '"misconception"', "seedItemId"]) expect(json).not.toContain(secret);
});
