import type { Database } from "bun:sqlite";
import type { Confidence } from "../../shared/api";
import type { Answer, Item, Step } from "../../shared/schemas";
import { db } from "../db";
import { displayOrder, type ItemRow, type StepRow } from "./public";

const DAY_MS = 24 * 60 * 60 * 1000;

const CONFIDENCE_WORDS: Record<Confidence, string> = { guess: "guessing", unsure: "unsure", sure: "sure" };

function describeItem(item: Item): string {
  const lines = [`Format: ${item.format}; Bloom: ${item.bloom}; node: ${item.nodeId}`, `Prompt: ${item.prompt}`];
  if (item.format === "single" || item.format === "multi") {
    const keys = new Set(item.format === "single" ? [item.correct] : item.correct);
    item.options.forEach((o, i) => {
      const role = keys.has(i) ? "CORRECT" : `misconception: ${o.misconception ?? "—"}`;
      lines.push(`  [${i}] ${o.text} (${role}; feedback: ${o.feedback})`);
    });
  } else if (item.format === "order") {
    lines.push(`Correct order: ${item.sequence.join(" → ")}`);
  } else if (item.format === "cloze") {
    lines.push(`Text: ${item.text}`, `Accepted answers: ${item.blanks.map((b, i) => `{{${i + 1}}} = ${b.join(" | ")}`).join("; ")}`);
  } else if (item.format === "number") {
    lines.push(`Answer: ${item.answer} ± ${item.tolerance}${item.unit ? ` ${item.unit}` : ""}`);
  } else {
    lines.push(`Reference answer: ${item.referenceAnswer}`, `Rubric: ${item.rubric.join("; ")}`);
  }
  lines.push(`Solution: ${item.solution}`, `Hints: ${item.hints.map((h, i) => `${i + 1}) ${h}`).join(" ")}`);
  return lines.join("\n");
}

function describeAnswer(raw: string, item: Item, row: ItemRow): string {
  const answer = JSON.parse(raw) as Answer | null;
  if (!answer) return "—";
  switch (answer.format) {
    case "single":
    case "multi": {
      if (item.format !== "single" && item.format !== "multi") return JSON.stringify(answer);
      const order = displayOrder(row, item.options.length);
      const picks = answer.format === "single" ? [answer.choice] : answer.choices;
      return picks.map((d) => `[${order[d]}] ${item.options[order[d] ?? -1]?.text ?? "?"}`).join(", ");
    }
    case "order":
      return answer.sequence.join(" → ");
    case "cloze":
      return answer.blanks.join(" | ");
    case "number":
      return String(answer.value);
    case "short":
      return answer.text;
  }
}

function describeStep(step: Step): string {
  switch (step.kind) {
    case "explain":
      return `Step "${step.title}" (explanation):\n${step.body}`;
    case "worked_example":
      return `Step "${step.title}" (worked example):\n${step.problem}\n${step.lines.map((l, i) => `${i + 1}. ${l.text}`).join("\n")}`;
    case "reflect":
      return `Step "${step.title}" (reflection): ${step.prompt}`;
    default:
      return `Step "${step.title}" (${step.kind})`;
  }
}

/** The open blank of a worked-example line the learner answers through the tutor, with its answer sheet and their earlier answers. */
function describeOpenLine(stepRow: StepRow, idx: number, database: Database): string | null {
  const step = JSON.parse(stepRow.content) as Step;
  const line = step.kind === "worked_example" ? step.lines[idx] : undefined;
  if (!line?.blank) return null;
  const blank = line.blank;
  const criteria =
    "criteria" in blank
      ? `Criteria the answer must cover:\n${blank.criteria.map((c) => `- ${c}`).join("\n")}`
      : `No criteria were written for this line: judge by meaning against the hidden line. Accepted phrasings, as examples only: ${blank.answers.join(" | ")}`;
  const earlier = database
    .query<{ answer: string; correct: number }, [string, number]>("SELECT answer, correct FROM worked_answers WHERE step_id = ? AND line_idx = ? ORDER BY created_at, rowid")
    .all(stepRow.id, idx);
  return [
    `Open question on line ${idx + 1} of this worked example (stepId "${stepRow.id}", line ${idx}); the learner answers it through you, in their own words.`,
    `Question: ${blank.prompt}`,
    `Hidden line, the reference the learner has not seen: ${line.text}`,
    criteria,
    earlier.length ? `Their earlier answers on this line: ${earlier.map((e) => `"${e.answer || "(revealed)"}" ${e.correct ? "correct" : "not accepted"}`).join("; ")}` : "No earlier answers on this line.",
    `Record the result with worked_line_record (stepId "${stepRow.id}", line ${idx}): outcome "correct" once their answer covers every criterion by meaning, in any wording; "gave_up" when they give up.`,
  ].join("\n");
}

/**
 * L17 context for a tutor turn: the item with its key, misconceptions, solution and hints; the learner's
 * attempts on it; unmastered prerequisites of its node; the step text; and the last 24 h of attempts.
 */
export function buildTutorContext(
  opts: { lessonId: string; itemId?: string; stepId?: string; line?: number; at?: Date },
  database: Database = db(),
): string {
  const at = opts.at ?? new Date();
  const lesson = database
    .query<{ topic_id: string; title: string; objective: string }, [string]>("SELECT topic_id, title, objective FROM lessons WHERE id = ?")
    .get(opts.lessonId);
  if (!lesson) throw new Error("lesson not found");
  const parts: string[] = [`Lesson: ${lesson.title}. Objective: ${lesson.objective}`];

  const row = opts.itemId ? database.query<ItemRow, [string]>("SELECT * FROM items WHERE id = ?").get(opts.itemId) : null;
  const stepId = opts.stepId ?? row?.step_id ?? null;
  const stepRow = stepId ? database.query<StepRow, [string]>("SELECT * FROM steps WHERE id = ?").get(stepId) : null;
  if (stepRow) parts.push(describeStep(JSON.parse(stepRow.content) as Step));
  if (stepRow && opts.line !== undefined) {
    const section = describeOpenLine(stepRow, opts.line, database);
    if (section) parts.push(section);
  }

  if (row) {
    const item = JSON.parse(row.content) as Item;
    parts.push(`Item (${row.role}); the learner does not see it in this form:\n${describeItem(item)}`);
    const attempts = database
      .query<{ answer: string; correct: number | null; misconception: string | null; hints_used: number; gave_up: number; confidence: Confidence | null }, [string]>(
        "SELECT answer, correct, misconception, hints_used, gave_up, confidence FROM attempts WHERE item_id = ? ORDER BY created_at, rowid",
      )
      .all(row.id);
    parts.push(
      attempts.length
        ? `The learner's attempts on this item:\n${attempts
            .map((a, i) => {
              const verdict = a.gave_up ? "gave up" : a.correct === 1 ? "correct" : "wrong";
              const extra = [
                a.confidence ? `confidence before checking: ${CONFIDENCE_WORDS[a.confidence]}` : "",
                a.misconception ? `misconception: ${a.misconception}` : "",
                a.hints_used ? `hints: ${a.hints_used}` : "",
              ]
                .filter(Boolean)
                .join("; ");
              return `${i + 1}. ${describeAnswer(a.answer, item, row)} — ${verdict}${extra ? ` (${extra})` : ""}`;
            })
            .join("\n")}`
        : "No attempts on this item yet.",
    );
    if (attempts.some((a) => a.confidence === "sure" && a.correct === 0 && a.gave_up === 0)) {
      parts.push(
        "The learner was sure of a wrong answer on this item (L20). Name the belief that answer rests on and set it against the correct reasoning; the item returns in their review a day after their last attempt.",
      );
    }

    const node = database
      .query<{ prereqs: string }, [string, string]>("SELECT prereqs FROM nodes WHERE topic_id = ? AND id = ?")
      .get(row.topic_id, row.node_id);
    const prereqIds = node ? (JSON.parse(node.prereqs) as string[]) : [];
    const unmastered = prereqIds.length
      ? database
          .query<{ id: string; title: string; summary: string; mastery: string }, string[]>(
            `SELECT id, title, summary, mastery FROM nodes
             WHERE topic_id = ? AND mastery IN ('new','learning') AND placement IS NOT 'known' AND id IN (${prereqIds.map(() => "?").join(",")})`,
          )
          .all(row.topic_id, ...prereqIds)
      : [];
    if (unmastered.length) {
      parts.push(`Unmastered prerequisites of node ${row.node_id}:\n${unmastered.map((n) => `- ${n.title} (${n.mastery}): ${n.summary}`).join("\n")}`);
    }
  }

  const recent = database
    .query<{ prompt: string; correct: number | null; misconception: string | null; gave_up: number; created_at: string }, [string, string]>(
      `SELECT json_extract(i.content, '$.prompt') AS prompt, a.correct, a.misconception, a.gave_up, a.created_at
       FROM attempts a JOIN items i ON i.id = a.item_id
       WHERE i.topic_id = ? AND a.created_at >= ? ORDER BY a.created_at DESC, a.rowid DESC LIMIT 10`,
    )
    .all(lesson.topic_id, new Date(at.getTime() - DAY_MS).toISOString());
  if (recent.length) {
    parts.push(
      `Recent attempts in the topic, last 24 h:\n${recent
        .map((r) => `- ${r.prompt.slice(0, 120)} — ${r.gave_up ? "gave up" : r.correct === 1 ? "correct" : r.correct === 0 ? "wrong" : "ungraded"}${r.misconception ? ` (${r.misconception})` : ""}`)
        .join("\n")}`,
    );
  }
  return parts.join("\n\n");
}
