import { describe, expect, test } from "bun:test";
import type { ItemState } from "@shared/api";
import { afterNarration, blockAt, explainNear, itemSettled, upcoming, type Track } from "./listen";

const explain = (checks: string[] = [], state: Track["state"] = "published"): Track => ({ kind: "explain", state, checks });
const other = (kind: string, state: Track["state"] = "published"): Track => ({ kind, state, checks: [] });

describe("afterNarration", () => {
  const tracks = [other("activate"), explain(["a", "b"]), explain(["c"]), other("worked_example"), explain(), other("check")];

  test("stops for the step's open checks", () => {
    expect(afterNarration(tracks, 1, { a: true })).toEqual({ type: "checks" });
  });

  test("goes on to an explanation that comes right after once the checks are answered", () => {
    expect(afterNarration(tracks, 1, { a: true, b: true })).toEqual({ type: "advance", pos: 2 });
  });

  test("waits for the learner when other steps come before the next explanation", () => {
    expect(afterNarration(tracks, 2, { c: true })).toEqual({ type: "wait", pos: 4 });
  });

  test("dropped steps do not separate explanations; one still being written is waited for", () => {
    expect(afterNarration([explain(), other("practice", "dropped"), explain()], 0, {})).toEqual({ type: "advance", pos: 2 });
    expect(afterNarration([explain(), explain([], "checking")], 0, {})).toEqual({ type: "wait", pos: 1 });
  });

  test("ends after the last explanation", () => {
    expect(afterNarration(tracks, 4, {})).toEqual({ type: "end" });
  });
});

test("upcoming finds the next explanation that is not dropped, written or not", () => {
  const tracks = [other("activate"), explain([], "dropped"), other("practice"), explain([], "pending"), explain()];
  expect(upcoming(tracks, 0)).toBe(3);
  expect(upcoming(tracks, 3)).toBe(4);
  expect(upcoming(tracks, 4)).toBe(-1);
});

test("explainNear finds published explanations in either direction", () => {
  const tracks = [explain(), other("practice"), explain([], "dropped"), explain([], "pending"), explain()];
  expect(explainNear(tracks, 0, 1)).toBe(4);
  expect(explainNear(tracks, 4, -1)).toBe(0);
  expect(explainNear(tracks, 0, -1)).toBe(-1);
});

test("an item is settled once solved, given up or awaiting grading, not after a wrong answer", () => {
  const state = (s: Partial<ItemState>): ItemState => ({ attempts: 1, wrongAttempts: 0, solved: false, gaveUp: false, hints: [], lastFeedback: null, ...s });
  expect(itemSettled(undefined)).toBe(false);
  expect(itemSettled(state({ attempts: 0 }))).toBe(false);
  expect(itemSettled(state({ solved: true }))).toBe(true);
  expect(itemSettled(state({}))).toBe(true);
  expect(itemSettled(state({ wrongAttempts: 1 }))).toBe(false);
  expect(itemSettled(state({ wrongAttempts: 1, gaveUp: true }))).toBe(true);
});

test("blockAt maps a time to the block being read, none between blocks", () => {
  const segments = [{ block: 0, start: 0, end: 2 }, { block: 2, start: 2.5, end: 5 }];
  expect(blockAt(segments, 1)).toBe(0);
  expect(blockAt(segments, 2.2)).toBeNull();
  expect(blockAt(segments, 3)).toBe(2);
  expect(blockAt(segments, 5)).toBeNull();
});
