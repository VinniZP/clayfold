import type { Database } from "bun:sqlite";
import type { BurrowRoom, CrownsView, GameNudge, GameView, HabitView, RewardView } from "../../shared/api";
import {
  CROWN_SHARE,
  HABITS,
  OUTFIT_ITEMS,
  rankOf,
  RANKS,
  REWARD_PREFIX,
  rewardTier,
  TIER_POINTS,
  type OutfitRef,
  type OutfitSlot,
  type RewardCondition,
} from "../../shared/game";
import type { Resident } from "../../shared/schemas";
import { db, now } from "../db";
import { reviewSession } from "../review/session";
import { learnerStatus, supersedingLesson } from "../routes/lesson-summary";
import { courseComplete, courseNodes, goalDays, lessonProgress, metrics, type LessonProgress } from "./progress";
import { storedOutfit } from "./state";

type RewardRow = {
  id: string;
  topic_id: string;
  topic_title: string;
  source: RewardView["source"];
  ref: string;
  condition: string;
  name: string;
  description: string;
  slot: RewardView["slot"];
  svg: string;
  unlocked_at: string | null;
  seen_at: string | null;
};

type Progress = { done: number; total: number; met: boolean };

function lessonRewardProgress(c: Extract<RewardCondition, { kind: "lesson" }>, p: LessonProgress | undefined): Progress {
  const items = p?.checkItems ?? 0;
  if (c.earnedBy === "complete") return { done: p?.answered ?? 0, total: Math.max(1, items), met: items > 0 && p!.answered === items };
  const needed = Math.max(1, Math.ceil(CROWN_SHARE * items));
  if (c.earnedBy === "silver") return { done: Math.min(p?.firstRight ?? 0, needed), total: needed, met: !!p?.crown };
  return { done: (p?.crown ? 1 : 0) + (p?.challengeRight ? 1 : 0), total: 2, met: p?.crown === "gold" };
}

function rewardProgress(
  database: Database,
  row: RewardRow,
  lessons: Map<string, LessonProgress>,
  courses: ReturnType<typeof courseNodes>,
): Progress {
  const c = JSON.parse(row.condition) as RewardCondition;
  switch (c.kind) {
    case "lesson":
      return lessonRewardProgress(c, lessons.get(c.lessonId));
    case "nodes": {
      const levels = database
        .query<{ mastery: string }, [string, string]>("SELECT mastery FROM nodes WHERE topic_id = ? AND id IN (SELECT value FROM json_each(?))")
        .all(row.topic_id, JSON.stringify(c.nodeIds))
        .map((n) => n.mastery);
      const reached = levels.filter((m) => m === "mastered" || (c.mastery === "exit_passed" && m === "exit_passed")).length;
      return { done: reached, total: Math.max(1, levels.length), met: levels.length > 0 && reached === levels.length };
    }
    case "stage": {
      const entries = database
        .query<{ topic_id: string | null }, [string, string]>("SELECT topic_id FROM goal_plan WHERE goal_id = ? AND stage = ?")
        .all(row.topic_id, c.stage);
      const done = entries.filter((e) => e.topic_id && courseComplete(courses.get(e.topic_id))).length;
      return { done, total: Math.max(1, entries.length), met: entries.length > 0 && done === entries.length };
    }
  }
}

/** Lesson crowns and goal days; reads only, so the lesson list and the calendar can ask for it often. */
export function crownsView(at: Date = new Date(), database: Database = db()): CrownsView {
  const lessons: CrownsView["lessons"] = {};
  for (const [id, p] of lessonProgress(database)) if (p.crown) lessons[id] = p.crown;
  return { lessons, days: goalDays(at, database) };
}

/** The learning step to take next: a lesson in progress, due reviews, then a lesson not started. */
function nudge(at: Date, database: Database): GameNudge {
  const lessons = database
    .query<{ id: string; title: string; node_ids: string }, []>(
      "SELECT id, title, node_ids FROM lessons WHERE status IN ('ready','finished','generating') ORDER BY created_at DESC, rowid DESC",
    )
    .all()
    .filter((l) => supersedingLesson(l, database) === null)
    .map((l) => ({ ...l, status: learnerStatus(l.id, database) }));
  const started = lessons.find((l) => l.status === "in_progress");
  if (started) return { kind: "continue", lessonId: started.id, title: started.title };
  const review = reviewSession(null, at, database);
  const due = review.cards.length + review.items.length;
  if (due > 0) return { kind: "review", count: due };
  const fresh = lessons.find((l) => l.status === "not_started");
  if (fresh) return { kind: "start", lessonId: fresh.id, title: fresh.title };
  return { kind: "new" };
}

/**
 * The meerkat's state. Unlocks happen here: every reward, habit and rank whose condition holds is stamped
 * with the time it was first seen to hold, so turning the meerkat on rewards past learning at once.
 */
export function gameView(at: Date = new Date(), database: Database = db()): GameView {
  const stamp = now();
  const lessons = lessonProgress(database);
  const courses = courseNodes(database);

  const rows = database
    .query<RewardRow, []>(
      `SELECT r.*, t.title AS topic_title FROM rewards r JOIN topics t ON t.id = r.topic_id
       WHERE r.source != 'lesson' OR EXISTS (SELECT 1 FROM lessons l WHERE l.id = r.ref)
       ORDER BY r.created_at, r.rowid`,
    )
    .all();
  const unlockReward = database.query("UPDATE rewards SET unlocked_at = ? WHERE id = ?");
  const rewards: RewardView[] = rows.map((row) => {
    const p = rewardProgress(database, row, lessons, courses);
    let unlockedAt = row.unlocked_at;
    if (!unlockedAt && p.met) {
      unlockedAt = stamp;
      unlockReward.run(stamp, row.id);
    }
    const condition = JSON.parse(row.condition) as RewardCondition;
    return {
      id: row.id,
      topicId: row.topic_id,
      topicTitle: row.topic_title,
      source: row.source,
      name: row.name,
      description: row.description,
      slot: row.slot,
      svg: row.svg,
      tier: rewardTier(condition),
      condition,
      done: unlockedAt ? p.total : p.done,
      total: p.total,
      unlockedAt,
      seen: row.seen_at !== null,
    };
  });

  const unlocks = new Map(
    database
      .query<{ id: string; unlocked_at: string; seen_at: string | null }, []>("SELECT id, unlocked_at, seen_at FROM unlocks")
      .all()
      .map((u) => [u.id, u]),
  );
  const unlock = database.query("INSERT INTO unlocks (id, unlocked_at) VALUES (?, ?) ON CONFLICT (id) DO NOTHING");
  const measured = metrics(at, database);
  const habits: HabitView[] = HABITS.map((h) => {
    const done = Math.min(measured[h.metric], h.target);
    let row = unlocks.get(h.id);
    if (!row && done >= h.target) {
      unlock.run(h.id, stamp);
      row = { id: h.id, unlocked_at: stamp, seen_at: null };
    }
    return { id: h.id, item: h.item, tier: h.tier, done: row ? h.target : done, target: h.target, unlockedAt: row?.unlocked_at ?? null, seen: !!row?.seen_at };
  });

  const points =
    rewards.reduce((sum, r) => sum + (r.unlockedAt ? TIER_POINTS[r.tier] : 0), 0) +
    habits.reduce((sum, h) => sum + (h.unlockedAt ? TIER_POINTS[h.tier] : 0), 0);
  const { rank, next } = rankOf(points);
  for (let i = 1; i <= rank; i++) if (!unlocks.has(`rank:${i}`)) unlock.run(`rank:${i}`, stamp);
  const rankSeen = rank === 0 || !!unlocks.get(`rank:${rank}`)?.seen_at;

  const progress = [...lessons.values()];
  const crowns = crownsView(at, database);
  return {
    outfit: storedOutfit(database),
    rewards,
    habits,
    rank: { rank, points, next, seen: rankSeen },
    crowns: {
      silver: progress.filter((p) => p.crown === "silver").length,
      gold: progress.filter((p) => p.crown === "gold").length,
      days: crowns.days.length,
    },
    rooms: rooms(database, lessons, courses, stamp),
    nudge: nudge(at, database),
  };
}

/** Courses as chambers; a course's resident becomes a friend once one of its lessons is completed. */
function rooms(database: Database, lessons: Map<string, LessonProgress>, courses: ReturnType<typeof courseNodes>, stamp: string): BurrowRoom[] {
  const completedTopics = new Set(
    database
      .query<{ id: string; topic_id: string }, []>("SELECT id, topic_id FROM lessons")
      .all()
      .filter((l) => {
        const p = lessons.get(l.id);
        return !!p && p.checkItems > 0 && p.answered === p.checkItems;
      })
      .map((l) => l.topic_id),
  );
  const befriend = database.query("UPDATE residents SET befriended_at = ? WHERE topic_id = ? AND befriended_at IS NULL");
  return database
    .query<
      { id: string; title: string; goal_id: string | null; content: string | null; befriended_at: string | null; seen_at: string | null },
      []
    >(
      `SELECT t.id, t.title, t.goal_id, r.content, r.befriended_at, r.seen_at
       FROM topics t LEFT JOIN residents r ON r.topic_id = t.id WHERE t.kind = 'topic' ORDER BY t.created_at, t.rowid`,
    )
    .all()
    .map((t) => {
      let befriendedAt = t.befriended_at;
      if (t.content && !befriendedAt && completedTopics.has(t.id)) {
        befriendedAt = stamp;
        befriend.run(stamp, t.id);
      }
      const nodes = courses.get(t.id) ?? { passed: 0, total: 0 };
      return {
        topicId: t.id,
        title: t.title,
        passed: nodes.passed,
        total: nodes.total,
        goalId: t.goal_id,
        resident: t.content ? { ...(JSON.parse(t.content) as Resident), befriendedAt, seen: t.seen_at !== null } : null,
      };
    });
}

export function markSeen(
  marks: { rewards?: string[]; habits?: string[]; ranks?: number[]; residents?: string[] },
  database: Database = db(),
): void {
  const stamp = now();
  database.transaction(() => {
    for (const id of marks.rewards ?? []) database.query("UPDATE rewards SET seen_at = ? WHERE id = ? AND seen_at IS NULL").run(stamp, id);
    const unlockIds = [...(marks.habits ?? []), ...(marks.ranks ?? []).map((r) => `rank:${r}`)];
    for (const id of unlockIds) database.query("UPDATE unlocks SET seen_at = ? WHERE id = ? AND seen_at IS NULL").run(stamp, id);
    for (const id of marks.residents ?? []) database.query("UPDATE residents SET seen_at = ? WHERE topic_id = ? AND seen_at IS NULL").run(stamp, id);
  })();
}

/** Items the learner may wear, with their slot: built-in items of unlocked habits and reached ranks, and unlocked rewards. */
export function wearable(view: GameView): Map<OutfitRef, OutfitSlot> {
  const out = new Map<OutfitRef, OutfitSlot>();
  for (const h of view.habits) if (h.unlockedAt) out.set(h.item, OUTFIT_ITEMS[h.item]);
  for (const r of RANKS.slice(1, view.rank.rank + 1)) if (r.item) out.set(r.item, OUTFIT_ITEMS[r.item]);
  for (const r of view.rewards) if (r.unlockedAt) out.set(`${REWARD_PREFIX}${r.id}`, r.slot);
  return out;
}
