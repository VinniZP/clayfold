import type { Database } from "bun:sqlite";
import type { Crown } from "../../shared/api";
import { CROWN_SHARE, FOCUS_AWAY_MS, type Metric } from "../../shared/game";
import { activity, localDate } from "../routes/stats";
import { goalMinutes, today } from "../routes/today";

/** How the learner did on a lesson's exit check and challenge, from the first attempt at each item. */
export type LessonProgress = {
  checkItems: number;
  answered: number;
  firstRight: number;
  /** null: the lesson has no published challenge. */
  challengeRight: boolean | null;
  crown: Crown | null;
};

type FirstAttempt = { lesson_id: string; role: string; is_challenge: number; attempts: number; correct: number | null; hints_used: number | null };

export function lessonProgress(database: Database): Map<string, LessonProgress> {
  const rows = database
    .query<FirstAttempt, []>(
      `SELECT i.lesson_id, i.role,
              (s.idx = l.challenge_idx) AS is_challenge,
              (SELECT count(*) FROM attempts a WHERE a.item_id = i.id) AS attempts,
              (SELECT a.correct FROM attempts a WHERE a.item_id = i.id ORDER BY a.created_at, a.rowid LIMIT 1) AS correct,
              (SELECT a.hints_used FROM attempts a WHERE a.item_id = i.id ORDER BY a.created_at, a.rowid LIMIT 1) AS hints_used
       FROM items i JOIN steps s ON s.id = i.step_id JOIN lessons l ON l.id = i.lesson_id
       WHERE s.status = 'published' AND (i.role = 'check' OR s.idx = l.challenge_idx)`,
    )
    .all();
  const out = new Map<string, LessonProgress>();
  for (const r of rows) {
    const p = out.get(r.lesson_id) ?? { checkItems: 0, answered: 0, firstRight: 0, challengeRight: null, crown: null };
    if (r.is_challenge) {
      p.challengeRight = (p.challengeRight ?? true) && r.correct === 1 && r.hints_used === 0;
    } else {
      p.checkItems++;
      if (r.attempts > 0) p.answered++;
      if (r.correct === 1) p.firstRight++;
    }
    out.set(r.lesson_id, p);
  }
  for (const p of out.values()) {
    if (p.checkItems === 0 || p.answered < p.checkItems || p.firstRight < Math.ceil(CROWN_SHARE * p.checkItems)) continue;
    p.crown = p.challengeRight ? "gold" : "silver";
  }
  return out;
}

/** Local dates, oldest first, on which the minutes studied reached the daily goal. */
export function goalDays(at: Date, database: Database): string[] {
  const first = database
    .query<{ first: string | null }, []>(
      "SELECT min(t) AS first FROM (SELECT min(created_at) AS t FROM attempts UNION ALL SELECT min(reviewed_at) FROM reviews)",
    )
    .get()!.first;
  if (!first) return [];
  const start = new Date(first);
  const span = Math.round((new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime() - new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime()) / 86_400_000) + 1;
  const goal = goalMinutes(database);
  return activity(Math.max(1, span), null, at, database)
    .filter((d) => d.minutes >= goal)
    .map((d) => d.date);
}

const count = (database: Database, sql: string): number => database.query<{ n: number }, []>(sql).get()!.n;

export function metrics(at: Date, database: Database): Record<Metric, number> {
  const reviewDays = new Set(
    database
      .query<{ reviewed_at: string }, []>("SELECT reviewed_at FROM reviews")
      .all()
      .map((r) => localDate(new Date(r.reviewed_at))),
  );
  return {
    answers: count(database, "SELECT count(*) AS n FROM attempts WHERE correct IS NOT NULL"),
    comebacks: count(
      database,
      `SELECT count(*) AS n FROM items i WHERE EXISTS (
         SELECT 1 FROM attempts w JOIN attempts r ON r.item_id = w.item_id AND r.correct = 1
           AND (r.created_at > w.created_at OR (r.created_at = w.created_at AND r.rowid > w.rowid))
         WHERE w.item_id = i.id AND w.correct = 0)`,
    ),
    tutorChats: count(
      database,
      "SELECT count(DISTINCT c.id) AS n FROM conversations c JOIN messages m ON m.conversation_id = c.id AND m.role = 'user' WHERE c.kind = 'tutor'",
    ),
    reflections: count(database, "SELECT count(*) AS n FROM notes n JOIN steps s ON s.id = n.step_id WHERE s.kind = 'reflect'"),
    reviews: count(database, "SELECT count(*) AS n FROM reviews"),
    reviewDays: reviewDays.size,
    streak: today(at, database).streak.best,
    goalDays: goalDays(at, database).length,
    focusedLessons: database
      .query<{ n: number }, [number]>("SELECT count(DISTINCT lesson_id) AS n FROM focus_runs WHERE longest_away_ms <= ?")
      .get(FOCUS_AWAY_MS)!.n,
  };
}

/** Nodes of each course past the exit check (mastered included), and all its nodes. */
export function courseNodes(database: Database): Map<string, { passed: number; total: number }> {
  return new Map(
    database
      .query<{ topic_id: string; passed: number; total: number }, []>(
        "SELECT topic_id, count(*) FILTER (WHERE mastery IN ('exit_passed','mastered')) AS passed, count(*) AS total FROM nodes GROUP BY topic_id",
      )
      .all()
      .map((r) => [r.topic_id, { passed: r.passed, total: r.total }]),
  );
}

export const courseComplete = (nodes: { passed: number; total: number } | undefined): boolean => !!nodes && nodes.total > 0 && nodes.passed === nodes.total;
