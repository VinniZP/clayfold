import { beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import type { Item } from "../../shared/schemas";
import { openDb } from "../db";
import { insertItem, insertLesson, insertStep, items, seed } from "../routes/test-fixtures";
import { assembleTest, eligibleCount, interleaveByNode } from "./practice-test";

const T0 = new Date("2026-01-10T10:00:00.000Z");
const HOUR = 60 * 60 * 1000;

let database: Database;
beforeEach(() => {
  database = openDb(":memory:");
  seed(database);
});

/** Seeded random source, so shuffles repeat between runs. */
function seeded(seed = 7): () => number {
  let x = seed;
  return () => ((x = (x * 16807) % 2147483647) / 2147483647);
}

function attempt(itemId: string, correct: boolean, at: Date = T0): void {
  database
    .query("INSERT INTO attempts (id, item_id, answer, correct, context, created_at) VALUES (?, ?, '{}', ?, 'check', ?)")
    .run(crypto.randomUUID(), itemId, correct ? 1 : 0, at.toISOString());
}

/** A lesson whose exit check holds `checks`; every check item is answered when `finished`. */
function lessonWithCheck(lessonId: string, checks: Item[], finished: boolean, correct = true): string[] {
  if (lessonId !== "ls1") insertLesson(database, lessonId, [...new Set(checks.map((c) => c.nodeId))]);
  const { itemIds } = insertStep(database, 9, { kind: "check", title: "Final check", items: checks }, lessonId);
  if (finished) for (const id of itemIds) attempt(id, correct);
  return itemIds;
}

describe("assembleTest (L20)", () => {
  test("draws graded items of finished lessons only: no prequestions, retired items or unfinished lessons", () => {
    const checks = lessonWithCheck("ls1", [items.single("c1"), items.single("c2")], true);
    const practice = insertItem(database, items.number("p"), { role: "practice", lessonId: "ls1" });
    const explain = insertItem(database, items.cloze("e"), { role: "explain_check", lessonId: "ls1" });
    insertItem(database, items.single("act"), { role: "activate", lessonId: "ls1" });
    const retired = insertItem(database, items.single("old"), { role: "practice", lessonId: "ls1" });
    database.query("UPDATE items SET status = 'retired' WHERE id = ?").run(retired);
    lessonWithCheck("ls2", [items.single("u1", "b"), items.single("u2", "b")], false);
    insertItem(database, items.single("u3", "b"), { role: "practice", lessonId: "ls2" });

    const picked = assembleTest("tp1", 30, database, seeded()).map((r) => r.id);
    expect(picked.sort()).toEqual([...checks, practice, explain].sort());
    expect(eligibleCount("tp1", database)).toBe(4);
  });

  test("a lesson counts once its whole exit check is answered", () => {
    const [first] = lessonWithCheck("ls1", [items.single("c1"), items.single("c2")], false);
    attempt(first!, false);
    expect(eligibleCount("tp1", database)).toBe(0);
  });

  test("covers every node before a weak node gets more seats, weak nodes weighing up to twice as much", () => {
    const strong = Array.from({ length: 6 }, (_, i) => items.single(`a${i}`, "a"));
    const weak = Array.from({ length: 6 }, (_, i) => items.single(`b${i}`, "b"));
    const ids = lessonWithCheck("ls1", [...strong, ...weak], false);
    ids.forEach((id, i) => attempt(id, i < 6));

    const picked = assembleTest("tp1", 6, database, seeded());
    expect(picked.filter((r) => r.node_id === "b")).toHaveLength(4);
    expect(picked.filter((r) => r.node_id === "a")).toHaveLength(2);
  });

  test("prefers the items answered longest ago, never-answered first", () => {
    const [check] = lessonWithCheck("ls1", [items.single("c")], true);
    const recent = insertItem(database, items.single("recent"), { role: "practice", lessonId: "ls1" });
    const fresh = insertItem(database, items.single("fresh"), { role: "practice", lessonId: "ls1" });
    attempt(recent, true, new Date(T0.getTime() + 5 * HOUR));

    const picked = assembleTest("tp1", 2, database, seeded()).map((r) => r.id);
    expect(picked.sort()).toEqual([check!, fresh].sort());
  });

  test("interleaves nodes so that no two neighbours share one while another node has items left", () => {
    const checks = [
      ...Array.from({ length: 4 }, (_, i) => items.single(`a${i}`, "a")),
      ...Array.from({ length: 4 }, (_, i) => items.single(`b${i}`, "b")),
      ...Array.from({ length: 2 }, (_, i) => items.single(`c${i}`, "c")),
    ];
    lessonWithCheck("ls1", checks, true);
    for (const seed of [1, 2, 3, 4, 5]) {
      const nodes = assembleTest("tp1", 10, database, seeded(seed)).map((r) => r.node_id);
      expect(nodes).toHaveLength(10);
      expect(nodes.some((n, i) => i > 0 && n === nodes[i - 1])).toBe(false);
    }
  });

  test("interleaving keeps a node's own order and falls back to repeats only when one node is left", () => {
    const rows = ["a1", "a2", "a3", "b1"].map((id) => ({ id, topic_id: "tp1", node_id: id[0]! }));
    const out = interleaveByNode(rows, seeded()).map((r) => r.id);
    expect(out).toEqual(["a1", "b1", "a2", "a3"]);
  });

  test("a goal draws on the finished lessons of every topic it opened", () => {
    database.query("INSERT INTO topics (id, slug, title, request, kind) VALUES ('g1', 'g1', 'Goal', 'request', 'goal')").run();
    database.query("UPDATE topics SET goal_id = 'g1' WHERE id = 'tp1'").run();
    lessonWithCheck("ls1", [items.single("c1"), items.single("c2")], true);
    expect(eligibleCount("g1", database)).toBe(2);
    expect(assembleTest("g1", 10, database, seeded())).toHaveLength(2);
  });
});
