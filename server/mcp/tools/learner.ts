import type { Database } from "bun:sqlite";
import type { AskLearnerResult, LearnerState, RegenReason } from "../../../shared/tools";
import type { Item } from "../../../shared/schemas";
import { teachbackGaps } from "../../routes/teachback";
import { defineTool, ToolError } from "../context";

export const askLearner = defineTool({
  name: "ask_learner",
  description: `Show the learner a question with clickable options in the app (multi: allow several; allowFree: also accept a typed answer). Use it for interview questions, placement ("what would you do first?") and choices about what to do next. For a question with a correct answer, set shuffle: true (the app shuffles the order, Q3) and keep options of similar length and form (Q4).
Options are concrete answers: the app shows its own field for a typed answer next to them, so an "other" or "my own answer" option only repeats it.
After calling it, end your turn immediately: the learner's answer arrives as the next user message. Returns {shown: true, instruction}.`,
  handler() {
    const result: AskLearnerResult = { shown: true, instruction: "End your turn now and wait for the learner's answer." };
    return { result };
  },
});

type NodeRow = { id: string; title: string; prereqs: string; placement: LearnerState["nodes"][number]["placement"]; mastery: LearnerState["nodes"][number]["mastery"] };

export function learnerState(db: Database, topicId: string, nodeIds?: string[]): LearnerState {
  const topic = db.query<{ id: string; title: string }, [string]>("SELECT id, title FROM topics WHERE id = ?").get(topicId);
  if (!topic) throw new ToolError(`topic "${topicId}" does not exist`);
  const filter = nodeIds && nodeIds.length > 0 ? new Set(nodeIds) : null;
  const inScope = (nodeId: string) => !filter || filter.has(nodeId);

  const allNodes = prerequisiteOrder(
    db.query<NodeRow, [string]>("SELECT id, title, prereqs, placement, mastery FROM nodes WHERE topic_id = ? ORDER BY rowid").all(topicId),
  );
  // A prerequisite the learner placed as known counts as satisfied for sequencing.
  const satisfied = new Set(allNodes.filter((n) => n.mastery === "mastered" || n.placement === "known").map((n) => n.id));
  const nodes = allNodes.filter((n) => inScope(n.id)).map((n) => ({
    id: n.id,
    title: n.title,
    placement: n.placement,
    mastery: n.mastery,
    prereqs: JSON.parse(n.prereqs) as string[],
    unmasteredPrereqs: (JSON.parse(n.prereqs) as string[]).filter((p) => !satisfied.has(p)),
  }));
  const sources = db
    .query<LearnerState["sources"][number], [string]>(
      "SELECT id, title, url, kind, status, origin FROM sources WHERE topic_id = ? ORDER BY fetched_at",
    )
    .all(topicId);

  const attempts = db
    .query<
      { item_id: string; node_id: string; content: string; correct: number; misconception: string | null; hints_used: number; created_at: string },
      [string]
    >(
      `SELECT a.item_id, i.node_id, i.content, a.correct, a.misconception, a.hints_used, a.created_at
       FROM attempts a JOIN items i ON i.id = a.item_id
       WHERE i.topic_id = ? AND a.correct IS NOT NULL
       ORDER BY a.created_at DESC, a.rowid DESC`,
    )
    .all(topicId)
    .filter((a) => inScope(a.node_id))
    .slice(0, 30)
    .map((a) => ({
      itemId: a.item_id,
      nodeId: a.node_id,
      prompt: (JSON.parse(a.content) as Item).prompt,
      correct: a.correct === 1,
      misconception: a.misconception,
      hintsUsed: a.hints_used,
      at: a.created_at,
    }));

  const misconceptionsSeen = db
    .query<{ misconception: string; node_id: string; count: number }, [string]>(
      `SELECT a.misconception, i.node_id, COUNT(*) AS count
       FROM attempts a JOIN items i ON i.id = a.item_id
       WHERE i.topic_id = ? AND a.misconception IS NOT NULL
       GROUP BY a.misconception, i.node_id ORDER BY count DESC`,
    )
    .all(topicId)
    .filter((m) => inScope(m.node_id))
    .map((m) => ({ misconception: m.misconception, count: m.count, nodeId: m.node_id }));

  const notes = db
    .query<{ text: string; quote: string | null; lesson_id: string | null; created_at: string }, [string]>(
      "SELECT text, quote, lesson_id, created_at FROM notes WHERE topic_id = ? ORDER BY created_at DESC LIMIT 50",
    )
    .all(topicId)
    .map((n) => ({ text: n.text, quote: n.quote, lessonId: n.lesson_id, at: n.created_at }));

  const regenQueue = db
    .query<{ id: string; target_type: "item" | "card"; target_id: string; reason: RegenReason }, [string]>(
      "SELECT id, target_type, target_id, reason FROM regen_queue WHERE topic_id = ? AND status = 'open' ORDER BY created_at",
    )
    .all(topicId)
    .map((q) => {
      const table = q.target_type === "item" ? "items" : "cards";
      const row = db.query<{ content: string }, [string]>(`SELECT content FROM ${table} WHERE id = ?`).get(q.target_id);
      return { queueId: q.id, targetType: q.target_type, reason: q.reason, content: row ? JSON.parse(row.content) : null };
    });

  const lessonsDone = db
    .query<{ id: string; title: string; node_ids: string; finished_at: string }, [string]>(
      "SELECT id, title, node_ids, finished_at FROM lessons WHERE topic_id = ? AND status = 'finished' AND practice IS NULL ORDER BY finished_at",
    )
    .all(topicId)
    .map((l) => ({ lessonId: l.id, title: l.title, nodeIds: JSON.parse(l.node_ids) as string[], finishedAt: l.finished_at }))
    .filter((l) => !filter || l.nodeIds.some(inScope));

  const goal =
    db.query<{ title: string }, [string]>("SELECT g.title FROM topics t JOIN topics g ON g.id = t.goal_id WHERE t.id = ?").get(topicId)?.title ?? null;
  const glossary = db
    .query<{ term: string; definition: string; original: string | null }, [string]>("SELECT term, definition, original FROM glossary_terms WHERE topic_id = ? ORDER BY term COLLATE NOCASE")
    .all(topicId);
  const gaps = teachbackGaps(topicId, db).filter((g) => inScope(g.nodeId));
  return { topic: { ...topic, goal }, nodes, sources, recentAttempts: attempts, misconceptionsSeen, teachbackGaps: gaps, notes, regenQueue, lessonsDone, glossary };
}

/** Topological order (every node after its prerequisites), stable by insertion order; the graph is a DAG (graph_set rejects cycles). */
export function prerequisiteOrder<T extends { id: string; prereqs: string }>(rows: T[]): T[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out: T[] = [];
  const placed = new Set<string>();
  const visit = (r: T) => {
    if (placed.has(r.id)) return;
    placed.add(r.id);
    for (const p of JSON.parse(r.prereqs) as string[]) {
      const pre = byId.get(p);
      if (pre) visit(pre);
    }
    out.push(r);
  };
  rows.forEach(visit);
  return out;
}

export const getLearnerState = defineTool({
  name: "get_learner_state",
  description: `Read what the platform knows about the learner in this topic: graph nodes in prerequisite order (every node after its prerequisites) with placement, mastery, prerequisites and unmastered prerequisites; the topic's sources with their sourceIds, origin "learner" marking the learner's own materials; the last 30 graded attempts (item prompt, correct, misconception picked, hints used); misconceptions seen with counts; teachbackGaps (key ideas the learner left out or got wrong when explaining a node, from the latest teach-back on it); the learner's notes; open regeneration-queue entries with their current content (fix them with item_replace); finished lessons.
Call it before planning a lesson or a review session, and when tutoring. Pass nodeIds to narrow nodes, attempts, misconceptions and lessons to those nodes. Returns LearnerState JSON.`,
  handler(ctx, { nodeIds }) {
    return { result: learnerState(ctx.db, ctx.topicId, nodeIds) };
  },
});
