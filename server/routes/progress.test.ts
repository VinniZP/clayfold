import { beforeEach, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import type { Step } from "../../shared/schemas";
import { openDb } from "../db";
import { answerWorkedLine, giveUp, GradingError, revealWorkedLine, submitAttempt, takeHint } from "./grading";
import { lessonItemStates, lessonRevealedLines } from "./progress";
import { publicStep, type StepRow } from "./public";
import { insertStep, items, seed } from "./test-fixtures";

let database: Database;
beforeEach(() => {
  database = openDb(":memory:");
  seed(database);
});

const cites = [{ sourceId: "src1", quote: "A verbatim quote from the source." }];
const worked: Step = {
  kind: "worked_example",
  title: "Worked",
  problem: "Problem text",
  cites,
  lines: [{ text: "Line one" }, { text: "SECRET-WORKED-LINE", blank: { prompt: "Next?", answers: ["yes"] } }],
};

function lessonViewJson(): string {
  const steps = database
    .query<StepRow, []>("SELECT * FROM steps ORDER BY idx")
    .all()
    .map((r) => publicStep(r, database));
  return JSON.stringify({ steps, itemStates: lessonItemStates("ls1", database), revealedLines: lessonRevealedLines("ls1", database) });
}

test("an unsolved item's state carries no solution, key, unseen hint or misconception", async () => {
  const { itemIds } = insertStep(database, 0, { kind: "practice", title: "Practice", item: items.single("p") });
  const id = itemIds[0]!;
  takeHint(id, 1, database);
  await submitAttempt(id, { answer: { format: "single", choice: 0 }, hintsUsed: 0, durationMs: 9000, context: "practice", confidence: "sure" }, { database });

  const json = lessonViewJson();
  for (const secret of ["SECRET-SOL", '"solution"', '"correctAnswer"', "SECRET-HINT2", "SECRET-MISC"]) expect(json).not.toContain(secret);
  expect(lessonItemStates("ls1", database)[id]).toEqual({
    attempts: 1,
    wrongAttempts: 1,
    solved: false,
    gaveUp: false,
    hints: ["SECRET-HINT1-p"],
    lastFeedback: "SECRET-FB2-p",
    lastConfidence: "sure",
  });

  giveUp(id, { database });
  expect(lessonItemStates("ls1", database)[id]).toMatchObject({ gaveUp: true, lastFeedback: null, lastConfidence: null, solution: "SECRET-SOL-p", correctAnswer: "key p" });
});

test("a wrong sort answer's placement feedback is restored after reload", async () => {
  const { itemIds } = insertStep(database, 0, { kind: "practice", title: "Practice", item: items.sort() });
  const id = itemIds[0]!;
  const res = await submitAttempt(id, { answer: { format: "sort", categories: [0, 0, 0, 0] }, hintsUsed: 0, durationMs: 9000, context: "practice" }, { database });
  expect(lessonItemStates("ls1", database)[id]!.lastFeedback).toBe(res.feedback);
});

test("an answered prequestion reveals its answer; an unanswered one does not", async () => {
  const { itemIds } = insertStep(database, 0, { kind: "activate", title: "Before", items: [items.single("a1"), items.single("a2")] });
  await submitAttempt(itemIds[0]!, { answer: { format: "single", choice: 0 }, hintsUsed: 0, durationMs: 1, context: "activate" }, { database });
  const states = lessonItemStates("ls1", database);
  expect(states[itemIds[0]!]).toMatchObject({ solution: "SECRET-SOL-a1", correctAnswer: "key a1" });
  expect(states[itemIds[1]!]!.solution).toBeUndefined();
});

test("answered worked lines are revealed after reload; unanswered ones stay hidden", () => {
  const { stepId } = insertStep(database, 0, worked);
  expect(lessonViewJson()).not.toContain("SECRET-WORKED-LINE");
  answerWorkedLine({ id: stepId, content: JSON.stringify(worked) }, 1, "no", { database });
  expect(lessonRevealedLines("ls1", database)).toEqual({ [stepId]: [{ idx: 1, text: "SECRET-WORKED-LINE" }] });
});

test("open blanks and phrase answers go through the tutor: the public view says so and exact checking refuses them", () => {
  const open: Step = {
    ...worked,
    lines: [
      { text: "Line one" },
      { text: "SECRET-OPEN-LINE", blank: { prompt: "What next?", criteria: ["names the next call"] } },
      { text: "SECRET-PHRASE-LINE", blank: { prompt: "And then?", answers: ["calls the model again"] } },
      { text: "SECRET-CLOSED-LINE", blank: { prompt: "Which id?", answers: ["call_7", 'git commit -m "Fix it now"'] } },
    ],
  };
  const { stepId } = insertStep(database, 0, open);
  const lines = (publicStep(database.query<StepRow, []>("SELECT * FROM steps").get()!, database) as Extract<ReturnType<typeof publicStep>, { kind: "worked_example" }>).lines;
  expect(lines.map((l) => l.blankOpen ?? false)).toEqual([false, true, true, false]);
  expect(lessonViewJson()).not.toContain("SECRET-OPEN-LINE");

  const row = { id: stepId, content: JSON.stringify(open) };
  expect(() => answerWorkedLine(row, 1, "it calls the model", { database })).toThrow(GradingError);
  expect(() => answerWorkedLine(row, 2, "calls the model again", { database })).toThrow("answered through the tutor");
  expect(answerWorkedLine(row, 3, "CALL_7", { database })).toEqual({ correct: true, text: "SECRET-CLOSED-LINE" });
  expect(revealWorkedLine(row, 1, { database })).toEqual({ correct: false, text: "SECRET-OPEN-LINE" });
  expect(database.query("SELECT line_idx, answer, correct FROM worked_answers ORDER BY line_idx").all()).toEqual([
    { line_idx: 1, answer: "", correct: 0 },
    { line_idx: 3, answer: "CALL_7", correct: 1 },
  ]);
});

test("hint levels persist in the database across a fresh module instance", async () => {
  const { itemIds } = insertStep(database, 0, { kind: "practice", title: "Practice", item: items.number("h") });
  const id = itemIds[0]!;
  expect(takeHint(id, 1, database).level).toBe(1);

  const specifier = "./grading.ts?fresh-module"; // a query string gives a second, independent module instance
  const fresh = (await import(specifier)) as typeof import("./grading");
  expect(fresh.takeHint).not.toBe(takeHint);
  expect(fresh.takeHint(id, 2, database).level).toBe(2);
  await fresh.submitAttempt(id, { answer: { format: "number", value: 0 }, hintsUsed: 0, durationMs: 1, context: "practice" }, { database });
  expect(database.query<{ hints_used: number }, []>("SELECT hints_used FROM attempts").get()!.hints_used).toBe(2);
  expect(lessonItemStates("ls1", database)[id]!.hints).toEqual(["SECRET-HINT1-h", "SECRET-HINT2-h"]);
});
