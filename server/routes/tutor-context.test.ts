import { expect, test } from "bun:test";
import { openDb } from "../db";
import { submitAttempt } from "./grading";
import { insertItem, insertStep, items, seed } from "./test-fixtures";
import { buildTutorContext } from "./tutor-context";

test("tutor context carries the key, misconceptions, attempts and unmastered prerequisites (L17)", async () => {
  const database = openDb(":memory:");
  seed(database);
  const id = insertItem(database, items.single("b1", "b"), { role: "practice", lessonId: "ls1" });
  await submitAttempt(id, { answer: { format: "single", choice: 0 }, hintsUsed: 0, durationMs: 9000, context: "practice" }, { database });

  const context = buildTutorContext({ lessonId: "ls1", itemId: id }, database);
  for (const part of ["[0] key b1 (CORRECT", "SECRET-MISC2-b1", "SECRET-SOL-b1", "SECRET-HINT2-b1", "[2] wrong2 b1 — wrong", "Node A (new)"]) {
    expect(context).toContain(part);
  }

  database.query("UPDATE nodes SET placement = 'known' WHERE id = 'a'").run();
  expect(buildTutorContext({ lessonId: "ls1", itemId: id }, database)).not.toContain("Node A");

  database.query("UPDATE nodes SET placement = NULL, mastery = 'exit_passed' WHERE id = 'a'").run();
  expect(buildTutorContext({ lessonId: "ls1", itemId: id }, database)).not.toContain("Node A");
});

test("tutor context shows a match item's pairs and distractor, and each pair of the learner's attempt", async () => {
  const database = openDb(":memory:");
  seed(database);
  const id = insertItem(database, items.match(), { role: "practice", lessonId: "ls1" });
  await submitAttempt(id, { answer: { format: "match", pairs: [0, 2, 1] }, hintsUsed: 0, durationMs: 9000, context: "practice" }, { database });

  const context = buildTutorContext({ lessonId: "ls1", itemId: id }, database);
  for (const part of ["left0 → right0 (if paired wrongly, misconception: SECRET-MISC0-mt", "Distractor, pairs with nothing: extra", "left2 → extra (wrong); left1 → right1 (right); left0 → right2 (wrong) — wrong"]) {
    expect(context).toContain(part);
  }
});

test("tutor context carries the confidence of each attempt and flags a confident error (L20)", async () => {
  const database = openDb(":memory:");
  seed(database);
  const id = insertItem(database, items.single("b1", "b"), { role: "practice", lessonId: "ls1" });
  const answer = (choice: number, confidence?: "guess" | "sure") =>
    submitAttempt(id, { answer: { format: "single", choice }, hintsUsed: 0, durationMs: 9000, context: "practice", confidence }, { database });
  await answer(1, "guess");
  expect(buildTutorContext({ lessonId: "ls1", itemId: id }, database)).toContain("wrong (confidence before checking: guessing; misconception");
  expect(buildTutorContext({ lessonId: "ls1", itemId: id }, database)).not.toContain("was sure of a wrong answer");
  await answer(0, "sure");
  const context = buildTutorContext({ lessonId: "ls1", itemId: id }, database);
  expect(context).toContain("2. [2] wrong2 b1 — wrong (confidence before checking: sure;");
  expect(context).toContain("The learner was sure of a wrong answer on this item (L20)");
});

test("tutor context for an open worked line carries its question, hidden line, criteria and earlier answers", () => {
  const database = openDb(":memory:");
  seed(database);
  const worked = {
    kind: "worked_example" as const,
    title: "Worked",
    problem: "Problem text",
    cites: [{ sourceId: "src1", quote: "A verbatim quote from the source." }],
    lines: [
      { text: "Line one" },
      { text: "Call the model again with the updated messages", blank: { prompt: "What does the harness do next?", criteria: ["names a new model call", "mentions the updated history"] } },
      { text: "Old line", blank: { prompt: "And then?", answers: ["sends the history to the model"] } },
    ],
  };
  const { stepId } = insertStep(database, 0, worked);
  database.query("INSERT INTO worked_answers (step_id, line_idx, answer, correct) VALUES (?, 1, 'it waits', 0)").run(stepId);

  const context = buildTutorContext({ lessonId: "ls1", stepId, line: 1 }, database);
  for (const part of ["Question: What does the harness do next?", "Hidden line, the reference the learner has not seen: Call the model again", "- mentions the updated history", '"it waits" not accepted', `worked_line_record (stepId "${stepId}", line 1)`]) {
    expect(context).toContain(part);
  }
  expect(buildTutorContext({ lessonId: "ls1", stepId, line: 2 }, database)).toContain("Accepted phrasings, as examples only: sends the history to the model");
  expect(buildTutorContext({ lessonId: "ls1", stepId }, database)).not.toContain("Open question on line");
});

test("tutor context names the lenses the learner asked for and carries the last alternative they read", () => {
  const database = openDb(":memory:");
  seed(database);
  const { stepId, itemIds } = insertStep(database, 0, {
    kind: "explain",
    title: "Explain",
    body: "Body",
    cites: [{ sourceId: "src1", quote: "A verbatim quote from the source." }],
    checks: [items.single("e")],
  });
  expect(buildTutorContext({ lessonId: "ls1", stepId }, database)).not.toContain("explained differently");
  const add = database.query("INSERT INTO alternatives (id, step_id, lens, body, created_at) VALUES (?, ?, ?, ?, ?)");
  add.run("alt1", stepId, "simpler", "Plain version", "2026-01-01T00:00:00.000Z");
  add.run("alt2", stepId, "analogy", "Analogy version", "2026-01-01T00:01:00.000Z");

  const context = buildTutorContext({ lessonId: "ls1", itemId: itemIds[0] }, database);
  expect(context).toContain("explained differently 2 time(s), with the lenses: simpler, analogy");
  expect(context).toContain("Analogy version");
  expect(context).not.toContain("Plain version");
});

test("tutor context carries the passage the learner selected, after the step it comes from", () => {
  const database = openDb(":memory:");
  seed(database);
  const { stepId } = insertStep(database, 0, { kind: "reflect", title: "Reflect", purpose: "why", prompt: "Why does the prior matter?" });

  const context = buildTutorContext({ lessonId: "ls1", stepId, quote: "the share among people with a positive result" }, database);
  expect(context).toContain('The learner asks about this passage, selected on the page:\n"""\nthe share among people with a positive result\n"""');
  expect(context.indexOf("Why does the prior matter?")).toBeLessThan(context.indexOf("asks about this passage"));
  expect(buildTutorContext({ lessonId: "ls1", stepId }, database)).not.toContain("asks about this passage");
});
