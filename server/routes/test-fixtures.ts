import type { Database } from "bun:sqlite";
import type { Card, Item, Step } from "../../shared/schemas";
import { newId } from "../db";
import { stepItems } from "./public";

// Test builders: rows shaped as step_submit writes them on publish.

const cite = [{ sourceId: "src1", quote: "A verbatim quote from the source." }];

const common = (tag: string, nodeId = "a") => ({
  prompt: `Prompt ${tag}`,
  bloom: "apply" as const,
  solution: `SECRET-SOL-${tag}`,
  hints: [`SECRET-HINT1-${tag}`, `SECRET-HINT2-${tag}`],
  cites: cite,
  nodeId,
});

export const items = {
  single: (tag = "s", nodeId = "a"): Item => ({
    format: "single",
    ...common(tag, nodeId),
    options: [
      { text: `key ${tag}`, feedback: `SECRET-FB0-${tag}` },
      { text: `wrong1 ${tag}`, misconception: `SECRET-MISC1-${tag}`, feedback: `SECRET-FB1-${tag}` },
      { text: `wrong2 ${tag}`, misconception: `SECRET-MISC2-${tag}`, feedback: `SECRET-FB2-${tag}` },
    ],
    correct: 0,
  }),
  multi: (tag = "m", nodeId = "a"): Item => ({
    format: "multi",
    ...common(tag, nodeId),
    options: [
      { text: `m0 ${tag}`, feedback: `SECRET-FB0-${tag}` },
      { text: `m1 ${tag}`, misconception: `SECRET-MISC1-${tag}`, feedback: `SECRET-FB1-${tag}` },
      { text: `m2 ${tag}`, feedback: `SECRET-FB2-${tag}` },
    ],
    correct: [0, 2],
  }),
  order: (tag = "o", nodeId = "a"): Item => ({ format: "order", ...common(tag, nodeId), sequence: ["first", "second", "third", "fourth"] }),
  cloze: (tag = "c", nodeId = "a"): Item => ({
    format: "cloze",
    ...common(tag, nodeId),
    text: "The {{1}} sits before the {{2}}.",
    blanks: [["SECRET-BLANK1", "Alt  Answer"], ["second"]],
  }),
  number: (tag = "n", nodeId = "a"): Item => ({ format: "number", ...common(tag, nodeId), answer: 9137.25, tolerance: 0.5, unit: "kg" }),
  short: (tag = "t", nodeId = "a"): Item => ({
    format: "short",
    ...common(tag, nodeId),
    referenceAnswer: `SECRET-REF-${tag}`,
    rubric: [`SECRET-RUBRIC1-${tag}`, `SECRET-RUBRIC2-${tag}`],
  }),
};

/** Topic tp1 with nodes a; b and c (both need a); d. Source src1, lesson ls1. */
export function seed(database: Database): void {
  database.query("INSERT INTO topics (id, slug, title, request) VALUES ('tp1', 'tp1', 'Topic', 'request')").run();
  const node = database.query("INSERT INTO nodes (topic_id, id, title, kind, summary, prereqs) VALUES ('tp1', ?, ?, 'knowledge', ?, ?)");
  node.run("a", "Node A", "Summary of node A", "[]");
  node.run("b", "Node B", "Summary of node B", '["a"]');
  node.run("c", "Node C", "Summary of node C", '["a"]');
  node.run("d", "Node D", "Summary of node D", "[]");
  database
    .query("INSERT INTO sources (id, topic_id, url, title, kind, note, text, status) VALUES ('src1', 'tp1', 'https://example.org/a', 'Example source', 'docs', 'note', 'text', 'ok')")
    .run();
  database
    .query("INSERT INTO lessons (id, topic_id, title, objective, level, node_ids, outline) VALUES ('ls1', 'tp1', 'Lesson', 'Objective of the lesson', 'novice', '[\"a\"]', '[]')")
    .run();
}

const ROLE: Record<string, string> = { activate: "activate", explain: "explain_check", practice: "practice", check: "check" };

/** Inserts a published step and its item rows (reversed display order). Returns the step id and item ids in step order. */
export function insertStep(database: Database, idx: number, step: Step, lessonId = "ls1"): { stepId: string; itemIds: string[] } {
  const stepId = newId("st");
  database
    .query("INSERT INTO steps (id, lesson_id, idx, kind, content, status) VALUES (?, ?, ?, ?, ?, 'published')")
    .run(stepId, lessonId, idx, step.kind, JSON.stringify(step));
  const itemIds = stepItems(step).map((item) => insertItem(database, item, { stepId, lessonId, role: ROLE[step.kind]! }));
  return { stepId, itemIds };
}

export function insertItem(
  database: Database,
  item: Item,
  opts: { stepId?: string | null; lessonId?: string | null; role: string; displayOrder?: number[] | null },
): string {
  const id = newId("it");
  const length = "options" in item ? item.options.length : "sequence" in item ? item.sequence.length : 0;
  const order = opts.displayOrder === undefined ? (length ? Array.from({ length }, (_, i) => length - 1 - i) : null) : opts.displayOrder;
  database
    .query(
      "INSERT INTO items (id, topic_id, lesson_id, step_id, role, node_id, format, content, display_order) VALUES (?, 'tp1', ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(id, opts.lessonId ?? null, opts.stepId ?? null, opts.role, item.nodeId, item.format, JSON.stringify(item), order ? JSON.stringify(order) : null);
  return id;
}

export function insertCard(database: Database, nodeId = "a", status = "proposed"): string {
  const id = newId("cd");
  const card: Card = { kind: "basic", front: "What is node A?", back: "The first node", nodeId, lens: "fact", cites: cite };
  database.query("INSERT INTO cards (id, topic_id, node_id, content, status) VALUES (?, 'tp1', ?, ?, ?)").run(id, nodeId, JSON.stringify(card), status);
  return id;
}
