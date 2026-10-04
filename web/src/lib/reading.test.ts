import { expect, test } from "bun:test";
import { parseReading, READING_DEFAULTS } from "./reading";

test("nothing stored, or storage that is not a JSON object, gives the defaults", () => {
  for (const raw of [null, "", "not json", "null", "42", '"serif"', "[]"]) expect(parseReading(raw)).toEqual(READING_DEFAULTS);
});

test("each stored value is kept when known and replaced by its default when not", () => {
  expect(parseReading(JSON.stringify({ size: "xl", leading: "loose", measure: "wide", font: 3, motion: "reduce", extra: "x" }))).toEqual({
    size: "xl",
    leading: "comfortable",
    measure: "wide",
    font: "standard",
    motion: "reduce",
  });
});
