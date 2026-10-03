import { expect, test } from "bun:test";
import { Report } from "./deterministic";
import { checkTermMarks } from "./terms";

const glossary = new Set(["commit", "staging area"]);
const check = (value: unknown, root: "step" | "item" | "card") => {
  const r = new Report();
  checkTermMarks(value, root, glossary, r);
  return r.violations.map((v) => `${v.path}: ${v.message.split(";")[0]}`);
};

test("marks of glossary terms pass in Markdown fields, case aside", () => {
  expect(check({ kind: "explain", title: "T", body: "Make a [[commits|commit]] from the [[Staging Area]].", checks: [{ prompt: "[[Commit]]?", hints: ["a [[Commit]]"], options: [{ text: "[[Commit]]", feedback: "x" }] }] }, "step")).toEqual([]);
  expect(check({ front: "What is a [[Commit]]?", back: "A snapshot" }, "card")).toEqual([]);
  expect(check({ prompt: "Which [[Commit]]?" }, "item")).toEqual([]);
});

test("an unknown term, a mark outside Markdown fields and a reflect prompt mark fail L19; quotes are not checked", () => {
  expect(check({ kind: "explain", title: "A [[Commit]]", body: "[[Branch]]", cites: [{ quote: "[[Anything]]" }] }, "step")).toEqual([
    "title: term marks belong only in body, problem, prompt, solution, hints, feedback, option and line text, and card sides",
    'body: "Branch" is not in the topic glossary',
  ]);
  expect(check({ kind: "reflect", title: "R", prompt: "Why a [[Commit]]?" }, "step")).toHaveLength(1);
  expect(check({ format: "cloze", text: "A {{1}} is a [[Commit]]", blanks: [["[[Commit]]"]] }, "item")).toHaveLength(2);
});
