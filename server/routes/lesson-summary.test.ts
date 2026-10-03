import { beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { openDb } from "../db";
import { learnerStatus, lessonSummary, supersedingLesson, type LessonRow } from "./lesson-summary";
import { answerWorkedLine, submitAttempt, takeHint } from "./grading";
import { rebuildLesson } from "./lessons";
import { insertStep, items, seed } from "./test-fixtures";

let database: Database;
beforeEach(() => {
  database = openDb(":memory:");
  seed(database); // src1 on example.org
  database
    .query(`UPDATE lessons SET outline = ?, sources_at_plan = 1, node_ids = '["b","a"]' WHERE id = 'ls1'`)
    .run(JSON.stringify(["activate", "practice", "practice", "check"].map((kind) => ({ kind, title: kind }))));
});

const summary = () => lessonSummary(database.query<LessonRow, []>("SELECT * FROM lessons WHERE id = 'ls1'").get()!, database);
const addSource = (id: string, url: string) =>
  database.query("INSERT INTO sources (id, topic_id, url, title, kind, note, status) VALUES (?, 'tp1', ?, 't', 'docs', 'n', 'ok')").run(id, url);

test("stepsReady counts published and dropped steps against the outline length", () => {
  insertStep(database, 0, { kind: "activate", title: "Before", items: [items.single("a1"), items.single("a2")] });
  insertStep(database, 1, { kind: "practice", title: "P", item: items.single("p1") });
  database.query("UPDATE steps SET status = 'dropped' WHERE idx = 1").run();
  database.query("INSERT INTO steps (id, lesson_id, idx, kind, content, status) VALUES ('st_x', 'ls1', 2, 'practice', '{}', 'rejected')").run();
  expect(summary()).toMatchObject({ stepsReady: 2, stepsTotal: 4 });
});

test("sourcesStale: new sources since the plan and a lesson citing one publisher; not for a diverse lesson", () => {
  insertStep(database, 0, { kind: "activate", title: "Before", items: [items.single("a1"), items.single("a2")] });
  expect(summary().sourcesStale).toBe(false); // no new sources
  addSource("src2", "https://git-scm.com/book");
  expect(summary().sourcesStale).toBe(true);
  const other = { ...items.single("p2"), cites: [{ sourceId: "src2", quote: "A verbatim quote from the source." }] };
  insertStep(database, 1, { kind: "practice", title: "P", item: other });
  expect(summary().sourcesStale).toBe(false);
});

test("a lesson planned before sources were tracked is stale once the topic has a second publisher it does not cite", () => {
  database.query("UPDATE lessons SET sources_at_plan = NULL").run();
  expect(summary().sourcesStale).toBe(false);
  addSource("src2", "https://git-scm.com/book");
  expect(summary().sourcesStale).toBe(true);
});

test("rebuild starts a new lesson-author run on the old lesson's first node and keeps the old lesson", () => {
  const sent: { conversationId: string; text: string; display?: string | null }[] = [];
  const res = rebuildLesson({ topic_id: "tp1", node_ids: '["b","a"]' }, database, (t) => sent.push(t));
  expect(res.lessonId).toBeNull();
  expect(sent).toEqual([{ conversationId: res.conversationId, text: "/clayfold:lesson-author b", display: null }]);
  expect(database.query("SELECT kind, lesson_id FROM conversations WHERE id = ?").get(res.conversationId)).toEqual({ kind: "lesson", lesson_id: null });
  expect(database.query("SELECT status FROM lessons WHERE id = 'ls1'").get()).toEqual({ status: "generating" });
});

describe("supersession", () => {
  const lesson = (id: string, nodeIds: string[], status: string, createdAt: string) =>
    database
      .query("INSERT INTO lessons (id, topic_id, title, objective, level, node_ids, outline, status, created_at) VALUES (?, 'tp1', 'L', 'Objective here', 'novice', ?, '[]', ?, ?)")
      .run(id, JSON.stringify(nodeIds), status, createdAt);
  const self = { id: "ls1", node_ids: '["b","a"]' };
  beforeEach(() => database.query("UPDATE lessons SET created_at = '2026-01-01T00:00:00.000Z', status = 'finished'").run());

  test("the newest later finished lesson on the same node set supersedes, whatever the node order", () => {
    lesson("v2", ["a", "b"], "finished", "2026-01-02T00:00:00.000Z");
    lesson("v3", ["a", "b", "a"], "finished", "2026-01-03T00:00:00.000Z");
    expect(supersedingLesson(self, database)).toBe("v3");
    expect(supersedingLesson({ id: "v2", node_ids: '["a","b"]' }, database)).toBe("v3");
    expect(supersedingLesson({ id: "v3", node_ids: '["a","b"]' }, database)).toBeNull();
  });

  test("a different node set, an earlier lesson, a failed or a still generating version does not supersede", () => {
    lesson("other", ["a"], "finished", "2026-01-02T00:00:00.000Z");
    lesson("older", ["a", "b"], "finished", "2025-12-31T00:00:00.000Z");
    lesson("failed", ["a", "b"], "failed", "2026-01-03T00:00:00.000Z");
    lesson("building", ["a", "b"], "generating", "2026-01-04T00:00:00.000Z");
    expect(supersedingLesson(self, database)).toBeNull();
    database.query("UPDATE lessons SET status = 'finished' WHERE id = 'building'").run();
    expect(supersedingLesson(self, database)).toBe("building");
  });

  test("a superseded lesson is never flagged stale", () => {
    addSource("src2", "https://git-scm.com/book");
    expect(summary()).toMatchObject({ sourcesStale: true, supersededBy: null });
    lesson("v2", ["a", "b"], "finished", "2026-01-02T00:00:00.000Z");
    expect(summary()).toMatchObject({ sourcesStale: false, supersededBy: "v2" });
  });
});

describe("learnerStatus", () => {
  const worked = {
    kind: "worked_example" as const,
    title: "Worked",
    problem: "Problem",
    cites: [{ sourceId: "src1", quote: "A verbatim quote from the source." }],
    lines: [{ text: "one" }, { text: "two", blank: { prompt: "Next line?", answers: ["two"] } }],
  };
  const attempt = (itemId: string, choice: number, context: "practice" | "check") =>
    submitAttempt(itemId, { answer: { format: "single", choice }, hintsUsed: 0, durationMs: 1000, context }, { database });

  test("not started → in progress on any learner action → completed when every check item has an attempt", async () => {
    const practice = insertStep(database, 1, { kind: "practice", title: "P", item: items.single("p") }).itemIds[0]!;
    insertStep(database, 2, worked);
    const check = insertStep(database, 3, { kind: "check", title: "C", items: [items.single("c1"), items.single("c2")] }).itemIds;
    expect(learnerStatus("ls1", database)).toBe("not_started");

    takeHint(practice, 1, database);
    expect(learnerStatus("ls1", database)).toBe("in_progress");

    await attempt(check[0]!, 0, "check"); // wrong still counts as attempted
    expect(learnerStatus("ls1", database)).toBe("in_progress");
    await attempt(check[1]!, 2, "check");
    expect(summary().learnerStatus).toBe("completed");
  });

  test("a worked answer or a note on the lesson counts as started", () => {
    const w = insertStep(database, 2, worked).stepId;
    answerWorkedLine({ id: w, content: JSON.stringify(worked) }, 1, "two", { database });
    expect(learnerStatus("ls1", database)).toBe("in_progress");

    database.query("DELETE FROM worked_answers").run();
    database.query("INSERT INTO notes (id, topic_id, lesson_id, text) VALUES ('n1', 'tp1', 'ls1', 'note')").run();
    expect(learnerStatus("ls1", database)).toBe("in_progress");
  });
});
