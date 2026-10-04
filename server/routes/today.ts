import type { Database } from "bun:sqlite";
import { Hono } from "hono";
import { z } from "zod";
import type { GoalMinutes, TodayView } from "../../shared/api";
import { db } from "../db";
import { readBody } from "./http";
import { activity, localDate } from "./stats";

export const FREEZE_EVERY = 7;
export const MAX_FREEZES = 2;
const DEFAULT_GOAL: GoalMinutes = 10;

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const nextDayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);

export function goalMinutes(database: Database): GoalMinutes {
  const row = database.query<{ value: string }, []>("SELECT value FROM settings WHERE key = 'goal_minutes'").get();
  return row ? (JSON.parse(row.value) as GoalMinutes) : DEFAULT_GOAL;
}

/** Walks every day from the first answered item or reviewed card; today extends the streak only once active. */
function streak(at: Date, database: Database): TodayView["streak"] {
  const first = database
    .query<{ first: string | null }, []>(
      `SELECT min(t) AS first FROM (
         SELECT min(created_at) AS t FROM attempts WHERE gave_up = 0
         UNION ALL SELECT min(reviewed_at) FROM reviews)`,
    )
    .get()!.first;
  const today = startOfDay(at);
  const span = first ? Math.max(1, Math.round((today.getTime() - startOfDay(new Date(first)).getTime()) / 86_400_000) + 1) : 1;
  const days = activity(span, null, at, database);
  let run = 0;
  let best = 0;
  let freezes = 0;
  let toNext = FREEZE_EVERY;
  let frozen: string[] = [];
  days.forEach((day, i) => {
    const isToday = i === days.length - 1;
    if (day.attempts + day.reviews > 0) {
      best = Math.max(best, ++run);
      if (freezes < MAX_FREEZES && --toNext === 0) {
        freezes++;
        toNext = FREEZE_EVERY;
      }
    } else if (isToday) {
      return;
    } else if (run > 0 && freezes > 0) {
      freezes--;
      frozen.push(day.date);
    } else {
      run = 0;
      toNext = FREEZE_EVERY;
      frozen = [];
    }
  });
  const last = days.at(-1)!;
  return {
    days: run,
    best,
    activeToday: last.attempts + last.reviews > 0,
    freezes,
    nextFreezeIn: freezes < MAX_FREEZES ? toNext : null,
    frozen,
  };
}

export function today(at: Date = new Date(), database: Database = db()): TodayView {
  const dayStart = startOfDay(at).toISOString();
  const advanced = database
    .query<{ topic_id: string; id: string; title: string; mastery: "exit_passed" | "mastered" }, [string, string]>(
      `SELECT topic_id, id, title, mastery FROM nodes
       WHERE (mastery = 'mastered' AND mastered_at >= ?1) OR (mastery = 'exit_passed' AND exit_passed_at >= ?2)
       ORDER BY coalesce(mastered_at, exit_passed_at)`,
    )
    .all(dayStart, dayStart)
    .map((n) => ({ topicId: n.topic_id, nodeId: n.id, title: n.title, mastery: n.mastery }));
  const nextDue = database
    .query<{ due: string }, [string]>("SELECT min(due) AS due FROM cards WHERE status = 'active' AND due > ?")
    .get(at.toISOString())?.due;
  let nextReview: TodayView["nextReview"] = null;
  if (nextDue) {
    const date = new Date(nextDue);
    const cards = database
      .query<{ n: number }, [string, string]>("SELECT count(*) AS n FROM cards WHERE status = 'active' AND due > ? AND due < ?")
      .get(at.toISOString(), nextDayStart(date).toISOString())!.n;
    nextReview = { date: localDate(date), cards };
  }
  const minutes = goalMinutes(database);
  return {
    streak: streak(at, database),
    goal: { minutes, done: activity(1, null, at, database)[0]!.minutes },
    advanced,
    nextReview,
  };
}

export const todayRoutes = new Hono();

todayRoutes.get("/today", (c) => c.json(today()));
todayRoutes.put("/goal", async (c) => {
  const { minutes } = await readBody(c, z.object({ minutes: z.union([z.literal(5), z.literal(10), z.literal(20)]) }));
  db().query("INSERT INTO settings (key, value) VALUES ('goal_minutes', ?1) ON CONFLICT (key) DO UPDATE SET value = ?1").run(JSON.stringify(minutes));
  return c.json(today());
});
