import type { Database } from "bun:sqlite";
import { beforeEach, expect, test } from "bun:test";
import type { Step } from "../../shared/schemas";
import { openDb } from "../db";
import { giveUp, recordWorkedLine, submitAttempt } from "../routes/grading";
import { insertStep, items, seed } from "../routes/test-fixtures";
import { courseBook, nestHeadings } from "./book";

let database: Database;
beforeEach(() => {
  database = openDb(":memory:");
  seed(database);
  database.query("UPDATE lessons SET status = 'finished', summary = 'What the lesson covered.'").run();
});

const cite = { sourceId: "src1", quote: "A verbatim quote from the source." };
// Fixture items show their options in reverse, so the key (authored first) is the last display option.
const choose = (itemId: string, correct: boolean, context: "activate" | "explain" | "practice" | "check") =>
  submitAttempt(itemId, { answer: { format: "single", choice: correct ? 2 : 0 }, hintsUsed: 0, durationMs: 4000, context }, { database });

test("the book holds a key, solution or faded line only once the lesson page has shown it to the learner", async () => {
  const [a1] = insertStep(database, 0, { kind: "activate", title: "Warm-up", items: [items.single("a1"), items.single("a2")] }).itemIds;
  insertStep(database, 1, { kind: "explain", title: "The idea", body: "The [[core idea|Idea]] in words.", cites: [cite], checks: [items.single("x1")] });
  const worked: Step = {
    kind: "worked_example",
    title: "Walkthrough",
    problem: "A problem.",
    cites: [cite],
    lines: [{ text: "First line." }, { text: "SECRET-LINE-answered", blank: { prompt: "Second line?", answers: ["2"] } }, { text: "SECRET-LINE-open", blank: { prompt: "Third line?", answers: ["3"] } }],
  };
  const { stepId: workedId } = insertStep(database, 2, worked);
  const [p1] = insertStep(database, 3, { kind: "practice", title: "Solved", item: items.single("p1") }).itemIds;
  const [p2] = insertStep(database, 4, { kind: "practice", title: "Wrong once", item: items.single("p2") }).itemIds;
  const [p3] = insertStep(database, 5, { kind: "practice", title: "Given up", item: items.short("p3") }).itemIds;
  const [c1] = insertStep(database, 6, { kind: "check", title: "Exit", items: [items.single("c1"), items.single("c2")] }).itemIds;

  await choose(a1!, false, "activate");
  await choose(p1!, true, "practice");
  await choose(p2!, false, "practice");
  giveUp(p3!, { database });
  await choose(c1!, false, "check");
  recordWorkedLine(workedId, 1, "2", true, database);

  const book = courseBook("tp1", { database });
  expect([...new Set(book.match(/SECRET-[\w-]+/g))].sort()).toEqual(["SECRET-LINE-answered", "SECRET-REF-p3", "SECRET-SOL-a1", "SECRET-SOL-p1", "SECRET-SOL-p3"]);
  expect(book).toContain("**Correct answer:** key p1");
  expect(book).toContain("- key p2"); // options of an unsolved item stay, without marking the key
  expect(book).toContain("Not solved yet.");
  expect(book).toContain("Not attempted yet.");
  expect(book).toContain("_Your turn: Third line?_");
  expect(book).toContain("The core idea in words.");
  expect(book).toContain("_Sources: [1]_");
  expect(book).toContain("## Sources\n\n1. [Example source](<https://example.org/a>)");
});

test("the book has the mission, the map, finished current lessons, the glossary and the learner's notes", () => {
  database.query("UPDATE nodes SET mastery = 'mastered' WHERE id = 'a'").run();
  insertStep(database, 0, { kind: "reflect", title: "Look back", prompt: "Why does it work this way?", purpose: "why" });
  const reflectId = database.query<{ id: string }, []>("SELECT id FROM steps").get()!.id;
  database
    .query("INSERT INTO lessons (id, topic_id, title, objective, level, node_ids, outline, status) VALUES (?, 'tp1', ?, 'Objective of it', 'novice', ?, '[]', ?)")
    .run("draft", "Still writing", '["d"]', "generating");
  database.query("INSERT INTO glossary_terms (topic_id, key, term, definition, original) VALUES ('tp1', 'base rate', 'Base rate', 'How common a condition is.', 'prevalence')").run();
  database.query("INSERT INTO notes (id, topic_id, lesson_id, step_id, quote, text) VALUES ('n1', 'tp1', 'ls1', ?, 'Why does it work this way?', 'Because of base rates.')").run(reflectId);
  database.query("INSERT INTO notes (id, topic_id, lesson_id, quote, text) VALUES ('n2', 'tp1', 'ls1', 'a quoted line', 'Remember this.')").run();

  const book = courseBook("tp1", { database, mission: "# Mission: Topic\n\nLearn it.\n\n## Why\n\n```sh\n# not a heading\n```" });
  expect(book).toStartWith("# Topic\n\n_Course book from Clayfold, ");
  expect(book).toContain("## Mission\n\nLearn it.\n\n### Why\n\n```sh\n# not a heading\n```");
  expect(book).toContain('n0["Node A"]\n  n1["Node B"]');
  expect(book).toContain("n0 --> n1");
  expect(book).toContain("- **Node A** · Knowledge · mastered\n  Summary of node A");
  expect(book).toContain("### 1. Lesson\n\n_Objective of the lesson_\n\nWhat the lesson covered.");
  expect(book).not.toContain("Still writing");
  expect(book).toContain("**Your answer:** Because of base rates.");
  expect(book).toContain("- **Base rate** (prevalence): How common a condition is.");
  expect(book).toContain("## My notes\n\n> a quoted line\n\nRemember this.");
  expect(book.match(/Because of base rates/g)).toHaveLength(1);
});

test("nestHeadings drops the title and moves headings outside code down", () => {
  expect(nestHeadings("# Title\n## A\n```\n# code\n```\n###### Deep", 1)).toBe("### A\n```\n# code\n```\n###### Deep");
});
