import { beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import type { Step } from "../../shared/schemas";
import { openDb } from "../db";
import { publicStep, type StepRow } from "./public";
import { insertStep, items, seed } from "./test-fixtures";

const cites = [{ sourceId: "src1", quote: "A verbatim quote from the source." }];

const steps: Step[] = [
  { kind: "activate", title: "Before we start", items: [items.single("act1"), items.order("act2")] },
  { kind: "explain", title: "Explain", body: "Body text", cites, checks: [items.cloze("ex1"), items.number("ex2")] },
  {
    kind: "worked_example",
    title: "Worked",
    problem: "Problem text",
    cites,
    lines: [{ text: "Line one shown" }, { text: "SECRET-WORKED-LINE", blank: { prompt: "What comes next?", answers: ["SECRET-WORKED-ANS"] } }],
  },
  { kind: "practice", title: "Practice", item: items.multi("pr1") },
  { kind: "reflect", title: "Reflect", prompt: "Why does this work the way it does?", purpose: "why" },
  { kind: "check", title: "Check", items: [items.short("ch1"), items.single("ch2")] },
];

let database: Database;
let inserted: { stepId: string; itemIds: string[] }[];

const row = (i: number) => database.query<StepRow, [string]>("SELECT * FROM steps WHERE id = ?").get(inserted[i]!.stepId)!;

beforeEach(() => {
  database = openDb(":memory:");
  seed(database);
  inserted = steps.map((s, i) => insertStep(database, i, s));
});

describe("publicStep", () => {
  test("serialized steps contain no key, solution, misconception, hint, feedback or rubric text", () => {
    const json = JSON.stringify(steps.map((_, i) => publicStep(row(i), database)));
    for (const secret of ["SECRET-", "9137.25", '"correct"', '"solution"', '"hints"', '"feedback"', '"misconception"', '"blanks"', '"sequence"', '"answer"', '"tolerance"']) {
      expect(json).not.toContain(secret);
    }
  });

  test("items carry item row ids in step order (rowid order is position order)", () => {
    const activate = publicStep(row(0), database);
    const check = publicStep(row(5), database);
    if (activate.kind !== "activate" || check.kind !== "check") throw new Error("kind");
    expect(activate.items.map((i) => i.id)).toEqual(inserted[0]!.itemIds);
    expect(activate.items.map((i) => i.prompt)).toEqual(["Prompt act1", "Prompt act2"]);
    expect(check.items.map((i) => i.prompt)).toEqual(["Prompt ch1", "Prompt ch2"]);
  });

  test("options and order entries follow display_order", () => {
    const activate = publicStep(row(0), database);
    if (activate.kind !== "activate") throw new Error("kind");
    expect(activate.items[0]!.options).toEqual([{ text: "wrong2 act1" }, { text: "wrong1 act1" }, { text: "key act1" }]);
    expect(activate.items[1]!.entries).toEqual(["fourth", "third", "second", "first"]);
    expect(activate.items[0]!.hintCount).toBe(2);
  });

  test("cloze, number, worked lines and cites", () => {
    const explain = publicStep(row(1), database);
    if (explain.kind !== "explain") throw new Error("kind");
    expect(explain.checks[0]).toMatchObject({ format: "cloze", text: "The {{1}} sits before the {{2}}.", blankCount: 2 });
    expect(explain.checks[1]).toMatchObject({ format: "number", unit: "kg" });
    expect(explain.cites).toEqual([{ sourceId: "src1", quote: cites[0]!.quote, url: "https://example.org/a", title: "Example source" }]);

    const worked = publicStep(row(2), database);
    if (worked.kind !== "worked_example") throw new Error("kind");
    expect(worked.lines).toEqual([{ idx: 0, text: "Line one shown" }, { idx: 1, blankPrompt: "What comes next?" }]);
  });

  test("a step whose item rows do not match its items is refused", () => {
    database.query("DELETE FROM items WHERE id = ?").run(inserted[3]!.itemIds[0]!);
    expect(() => publicStep(row(3), database)).toThrow();
  });
});
