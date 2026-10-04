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

test("tutor context carries the passage the learner selected, after the step it comes from", () => {
  const database = openDb(":memory:");
  seed(database);
  const { stepId } = insertStep(database, 0, { kind: "reflect", title: "Reflect", purpose: "why", prompt: "Why does the prior matter?" });

  const context = buildTutorContext({ lessonId: "ls1", stepId, quote: "the share among people with a positive result" }, database);
  expect(context).toContain('The learner asks about this passage, selected on the page:\n"""\nthe share among people with a positive result\n"""');
  expect(context.indexOf("Why does the prior matter?")).toBeLessThan(context.indexOf("asks about this passage"));
  expect(buildTutorContext({ lessonId: "ls1", stepId }, database)).not.toContain("asks about this passage");
});
