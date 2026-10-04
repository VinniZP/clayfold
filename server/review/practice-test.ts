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

/** Lessons of the scope the learner has completed (every exit-check item answered), and completed practice sets. */
export function finishedLessons(scopeId: string, database: Database = db()): string[] {
  const topics = scopeTopics(scopeId, database);
  return database
    .query<{ id: string; practice: string | null }, [string]>("SELECT id, practice FROM lessons WHERE topic_id IN (SELECT value FROM json_each(?)) ORDER BY created_at")
    .all(JSON.stringify(topics))
    .filter((l) => learnerStatus(l.id, database, l.practice !== null) === "completed")
    .map((l) => l.id);
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

/** Nodes of a topic, and how many of them passed the exit check (L12): the topic is complete when all did. */
export function topicNodes(topicId: string, database: Database = db()): { passed: number; total: number } {
  return database
    .query<{ passed: number; total: number }, [string]>(
      "SELECT count(*) FILTER (WHERE mastery IN ('exit_passed','mastered')) AS passed, count(*) AS total FROM nodes WHERE topic_id = ?",
    )
    .get(topicId)!;
}

/** Best share answered right across the topic's graded finals (L21); null before one. */
export function bestFinalShare(topicId: string, database: Database = db()): number | null {
  return database
    .query<{ best: number | null }, [string]>(
      `SELECT max(1.0 * (SELECT count(*) FROM practice_test_items q WHERE q.test_id = p.id AND q.correct = 1)
                      / (SELECT count(*) FROM practice_test_items q WHERE q.test_id = p.id)) AS best
       FROM practice_tests p WHERE p.topic_id = ? AND p.kind = 'final' AND p.status = 'done'`,
    )
    .get(topicId)!.best;
}

/**
 * True once the node was practised again after `since`: a correct graded lesson or review answer, a correct
 * practice-test answer, or one of its cards rated Good or Easy. Unlocks a final's retake (L21).
 */
export function practisedSince(topicId: string, nodeId: string, since: string, database: Database = db()): boolean {
  return (
    database
      .query<{ done: number }, [string, string, string]>(
        `SELECT EXISTS (
           SELECT 1 FROM attempts a JOIN items i ON i.id = a.item_id
            WHERE i.topic_id = ?1 AND i.node_id = ?2 AND i.role != 'activate' AND a.correct = 1 AND a.created_at > ?3
           UNION ALL
           SELECT 1 FROM practice_test_items q JOIN practice_tests p ON p.id = q.test_id
            WHERE p.kind = 'practice' AND q.topic_id = ?1 AND q.node_id = ?2 AND q.correct = 1 AND q.answered_at > ?3
           UNION ALL
           SELECT 1 FROM reviews r JOIN cards c ON c.id = r.card_id
            WHERE c.topic_id = ?1 AND c.node_id = ?2 AND r.rating >= 3 AND r.reviewed_at > ?3
         ) AS done`,
      )
      .get(topicId, nodeId, since)!.done === 1
  );
}
