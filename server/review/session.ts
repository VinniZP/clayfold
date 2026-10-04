import type { Database } from "bun:sqlite";
import type { ReviewCard, ReviewSession } from "../../shared/api";
import type { Card, PublicItem } from "../../shared/schemas";
import { db } from "../db";
import { publicItem, type ItemRow } from "../routes/public";

const DAY_MS = 24 * 60 * 60 * 1000;
const ITEMS_PER_NODE = 2;
const MAX_CARDS = 100;
const MAX_RETESTS = 10;
const GRADED_ROLES = "('check','practice','explain_check','review')";
const MAX_TEST_MISSES = 20;

/** Groups nodes into clusters of siblings: nodes that share at least one prerequisite. */
function siblingClusters(nodes: { id: string; prereqs: string[] }[]): string[][] {
  const parent = new Map(nodes.map((n) => [n.id, n.id]));
  const find = (x: string): string => {
    while (parent.get(x) !== x) x = parent.get(x)!;
    return x;
  };
  const byPrereq = new Map<string, string>();
  for (const n of nodes) {
    for (const p of n.prereqs) {
      const other = byPrereq.get(p);
      if (other) parent.set(find(n.id), find(other));
      else byPrereq.set(p, n.id);
    }
  }
  const clusters = new Map<string, string[]>();
  for (const n of nodes) {
    const root = find(n.id);
    clusters.set(root, [...(clusters.get(root) ?? []), n.id]);
  }
  return [...clusters.values()];
}

/** Round-robin across the lists: a1 b1 a2 b2 ... */
function interleave<T>(lists: T[][]): T[] {
  const out: T[] = [];
  for (let i = 0; lists.some((l) => i < l.length); i++) for (const l of lists) if (i < l.length) out.push(l[i]!);
  return out;
}

/**
 * L20: items with a wrong answer rated "sure" and no correct review answer since, once a day has passed
 * since their latest attempt, whatever the mastery of their node. Oldest confident error first.
 */
export function retestItems(topicId: string | null, at: Date = new Date(), database: Database = db()): ItemRow[] {
  return database
    .query<ItemRow, string[]>(
      `SELECT i.* FROM items i
       JOIN (SELECT a.item_id, min(a.created_at) AS since FROM attempts a
             WHERE a.confidence = 'sure' AND a.correct = 0 AND a.gave_up = 0 AND NOT EXISTS (
               SELECT 1 FROM attempts r WHERE r.item_id = a.item_id AND r.context = 'review' AND r.correct = 1 AND r.created_at > a.created_at)
             GROUP BY a.item_id) e ON e.item_id = i.id
       WHERE i.status = 'active' AND i.role IN ${GRADED_ROLES} ${topicId ? "AND i.topic_id = ?" : ""}
         AND (SELECT max(created_at) FROM attempts WHERE item_id = i.id) <= ?
       ORDER BY e.since, i.rowid
       LIMIT ${MAX_RETESTS}`,
    )
    .all(...(topicId ? [topicId] : []), new Date(at.getTime() - DAY_MS).toISOString());
}

/**
 * Due cards, retests of confident errors (L20), delayed-retrieval items (L12) for nodes whose exit check passed
 * at least a day ago, then missed practice-test questions. L14: delayed-retrieval items interleave only within a cluster of confusable nodes
 * and stay blocked otherwise; siblings that share a prerequisite stand in for "confusable" (a heuristic, not a
 * measure of similarity).
 * Due cards plus delayed-retrieval items (L12) for nodes whose exit check passed at least a day ago, then missed
 * practice-test questions.
 * L14: items interleave only within a cluster of confusable nodes and stay blocked otherwise; siblings
 * that share a prerequisite stand in for "confusable" (a heuristic, not a measure of similarity).
 */
export function reviewSession(topicId: string | null, at: Date = new Date(), database: Database = db()): ReviewSession {
  const topicFilter = topicId ? "AND topic_id = ?" : "";
  const topicArgs = topicId ? [topicId] : [];
  const cards = database
    .query<{ id: string; topic_id: string; node_id: string; content: string }, string[]>(
      `SELECT id, topic_id, node_id, content FROM cards WHERE status = 'active' AND due <= ? ${topicFilter} ORDER BY due LIMIT ${MAX_CARDS}`,
    )
    .all(at.toISOString(), ...topicArgs)
    .map((r): ReviewCard => {
      const card = JSON.parse(r.content) as Card;
      return { id: r.id, topicId: r.topic_id, kind: card.kind, front: card.front, back: card.back, nodeId: r.node_id };
    });

  const nodes = database
    .query<{ topic_id: string; id: string; prereqs: string }, string[]>(
      `SELECT topic_id, id, prereqs FROM nodes WHERE mastery = 'exit_passed' AND exit_passed_at <= ? ${topicFilter} ORDER BY topic_id, rowid`,
    )
    .all(new Date(at.getTime() - DAY_MS).toISOString(), ...topicArgs);

  const pick = database.query<ItemRow, [string, string]>(
    `SELECT i.* FROM items i
     WHERE i.topic_id = ? AND i.node_id = ? AND i.status = 'active' AND i.role IN ${GRADED_ROLES}
     ORDER BY (SELECT max(created_at) FROM attempts WHERE item_id = i.id), i.rowid
     LIMIT ${ITEMS_PER_NODE}`,
  );
  const retests = retestItems(topicId, at, database);
  const listed = new Set(retests.map((r) => r.id));
  const items: PublicItem[] = retests.map(publicItem);
  const byTopic = new Map<string, typeof nodes>();
  for (const n of nodes) byTopic.set(n.topic_id, [...(byTopic.get(n.topic_id) ?? []), n]);
  for (const [topic, topicNodes] of byTopic) {
    const clusters = siblingClusters(topicNodes.map((n) => ({ id: n.id, prereqs: JSON.parse(n.prereqs) as string[] })));
    for (const cluster of clusters) {
      items.push(...interleave(cluster.map((nodeId) => pick.all(topic, nodeId).filter((r) => !listed.has(r.id)).map(publicItem))));
    }
  }
  const queued = new Set(items.map((i) => i.id));
  for (const row of testMisses(topicId, at, database)) if (!queued.has(row.id)) items.push(publicItem(row));
  return { cards, items, retests: [...listed] };
}

/**
 * L20: items whose latest practice-test answer was wrong come back a day after that test, until a review attempt
 * answers them.
 */
function testMisses(topicId: string | null, at: Date, database: Database): ItemRow[] {
  return database
    .query<ItemRow, string[]>(
      `WITH latest AS (
         SELECT q.item_id, q.correct, t.submitted_at,
                row_number() OVER (PARTITION BY q.item_id ORDER BY t.submitted_at DESC) AS n
         FROM practice_test_items q JOIN practice_tests t ON t.id = q.test_id
         WHERE t.submitted_at IS NOT NULL AND q.correct IS NOT NULL)
       SELECT i.* FROM latest l JOIN items i ON i.id = l.item_id
       WHERE l.n = 1 AND l.correct = 0 AND l.submitted_at <= ? AND i.status = 'active' ${topicId ? "AND i.topic_id = ?" : ""}
         AND NOT EXISTS (SELECT 1 FROM attempts a WHERE a.item_id = i.id AND a.context = 'review' AND a.created_at > l.submitted_at)
       ORDER BY l.submitted_at, i.rowid
       LIMIT ${MAX_TEST_MISSES}`,
    )
    .all(new Date(at.getTime() - DAY_MS).toISOString(), ...(topicId ? [topicId] : []));
}
