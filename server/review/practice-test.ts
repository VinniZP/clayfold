import type { Database } from "bun:sqlite";
import { db } from "../db";
import { learnerStatus } from "../routes/lesson-summary";
import type { ItemRow } from "../routes/public";

/** Item roles a practice test draws on; prequestions (L2) are ungraded for the learner and stay out. */
const TEST_ROLES = ["practice", "explain_check", "check"] as const;

type Candidate = ItemRow & { last_seen: string };

/** The topic itself, or every topic a goal's plan opened. */
export function scopeTopics(scopeId: string, database: Database = db()): string[] {
  const scope = database.query<{ kind: string }, [string]>("SELECT kind FROM topics WHERE id = ?").get(scopeId);
  if (!scope) return [];
  if (scope.kind !== "goal") return [scopeId];
  return database.query<{ id: string }, [string]>("SELECT id FROM topics WHERE goal_id = ? ORDER BY created_at").all(scopeId).map((r) => r.id);
}

/** Lessons of the scope the learner has completed: every exit-check item answered. */
export function finishedLessons(scopeId: string, database: Database = db()): string[] {
  const topics = scopeTopics(scopeId, database);
  return database
    .query<{ id: string }, [string]>("SELECT id FROM lessons WHERE topic_id IN (SELECT value FROM json_each(?)) ORDER BY created_at")
    .all(JSON.stringify(topics))
    .map((l) => l.id)
    .filter((id) => learnerStatus(id, database) === "completed");
}

/** Graded, active items of the finished lessons, each with the time it was last answered anywhere ('' when never). */
function candidates(scopeId: string, database: Database): Candidate[] {
  return database
    .query<Candidate, [string, string]>(
      `SELECT i.*, max(
         coalesce((SELECT max(created_at) FROM attempts WHERE item_id = i.id), ''),
         coalesce((SELECT max(answered_at) FROM practice_test_items WHERE item_id = i.id), '')) AS last_seen
       FROM items i
       WHERE i.lesson_id IN (SELECT value FROM json_each(?1)) AND i.status = 'active'
         AND i.role IN (SELECT value FROM json_each(?2))
       ORDER BY i.rowid`,
    )
    .all(JSON.stringify(finishedLessons(scopeId, database)), JSON.stringify(TEST_ROLES));
}

export function eligibleCount(scopeId: string, database: Database = db()): number {
  return candidates(scopeId, database).length;
}

const nodeKey = (r: Pick<ItemRow, "topic_id" | "node_id">) => `${r.topic_id}/${r.node_id}`;

/**
 * Share of a node's items whose first attempt was correct without hints or giving up; null before any attempt.
 * Prequestions are left out: they come before the teaching (L2).
 */
function firstTryAccuracy(topicId: string, nodeId: string, database: Database): number | null {
  const firsts = database
    .query<{ correct: number | null; hints_used: number; gave_up: number }, [string, string]>(
      `SELECT a.correct, a.hints_used, a.gave_up FROM items i
       JOIN attempts a ON a.id = (SELECT id FROM attempts WHERE item_id = i.id ORDER BY created_at, rowid LIMIT 1)
       WHERE i.topic_id = ? AND i.node_id = ? AND i.role != 'activate'`,
    )
    .all(topicId, nodeId);
  if (firsts.length === 0) return null;
  return firsts.filter((f) => f.correct === 1 && f.hints_used === 0 && f.gave_up === 0).length / firsts.length;
}

/** Fisher-Yates with an injectable source, so tests can fix the order. */
function shuffle<T>(list: T[], random: () => number): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/**
 * Orders the picked items so that no two neighbours share a node while another node has items left:
 * each position takes the node with the most items remaining, other than the previous one.
 */
export function interleaveByNode<T extends Pick<ItemRow, "topic_id" | "node_id">>(picked: T[], random: () => number = Math.random): T[] {
  const groups = new Map<string, T[]>();
  for (const item of picked) groups.set(nodeKey(item), [...(groups.get(nodeKey(item)) ?? []), item]);
  const order = shuffle([...groups.keys()], random);
  const out: T[] = [];
  let previous: string | null = null;
  while (out.length < picked.length) {
    const open = order.filter((k) => groups.get(k)!.length > 0);
    const choices = open.filter((k) => k !== previous);
    const key = (choices.length ? choices : open).reduce((best, k) => (groups.get(k)!.length > groups.get(best)!.length ? k : best));
    out.push(groups.get(key)!.shift()!);
    previous = key;
  }
  return out;
}

/**
 * Picks up to `length` items for a practice test (L20). Every node of the finished lessons gets a share weighted
 * 1 to 2 by how often its first tries failed, assigned seat by seat to the node with the highest weight per seat
 * taken (D'Hondt), so all nodes are covered before a weak node gets more. Within a node the least recently answered
 * items come first. The result is interleaved across nodes.
 */
export function assembleTest(scopeId: string, length: number, database: Database = db(), random: () => number = Math.random): ItemRow[] {
  const pools = new Map<string, { weight: number; items: Candidate[] }>();
  for (const c of shuffle(candidates(scopeId, database), random).sort((a, b) => a.last_seen.localeCompare(b.last_seen))) {
    const key = nodeKey(c);
    let pool = pools.get(key);
    if (!pool) pools.set(key, (pool = { weight: 2 - (firstTryAccuracy(c.topic_id, c.node_id, database) ?? 1), items: [] }));
    pool.items.push(c);
  }
  const taken = new Map<string, number>();
  const picked: Candidate[] = [];
  while (picked.length < length) {
    let best: string | null = null;
    let bestScore = -1;
    let bestTaken = 0;
    for (const [key, pool] of pools) {
      const n = taken.get(key) ?? 0;
      const score = pool.weight / (n + 1);
      if (n < pool.items.length && (score > bestScore || (score === bestScore && n < bestTaken))) {
        best = key;
        bestScore = score;
        bestTaken = n;
      }
    }
    if (best === null) break;
    const n = taken.get(best) ?? 0;
    picked.push(pools.get(best)!.items[n]!);
    taken.set(best, n + 1);
  }
  return interleaveByNode(picked, random).map(({ last_seen: _, ...row }) => row);
}
