import type { Database } from "bun:sqlite";
import type { AttemptRequest, AttemptResponse, GiveUpResponse, HintResponse, WorkedLineResponse } from "../../shared/api";
import { isOpenBlank, type Answer, type Blank, type Item } from "../../shared/schemas";
import { runJsonPrompt, type OneShotResult } from "../claude/oneshot";
import { db, newId } from "../db";
import { t } from "../i18n";
import { updateMasteryAfterAttempt } from "../review/mastery";
import { applyItemSignals } from "../review/signals";
import { displayOrder, type ItemRow } from "./public";

export class GradingError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 | 502 = 400,
  ) {
    super(message);
  }
}

export type Grade = { correct: boolean; chosenOption: number | null; misconception: string | null; feedback: string | null };

export const normalize = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

const sameSet = (a: number[], b: number[]) => {
  const x = new Set(a);
  const y = new Set(b);
  return x.size === y.size && [...x].every((v) => y.has(v));
};

/** Grades every format except `short`. `order` maps display positions to authoring indices. */
export function gradeClosed(item: Item, order: number[], answer: Answer): Grade {
  if (answer.format !== item.format) throw new GradingError(`answer format ${answer.format} does not match item format ${item.format}`);
  const plain = (correct: boolean): Grade => ({ correct, chosenOption: null, misconception: null, feedback: null });
  if (item.format === "single" && answer.format === "single") {
    const chosen = order[answer.choice];
    if (chosen === undefined) throw new GradingError("choice out of range");
    const option = item.options[chosen]!;
    return { correct: chosen === item.correct, chosenOption: chosen, misconception: option.misconception ?? null, feedback: option.feedback };
  }
  if (item.format === "multi" && answer.format === "multi") {
    const chosen = answer.choices.map((c) => order[c]);
    if (chosen.some((c) => c === undefined)) throw new GradingError("choice out of range");
    return plain(sameSet(chosen as number[], item.correct));
  }
  if (item.format === "order" && answer.format === "order") {
    return plain(answer.sequence.length === item.sequence.length && answer.sequence.every((s, i) => s === item.sequence[i]));
  }
  if (item.format === "cloze" && answer.format === "cloze") {
    return plain(
      answer.blanks.length === item.blanks.length &&
        answer.blanks.every((given, i) => item.blanks[i]!.some((accepted) => normalize(accepted) === normalize(given))),
    );
  }
  if (item.format === "number" && answer.format === "number") {
    return plain(Number.isFinite(answer.value) && Math.abs(answer.value - item.answer) <= item.tolerance);
  }
  throw new GradingError(`format ${item.format} is not graded here`);
}

export type JsonPromptRunner = <T>(opts: { prompt: string; schema: object; purpose: "grading" }) => Promise<OneShotResult<T>>;

const SHORT_SCHEMA = {
  type: "object",
  properties: { met: { type: "array", items: { type: "boolean" } } },
  required: ["met"],
  additionalProperties: false,
};

/** Model-graded free answer: correct when every rubric criterion is met. */
export async function gradeShort(
  item: Extract<Item, { format: "short" }>,
  text: string,
  run: JsonPromptRunner = runJsonPrompt,
): Promise<Grade> {
  const prompt = [
    "You grade a learner's short answer against a reference answer and a rubric.",
    "For each rubric criterion, in order, decide whether the learner's answer meets it. Judge meaning, not wording; ignore spelling.",
    "Return {\"met\": [boolean per criterion]}.",
    `<question>${item.prompt}</question>`,
    `<reference>${item.referenceAnswer}</reference>`,
    `<rubric>\n${item.rubric.map((r, i) => `${i + 1}. ${r}`).join("\n")}\n</rubric>`,
    `<learner_answer>${text}</learner_answer>`,
  ].join("\n\n");
  const res = await run<{ met: boolean[] }>({ prompt, schema: SHORT_SCHEMA, purpose: "grading" });
  if (!res.ok || res.value.met.length !== item.rubric.length) {
    throw new GradingError(t("grading.failed"), 502);
  }
  const met = res.value.met.filter(Boolean).length;
  const correct = met === item.rubric.length;
  return {
    correct,
    chosenOption: null,
    misconception: null,
    feedback: correct ? null : t("grading.rubric", { met, total: item.rubric.length }),
  };
}

export function correctAnswerText(item: Item): string {
  switch (item.format) {
    case "single":
      return item.options[item.correct]!.text;
    case "multi":
      return item.correct.map((i) => item.options[i]!.text).join("; ");
    case "order":
      return item.sequence.join(" → ");
    case "cloze":
      return item.blanks.map((accepted, i) => `${i + 1}: ${accepted[0]}`).join("; ");
    case "number":
      return `${item.answer}${item.tolerance ? ` ± ${item.tolerance}` : ""}${item.unit ? ` ${item.unit}` : ""}`;
    case "short":
      return item.referenceAnswer;
  }
}

function loadItem(itemId: string, database: Database): { row: ItemRow; item: Item } {
  const row = database.query<ItemRow, [string]>("SELECT * FROM items WHERE id = ?").get(itemId);
  if (!row) throw new GradingError("item not found", 404);
  return { row, item: JSON.parse(row.content) as Item };
}

const roleContext = (role: ItemRow["role"]) => (role === "explain_check" ? "explain" : role);

/** Highest hint level shown for the item since its last correct answer or give-up. */
export function openHintLevel(itemId: string, database: Database = db()): number {
  return database
    .query<{ level: number }, [string]>(
      `SELECT coalesce(max(level), 0) AS level FROM hint_views
       WHERE item_id = ?1 AND created_at > coalesce(
         (SELECT max(created_at) FROM attempts WHERE item_id = ?1 AND (correct = 1 OR gave_up = 1)), '')`,
    )
    .get(itemId)!.level;
}

export function takeHint(itemId: string, requested: number, database: Database = db(), at: Date = new Date()): HintResponse {
  const { row, item } = loadItem(itemId, database);
  if (row.role === "check") throw new GradingError(t("grading.noHintsInCheck"));
  const shown = openHintLevel(itemId, database);
  const level = Math.max(1, Math.min(Math.trunc(requested) || 1, shown + 1, item.hints.length));
  if (level > shown) {
    database.query("INSERT INTO hint_views (item_id, level, created_at) VALUES (?, ?, ?)").run(itemId, level, at.toISOString());
  }
  return { level, hint: item.hints[level - 1]!, hintCount: item.hints.length };
}

export const genericFeedback = (correct: boolean) => t(correct ? "grading.right" : "grading.wrong");

export async function submitAttempt(
  itemId: string,
  req: AttemptRequest,
  opts: { database?: Database; runPrompt?: JsonPromptRunner; at?: Date } = {},
): Promise<AttemptResponse & { attemptId: string }> {
  const database = opts.database ?? db();
  const at = opts.at ?? new Date();
  const { row, item } = loadItem(itemId, database);
  let grade: Grade;
  if (item.format === "short") {
    if (req.answer.format !== "short") throw new GradingError(`answer format ${req.answer.format} does not match item format short`);
    grade = await gradeShort(item, req.answer.text, opts.runPrompt);
  } else {
    const length = item.format === "single" || item.format === "multi" ? item.options.length : item.format === "order" ? item.sequence.length : 0;
    grade = gradeClosed(item, displayOrder(row, length), req.answer);
  }

  const hintsUsed = Math.max(Math.trunc(req.hintsUsed) || 0, openHintLevel(itemId, database));
  const attemptId = newId("at");
  database
    .query(
      `INSERT INTO attempts (id, item_id, answer, correct, chosen_option, misconception, hints_used, gave_up, duration_ms, context, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
    )
    .run(
      attemptId,
      itemId,
      JSON.stringify(req.answer),
      grade.correct ? 1 : 0,
      grade.chosenOption,
      grade.correct ? null : grade.misconception,
      hintsUsed,
      Number.isFinite(req.durationMs) ? Math.round(req.durationMs) : null,
      req.context,
      at.toISOString(),
    );
  updateMasteryAfterAttempt(attemptId, database);
  applyItemSignals(itemId, database);

  const attemptNo = database.query<{ n: number }, [string]>("SELECT count(*) AS n FROM attempts WHERE item_id = ?").get(itemId)!.n;
  const feedback = grade.feedback ?? genericFeedback(grade.correct);

  // L2: prequestions are ungraded for the learner and show the answer at once.
  if (row.role === "activate") {
    return { attemptId, correct: null, feedback, solution: item.solution, correctAnswer: correctAnswerText(item), attemptNo, offerTutor: false };
  }
  let offerTutor = false;
  if (!grade.correct && (row.role === "practice" || row.role === "explain_check") && req.context !== "review") {
    const wrong = database
      .query<{ n: number }, [string]>(
        "SELECT count(*) AS n FROM attempts WHERE item_id = ? AND correct = 0 AND gave_up = 0 AND context IN ('practice','explain')",
      )
      .get(itemId)!.n;
    offerTutor = wrong >= 2;
  }
  return {
    attemptId,
    correct: grade.correct,
    feedback,
    ...(grade.correct ? { solution: item.solution, correctAnswer: correctAnswerText(item) } : {}),
    attemptNo,
    offerTutor,
  };
}

export function giveUp(itemId: string, opts: { database?: Database; at?: Date } = {}): GiveUpResponse {
  const database = opts.database ?? db();
  const at = opts.at ?? new Date();
  const { row, item } = loadItem(itemId, database);
  const attemptId = newId("at");
  database
    .query(
      `INSERT INTO attempts (id, item_id, answer, correct, hints_used, gave_up, context, created_at)
       VALUES (?, ?, 'null', 0, ?, 1, ?, ?)`,
    )
    .run(attemptId, itemId, openHintLevel(itemId, database), roleContext(row.role), at.toISOString());
  updateMasteryAfterAttempt(attemptId, database);
  return { solution: item.solution, correctAnswer: correctAnswerText(item) };
}

/** Grades and records an answer to a faded worked-example line; the line's text is revealed after any attempt. */
function blankLine(step: { content: string }, lineIdx: number): { text: string; blank: Blank } {
  const content = JSON.parse(step.content) as { kind: string; lines?: { text: string; blank?: Blank }[] };
  const line = content.kind === "worked_example" ? content.lines?.[lineIdx] : undefined;
  if (!line?.blank) throw new GradingError("line has no blank");
  return { text: line.text, blank: line.blank };
}

/** Stores the learner's result on a faded line; the line's text is theirs to read from now on. */
export function recordWorkedLine(stepId: string, lineIdx: number, answer: string, correct: boolean, database: Database = db(), at = new Date()): void {
  database
    .query("INSERT INTO worked_answers (step_id, line_idx, answer, correct, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(stepId, lineIdx, answer, correct ? 1 : 0, at.toISOString());
}

/** Checks a closed blank by exact match. An open blank is answered through the tutor, which judges meaning. */
export function answerWorkedLine(
  step: { id: string; content: string },
  lineIdx: number,
  answer: string,
  opts: { database?: Database; at?: Date } = {},
): WorkedLineResponse {
  const line = blankLine(step, lineIdx);
  if (isOpenBlank(line.blank) || !("answers" in line.blank)) throw new GradingError("this line is answered through the tutor", 409);
  const correct = line.blank.answers.some((a) => normalize(a) === normalize(answer));
  recordWorkedLine(step.id, lineIdx, answer, correct, opts.database, opts.at);
  return { correct, text: line.text };
}

/** Shows a faded line without an answer, recorded as not solved. */
export function revealWorkedLine(step: { id: string; content: string }, lineIdx: number, opts: { database?: Database; at?: Date } = {}): WorkedLineResponse {
  const line = blankLine(step, lineIdx);
  recordWorkedLine(step.id, lineIdx, "", false, opts.database, opts.at);
  return { correct: false, text: line.text };
}
