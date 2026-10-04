import { beforeEach, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import type { AttemptRequest } from "../../shared/api";
import type { Answer } from "../../shared/schemas";
import { openDb } from "../db";
import { itemSignals } from "../review/signals";
import { giveUp, GradingError, submitAttempt } from "./grading";
import { mistakeCounts, mistakesView, mistakeSolution, retryMistake } from "./mistakes";
import { lessonItemStates } from "./progress";
import { activity } from "./stats";
import { insertItem, insertStep, items, seed } from "./test-fixtures";

const DAY = 24 * 60 * 60 * 1000;
const T0 = new Date("2026-01-10T10:00:00.000Z");
const later = (ms: number) => new Date(T0.getTime() + ms);

// Fixture items show options reversed: display 2 is the key, display 1 is wrong1, display 0 is wrong2.
const KEY: Answer = { format: "single", choice: 2 };
const WRONG1: Answer = { format: "single", choice: 1 };

let database: Database;
beforeEach(() => {
  database = openDb(":memory:");
  seed(database);
});

const attempt = (itemId: string, answer: Answer, context: AttemptRequest["context"], at = T0) =>
  submitAttempt(itemId, { answer, hintsUsed: 0, durationMs: 5000, context }, { database, at });
const retry = (itemId: string, answer: Answer, at: Date) => retryMistake(itemId, { answer, durationMs: 5000 }, { database, at });
const entry = (itemId: string) => mistakesView(database).entries.find((e) => e.itemId === itemId);

test("graded items wrong on the first try or given up are mistakes; prequestions, first-try successes and retired items are not", async () => {
  const wrongFirst = insertItem(database, items.single("w"), { role: "explain_check", lessonId: "ls1" });
  const rightFirst = insertItem(database, items.single("r"), { role: "practice", lessonId: "ls1" });
  const gaveUpLater = insertItem(database, items.single("g"), { role: "check", lessonId: "ls1" });
  const prequestion = insertItem(database, items.single("a"), { role: "activate", lessonId: "ls1" });
  const retired = insertItem(database, items.single("x"), { role: "practice", lessonId: "ls1" });
  const untouched = insertItem(database, items.single("u"), { role: "practice", lessonId: "ls1" });

  await attempt(wrongFirst, WRONG1, "explain", T0);
  await attempt(wrongFirst, KEY, "explain", later(60_000));
  await attempt(rightFirst, KEY, "practice", later(1000));
  await attempt(rightFirst, WRONG1, "review", later(2 * DAY));
  await attempt(gaveUpLater, KEY, "check", later(2000));
  giveUp(gaveUpLater, { database, at: later(3 * DAY) });
  await attempt(prequestion, WRONG1, "activate");
  await attempt(retired, WRONG1, "practice");
  database.query("UPDATE items SET status = 'retired' WHERE id = ?").run(retired);

  const view = mistakesView(database);
  expect(view.entries.map((e) => e.itemId)).toEqual([gaveUpLater, wrongFirst]);
  expect(entry(wrongFirst)).toMatchObject({
    answer: "wrong1 w",
    misconception: "SECRET-MISC1-w",
    gaveUp: false,
    at: T0.toISOString(),
    readyAt: later(DAY).toISOString(),
    resolvedAt: null,
    retries: 0,
    topicTitle: "Topic",
    nodeTitle: "Node A",
    lessonTitle: "Lesson",
  });
  expect(entry(gaveUpLater)).toMatchObject({ answer: null, gaveUp: true, misconception: null });
  for (const id of [rightFirst, prequestion, retired, untouched]) expect(() => mistakeSolution(id, database)).toThrow(GradingError);
});

test("the notebook carries no solution or hint; the solution and retries open only for an item in it", async () => {
  const { itemIds } = insertStep(database, 0, { kind: "practice", title: "Practice", item: items.single("p") });
  const id = itemIds[0]!;
  const other = insertItem(database, items.single("o"), { role: "practice", lessonId: "ls1" });
  await attempt(id, WRONG1, "practice");

  const json = JSON.stringify(mistakesView(database));
  for (const secret of ["SECRET-SOL", "SECRET-HINT", "SECRET-FB", '"solution"', '"correctAnswer"']) expect(json).not.toContain(secret);
  expect(entry(id)!.stepIdx).toBe(0);
  expect(mistakeSolution(id, database)).toEqual({ solution: "SECRET-SOL-p", correctAnswer: "key p" });

  await expect(retry(other, KEY, later(DAY))).rejects.toMatchObject({ status: 404 });
  expect(database.query("SELECT count(*) AS n FROM retries").get()).toEqual({ n: 0 });
});

test("a correct retry resolves an entry only a day or more after the latest error; a new error reopens it", async () => {
  const id = insertItem(database, items.single("s"), { role: "practice", lessonId: "ls1" });
  await attempt(id, WRONG1, "practice", T0);

  const sameDay = await retry(id, KEY, later(3600_000));
  expect(sameDay).toMatchObject({ correct: true, solution: "SECRET-SOL-s", correctAnswer: "key s" });
  expect(sameDay.entry).toMatchObject({ retries: 1, resolvedAt: null, readyAt: later(DAY).toISOString() });

  const wrong = await retry(id, WRONG1, later(DAY + 1000));
  expect(wrong).toMatchObject({ correct: false, feedback: "SECRET-FB1-s" });
  expect(wrong.entry).toMatchObject({ resolvedAt: null, readyAt: later(2 * DAY + 1000).toISOString() });
  expect(mistakeCounts(later(2 * DAY), database)).toEqual({ open: 1, ready: 0 });
  expect(mistakeCounts(later(2 * DAY + 1000), database)).toEqual({ open: 1, ready: 1 });

  const resolved = await retry(id, KEY, later(2 * DAY + 1000));
  expect(resolved.entry.resolvedAt).toBe(later(2 * DAY + 1000).toISOString());
  expect(mistakeCounts(later(3 * DAY), database)).toEqual({ open: 0, ready: 0 });

  await attempt(id, WRONG1, "review", later(5 * DAY));
  expect(entry(id)).toMatchObject({ resolvedAt: null, readyAt: later(6 * DAY).toISOString() });
});

test("retries leave first-try state, the exit check, mastery and learner signals alone", async () => {
  const { itemIds } = insertStep(database, 0, { kind: "check", title: "Check", items: [items.single("k")] });
  const check = itemIds[0]!;
  await attempt(check, WRONG1, "check", T0);
  const before = { states: lessonItemStates("ls1", database), signals: itemSignals(check, database) };

  for (let i = 1; i <= 8; i++) await retry(check, i % 2 ? KEY : WRONG1, later(i * DAY));

  expect(lessonItemStates("ls1", database)).toEqual(before.states);
  expect(itemSignals(check, database)).toEqual(before.signals);
  expect(database.query("SELECT count(*) AS n FROM attempts").get()).toEqual({ n: 1 });
  expect(database.query("SELECT count(*) AS n FROM regen_queue").get()).toEqual({ n: 0 });
  expect(database.query("SELECT mastery FROM nodes WHERE topic_id = 'tp1' AND id = 'a'").get()).toEqual({ mastery: "learning" });

  database.query("UPDATE nodes SET mastery = 'exit_passed', exit_passed_at = ? WHERE id = 'a'").run(T0.toISOString());
  await retry(check, KEY, later(20 * DAY));
  expect(database.query("SELECT mastery FROM nodes WHERE topic_id = 'tp1' AND id = 'a'").get()).toEqual({ mastery: "exit_passed" });
});

test("a distractor chosen twice across attempts and retries is a pattern while the entry is open; retries count as activity", async () => {
  const id = insertItem(database, items.single("m"), { role: "practice", lessonId: "ls1" });
  await attempt(id, WRONG1, "practice", T0);
  expect(mistakesView(database).patterns).toEqual([]);

  await retry(id, WRONG1, later(1000));
  expect(mistakesView(database).patterns).toEqual([
    { itemId: id, topicId: "tp1", nodeTitle: "Node A", option: "wrong1 m", misconception: "SECRET-MISC1-m", times: 2 },
  ]);
  expect(activity(1, null, later(2000), database)[0]).toMatchObject({ attempts: 2, correct: 0 });

  await retry(id, KEY, later(2 * DAY));
  expect(mistakesView(database).patterns).toEqual([]);
});
