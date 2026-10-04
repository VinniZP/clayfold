import type { Database } from "bun:sqlite";
import { Hono } from "hono";
import { CONFIDENCE_LEVELS, type ActivityDay, type CalibrationLevel, type CalibrationView, type Confidence, type WeakSpot } from "../../shared/api";
import type { Card, Item } from "../../shared/schemas";
import { db } from "../db";
import { LEECH_LAPSES } from "../review/signals";

const DAY_MS = 24 * 60 * 60 * 1000;
const WEAK_WINDOW_MS = 30 * DAY_MS;
const WEAK_ITEM_WRONG = 2;

export const localDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** One entry per local day (server time zone), oldest first, including days without activity. */
export function activity(days: number, topicId: string | null, at: Date = new Date(), database: Database = db()): ActivityDay[] {
  const start = new Date(at.getFullYear(), at.getMonth(), at.getDate() - (days - 1));
  const out = new Map<string, ActivityDay>();
  for (let i = 0; i < days; i++) {
    const date = localDate(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
    out.set(date, { date, attempts: 0, correct: 0, reviews: 0, minutes: 0 });
  }
  const topicFilter = topicId ? "AND i.topic_id = ?" : "";
  const args = [start.toISOString(), ...(topicId ? [topicId] : [])];
  const attempts = database
    .query<{ created_at: string; correct: number | null; duration_ms: number | null }, string[]>(
      `SELECT a.created_at, a.correct, a.duration_ms FROM attempts a JOIN items i ON i.id = a.item_id
       WHERE a.created_at >= ? AND a.gave_up = 0 ${topicFilter}
       UNION ALL
       SELECT a.created_at, a.correct, a.duration_ms FROM retries a JOIN items i ON i.id = a.item_id
       WHERE a.created_at >= ? ${topicFilter}`,
    )
    .all(...args, ...args);
  const reviews = database
    .query<{ reviewed_at: string; duration_ms: number | null }, string[]>(
      `SELECT r.reviewed_at, r.duration_ms FROM reviews r JOIN cards i ON i.id = r.card_id
       WHERE r.reviewed_at >= ? ${topicFilter}`,
    )
    .all(...args);
  const ms = new Map<string, number>();
  for (const a of attempts) {
    const day = out.get(localDate(new Date(a.created_at)));
    if (!day) continue;
    day.attempts++;
    if (a.correct === 1) day.correct++;
    ms.set(day.date, (ms.get(day.date) ?? 0) + (a.duration_ms ?? 0));
  }
  for (const r of reviews) {
    const day = out.get(localDate(new Date(r.reviewed_at)));
    if (!day) continue;
    day.reviews++;
    ms.set(day.date, (ms.get(day.date) ?? 0) + (r.duration_ms ?? 0));
  }
  for (const day of out.values()) day.minutes = Math.round((ms.get(day.date) ?? 0) / 6000) / 10;
  return [...out.values()];
}

/**
 * Items with at least 2 wrong attempts in the last 30 days and leech cards. Each is ranked by how far it
 * exceeds its own threshold (wrong attempts / 2, lapses / 8), worst first.
 */
export function weakSpots(topicId: string | null, limit: number, at: Date = new Date(), database: Database = db()): WeakSpot[] {
  const topicFilter = topicId ? "AND i.topic_id = ?" : "";
  const since = new Date(at.getTime() - WEAK_WINDOW_MS).toISOString();
  const items = database
    .query<{ id: string; topic_id: string; lesson_id: string | null; node_id: string; content: string; wrong: number; last_misconception: string | null }, (string | number)[]>(
      `SELECT i.id, i.topic_id, i.lesson_id, i.node_id, i.content, count(*) AS wrong,
         (SELECT misconception FROM attempts WHERE item_id = i.id AND correct = 0 AND gave_up = 0
          ORDER BY created_at DESC, rowid DESC LIMIT 1) AS last_misconception
       FROM attempts a JOIN items i ON i.id = a.item_id
       WHERE a.correct = 0 AND a.gave_up = 0 AND a.created_at >= ? AND i.role != 'activate' AND i.status != 'retired' ${topicFilter}
       GROUP BY i.id HAVING count(*) >= ?`,
    )
    .all(since, ...(topicId ? [topicId] : []), WEAK_ITEM_WRONG);
  const cards = database
    .query<{ id: string; topic_id: string; node_id: string; content: string; lapses: number }, (string | number)[]>(
      `SELECT i.id, i.topic_id, i.node_id, i.content, i.lapses FROM cards i
       WHERE i.lapses >= ? AND i.status IN ('active','suspended') ${topicFilter}`,
    )
    .all(LEECH_LAPSES, ...(topicId ? [topicId] : []));
  const ranked: { score: number; spot: WeakSpot }[] = [
    ...items.map((r) => ({
      score: r.wrong / WEAK_ITEM_WRONG,
      spot: {
        kind: "item" as const,
        itemId: r.id,
        topicId: r.topic_id,
        lessonId: r.lesson_id,
        nodeId: r.node_id,
        prompt: (JSON.parse(r.content) as Item).prompt,
        wrongAttempts: r.wrong,
        lastMisconception: r.last_misconception,
      },
    })),
    ...cards.map((r) => ({
      score: r.lapses / LEECH_LAPSES,
      spot: { kind: "card" as const, cardId: r.id, topicId: r.topic_id, nodeId: r.node_id, front: (JSON.parse(r.content) as Card).front, lapses: r.lapses },
    })),
  ];
  return ranked
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => r.spot);
}

/** Rated, graded answers per confidence level, overall and per topic (L20); prequestions and give-ups are left out. */
export function calibration(database: Database = db()): CalibrationView {
  const rows = database
    .query<{ topic_id: string; title: string; confidence: Confidence; attempts: number; correct: number }, []>(
      `SELECT i.topic_id, t.title, a.confidence, count(*) AS attempts, sum(a.correct) AS correct
       FROM attempts a JOIN items i ON i.id = a.item_id JOIN topics t ON t.id = i.topic_id
       WHERE a.confidence IS NOT NULL AND a.correct IS NOT NULL AND a.gave_up = 0 AND i.role != 'activate'
       GROUP BY i.topic_id, a.confidence`,
    )
    .all();
  const levels = (of: typeof rows): CalibrationLevel[] =>
    CONFIDENCE_LEVELS.map((confidence) => {
      const at = of.filter((r) => r.confidence === confidence);
      return { confidence, attempts: at.reduce((n, r) => n + r.attempts, 0), correct: at.reduce((n, r) => n + r.correct, 0) };
    });
  const total = (of: typeof rows) => of.reduce((n, r) => n + r.attempts, 0);
  const byTopic = new Map<string, typeof rows>();
  for (const r of rows) byTopic.set(r.topic_id, [...(byTopic.get(r.topic_id) ?? []), r]);
  const topics = [...byTopic.values()]
    .sort((a, b) => total(b) - total(a))
    .map((of) => ({ topicId: of[0]!.topic_id, title: of[0]!.title, levels: levels(of) }));
  return { overall: levels(rows), topics };
}

const clampInt = (raw: string | undefined, fallback: number, max: number) => Math.min(Math.max(Math.trunc(Number(raw ?? fallback)) || fallback, 1), max);

export const stats = new Hono();

stats.get("/stats/activity", (c) => c.json(activity(clampInt(c.req.query("days"), 7, 366), c.req.query("topicId") || null)));
stats.get("/stats/calibration", (c) => c.json(calibration()));
stats.get("/weak", (c) => c.json(weakSpots(c.req.query("topicId") || null, clampInt(c.req.query("limit"), 10, 100))));
