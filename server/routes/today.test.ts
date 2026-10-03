import { beforeEach, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { openDb } from "../db";
import { activateCard, reviewCard } from "../review/fsrs";
import { submitAttempt } from "./grading";
import { localDate } from "./stats";
import { today } from "./today";
import { insertCard, insertItem, items, seed } from "./test-fixtures";

let database: Database;
let item: string;
beforeEach(() => {
  database = openDb(":memory:");
  seed(database);
  item = insertItem(database, items.single(), { role: "practice", lessonId: "ls1" });
});

const NOW = new Date(2026, 0, 20, 15, 0); // local time
const localAt = (dayOffset: number, hour = 12) => new Date(2026, 0, 20 + dayOffset, hour, 30);
const answerOn = (dayOffset: number, durationMs = 60_000) =>
  submitAttempt(item, { answer: { format: "single", choice: 0 }, hintsUsed: 0, durationMs, context: "practice" }, { database, at: localAt(dayOffset) });

test("seven streak days earn a freeze that covers a missed day; an empty today keeps the streak open", async () => {
  for (const d of [-10, -9, -8, -7, -6, -5, -4, -2, -1]) await answerOn(d);
  expect(today(NOW, database).streak).toEqual({
    days: 9,
    best: 9,
    activeToday: false,
    freezes: 0,
    nextFreezeIn: 5,
    frozen: [localDate(localAt(-3))],
  });
});

test("a missed day without a freeze ends the streak; a review counts as activity", async () => {
  for (const d of [-5, -4, -3, -1]) await answerOn(d);
  const card = insertCard(database);
  activateCard(card, localAt(0, 9), database);
  reviewCard(card, 3, localAt(0, 10), database, 30_000);
  expect(today(NOW, database).streak).toMatchObject({ days: 2, best: 3, activeToday: true, freezes: 0, frozen: [] });
});

test("freezes stop accruing at the maximum", async () => {
  for (let d = -20; d <= 0; d++) await answerOn(d);
  expect(today(NOW, database).streak).toMatchObject({ days: 21, freezes: 2, nextFreezeIn: null });
});

test("goal, nodes advanced today and the next review day", async () => {
  await answerOn(0, 3 * 60_000);
  database.query("INSERT INTO settings (key, value) VALUES ('goal_minutes', '20')").run();
  database.query("UPDATE nodes SET mastery = 'exit_passed', exit_passed_at = ? WHERE id = 'b'").run(localAt(0, 9).toISOString());
  database.query("UPDATE nodes SET mastery = 'mastered', mastered_at = ? WHERE id = 'c'").run(localAt(0, 10).toISOString());
  database.query("UPDATE nodes SET mastery = 'exit_passed', exit_passed_at = ? WHERE id = 'd'").run(localAt(-1).toISOString());
  for (const [due, status] of [[localAt(0, 9), "active"], [localAt(2, 8), "active"], [localAt(2, 22), "active"], [localAt(3), "active"], [localAt(1), "suspended"]] as const) {
    const id = insertCard(database, "a", status);
    database.query("UPDATE cards SET due = ? WHERE id = ?").run(due.toISOString(), id);
  }

  const view = today(NOW, database);
  expect(view.goal).toEqual({ minutes: 20, done: 3 });
  expect(view.advanced).toEqual([
    { topicId: "tp1", nodeId: "b", title: "Node B", mastery: "exit_passed" },
    { topicId: "tp1", nodeId: "c", title: "Node C", mastery: "mastered" },
  ]);
  expect(view.nextReview).toEqual({ date: localDate(localAt(2)), cards: 2 });
});

test("without any activity the streak is empty and the goal defaults to 10 minutes", () => {
  const view = today(NOW, database);
  expect(view.streak).toEqual({ days: 0, best: 0, activeToday: false, freezes: 0, nextFreezeIn: 7, frozen: [] });
  expect(view.goal).toEqual({ minutes: 10, done: 0 });
  expect(view.nextReview).toBeNull();
});
