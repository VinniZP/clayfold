import { beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import type { AttemptRequest } from "../../shared/api";
import type { Answer } from "../../shared/schemas";
import { openDb } from "../db";
import { submitAttempt } from "../routes/grading";
import { insertCard, insertItem, items, seed } from "../routes/test-fixtures";
import { activateCard, reviewCard } from "./fsrs";
import { reviewSession } from "./session";
import { applyCardSignals, itemSignals } from "./signals";

const DAY = 24 * 60 * 60 * 1000;
const T0 = new Date("2026-01-10T10:00:00.000Z");
const later = (ms: number) => new Date(T0.getTime() + ms);

let database: Database;
beforeEach(() => {
  database = openDb(":memory:");
  seed(database);
});

const mastery = (nodeId: string) =>
  database.query<{ mastery: string; exit_passed_at: string | null }, [string]>("SELECT mastery, exit_passed_at FROM nodes WHERE topic_id = 'tp1' AND id = ?").get(nodeId)!;
const openQueue = () => database.query<{ target_id: string; reason: string }, []>("SELECT target_id, reason FROM regen_queue WHERE status = 'open'").all();

// Fixture items show options reversed: display 2 is the key, display 0 and 1 are distractors.
const KEY: Answer = { format: "single", choice: 2 };
const WRONG: Answer = { format: "single", choice: 0 };
const attempt = (itemId: string, answer: Answer, context: AttemptRequest["context"], at: Date, extra: Partial<AttemptRequest> = {}) =>
  submitAttempt(itemId, { answer, hintsUsed: 0, durationMs: 20000, context, ...extra }, { database, at });

describe("FSRS", () => {
  test("accept initialises the card due now; a review reschedules it and logs the review", () => {
    const id = insertCard(database);
    activateCard(id, T0, database);
    const accepted = database.query<{ status: string; due: string; fsrs: string }, [string]>("SELECT status, due, fsrs FROM cards WHERE id = ?").get(id)!;
    expect(accepted.status).toBe("active");
    expect(accepted.due).toBe(T0.toISOString());

    const { due } = reviewCard(id, 3, T0, database);
    expect(Date.parse(due)).toBeGreaterThan(T0.getTime());
    const row = database.query<{ reps: number; lapses: number }, [string]>("SELECT reps, lapses FROM cards WHERE id = ?").get(id)!;
    expect(row.reps).toBe(1);
    expect(database.query<{ n: number }, []>("SELECT count(*) AS n FROM reviews").get()!.n).toBe(1);
  });

  test("Again on a review card counts a lapse; 8 lapses queue the card as a leech", () => {
    const id = insertCard(database);
    activateCard(id, T0, database);
    let at = T0;
    reviewCard(id, 3, at, database);
    for (let i = 0; i < 8; i++) {
      const due = database.query<{ due: string }, [string]>("SELECT due FROM cards WHERE id = ?").get(id)!.due;
      at = new Date(Math.max(Date.parse(due), at.getTime()) + 60_000);
      reviewCard(id, 3, at, database);
      at = new Date(at.getTime() + 2 * DAY);
      reviewCard(id, 1, at, database);
    }
    const { lapses } = database.query<{ lapses: number }, [string]>("SELECT lapses FROM cards WHERE id = ?").get(id)!;
    expect(lapses).toBeGreaterThanOrEqual(8);
    expect(openQueue()).toEqual([{ target_id: id, reason: "leech" }]);
    expect(applyCardSignals(id, database)).toBe(false);
  });
});

describe("mastery (L12)", () => {
  test("new → learning on any attempt; a retried check item does not count as first-try correct", async () => {
    const checks = Array.from({ length: 5 }, (_, i) => insertItem(database, items.single(`c${i}`), { role: "check", lessonId: "ls1" }));
    const practice = insertItem(database, items.single("p"), { role: "practice", lessonId: "ls1" });

    await attempt(practice, WRONG, "practice", T0);
    expect(mastery("a").mastery).toBe("learning");

    await attempt(checks[0]!, WRONG, "check", T0);
    await attempt(checks[0]!, KEY, "check", T0); // retry does not count as first try
    for (const id of checks.slice(1, 4)) await attempt(id, KEY, "check", T0);
    expect(mastery("a").mastery).toBe("learning"); // 3 of 5 first-try correct

    await attempt(checks[4]!, KEY, "check", T0);
    expect(mastery("a").mastery).toBe("exit_passed"); // 4 of 5
  });

  test("exit_passed needs at least 80% first-try correct without hints", async () => {
    const checks = Array.from({ length: 5 }, (_, i) => insertItem(database, items.single(`c${i}`), { role: "check", lessonId: "ls1" }));
    await attempt(checks[0]!, KEY, "check", T0, { hintsUsed: 1 });
    for (const id of checks.slice(1, 4)) await attempt(id, KEY, "check", T0);
    expect(mastery("a").mastery).toBe("learning");
    await attempt(checks[4]!, KEY, "check", T0);
    expect(mastery("a")).toEqual({ mastery: "exit_passed", exit_passed_at: T0.toISOString() });

    const review = insertItem(database, items.single("r"), { role: "practice", lessonId: "ls1" });
    await attempt(review, KEY, "review", later(DAY - 60_000));
    expect(mastery("a").mastery).toBe("exit_passed"); // too early
    await attempt(review, WRONG, "review", later(DAY + 60_000));
    expect(mastery("a").mastery).toBe("exit_passed"); // wrong
    await attempt(review, KEY, "review", later(DAY + 120_000));
    expect(mastery("a").mastery).toBe("mastered");
  });

  test("a card of an exit-passed node rated Good a day later masters it; earlier or Hard does not", async () => {
    const check = insertItem(database, items.single("c"), { role: "check", lessonId: "ls1" });
    await attempt(check, KEY, "check", T0);
    expect(mastery("a").mastery).toBe("exit_passed");
    const card = insertCard(database, "a");
    activateCard(card, T0, database);
    reviewCard(card, 4, later(DAY / 2), database);
    expect(mastery("a").mastery).toBe("exit_passed");
    reviewCard(card, 2, later(2 * DAY), database);
    expect(mastery("a").mastery).toBe("exit_passed");
    reviewCard(card, 3, later(3 * DAY), database);
    expect(mastery("a").mastery).toBe("mastered");
  });
});

describe("learner signals", () => {
  test("apply+ item answered right on first sight in < 8 s in two sessions → possible_leak", async () => {
    const id = insertItem(database, items.single("p"), { role: "practice", lessonId: "ls1" });
    await attempt(id, KEY, "practice", T0, { durationMs: 3000 });
    await attempt(id, KEY, "practice", later(60_000), { durationMs: 2000 }); // same session
    expect(openQueue()).toEqual([]);
    await attempt(id, KEY, "review", later(2 * DAY), { durationMs: 4000 });
    expect(openQueue()).toEqual([{ target_id: id, reason: "possible_leak" }]);
  });

  test("a distractor never chosen in 6 attempts → dead_distractor; one chosen twice is only recorded", async () => {
    const id = insertItem(database, items.single("p"), { role: "practice", lessonId: "ls1" });
    for (let i = 0; i < 2; i++) await attempt(id, WRONG, "practice", later(i * 1000)); // display 0 = authoring 2
    expect(itemSignals(id, database)).toEqual([{ reason: "misconception_confirmed", option: 2, misconception: "SECRET-MISC2-p", times: 2 }]);
    expect(openQueue()).toEqual([]);
    for (let i = 0; i < 4; i++) await attempt(id, KEY, "practice", later(10_000 + i * 1000));
    expect(openQueue()).toEqual([{ target_id: id, reason: "dead_distractor" }]);
    expect(itemSignals(id, database)).toContainEqual({ reason: "dead_distractor", neverChosen: [1], attempts: 6 });
    await attempt(id, KEY, "practice", later(20_000));
    expect(openQueue()).toHaveLength(1); // deduplicated per target
  });
});

describe("review session", () => {
  test("due cards and delayed-retrieval items; siblings sharing a prerequisite interleave, others stay blocked", async () => {
    const card = insertCard(database, "a");
    activateCard(card, T0, database);
    insertCard(database, "a"); // proposed: not due
    const setExit = database.query("UPDATE nodes SET mastery = 'exit_passed', exit_passed_at = ? WHERE topic_id = 'tp1' AND id = ?");
    for (const n of ["b", "c", "d"]) setExit.run(T0.toISOString(), n);
    setExit.run(later(DAY).toISOString(), "a"); // exit passed too recently
    const ids: Record<string, string[]> = {};
    for (const n of ["a", "b", "c", "d"]) {
      ids[n] = [0, 1, 2].map((i) => insertItem(database, items.single(`${n}${i}`, n), { role: "check", lessonId: "ls1" }));
    }
    const session = reviewSession("tp1", later(DAY + 1000), database);
    expect(session.cards.map((c) => c.id)).toEqual([card]);
    expect(session.items.map((i) => i.id)).toEqual([ids.b![0]!, ids.c![0]!, ids.b![1]!, ids.c![1]!, ids.d![0]!, ids.d![1]!]);
    expect(JSON.stringify(session)).not.toContain("SECRET");
  });

  test("a wrong answer rated sure comes back first, a day after the item's latest attempt, until a review answer is right (L23)", async () => {
    database.query("UPDATE nodes SET mastery = 'exit_passed', exit_passed_at = ? WHERE topic_id = 'tp1' AND id = 'b'").run(T0.toISOString());
    const planned = insertItem(database, items.single("b0", "b"), { role: "check", lessonId: "ls1" });
    const sure = insertItem(database, items.single("s", "b"), { role: "practice", lessonId: "ls1" });
    const unsure = insertItem(database, items.single("u", "a"), { role: "practice", lessonId: "ls1" });
    await attempt(sure, WRONG, "practice", T0, { confidence: "sure" });
    await attempt(sure, KEY, "practice", later(60_000));
    await attempt(unsure, WRONG, "practice", T0, { confidence: "unsure" });
    const retests = (at: Date) => reviewSession("tp1", at, database).retests;

    expect(retests(later(DAY))).toEqual([]); // the latest attempt is less than a day old
    const session = reviewSession("tp1", later(DAY + 60_000), database);
    expect(session.retests).toEqual([sure]);
    expect(session.items.map((i) => i.id)).toEqual([sure, planned]); // listed once, ahead of delayed retrieval

    await attempt(sure, WRONG, "review", later(DAY + 120_000), { confidence: "sure" });
    expect(retests(later(DAY + 180_000))).toEqual([]);
    expect(retests(later(2 * DAY + 180_000))).toEqual([sure]);
    await attempt(sure, KEY, "review", later(2 * DAY + 240_000));
    expect(retests(later(4 * DAY))).toEqual([]);
  });
});
