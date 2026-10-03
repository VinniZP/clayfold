import type { Database } from "bun:sqlite";
import type { Item } from "../../shared/schemas";
import { db, newId } from "../db";

export type RegenReason = "possible_leak" | "dead_distractor" | "leech" | "learner_report";

export type Signal =
  | { reason: "possible_leak"; fastFirstSightSessions: number }
  | { reason: "dead_distractor"; neverChosen: number[]; attempts: number }
  | { reason: "misconception_confirmed"; option: number; misconception: string | null; times: number };

const LEAK_MS = 8000;
const LEAK_SESSIONS = 2;
/** Attempts on one item more than this far apart belong to different sessions. */
const SESSION_GAP_MS = 30 * 60 * 1000;
const DEAD_DISTRACTOR_ATTEMPTS = 6;
const CONFIRMED_MISCONCEPTION_TIMES = 2;
export const LEECH_LAPSES = 8;
const APPLY_PLUS = new Set(["apply", "analyze", "evaluate", "create"]);

/** Adds an open regen entry unless the target already has one. Returns the entry id, or null when deduplicated. */
export function enqueueRegen(
  target: { topicId: string; type: "item" | "card"; id: string },
  reason: RegenReason,
  signal: unknown,
  database: Database = db(),
): string | null {
  const open = database
    .query("SELECT 1 FROM regen_queue WHERE target_type = ? AND target_id = ? AND status = 'open'")
    .get(target.type, target.id);
  if (open) return null;
  const id = newId("rq");
  database
    .query("INSERT INTO regen_queue (id, topic_id, target_type, target_id, reason, signal) VALUES (?, ?, ?, ?, ?, ?)")
    .run(id, target.topicId, target.type, target.id, reason, JSON.stringify(signal));
  return id;
}

type AttemptRow = {
  correct: number | null;
  chosen_option: number | null;
  misconception: string | null;
  hints_used: number;
  gave_up: number;
  duration_ms: number | null;
  created_at: string;
};

/** Learner-data signals for an item. */
export function itemSignals(itemId: string, database: Database = db()): Signal[] {
  const item = database
    .query<{ role: string; content: string }, [string]>("SELECT role, content FROM items WHERE id = ?")
    .get(itemId);
  if (!item) return [];
  const content = JSON.parse(item.content) as Item;
  const attempts = database
    .query<AttemptRow, [string]>(
      `SELECT correct, chosen_option, misconception, hints_used, gave_up, duration_ms, created_at
       FROM attempts WHERE item_id = ? ORDER BY created_at, rowid`,
    )
    .all(itemId);
  const out: Signal[] = [];

  if ((item.role === "practice" || item.role === "check") && APPLY_PLUS.has(content.bloom)) {
    let sessions = 0;
    let last = -Infinity;
    for (const a of attempts) {
      const at = Date.parse(a.created_at);
      const firstInSession = at - last > SESSION_GAP_MS;
      last = at;
      if (firstInSession && a.correct === 1 && a.hints_used === 0 && a.gave_up === 0 && (a.duration_ms ?? Infinity) < LEAK_MS) {
        sessions++;
      }
    }
    if (sessions >= LEAK_SESSIONS) out.push({ reason: "possible_leak", fastFirstSightSessions: sessions });
  }

  if (content.format === "single") {
    const answered = attempts.filter((a) => a.gave_up === 0 && a.chosen_option !== null);
    const counts = new Map<number, number>();
    for (const a of answered) counts.set(a.chosen_option!, (counts.get(a.chosen_option!) ?? 0) + 1);
    const distractors = content.options.map((_, i) => i).filter((i) => i !== content.correct);
    if (answered.length >= DEAD_DISTRACTOR_ATTEMPTS) {
      const neverChosen = distractors.filter((i) => !counts.has(i));
      if (neverChosen.length) out.push({ reason: "dead_distractor", neverChosen, attempts: answered.length });
    }
    for (const option of distractors) {
      const times = counts.get(option) ?? 0;
      if (times >= CONFIRMED_MISCONCEPTION_TIMES) {
        out.push({ reason: "misconception_confirmed", option, misconception: content.options[option]?.misconception ?? null, times });
      }
    }
  }
  return out;
}

/**
 * Enqueues regeneration for signals that call for it. A confirmed misconception keeps the item: the
 * distractor works, and the attempts rows already carry the misconception for the tutor and learner state.
 */
export function applyItemSignals(itemId: string, database: Database = db()): Signal[] {
  const signals = itemSignals(itemId, database);
  const item = database.query<{ topic_id: string }, [string]>("SELECT topic_id FROM items WHERE id = ?").get(itemId);
  if (!item) return signals;
  for (const s of signals) {
    if (s.reason === "possible_leak" || s.reason === "dead_distractor") {
      enqueueRegen({ topicId: item.topic_id, type: "item", id: itemId }, s.reason, s, database);
    }
  }
  return signals;
}

/** C4: a card with LEECH_LAPSES or more lapses goes to the rewrite queue. */
export function applyCardSignals(cardId: string, database: Database = db()): boolean {
  const card = database
    .query<{ topic_id: string; lapses: number }, [string]>("SELECT topic_id, lapses FROM cards WHERE id = ?")
    .get(cardId);
  if (!card || card.lapses < LEECH_LAPSES) return false;
  return enqueueRegen({ topicId: card.topic_id, type: "card", id: cardId }, "leech", { lapses: card.lapses }, database) !== null;
}
