import type { Database } from "bun:sqlite";
import { createEmptyCard, fsrs, generatorParameters, type Card as FsrsCard, type CardInput, type Grade } from "ts-fsrs";
import type { ReviewRating } from "../../shared/api";
import { db, newId } from "../db";
import { updateMasteryAfterCardReview } from "./mastery";
import { applyCardSignals } from "./signals";

/** L15: FSRS default weights, target retention 0.90. */
export const scheduler = fsrs(generatorParameters({ request_retention: 0.9, enable_fuzz: true }));

export function newCardState(at: Date): FsrsCard {
  return createEmptyCard(at);
}

/** Moves a card into review; a card without FSRS state starts due now. */
export function activateCard(cardId: string, at: Date = new Date(), database: Database = db()): void {
  const state = newCardState(at);
  database
    .query("UPDATE cards SET status = 'active', fsrs = ?, due = ?, lapses = 0, reps = 0 WHERE id = ? AND fsrs IS NULL")
    .run(JSON.stringify(state), state.due.toISOString(), cardId);
  database.query("UPDATE cards SET status = 'active' WHERE id = ?").run(cardId);
}

export type ReviewOutcome = { due: string; lapses: number; leech: boolean };

export function reviewCard(
  cardId: string,
  rating: ReviewRating,
  at: Date = new Date(),
  database: Database = db(),
  durationMs: number | null = null,
): ReviewOutcome {
  const row = database
    .query<{ fsrs: string | null; status: string }, [string]>("SELECT fsrs, status FROM cards WHERE id = ?")
    .get(cardId);
  if (!row) throw new Error("card not found");
  if (row.status !== "active") throw new Error("card is not active");
  const state: CardInput | FsrsCard = row.fsrs ? (JSON.parse(row.fsrs) as CardInput) : newCardState(at);
  const { card, log } = scheduler.next(state, at, rating as Grade);
  const due = card.due.toISOString();
  database
    .query("UPDATE cards SET fsrs = ?, due = ?, lapses = ?, reps = ? WHERE id = ?")
    .run(JSON.stringify(card), due, card.lapses, card.reps, cardId);
  database
    .query("INSERT INTO reviews (id, card_id, rating, log, reviewed_at, duration_ms) VALUES (?, ?, ?, ?, ?, ?)")
    .run(newId("rv"), cardId, rating, JSON.stringify(log), at.toISOString(), durationMs === null ? null : Math.round(durationMs));
  updateMasteryAfterCardReview(cardId, rating, at, database);
  const leech = applyCardSignals(cardId, database);
  return { due, lapses: card.lapses, leech };
}
