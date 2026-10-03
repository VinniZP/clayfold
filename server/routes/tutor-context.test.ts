import { expect, test } from "bun:test";
import { openDb } from "../db";
import { submitAttempt } from "./grading";
import { insertItem, items, seed } from "./test-fixtures";
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
