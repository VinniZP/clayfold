import { expect, test } from "bun:test";
import { stripTermMarks, stripTermMarksDeep, termMarks } from "./terms";

test("termMarks reads the surface and the term of each mark", () => {
  expect(termMarks("Run [[commits|Commit]] after [[Staging area]]; [[|x]] and [[a|b|c]] are not marks.")).toEqual([
    { surface: "commits", term: "Commit" },
    { surface: "Staging area", term: "Staging area" },
  ]);
});

test("stripping leaves the surface everywhere except in cites", () => {
  expect(stripTermMarks("Two [[commits|Commit]] here")).toBe("Two commits here");
  const step = { body: "A [[Commit]]", items: [{ prompt: "[[commits|Commit]]?", cites: [{ quote: "[[kept]]" }] }] };
  expect(stripTermMarksDeep(step)).toEqual({ body: "A Commit", items: [{ prompt: "commits?", cites: [{ quote: "[[kept]]" }] }] });
});
