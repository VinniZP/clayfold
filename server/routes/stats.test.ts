import { beforeEach, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import type { Confidence } from "../../shared/api";
import { openDb } from "../db";
import { activateCard, reviewCard } from "../review/fsrs";
import { giveUp, submitAttempt } from "./grading";
import { activity, calibration, weakSpots } from "./stats";
import { insertCard, insertItem, items, seed } from "./test-fixtures";

let database: Database;
beforeEach(() => {
  database = openDb(":memory:");
  seed(database);
});

const NOW = new Date(2026, 0, 10, 15, 0); // local time
const localAt = (dayOffset: number, hour: number) => new Date(2026, 0, 10 + dayOffset, hour, 30);
const answer = (id: string, choice: number, at: Date, durationMs = 60_000) =>
  submitAttempt(id, { answer: { format: "single", choice }, hintsUsed: 0, durationMs, context: "practice" }, { database, at });

test("activity buckets attempts and reviews by local day, oldest first, with empty days", async () => {
  const id = insertItem(database, items.single(), { role: "practice", lessonId: "ls1" });
  await answer(id, 0, localAt(-2, 0)); // just after local midnight
  await answer(id, 2, localAt(-2, 23));
  await answer(id, 2, localAt(-9, 12)); // outside the window
  const card = insertCard(database);
  activateCard(card, localAt(0, 9), database);
  reviewCard(card, 3, localAt(0, 10), database, 30_000);

  const days = activity(3, "tp1", NOW, database);
  expect(days).toEqual([
    { date: "2026-01-08", attempts: 2, correct: 1, reviews: 0, minutes: 2 },
    { date: "2026-01-09", attempts: 0, correct: 0, reviews: 0, minutes: 0 },
    { date: "2026-01-10", attempts: 0, correct: 0, reviews: 1, minutes: 0.5 },
  ]);
  expect(activity(3, "other", NOW, database).every((d) => d.attempts === 0 && d.reviews === 0)).toBe(true);
});

test("weak spots: items wrong twice in 30 days and leech cards, worst first relative to their thresholds", async () => {
  const twice = insertItem(database, items.single("w2"), { role: "practice", lessonId: "ls1" });
  const thrice = insertItem(database, items.single("w3"), { role: "practice", lessonId: "ls1" });
  const once = insertItem(database, items.single("w1"), { role: "practice", lessonId: "ls1" });
  const old = insertItem(database, items.single("old"), { role: "practice", lessonId: "ls1" });
  const pre = insertItem(database, items.single("pre"), { role: "activate", lessonId: "ls1" });
  for (const id of [twice, thrice, pre]) for (let i = 0; i < 2; i++) await answer(id, 0, localAt(-1, 10 + i));
  await answer(thrice, 1, localAt(-1, 13));
  await answer(once, 0, localAt(-1, 10));
  for (let i = 0; i < 2; i++) await answer(old, 0, localAt(-40, 10 + i));
  const leech = insertCard(database, "a", "active");
  database.query("UPDATE cards SET lapses = 10 WHERE id = ?").run(leech);

  const spots = weakSpots("tp1", 10, NOW, database);
  expect(spots.map((s) => (s.kind === "item" ? s.itemId : s.cardId))).toEqual([thrice, leech, twice]);
  expect(spots[0]).toMatchObject({ kind: "item", wrongAttempts: 3, lastMisconception: "SECRET-MISC1-w3", prompt: "Prompt w3", lessonId: "ls1" });
  expect(weakSpots("tp1", 1, NOW, database)).toHaveLength(1);
});

test("calibration counts rated, graded answers per confidence level, overall and per topic, busiest topic first (L20)", async () => {
  database.query("INSERT INTO topics (id, slug, title, request) VALUES ('tp2', 'tp2', 'Second', 'request')").run();
  const rate = (id: string, choice: number, confidence?: Confidence, context: "practice" | "activate" = "practice") =>
    submitAttempt(id, { answer: { format: "single", choice }, hintsUsed: 0, durationMs: 1000, context, confidence }, { database, at: NOW });
  const one = insertItem(database, items.single("one"), { role: "practice", lessonId: "ls1" });
  const pre = insertItem(database, items.single("pre"), { role: "activate", lessonId: "ls1" });
  const other = insertItem(database, items.single("other"), { role: "check", lessonId: "ls1" });
  database.query("UPDATE items SET topic_id = 'tp2' WHERE id = ?").run(other);
  await rate(one, 2, "sure");
  await rate(one, 0, "sure");
  await rate(one, 2, "guess");
  await rate(one, 0); // unrated
  await rate(pre, 2, "sure", "activate");
  await rate(other, 0, "guess");
  giveUp(one, { database, at: NOW });

  const view = calibration(database);
  expect(view.overall).toEqual([
    { confidence: "guess", attempts: 2, correct: 1 },
    { confidence: "unsure", attempts: 0, correct: 0 },
    { confidence: "sure", attempts: 2, correct: 1 },
  ]);
  expect(view.topics.map((t) => [t.title, t.levels.map((l) => `${l.correct}/${l.attempts}`)])).toEqual([
    ["Topic", ["1/1", "0/0", "1/2"]],
    ["Second", ["0/1", "0/0", "0/0"]],
  ]);
});
