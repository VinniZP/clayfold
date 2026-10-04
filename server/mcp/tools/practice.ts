import type { Database } from "bun:sqlite";
import type { Item, Level, PracticeFocus } from "../../../shared/schemas";
import type { PracticeBrief, PracticeTarget } from "../../../shared/tools";
import { defineTool, ToolError } from "../context";

const BRIEF_LIMIT = 10;
const EXISTING_LIMIT = 30;
const PROMPT_CHARS = 400;

export type PracticeSpec = { focus: PracticeFocus; seedItemId: string | null };

const clip = (text: string) => (text.length > PROMPT_CHARS ? `${text.slice(0, PROMPT_CHARS)}…` : text);

/**
 * The learner's errors on the nodes, newest first: misconceptions they chose and the items they answered
 * wrongly or gave up on. Prequestions are left out: they are asked before the lesson teaches the answer (L2).
 */
export function practiceTargets(db: Database, topicId: string, nodeIds: string[]): { targets: PracticeTarget[]; missed: PracticeBrief["missed"] } {
  const nodes = JSON.stringify(nodeIds);
  const targets = db
    .query<PracticeTarget, [string, string]>(
      `SELECT a.misconception, i.node_id AS nodeId, count(*) AS count, max(a.created_at) AS lastAt
       FROM attempts a JOIN items i ON i.id = a.item_id
       WHERE i.topic_id = ? AND i.role != 'activate' AND a.misconception IS NOT NULL
         AND i.node_id IN (SELECT value FROM json_each(?))
       GROUP BY a.misconception, i.node_id
       ORDER BY count DESC, lastAt DESC`,
    )
    .all(topicId, nodes);
  const missed = db
    .query<{ id: string; node_id: string; content: string; misconception: string | null; gave_up: number; solved: number; at: string }, [string, string]>(
      `SELECT i.id, i.node_id, i.content,
         (SELECT misconception FROM attempts WHERE item_id = i.id AND misconception IS NOT NULL ORDER BY created_at DESC, rowid DESC LIMIT 1) AS misconception,
         max(a.gave_up) AS gave_up,
         max(a.correct = 1 AND a.gave_up = 0) AS solved,
         max(a.created_at) FILTER (WHERE a.correct = 0) AS at
       FROM items i JOIN attempts a ON a.item_id = i.id
       WHERE i.topic_id = ? AND i.role != 'activate' AND i.node_id IN (SELECT value FROM json_each(?))
       GROUP BY i.id
       HAVING at IS NOT NULL
       ORDER BY at DESC`,
    )
    .all(topicId, nodes)
    .map((r) => ({
      itemId: r.id,
      nodeId: r.node_id,
      prompt: clip((JSON.parse(r.content) as Item).prompt),
      misconception: r.misconception,
      gaveUp: r.gave_up === 1,
      solvedLater: r.solved === 1,
      at: r.at,
    }));
  return { targets, missed };
}

type PracticeRow = { id: string; level: Level; node_ids: string; outline: string; practice: string | null };

export function practiceBrief(db: Database, topicId: string, lessonId: string): PracticeBrief {
  const row = db
    .query<PracticeRow, [string, string]>("SELECT id, level, node_ids, outline, practice FROM lessons WHERE id = ? AND topic_id = ?")
    .get(lessonId, topicId);
  if (!row) throw new ToolError(`lesson "${lessonId}" does not exist in this topic`);
  if (!row.practice) throw new ToolError(`lesson "${lessonId}" is a lesson, not a practice set`);
  const spec = JSON.parse(row.practice) as PracticeSpec;
  const nodeIds = JSON.parse(row.node_ids) as string[];
  const nodes = db
    .query<PracticeBrief["nodes"][number], [string, string]>(
      "SELECT id, title, summary, mastery FROM nodes WHERE topic_id = ? AND id IN (SELECT value FROM json_each(?)) ORDER BY rowid",
    )
    .all(topicId, JSON.stringify(nodeIds));
  const seedRow = spec.seedItemId
    ? db.query<{ id: string; node_id: string; content: string }, [string]>("SELECT id, node_id, content FROM items WHERE id = ?").get(spec.seedItemId)
    : null;
  const seedItem = seedRow ? (JSON.parse(seedRow.content) as Item) : null;
  const { targets, missed } = practiceTargets(db, topicId, nodeIds);
  const existingPrompts = db
    .query<{ nodeId: string; prompt: string }, [string, string]>(
      `SELECT node_id AS nodeId, json_extract(content, '$.prompt') AS prompt FROM items
       WHERE topic_id = ? AND status = 'active' AND node_id IN (SELECT value FROM json_each(?))
       ORDER BY rowid DESC LIMIT ${EXISTING_LIMIT}`,
    )
    .all(topicId, JSON.stringify(nodeIds))
    .map((p) => ({ ...p, prompt: clip(p.prompt) }));
  return {
    lessonId,
    size: (JSON.parse(row.outline) as unknown[]).length,
    focus: spec.focus,
    level: row.level,
    nodes,
    seed:
      seedRow && seedItem
        ? {
            itemId: seedRow.id,
            nodeId: seedRow.node_id,
            format: seedItem.format,
            bloom: seedItem.bloom,
            prompt: clip(seedItem.prompt),
            misconceptions: "options" in seedItem ? seedItem.options.flatMap((o) => (o.misconception ? [o.misconception] : [])) : [],
          }
        : null,
    targets: targets.slice(0, BRIEF_LIMIT),
    missed: missed.slice(0, BRIEF_LIMIT),
    existingPrompts,
  };
}

export const practiceBriefTool = defineTool({
  name: "practice_brief",
  description: `Read what a practice set asks for: its size (one practice step per outline index 0..size-1), focus ("same" level, "harder": every item apply or higher, "mistakes": target the learner's own errors), learner level and graph nodes; the item the learner asked for more practice like (seed), if any; the misconceptions the learner chose on these nodes with counts (targets); items they answered wrongly or gave up on (missed); and prompts of the topic's active items on these nodes, which the new items must not repeat (Q7).
Call it first in a practice-set run. Then submit the items with step_submit (kind "practice", one item per index) and close the set with lesson_finish. Returns PracticeBrief JSON.`,
  handler(ctx, { lessonId }) {
    return { result: practiceBrief(ctx.db, ctx.topicId, lessonId) };
  },
});
