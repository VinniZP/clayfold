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

  test("match maps both sides through the display order and marks each pair", () => {
    const item = items.match();
    // Left shown as left2, left1, left0; right shown as extra, right2, right1, right0.
    const order = [2, 1, 0, 3, 2, 1, 0];
    expect(gradeClosed(item, order, { format: "match", pairs: [1, 2, 3] })).toMatchObject({ correct: true, feedback: null, marks: [true, true, true] });
    const wrong = gradeClosed(item, order, { format: "match", pairs: [0, 2, 1] });
    expect(wrong).toMatchObject({ correct: false, chosenOption: null, misconception: "SECRET-MISCX-mt", marks: [false, true, false] });
    expect(wrong.feedback).toBe("1 of 3 placed right.\n\n- **left2**: SECRET-FBX-mt\n- **left0**: SECRET-FB0-mt");
    expect(() => gradeClosed(item, order, { format: "match", pairs: [1, 2, 9] })).toThrow();
    expect(() => gradeClosed(item, order, { format: "match", pairs: [1, 2] })).toThrow();
  });

  test("sort compares each entry's category; a misplacement without a mistake only counts", () => {
    const item = items.sort();
    // Entries shown as e3, e2, e1, e0.
    expect(gradeClosed(item, reversed(4), { format: "sort", categories: [1, 0, 1, 0] })).toMatchObject({ correct: true, marks: [true, true, true, true] });
    const wrong = gradeClosed(item, reversed(4), { format: "sort", categories: [0, 0, 0, 0] });
    expect(wrong).toMatchObject({ correct: false, misconception: "SECRET-MISC1-so", marks: [false, true, false, true] });
    expect(wrong.feedback).toBe("2 of 4 placed right.\n\n- **e1**: SECRET-FB1-so");
    expect(gradeClosed(item, reversed(4), { format: "sort", categories: [0, 0, 1, 0] }).feedback).toBe("3 of 4 placed right.");
    expect(() => gradeClosed(item, reversed(4), { format: "sort", categories: [1, 0, 2, 0] })).toThrow();
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

  test("match and sort answers carry marks; the key and solution come only with the right answer", async () => {
    const id = insertItem(database, items.match(), { role: "practice", lessonId: "ls1" });
    const wrong = await submitAttempt(id, req({ format: "match", pairs: [0, 2, 1] }), { database });
    expect(wrong).toMatchObject({ correct: false, marks: [false, true, false] });
    expect(wrong.correctAnswer).toBeUndefined();
    expect(database.query<{ misconception: string }, []>("SELECT misconception FROM attempts").get()!.misconception).toBe("SECRET-MISCX-mt");
    const right = await submitAttempt(id, req({ format: "match", pairs: [1, 2, 3] }), { database });
    expect(right).toMatchObject({ correct: true, marks: [true, true, true], correctAnswer: "left0 → right0; left1 → right1; left2 → right2" });
    const sortId = insertItem(database, items.sort(), { role: "practice", lessonId: "ls1" });
    expect(giveUp(sortId, { database }).correctAnswer).toBe("catA: e0, e2; catB: e1, e3");
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
