import { expect, test } from "bun:test";
import { excerpt, foldForSearch, markText, plainText } from "./search";

test("plainText keeps what the reader sees of markdown and term marks", () => {
  expect(plainText("## Step\n\nA **bold** [[commits|Commit]] with `git log` and [a link](https://x.org).\n\n- one\n- two<br>three")).toBe(
    "Step A bold commits with git log and a link. one two three",
  );
});

test("folding ignores case and ё and keeps every offset", () => {
  expect(foldForSearch("Ёлка и ЕЛЬ")).toBe("елка и ель");
  expect(foldForSearch("İstanbul")).toHaveLength("İstanbul".length);
  expect(markText("Ёжик в тумане", ["ежик"])).toEqual({ text: "Ёжик в тумане", marks: [[0, 4]] });
});

test("an excerpt cuts at words around the first match and shifts the marks", () => {
  const text = `${"lead ".repeat(30)}the needle sits here ${"tail ".repeat(60)}`.trim();
  const out = excerpt(text, ["needle"])!;
  expect(out.text.startsWith("…lead")).toBe(true);
  expect(out.text.endsWith("tail…")).toBe(true);
  expect(out.marks.map(([a, b]) => out.text.slice(a, b))).toEqual(["needle"]);
  expect(excerpt("no match here", ["needle"])).toBeNull();
  expect(excerpt("no match here", ["needle"], true)).toEqual({ text: "no match here", marks: [] });
});
