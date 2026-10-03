import type { Database } from "bun:sqlite";
import type { Cite, Item, PublicCite, PublicItem, PublicStep, Step } from "../../shared/schemas";
import { db } from "../db";

export type ItemRow = {
  id: string;
  topic_id: string;
  lesson_id: string | null;
  step_id: string | null;
  role: "activate" | "check" | "practice" | "explain_check" | "review";
  node_id: string;
  format: string;
  content: string;
  display_order: string | null;
  status: "active" | "flagged" | "retired";
  created_at: string;
};

export type StepRow = { id: string; lesson_id: string; idx: number; kind: string; content: string; status: string };

/** `display_order[d]` is the authoring index shown at display position d; identity when absent. */
export function displayOrder(row: Pick<ItemRow, "display_order">, length: number): number[] {
  const order = row.display_order ? (JSON.parse(row.display_order) as number[]) : null;
  if (order && order.length === length) return order;
  return Array.from({ length }, (_, i) => i);
}

export function publicItem(row: ItemRow): PublicItem {
  const item = JSON.parse(row.content) as Item;
  const out: PublicItem = { id: row.id, format: item.format, prompt: item.prompt, bloom: item.bloom, hintCount: item.hints.length };
  switch (item.format) {
    case "single":
    case "multi":
      out.options = displayOrder(row, item.options.length).map((i) => ({ text: item.options[i]!.text }));
      break;
    case "order":
      out.entries = displayOrder(row, item.sequence.length).map((i) => item.sequence[i]!);
      break;
    case "cloze":
      out.text = item.text;
      out.blankCount = item.blanks.length;
      break;
    case "number":
      if (item.unit) out.unit = item.unit;
      break;
    case "short":
      break;
  }
  return out;
}

/** Authoring items of a step, in the order the step lists them. */
export function stepItems(step: Step): Item[] {
  switch (step.kind) {
    case "activate":
    case "check":
      return step.items;
    case "explain":
      return step.checks;
    case "practice":
      return [step.item];
    default:
      return [];
  }
}

// Publishing a step (step_submit) inserts its items in step order: activate items, explain checks, practice item, check items. Rowid order is position order.
export function stepItemRows(stepId: string, database: Database = db()): ItemRow[] {
  return database.query<ItemRow, [string]>("SELECT * FROM items WHERE step_id = ? ORDER BY rowid").all(stepId);
}

function publicCites(cites: Cite[], database: Database): PublicCite[] {
  const source = database.query<{ url: string; title: string }, [string]>("SELECT url, title FROM sources WHERE id = ?");
  return cites.map((c) => {
    const s = source.get(c.sourceId);
    return { sourceId: c.sourceId, quote: c.quote, url: s?.url ?? "", title: s?.title ?? "" };
  });
}

/** Browser view of a published step: no keys, solutions, misconceptions, hints or feedback (L7). */
export function publicStep(row: StepRow, database: Database = db()): PublicStep {
  const step = JSON.parse(row.content) as Step;
  const rows = stepItemRows(row.id, database);
  const expected = stepItems(step).length;
  if (rows.length !== expected) {
    throw new Error(`step ${row.id}: ${rows.length} item rows for ${expected} authored items`);
  }
  const items = rows.map(publicItem);
  const base = { id: row.id, idx: row.idx };
  switch (step.kind) {
    case "activate":
      return { ...base, kind: "activate", title: step.title, items };
    case "check":
      return { ...base, kind: "check", title: step.title, items };
    case "practice":
      return { ...base, kind: "practice", title: step.title, item: items[0]! };
    case "explain":
      return {
        ...base,
        kind: "explain",
        title: step.title,
        body: step.body,
        ...(step.figure ? { figure: step.figure } : {}),
        checks: items,
        cites: publicCites(step.cites, database),
      };
    case "worked_example":
      return {
        ...base,
        kind: "worked_example",
        title: step.title,
        problem: step.problem,
        lines: step.lines.map((line, idx) => (line.blank ? { idx, blankPrompt: line.blank.prompt } : { idx, text: line.text })),
        ...(step.figure ? { figure: step.figure } : {}),
        cites: publicCites(step.cites, database),
      };
    case "reflect":
      return { ...base, kind: "reflect", title: step.title, prompt: step.prompt, purpose: step.purpose };
  }
}
