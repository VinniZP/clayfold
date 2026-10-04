import type { Database } from "bun:sqlite";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Hono } from "hono";
import { z } from "zod";
import { EXPLAIN_LENSES, lensesFor, type AlternativeView, type ExplainLens, type LessonView } from "../../shared/api";
import type { Step } from "../../shared/schemas";
import { stripTermMarks, TERM_MARK, termKey, termMarks } from "../../shared/terms";
import { runJsonPrompt, type OneShotResult } from "../claude/oneshot";
import { paths } from "../config";
import { db, newId } from "../db";
import { glossaryKeys } from "../gates/terms";
import { languageInstruction, t } from "../i18n";
import { fail, readBody } from "./http";

/** L4 caps an explanation segment at this many words; an alternative stays within it too. */
export const ALTERNATIVE_MAX_WORDS = 400;

type Explained = Extract<Step, { kind: "explain" | "worked_example" }>;

export type AlternativeRunner = <T>(opts: { prompt: string; schema: object; purpose: "tutor" }) => Promise<OneShotResult<T>>;

export type AlternativeDeps = {
  database: Database;
  run: AlternativeRunner;
  /** A workspace file of the topic (MISSION.md, NOTES.md), or null when it does not exist. */
  memory: (slug: string, file: string) => string | null;
};

const LENS_TASK: Record<ExplainLens, string> = {
  simpler: "Simpler: plain everyday words and short sentences, about half the length of the step. Keep the field's terms the step uses and say what each means in plain words.",
  analogy:
    "An analogy: one analogy drawn from the learner's interests and context in the mission, realistic in that domain (or an everyday situation when the mission names none). Map each part of the idea to a part of the analogy, then say in one sentence where the analogy stops fitting.",
  steps: "Step by step: a numbered sequence of small steps, one idea each, every step building on the one before.",
  example:
    "Example first: open with one concrete, realistic situation from the learner's interests, walk through what happens in it, then state the general idea it shows. The situation differs from any example in the step.",
  precise:
    "More precise: the exact meaning of each term, the conditions under which the idea holds, and why it works, in the field's own terms. Where the step leaves a point open, say that it is open instead of settling it.",
};

const SCHEMA = {
  type: "object",
  properties: { body: { type: "string", minLength: 1 } },
  required: ["body"],
  additionalProperties: false,
};

/**
 * The step as the learner has seen it. A worked example shows its lines up to the first faded line the learner has
 * not answered; that line appears as its question and later lines are left out, so neither reaches the prompt (L7).
 */
export function seenStepText(step: Explained, answeredLines: Set<number>): string {
  if (step.kind === "explain") return step.body;
  const lines: string[] = [];
  for (const [i, line] of step.lines.entries()) {
    if (line.blank && !answeredLines.has(i)) {
      lines.push(`${i + 1}. [Left for the learner to work out: ${line.blank.prompt}]`);
      if (i < step.lines.length - 1) lines.push("[The example continues in lines the learner has not seen yet.]");
      break;
    }
    lines.push(`${i + 1}. ${line.text}`);
  }
  return `Problem:\n${step.problem}\n\nSolution lines:\n${lines.join("\n")}`;
}

export function alternativePrompt(opts: {
  step: Explained;
  seen: string;
  lens: ExplainLens;
  glossary: { term: string; definition: string }[];
  mission: string | null;
  notes: string | null;
  earlier: string[];
}): string {
  const kind = opts.step.kind === "explain" ? "explanation" : "worked example";
  return [
    `A learner read this ${kind} in a lesson and it did not click. Explain the same idea another way.`,
    `The way they asked for: ${LENS_TASK[opts.lens]}`,
    [
      "Rules:",
      "- Same idea, same facts. Make no claim about the subject that the step does not make; an analogy or a situation you invent must not add one.",
      "- The learner answers retrieval questions on this step next, then practice items and an unaided exit check. Write no questions, exercises or quizzes, and do not answer, hint at or solve anything those may ask.",
      opts.step.kind === "worked_example"
        ? "- A line left for the learner stays theirs: do not write it, its result or the lines after it, not even through a parallel example. Explain the problem and the lines shown, what each does and why."
        : "",
      `- Markdown: paragraphs, short lists, bold, inline code and code blocks. No headings, tables, images, links or HTML. At most ${ALTERNATIVE_MAX_WORDS} words.`,
      opts.glossary.length
        ? "- Mark a glossary term at its first use as [[surface|Term]] (the word as it stands, then the term) or [[Term]]. Only the terms in <glossary> get a mark."
        : "- Write no [[…]] marks.",
      "- Address the learner the way their notes ask, or as the step does. Start with the explanation itself: no greeting, preface or closing offer.",
      `- ${languageInstruction()}`,
    ]
      .filter(Boolean)
      .join("\n"),
    opts.mission ? `<mission>\n${opts.mission}\n</mission>` : "",
    opts.notes ? `<notes>\n${opts.notes}\n</notes>` : "",
    opts.glossary.length ? `<glossary>\n${opts.glossary.map((g) => `- ${g.term}: ${g.definition}`).join("\n")}\n</glossary>` : "",
    `<title>${opts.step.title}</title>\n<step>\n${opts.seen}\n</step>`,
    opts.earlier.length
      ? `The learner already read these explanations of this step in the same way; write a different one, with another analogy or situation where the way uses one:\n${opts.earlier.map((e) => `<earlier>\n${e}\n</earlier>`).join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

const wordCount = (text: string) => stripTermMarks(text).split(/\s+/).filter(Boolean).length;

/** The body to store, or a problem for the second attempt. A mark of a term outside the topic glossary keeps its surface. */
export function checkAlternative(body: string, glossary: Set<string>): { body: string } | { problem: string } {
  const clean = body.trim().replace(TERM_MARK, (mark, surface: string, term?: string) => (glossary.has(termKey(term ?? surface)) ? mark : surface.trim()));
  if (!clean) return { problem: "the explanation is empty" };
  const words = wordCount(clean);
  if (words > ALTERNATIVE_MAX_WORDS) return { problem: `the explanation has ${words} words; keep it within ${ALTERNATIVE_MAX_WORDS}` };
  if (/^#{1,6}\s/m.test(clean)) return { problem: "the explanation has a heading; use paragraphs and lists only" };
  return { body: clean };
}

/** L11: the exit check is under way when some of its items have attempts and others have none. */
export function exitCheckUnderway(lessonId: string, database: Database): boolean {
  const counts = database
    .query<{ n: number }, [string]>(
      `SELECT (SELECT COUNT(*) FROM attempts a WHERE a.item_id = i.id) AS n
       FROM items i JOIN steps s ON s.id = i.step_id
       WHERE s.lesson_id = ? AND s.status = 'published' AND i.role = 'check'`,
    )
    .all(lessonId)
    .map((r) => r.n);
  return counts.some((n) => n > 0) && counts.some((n) => n === 0);
}

const answeredLines = (stepId: string, database: Database) =>
  new Set(database.query<{ line_idx: number }, [string]>("SELECT DISTINCT line_idx FROM worked_answers WHERE step_id = ?").all(stepId).map((r) => r.line_idx));

type AlternativeRow = { id: string; step_id: string; lens: ExplainLens; body: string; created_at: string };

const view = (r: AlternativeRow): AlternativeView => ({ id: r.id, lens: r.lens, body: r.body, createdAt: r.created_at });

/** Stored alternatives of the lesson's steps, oldest first per step. */
export function lessonAlternatives(lessonId: string, database: Database = db()): LessonView["alternatives"] {
  const rows = database
    .query<AlternativeRow, [string]>(
      `SELECT a.* FROM alternatives a JOIN steps s ON s.id = a.step_id WHERE s.lesson_id = ? ORDER BY a.created_at, a.rowid`,
    )
    .all(lessonId);
  const out: LessonView["alternatives"] = {};
  for (const r of rows) (out[r.step_id] ??= []).push(view(r));
  return out;
}

function readMemory(slug: string, file: string): string | null {
  const path = join(paths.workspace(slug), file);
  return existsSync(path) ? readFileSync(path, "utf8").trim() || null : null;
}

async function write(stepId: string, lens: ExplainLens, deps: AlternativeDeps): Promise<AlternativeView> {
  const { database } = deps;
  const row = database
    .query<{ content: string; lesson_id: string; topic_id: string; slug: string }, [string]>(
      `SELECT s.content, s.lesson_id, l.topic_id, t.slug FROM steps s JOIN lessons l ON l.id = s.lesson_id JOIN topics t ON t.id = l.topic_id
       WHERE s.id = ? AND s.status = 'published'`,
    )
    .get(stepId);
  if (!row) fail(404, "step not found");
  const step = JSON.parse(row.content) as Step;
  if (step.kind !== "explain" && step.kind !== "worked_example") fail(400, "only explain and worked_example steps are explained differently");
  if (!lensesFor(step.kind).includes(lens)) fail(400, `a ${step.kind} step has no ${lens} lens`);
  if (exitCheckUnderway(row.lesson_id, database)) fail(409, t("explain.duringCheck"));

  const seen = seenStepText(step, answeredLines(stepId, database));
  const marked = new Set(termMarks(seen).map((m) => termKey(m.term)));
  const glossary = database
    .query<{ key: string; term: string; definition: string }, [string]>("SELECT key, term, definition FROM glossary_terms WHERE topic_id = ? ORDER BY term")
    .all(row.topic_id)
    .filter((g) => marked.has(g.key));
  const earlier = database
    .query<{ body: string }, [string, string]>("SELECT body FROM alternatives WHERE step_id = ? AND lens = ? ORDER BY created_at, rowid")
    .all(stepId, lens)
    .map((r) => r.body);
  const prompt = alternativePrompt({
    step,
    seen,
    lens,
    glossary,
    mission: deps.memory(row.slug, "MISSION.md"),
    notes: deps.memory(row.slug, "NOTES.md"),
    earlier,
  });

  const known = glossaryKeys(database, row.topic_id);
  let problem: string | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await deps.run<{ body: string }>({
      prompt: problem ? `${prompt}\n\nYour previous answer was rejected: ${problem}.` : prompt,
      schema: SCHEMA,
      purpose: "tutor",
    });
    if (!res.ok) continue;
    const checked = checkAlternative(res.value.body, known);
    if ("problem" in checked) {
      problem = checked.problem;
      continue;
    }
    const stored: AlternativeRow = { id: newId("alt"), step_id: stepId, lens, body: checked.body, created_at: new Date().toISOString() };
    database
      .query("INSERT INTO alternatives (id, step_id, lens, body, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(stored.id, stored.step_id, stored.lens, stored.body, stored.created_at);
    return view(stored);
  }
  fail(502, t("explain.failed"));
}

const pending = new Map<string, Promise<AlternativeView>>();

/** Writes and stores a new alternative explanation of a step; concurrent calls for a step and lens share one run. */
export function explainDifferently(stepId: string, lens: ExplainLens, deps?: Partial<AlternativeDeps>): Promise<AlternativeView> {
  const full: AlternativeDeps = { run: runJsonPrompt, memory: readMemory, ...deps, database: deps?.database ?? db() };
  const key = `${stepId}:${lens}`;
  let run = pending.get(key);
  if (!run) {
    run = write(stepId, lens, full).finally(() => pending.delete(key));
    pending.set(key, run);
  }
  return run;
}

export const alternatives = new Hono();

alternatives.post("/steps/:stepId/alternatives", async (c) => {
  const { lens } = await readBody(c, z.object({ lens: z.enum(EXPLAIN_LENSES) }));
  return c.json(await explainDifferently(c.req.param("stepId"), lens));
});
