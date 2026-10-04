import type { Database } from "bun:sqlite";
import type { ItemState, LessonView } from "../../shared/api";
import type { Answer, Item } from "../../shared/schemas";
import { db } from "../db";
import { displayLength } from "../gates/content";
import { correctAnswerText, genericFeedback, gradeClosed, GradingError } from "./grading";
import { displayOrder, type ItemRow } from "./public";

type AttemptRow = { item_id: string; answer: string; correct: number | null; chosen_option: number | null; gave_up: number };

/** The feedback the latest answer got: the chosen option's, a match or sort answer's placement feedback, or the generic line. */
function attemptFeedback(item: Item, row: ItemRow, last: AttemptRow): string {
  if (item.format === "single" && last.chosen_option !== null) return item.options[last.chosen_option]?.feedback ?? genericFeedback(last.correct === 1);
  if (item.format === "match" || item.format === "sort") {
    try {
      const grade = gradeClosed(item, displayOrder(row, displayLength(item)), JSON.parse(last.answer) as Answer);
      if (grade.feedback) return grade.feedback;
    } catch (e) {
      // item_replace may have changed the item since this answer.
      if (!(e instanceof GradingError)) throw e;
    }
  }
  return genericFeedback(last.correct === 1);
}

/** Progress on every item of the lesson's published steps; keys leave the server only per L7. */
export function lessonItemStates(lessonId: string, database: Database = db()): Record<string, ItemState> {
  const rows = database
    .query<ItemRow, [string]>(
      `SELECT i.* FROM items i JOIN steps s ON s.id = i.step_id
       WHERE s.lesson_id = ? AND s.status = 'published' ORDER BY s.idx, i.rowid`,
    )
    .all(lessonId);
  const attemptsOf = database.query<AttemptRow, [string]>(
    "SELECT item_id, answer, correct, chosen_option, gave_up FROM attempts WHERE item_id = ? ORDER BY created_at, rowid",
  );
  const maxHint = database.query<{ level: number }, [string]>("SELECT coalesce(max(level), 0) AS level FROM hint_views WHERE item_id = ?");

  const out: Record<string, ItemState> = {};
  for (const row of rows) {
    const item = JSON.parse(row.content) as Item;
    const attempts = attemptsOf.all(row.id);
    const answers = attempts.filter((a) => a.gave_up === 0);
    const solved = answers.some((a) => a.correct === 1);
    const gaveUp = attempts.some((a) => a.gave_up === 1);
    const last = attempts.at(-1);
    const lastFeedback = last && last.gave_up === 0 ? attemptFeedback(item, row, last) : null;
    const reveal = solved || gaveUp || (row.role === "activate" && answers.length > 0);
    out[row.id] = {
      attempts: answers.length,
      wrongAttempts: answers.filter((a) => a.correct === 0).length,
      solved,
      gaveUp,
      hints: item.hints.slice(0, maxHint.get(row.id)!.level),
      lastFeedback,
      ...(reveal ? { solution: item.solution, correctAnswer: correctAnswerText(item) } : {}),
    };
  }
  return out;
}

/** Answered faded lines of the lesson's worked examples, with the text each answer revealed. */
export function lessonRevealedLines(lessonId: string, database: Database = db()): LessonView["revealedLines"] {
  const rows = database
    .query<{ step_id: string; line_idx: number; content: string }, [string]>(
      `SELECT DISTINCT w.step_id, w.line_idx, s.content FROM worked_answers w JOIN steps s ON s.id = w.step_id
       WHERE s.lesson_id = ? AND s.status = 'published' ORDER BY w.step_id, w.line_idx`,
    )
    .all(lessonId);
  const out: LessonView["revealedLines"] = {};
  for (const r of rows) {
    const text = (JSON.parse(r.content) as { lines?: { text: string }[] }).lines?.[r.line_idx]?.text;
    if (text !== undefined) (out[r.step_id] ??= []).push({ idx: r.line_idx, text });
  }
  return out;
}
