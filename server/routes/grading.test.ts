import { beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import type { AttemptRequest } from "../../shared/api";
import type { Answer, Item } from "../../shared/schemas";
import { openDb } from "../db";
import { gradeClosed, gradeShort, giveUp, submitAttempt, takeHint, type JsonPromptRunner } from "./grading";
import { insertItem, items, seed } from "./test-fixtures";

const reversed = (n: number) => Array.from({ length: n }, (_, i) => n - 1 - i);

describe("gradeClosed", () => {
  test("single maps the display index to the authoring index", () => {
    const item = items.single();
    // display [2,1,0]: display 2 is authoring 0, the key
    expect(gradeClosed(item, reversed(3), { format: "single", choice: 2 })).toMatchObject({ correct: true, chosenOption: 0 });
    const wrong = gradeClosed(item, reversed(3), { format: "single", choice: 0 });
    expect(wrong).toMatchObject({ correct: false, chosenOption: 2, misconception: "SECRET-MISC2-s", feedback: "SECRET-FB2-s" });
    expect(() => gradeClosed(item, reversed(3), { format: "single", choice: 3 })).toThrow();
  });

  test("multi compares sets of authoring indices", () => {
    const item = items.multi();
    expect(gradeClosed(item, reversed(3), { format: "multi", choices: [2, 0] }).correct).toBe(true);
    expect(gradeClosed(item, reversed(3), { format: "multi", choices: [0] }).correct).toBe(false);
    expect(gradeClosed(item, reversed(3), { format: "multi", choices: [0, 1, 2] }).correct).toBe(false);
  });

  test("order needs the exact sequence", () => {
    const item = items.order();
    expect(gradeClosed(item, reversed(4), { format: "order", sequence: ["first", "second", "third", "fourth"] }).correct).toBe(true);
    expect(gradeClosed(item, reversed(4), { format: "order", sequence: ["second", "first", "third", "fourth"] }).correct).toBe(false);
  });

  test("cloze matches each blank case-insensitively, trimmed, with collapsed whitespace", () => {
    const item = items.cloze();
    expect(gradeClosed(item, [], { format: "cloze", blanks: ["  alt answer ", "SECOND"] }).correct).toBe(true);
    expect(gradeClosed(item, [], { format: "cloze", blanks: ["secret-blank1", "second"] }).correct).toBe(true);
    expect(gradeClosed(item, [], { format: "cloze", blanks: ["secret-blank1", "third"] }).correct).toBe(false);
    expect(gradeClosed(item, [], { format: "cloze", blanks: ["secret-blank1"] }).correct).toBe(false);
  });

  test("number accepts values within tolerance", () => {
    const item = items.number();
    expect(gradeClosed(item, [], { format: "number", value: 9137.7 }).correct).toBe(true);
    expect(gradeClosed(item, [], { format: "number", value: 9137.8 }).correct).toBe(false);
    expect(gradeClosed(item, [], { format: "number", value: Number.NaN }).correct).toBe(false);
  });

  test("an answer of another format is refused", () => {
    expect(() => gradeClosed(items.number(), [], { format: "single", choice: 0 })).toThrow();
  });
});

const fakeRunner =
  (met: boolean[] | null): JsonPromptRunner =>
  async <T>() =>
    (met ? { ok: true, value: { met } as T, costUsd: 0 } : { ok: false, error: "boom" }) as never;

describe("gradeShort", () => {
  const item = items.short() as Extract<Item, { format: "short" }>;
  test("correct only when every criterion is met", async () => {
    expect((await gradeShort(item, "answer", fakeRunner([true, true]))).correct).toBe(true);
    const partial = await gradeShort(item, "answer", fakeRunner([true, false]));
    expect(partial.correct).toBe(false);
    expect(partial.feedback).toContain("1 of 2");
    expect(partial.feedback).not.toContain("SECRET");
  });
  test("a grader failure or malformed verdict is an error, not a grade", async () => {
    await expect(gradeShort(item, "answer", fakeRunner(null))).rejects.toThrow();
    await expect(gradeShort(item, "answer", fakeRunner([true]))).rejects.toThrow();
  });
});

describe("submitAttempt", () => {
  let database: Database;
  beforeEach(() => {
    database = openDb(":memory:");
    seed(database);
  });
  const req = (answer: Answer, context: AttemptRequest["context"] = "practice"): AttemptRequest => ({ answer, hintsUsed: 0, durationMs: 20000, context });

  test("a wrong answer gets the option's feedback and no solution; the second wrong offers the tutor", async () => {
    const id = insertItem(database, items.single(), { role: "practice", lessonId: "ls1" });
    const first = await submitAttempt(id, req({ format: "single", choice: 0 }), { database });
    expect(first).toMatchObject({ correct: false, feedback: "SECRET-FB2-s", attemptNo: 1, offerTutor: false });
    expect(first.solution).toBeUndefined();
    expect(first.correctAnswer).toBeUndefined();
    const second = await submitAttempt(id, req({ format: "single", choice: 1 }), { database });
    expect(second).toMatchObject({ correct: false, attemptNo: 2, offerTutor: true });
    const row = database.query<{ chosen_option: number; misconception: string }, []>("SELECT chosen_option, misconception FROM attempts ORDER BY rowid DESC LIMIT 1").get()!;
    expect(row).toEqual({ chosen_option: 1, misconception: "SECRET-MISC1-s" });
    const right = await submitAttempt(id, req({ format: "single", choice: 2 }), { database });
    expect(right).toMatchObject({ correct: true, solution: "SECRET-SOL-s", correctAnswer: "key s", attemptNo: 3 });
  });

  test("check items never offer the tutor and refuse hints", async () => {
    const id = insertItem(database, items.single(), { role: "check", lessonId: "ls1" });
    await submitAttempt(id, req({ format: "single", choice: 0 }, "check"), { database });
    const second = await submitAttempt(id, req({ format: "single", choice: 0 }, "check"), { database });
    expect(second.offerTutor).toBe(false);
    expect(() => takeHint(id, 1, database)).toThrow();
  });

  test("prequestions are stored graded but answered ungraded with the solution", async () => {
    const id = insertItem(database, items.single(), { role: "activate", lessonId: "ls1" });
    const res = await submitAttempt(id, req({ format: "single", choice: 0 }, "activate"), { database });
    expect(res).toMatchObject({ correct: null, solution: "SECRET-SOL-s", correctAnswer: "key s" });
    expect(database.query<{ correct: number }, []>("SELECT correct FROM attempts").get()!.correct).toBe(0);
  });

  test("confidence is stored with the attempt and echoed; prequestions and unrated answers store none (L20)", async () => {
    const practice = insertItem(database, items.single(), { role: "practice", lessonId: "ls1" });
    const pre = insertItem(database, items.single("a"), { role: "activate", lessonId: "ls1" });
    const sure = await submitAttempt(practice, { ...req({ format: "single", choice: 0 }), confidence: "sure" }, { database });
    expect(sure).toMatchObject({ correct: false, confidence: "sure" });
    expect((await submitAttempt(practice, req({ format: "single", choice: 2 }), { database })).confidence).toBeNull();
    expect((await submitAttempt(pre, { ...req({ format: "single", choice: 0 }, "activate"), confidence: "guess" }, { database })).confidence).toBeNull();
    const stored = database.query<{ confidence: string | null }, []>("SELECT confidence FROM attempts ORDER BY rowid").all();
    expect(stored.map((r) => r.confidence)).toEqual(["sure", null, null]);
  });

  test("short answers are graded synchronously through the runner", async () => {
    const id = insertItem(database, items.short(), { role: "practice", lessonId: "ls1" });
    const res = await submitAttempt(id, req({ format: "short", text: "my answer" }), { database, runPrompt: fakeRunner([true, true]) });
    expect(res).toMatchObject({ correct: true, correctAnswer: "SECRET-REF-t" });
  });

  test("hints come in order and count toward the next attempt; give-up reveals the answer", async () => {
    const id = insertItem(database, items.number(), { role: "practice", lessonId: "ls1" });
    expect(takeHint(id, 2, database)).toEqual({ level: 1, hint: "SECRET-HINT1-n", hintCount: 2 });
    expect(takeHint(id, 2, database).level).toBe(2);
    expect(takeHint(id, 5, database).level).toBe(2);
    await submitAttempt(id, req({ format: "number", value: 1 }), { database });
    expect(database.query<{ hints_used: number }, []>("SELECT hints_used FROM attempts").get()!.hints_used).toBe(2);
    expect(giveUp(id, { database })).toEqual({ solution: "SECRET-SOL-n", correctAnswer: "9137.25 ± 0.5 kg" });
    expect(database.query<{ n: number }, []>("SELECT count(*) AS n FROM attempts WHERE gave_up = 1").get()!.n).toBe(1);
  });
});
