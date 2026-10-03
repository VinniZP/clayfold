import type { Database } from "bun:sqlite";
import type { Item, Step } from "../../../shared/schemas";
import type { Violation } from "../../../shared/rules";
import { displayOrderFor, type ItemRole } from "../../gates/content";
import { gateCards, gateItem, recordGates } from "../../gates/pipeline";
import { defineTool, ToolError } from "../context";

type QueueRow = { id: string; target_type: "item" | "card"; target_id: string };
type ReplaceResult = { status: "replaced" | "rejected"; violations: Violation[] };

function nextAttempt(db: Database, type: "item" | "card", id: string): number {
  const row = db
    .query<{ n: number }, [string, string]>("SELECT COALESCE(MAX(attempt), 0) + 1 AS n FROM gate_results WHERE target_type = ? AND target_id = ?")
    .get(type, id);
  return row?.n ?? 1;
}

/** Puts `item` at the position the replaced item holds in its step; rowid order of a step's items is step order. */
function replaceInStep(db: Database, stepId: string, itemId: string, item: Item): void {
  const step = db.query<{ content: string }, [string]>("SELECT content FROM steps WHERE id = ?").get(stepId);
  if (!step) return;
  const pos = db
    .query<{ id: string }, [string]>("SELECT id FROM items WHERE step_id = ? ORDER BY rowid")
    .all(stepId)
    .findIndex((r) => r.id === itemId);
  const content = JSON.parse(step.content) as Step;
  if (pos < 0) return;
  if (content.kind === "activate" || content.kind === "check") content.items[pos] = item;
  else if (content.kind === "explain") content.checks[pos] = item;
  else if (content.kind === "practice") content.item = item;
  db.query("UPDATE steps SET content = ? WHERE id = ?").run(JSON.stringify(content), stepId);
}

export const itemReplace = defineTool({
  name: "item_replace",
  description: `Replace an item or a card listed in get_learner_state().regenQueue (learner signals: a distractor nobody picks, an answer leak, an error report, a card with many lapses).
Pass the queue entry's queueId and either "item" (for targetType item) or "card" (for targetType card). The replacement goes through the same gates as new content (schema, deterministic rules, verbatim quotes Q6, critic), keeps the original's place, and is reshuffled for display.
Returns {status: "replaced", violations: []} and closes the queue entry, or {status: "rejected", violations} and leaves it open: fix the violations and call again.`,
  async handler(ctx, { queueId, item, card }) {
    const entry = ctx.db
      .query<QueueRow, [string, string]>("SELECT id, target_type, target_id FROM regen_queue WHERE id = ? AND topic_id = ? AND status = 'open'")
      .get(queueId, ctx.topicId);
    if (!entry) throw new ToolError(`queue entry "${queueId}" is not an open entry of this topic`);
    const deps = { db: ctx.db, critic: ctx.critic };
    const close = () => ctx.db.query("UPDATE regen_queue SET status = 'done' WHERE id = ?").run(entry.id);

    if (entry.target_type === "item") {
      if (!item || card) throw new ToolError(`queue entry "${queueId}" targets an item; pass "item" only`);
      const row = ctx.db
        .query<{ role: string; step_id: string | null }, [string, string]>("SELECT role, step_id FROM items WHERE id = ? AND topic_id = ?")
        .get(entry.target_id, ctx.topicId);
      if (!row) throw new ToolError(`item "${entry.target_id}" no longer exists`);
      const role: ItemRole = row.role === "review" ? "practice" : (row.role as ItemRole);
      const displayOrder = displayOrderFor(item);
      const run = await gateItem(deps, { topicId: ctx.topicId, item, role, replacesItemId: entry.target_id, displayOrder });
      recordGates(ctx.db, { type: "item", id: entry.target_id, attempt: nextAttempt(ctx.db, "item", entry.target_id) }, run.records);
      if (run.violations.length > 0) return { result: { status: "rejected", violations: run.violations } satisfies ReplaceResult };
      ctx.db.transaction(() => {
        ctx.db
          .query("UPDATE items SET content = ?, node_id = ?, format = ?, display_order = ? WHERE id = ?")
          .run(JSON.stringify(item), item.nodeId, item.format, displayOrder ? JSON.stringify(displayOrder) : null, entry.target_id);
        if (row.step_id) replaceInStep(ctx.db, row.step_id, entry.target_id, item);
        close();
      })();
      return { result: { status: "replaced", violations: [] } satisfies ReplaceResult };
    }

    if (!card || item) throw new ToolError(`queue entry "${queueId}" targets a card; pass "card" only`);
    const exists = ctx.db.query("SELECT 1 FROM cards WHERE id = ? AND topic_id = ?").get(entry.target_id, ctx.topicId);
    if (!exists) throw new ToolError(`card "${entry.target_id}" no longer exists`);
    const [run] = await gateCards(deps, { topicId: ctx.topicId, cards: [card], pathPrefix: "card" });
    const violations = (run!.violations ?? []).map((v) => (v.path ? { ...v, path: v.path.replace(/^card\.0/, "card") } : v));
    recordGates(ctx.db, { type: "card", id: entry.target_id, attempt: nextAttempt(ctx.db, "card", entry.target_id) }, run!.records);
    if (violations.length > 0) return { result: { status: "rejected", violations } satisfies ReplaceResult };
    ctx.db.transaction(() => {
      ctx.db.query("UPDATE cards SET content = ?, node_id = ? WHERE id = ?").run(JSON.stringify(card), card.nodeId, entry.target_id);
      close();
    })();
    return { result: { status: "replaced", violations: [] } satisfies ReplaceResult };
  },
});
