import type { Database } from "bun:sqlite";
import { Hono } from "hono";
import { z } from "zod";
import type { MistakeEntry, MistakePattern, MistakeSolution, MistakesView, RetryRequest, RetryResponse, TodayView } from "../../shared/api";
import type { Answer, Item } from "../../shared/schemas";
import { db, newId } from "../db";
import { displayLength, matchOrders, matchTargets } from "../gates/content";
import { t } from "../i18n";
import { CONFIRMED_MISCONCEPTION_TIMES } from "../review/signals";
import { correctAnswerText, gradeAnswer, GradingError, type JsonPromptRunner } from "./grading";
import { fail, readBody } from "./http";
import { AnswerSchema } from "./items";
import { displayOrder, publicItem, type ItemRow } from "./public";

const DAY_MS = 24 * 60 * 60 * 1000;

type MistakeRow = ItemRow & { topic_title: string; node_title: string | null; lesson_title: string | null; step_idx: number | null };

/** Graded items whose first attempt was wrong or that the learner gave up on; give-ups are stored as wrong attempts. */
function mistakeRows(database: Database, itemId: string | null = null): MistakeRow[] {
  return database
    .query<MistakeRow, [string | null]>(
      `SELECT i.*, t.title AS topic_title, n.title AS node_title, l.title AS lesson_title, s.idx AS step_idx
       FROM items i
       JOIN topics t ON t.id = i.topic_id
       LEFT JOIN nodes n ON n.topic_id = i.topic_id AND n.id = i.node_id
       LEFT JOIN lessons l ON l.id = i.lesson_id
       LEFT JOIN steps s ON s.id = i.step_id
       WHERE i.role IN ('practice','explain_check','check','review') AND i.status != 'retired' AND (?1 IS NULL OR i.id = ?1)
         AND ((SELECT correct FROM attempts WHERE item_id = i.id ORDER BY created_at, rowid LIMIT 1) = 0
              OR EXISTS (SELECT 1 FROM attempts WHERE item_id = i.id AND gave_up = 1))`,
    )
    .all(itemId);
}

/** The learner's answer in the words of the item; choices are stored in display order. */
function answerText(row: ItemRow, item: Item, answer: Answer): string {
  switch (answer.format) {
    case "single":
    case "multi": {
      const options = item.format === "single" || item.format === "multi" ? item.options : [];
      const order = displayOrder(row, options.length);
      const picks = answer.format === "single" ? [answer.choice] : answer.choices;
      return picks.map((d) => options[order[d] ?? -1]?.text ?? "?").join("; ");
    }
    case "order":
      return answer.sequence.join(" → ");
    case "match": {
      if (item.format !== "match") return "";
      const { left, right } = matchOrders(item, displayOrder(row, displayLength(item)));
      const targets = matchTargets(item);
      return left.map((pair, d) => `${item.pairs[pair]!.left} → ${targets[right[answer.pairs[d] ?? -1] ?? -1] ?? "?"}`).join("; ");
    }
    case "sort": {
      if (item.format !== "sort") return "";
      return displayOrder(row, item.entries.length)
        .map((i, d) => `${item.entries[i]!.text} → ${item.categories[answer.categories[d] ?? -1] ?? "?"}`)
        .join("; ");
    }
    case "cloze":
      return answer.blanks.map((b, i) => `${i + 1}: ${b}`).join("; ");
    case "number":
      return `${answer.value}${item.format === "number" && item.unit ? ` ${item.unit}` : ""}`;
    case "short":
      return answer.text;
  }
}

function toEntry(row: MistakeRow, database: Database): MistakeEntry {
  const item = JSON.parse(row.content) as Item;
  const wrong = database
    .query<{ answer: string; misconception: string | null; gave_up: number; created_at: string }, [string]>(
      "SELECT answer, misconception, gave_up, created_at FROM attempts WHERE item_id = ? AND correct = 0 ORDER BY created_at, rowid",
    )
    .all(row.id);
  const retries = database
    .query<{ correct: number; created_at: string }, [string]>("SELECT correct, created_at FROM retries WHERE item_id = ? ORDER BY created_at, rowid")
    .all(row.id);
  const answered = wrong.find((a) => a.gave_up === 0);
  const lastError = Math.max(...[...wrong, ...retries.filter((r) => r.correct === 0)].map((a) => Date.parse(a.created_at)));
  const readyAt = lastError + DAY_MS;
  const resolved = retries.find((r) => r.correct === 1 && Date.parse(r.created_at) >= readyAt);
  return {
    itemId: row.id,
    topicId: row.topic_id,
    topicTitle: row.topic_title,
    nodeId: row.node_id,
    nodeTitle: row.node_title ?? row.node_id,
    lessonId: row.lesson_id,
    lessonTitle: row.lesson_title,
    stepIdx: row.step_idx,
    item: publicItem(row),
    answer: answered ? answerText(row, item, JSON.parse(answered.answer) as Answer) : null,
    misconception: answered?.misconception ?? null,
    gaveUp: wrong.some((a) => a.gave_up === 1),
    at: wrong[0]!.created_at,
    retries: retries.length,
    readyAt: new Date(readyAt).toISOString(),
    resolvedAt: resolved?.created_at ?? null,
  };
}

const newestFirst = (a: MistakeEntry, b: MistakeEntry) => b.at.localeCompare(a.at);

export function mistakeEntries(database: Database = db()): MistakeEntry[] {
  return mistakeRows(database)
    .map((r) => toEntry(r, database))
    .sort(newestFirst);
}

/** Distractors of open single-choice entries chosen at least twice; retries count, since the misconception is the learner's either way. */
function patterns(rows: MistakeRow[], open: Set<string>, database: Database): MistakePattern[] {
  const chosen = database.query<{ option: number }, [string]>(
    `SELECT chosen_option AS option FROM attempts WHERE item_id = ?1 AND gave_up = 0 AND chosen_option IS NOT NULL
     UNION ALL SELECT chosen_option FROM retries WHERE item_id = ?1 AND chosen_option IS NOT NULL`,
  );
  const out: MistakePattern[] = [];
  for (const row of rows) {
    const item = JSON.parse(row.content) as Item;
    if (item.format !== "single" || !open.has(row.id)) continue;
    const counts = new Map<number, number>();
    for (const { option } of chosen.all(row.id)) counts.set(option, (counts.get(option) ?? 0) + 1);
    for (const [option, times] of counts) {
      if (option === item.correct || times < CONFIRMED_MISCONCEPTION_TIMES) continue;
      const o = item.options[option];
      if (!o) continue;
      out.push({ itemId: row.id, topicId: row.topic_id, nodeTitle: row.node_title ?? row.node_id, option: o.text, misconception: o.misconception ?? null, times });
    }
  }
  return out.sort((a, b) => b.times - a.times);
}

export function mistakesView(database: Database = db()): MistakesView {
  const rows = mistakeRows(database);
  const entries = rows.map((r) => toEntry(r, database)).sort(newestFirst);
  return { entries, patterns: patterns(rows, new Set(entries.filter((e) => !e.resolvedAt).map((e) => e.itemId)), database) };
}

export function mistakeCounts(at: Date = new Date(), database: Database = db()): TodayView["mistakes"] {
  const open = mistakeEntries(database).filter((e) => !e.resolvedAt);
  return { open: open.length, ready: open.filter((e) => Date.parse(e.readyAt) <= at.getTime()).length };
}

function mistakeRow(itemId: string, database: Database): MistakeRow {
  const row = mistakeRows(database, itemId)[0];
  if (!row) throw new GradingError("this item is not in the mistakes notebook", 404);
  return row;
}

const solutionOf = (item: Item): MistakeSolution => ({ solution: item.solution, correctAnswer: correctAnswerText(item) });

/** L9: the solution of an item the learner has already answered wrong or given up on. */
export function mistakeSolution(itemId: string, database: Database = db()): MistakeSolution {
  return solutionOf(JSON.parse(mistakeRow(itemId, database).content) as Item);
}

/** Grades an unaided retry and stores it in `retries`, out of reach of first-try results, mastery and signals. */
export async function retryMistake(
  itemId: string,
  req: RetryRequest,
  opts: { database?: Database; runPrompt?: JsonPromptRunner; at?: Date } = {},
): Promise<RetryResponse> {
  const database = opts.database ?? db();
  const row = mistakeRow(itemId, database);
  const item = JSON.parse(row.content) as Item;
  const grade = await gradeAnswer(row, item, req.answer, opts.runPrompt);
  database
    .query("INSERT INTO retries (id, item_id, answer, correct, chosen_option, duration_ms, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(
      newId("rt"),
      itemId,
      JSON.stringify(req.answer),
      grade.correct ? 1 : 0,
      grade.chosenOption,
      Number.isFinite(req.durationMs) ? Math.round(req.durationMs) : null,
      (opts.at ?? new Date()).toISOString(),
    );
  const feedback = grade.feedback ?? t(grade.correct ? "grading.right" : "grading.retryWrong");
  return { correct: grade.correct, feedback, ...solutionOf(item), entry: toEntry(row, database) };
}

async function graded<T>(fn: () => T | Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof GradingError) fail(e.status, e.message);
    throw e;
  }
}

export const mistakeRoutes = new Hono();

mistakeRoutes.get("/mistakes", (c) => c.json(mistakesView()));
mistakeRoutes.get("/mistakes/:itemId/solution", async (c) => c.json(await graded(() => mistakeSolution(c.req.param("itemId")))));
mistakeRoutes.post("/mistakes/:itemId/retry", async (c) => {
  const req = await readBody(c, z.object({ answer: AnswerSchema, durationMs: z.number().min(0).default(0) }));
  return c.json(await graded(() => retryMistake(c.req.param("itemId"), req)));
});
