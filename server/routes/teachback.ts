import type { Database } from "bun:sqlite";
import { Hono } from "hono";
import { z } from "zod";
import type { TeachbackAction, TeachbackDebrief, TeachbackIdea, TeachbackStatus, TeachbackSummary, TeachbackView } from "../../shared/api";
import type { TopicEvent } from "../../shared/events";
import type { Item, Step } from "../../shared/schemas";
import { stripTermMarks, termKey, termMarks } from "../../shared/terms";
import type { LearnerState } from "../../shared/tools";
import { runJsonPrompt } from "../claude/oneshot";
import { isRunning, runTurn } from "../claude/runner";
import { db, newId, now } from "../db";
import { normalizeForQuote } from "../gates/text";
import { publish } from "../hub";
import { languageInstruction, t } from "../i18n";
import type { JsonPromptRunner } from "./grading";
import { fail, parseJson, readBody } from "./http";
import { learnerStatus } from "./lesson-summary";
import { teachbackEnabled } from "./settings";

/** A key idea of a teach-back: one published explain or worked_example step of the lesson. */
export type KeyIdea = { stepId: string; idx: number; title: string; text: string };

type StepRow = { id: string; idx: number; kind: string; content: string };

function ideaText(step: Step): string {
  if (step.kind === "explain") return stripTermMarks(step.body);
  if (step.kind === "worked_example") return stripTermMarks([step.problem, ...step.lines.map((l, i) => `${i + 1}. ${l.text}`)].join("\n"));
  return "";
}

/**
 * The lesson's explain steps that check the node, with every worked example (worked examples carry no node).
 * A lesson whose explain steps check other nodes only gives all of its explain and worked_example steps.
 */
export function keyIdeas(lessonId: string, nodeId: string, database: Database = db()): KeyIdea[] {
  const steps = database
    .query<StepRow, [string]>("SELECT id, idx, kind, content FROM steps WHERE lesson_id = ? AND status = 'published' AND kind IN ('explain','worked_example') ORDER BY idx")
    .all(lessonId)
    .map((row) => ({ row, step: JSON.parse(row.content) as Step }));
  const onNode = steps.filter(({ step }) => step.kind === "worked_example" || (step.kind === "explain" && step.checks.some((c) => c.nodeId === nodeId)));
  const chosen = onNode.some(({ step }) => step.kind === "explain") ? onNode : steps;
  return chosen.map(({ row, step }) => ({ stepId: row.id, idx: row.idx, title: stripTermMarks((step as { title: string }).title), text: ideaText(step) }));
}

function misconceptions(lessonId: string, nodeId: string, database: Database): string[] {
  const seen = new Set<string>();
  for (const row of database
    .query<{ content: string }, [string, string]>("SELECT content FROM items WHERE lesson_id = ? AND node_id = ? AND status != 'retired' ORDER BY rowid")
    .all(lessonId, nodeId)) {
    const item = JSON.parse(row.content) as Item;
    if (item.format !== "single" && item.format !== "multi") continue;
    for (const o of item.options) if (o.misconception) seen.add(stripTermMarks(o.misconception));
  }
  return [...seen].slice(0, 8);
}

type TeachbackRow = {
  id: string;
  topic_id: string;
  node_id: string;
  lesson_id: string;
  conversation_id: string;
  status: TeachbackStatus;
  debrief: string | null;
  error: string | null;
  created_at: string;
  finished_at: string | null;
  node_title: string;
  lesson_title: string;
};

const SELECT_TEACHBACK = `SELECT tb.*, coalesce(n.title, tb.node_id) AS node_title, l.title AS lesson_title
  FROM teachbacks tb JOIN lessons l ON l.id = tb.lesson_id LEFT JOIN nodes n ON n.topic_id = tb.topic_id AND n.id = tb.node_id`;

/** Debriefs running in this process; a `debriefing` row without one was cut off by a restart. */
const debriefing = new Set<string>();

const effectiveStatus = (row: Pick<TeachbackRow, "id" | "status">): TeachbackStatus =>
  row.status === "debriefing" && !debriefing.has(row.id) ? "failed" : row.status;

function summaryOf(row: TeachbackRow): TeachbackSummary {
  const debrief = parseJson<TeachbackDebrief>(row.debrief);
  return {
    id: row.id,
    topicId: row.topic_id,
    nodeId: row.node_id,
    nodeTitle: row.node_title,
    lessonId: row.lesson_id,
    lessonTitle: row.lesson_title,
    conversationId: row.conversation_id,
    status: effectiveStatus(row),
    createdAt: row.created_at,
    finishedAt: row.finished_at,
    score: debrief ? { covered: debrief.ideas.filter((i) => i.verdict === "covered").length, total: debrief.ideas.length } : null,
  };
}

function teachbackRow(id: string, database: Database): TeachbackRow {
  const row = database.query<TeachbackRow, [string]>(`${SELECT_TEACHBACK} WHERE tb.id = ?`).get(id);
  if (!row) fail(404, t("teachback.notFound"));
  return row;
}

export function teachbackView(id: string, database: Database = db()): TeachbackView {
  const row = teachbackRow(id, database);
  const status = effectiveStatus(row);
  const error = status === "failed" ? (row.error ?? t("teachback.interrupted")) : null;
  return { ...summaryOf(row), debrief: parseJson<TeachbackDebrief>(row.debrief), error };
}

export function teachbackSummaries(topicId: string, database: Database = db()): TeachbackSummary[] {
  return database
    .query<TeachbackRow, [string]>(`${SELECT_TEACHBACK} WHERE tb.topic_id = ? ORDER BY tb.created_at DESC, tb.rowid DESC`)
    .all(topicId)
    .map(summaryOf);
}

/** The persona's grounding: the node, the key ideas with their lesson text, the node's misconceptions and the glossary terms the steps use. */
export function buildTeachbackContext(id: string, database: Database = db()): string {
  const row = teachbackRow(id, database);
  const node = database.query<{ summary: string }, [string, string]>("SELECT summary FROM nodes WHERE topic_id = ? AND id = ?").get(row.topic_id, row.node_id);
  const lesson = database.query<{ objective: string }, [string]>("SELECT objective FROM lessons WHERE id = ?").get(row.lesson_id)!;
  const ideas = keyIdeas(row.lesson_id, row.node_id, database);
  const raw = database
    .query<{ content: string }, [string]>("SELECT content FROM steps WHERE lesson_id = ? AND status = 'published' AND kind IN ('explain','worked_example')")
    .all(row.lesson_id)
    .map((s) => s.content)
    .join("\n");
  const marked = new Set(termMarks(raw).map((m) => termKey(m.term)));
  const terms = database
    .query<{ key: string; term: string; definition: string }, [string]>("SELECT key, term, definition FROM glossary_terms WHERE topic_id = ? ORDER BY term COLLATE NOCASE")
    .all(row.topic_id)
    .filter((g) => marked.has(g.key));
  const misc = misconceptions(row.lesson_id, row.node_id, database);
  return [
    `Teach-back id: ${row.id}. Your name: ${t("teachback.persona")}.`,
    `The learner explains: "${row.node_title}". ${node?.summary ?? ""}`.trim(),
    `Lesson they completed: "${row.lesson_title}". Objective: ${lesson.objective}`,
    `Key ideas, one per lesson step; the learner does not see this list:\n${ideas.map((k, i) => `${i + 1}. ${k.title}\n${k.text}`).join("\n\n")}`,
    misc.length ? `Misconceptions the lesson's questions on this node target:\n${misc.map((m) => `- ${m}`).join("\n")}` : "",
    terms.length ? `Terms the lesson uses:\n${terms.map((g) => `- ${g.term}: ${g.definition}`).join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** The newest authored lesson on the node that the learner completed, or the requested one if it qualifies. */
function lessonFor(topicId: string, nodeId: string, lessonId: string | undefined, database: Database): { id: string } {
  const candidates = database
    .query<{ id: string }, [string, string]>(
      `SELECT l.id FROM lessons l WHERE l.topic_id = ? AND l.status IN ('ready','finished')
         AND EXISTS (SELECT 1 FROM json_each(l.node_ids) WHERE value = ?)
       ORDER BY l.created_at DESC, l.rowid DESC`,
    )
    .all(topicId, nodeId)
    .filter((l) => !lessonId || l.id === lessonId);
  if (lessonId && candidates.length === 0) fail(404, t("teachback.lessonNotFound"));
  const done = candidates.find((l) => learnerStatus(l.id, database) === "completed");
  if (!done) fail(409, t("teachback.lessonNotCompleted"));
  return done;
}

export function startTeachback(
  topicId: string,
  req: { nodeId: string; lessonId?: string },
  database: Database = db(),
  run: typeof runTurn = runTurn,
): TeachbackView {
  if (!teachbackEnabled(database)) fail(409, t("teachback.disabled"));
  if (!database.query("SELECT 1 FROM nodes WHERE topic_id = ? AND id = ?").get(topicId, req.nodeId)) fail(404, t("teachback.nodeNotFound"));
  const lesson = lessonFor(topicId, req.nodeId, req.lessonId, database);
  if (keyIdeas(lesson.id, req.nodeId, database).length === 0) fail(409, t("teachback.noIdeas"));
  const id = newId("tb");
  const conversationId = newId("cv");
  database.transaction(() => {
    database.query("INSERT INTO conversations (id, topic_id, kind, lesson_id) VALUES (?, ?, 'teachback', ?)").run(conversationId, topicId, lesson.id);
    database
      .query("INSERT INTO teachbacks (id, topic_id, node_id, lesson_id, conversation_id) VALUES (?, ?, ?, ?, ?)")
      .run(id, topicId, req.nodeId, lesson.id, conversationId);
  })();
  run({ conversationId, text: `/clayfold:teach-back <context>\n${buildTeachbackContext(id, database)}\n</context>`, display: null });
  return teachbackView(id, database);
}

// ---------- Debrief ----------

/** What the judge returns: two yes/no answers per key idea (CheckEval), with the learner's words and the lesson's statement. */
export type RawDebrief = {
  ideas: { stepId: string; mentioned: boolean; correct: boolean; evidence: string; correction: string }[];
  summary: string;
};

const DEBRIEF_SCHEMA = {
  type: "object",
  properties: {
    ideas: {
      type: "array",
      items: {
        type: "object",
        properties: {
          stepId: { type: "string" },
          mentioned: { type: "boolean" },
          correct: { type: "boolean" },
          evidence: { type: "string" },
          correction: { type: "string" },
        },
        required: ["stepId", "mentioned", "correct", "evidence", "correction"],
        additionalProperties: false,
      },
    },
    summary: { type: "string" },
  },
  required: ["ideas", "summary"],
  additionalProperties: false,
};

const ATTEMPTS = 2;

const unquote = (s: string) => s.trim().replace(/^["'«»“”„]+|["'«»“”„]+$/g, "").replace(/^(\.\.\.|…)\s*|\s*(\.\.\.|…)$/g, "").trim();

/** Problems that make a debrief untrustworthy; the judge gets them back for its second attempt. */
export function checkDebrief(raw: RawDebrief, ideas: KeyIdea[], learnerText: string): string[] {
  const problems: string[] = [];
  const known = new Map(ideas.map((k) => [k.stepId, k]));
  const said = normalizeForQuote(learnerText);
  const seen = new Set<string>();
  for (const entry of raw.ideas) {
    if (!known.has(entry.stepId)) {
      problems.push(`stepId "${entry.stepId}" is not one of the key ideas; use the stepIds given.`);
      continue;
    }
    if (seen.has(entry.stepId)) problems.push(`stepId "${entry.stepId}" has more than one entry.`);
    seen.add(entry.stepId);
    if (entry.mentioned) {
      const evidence = normalizeForQuote(unquote(entry.evidence));
      if (!evidence) problems.push(`stepId "${entry.stepId}" is mentioned but its evidence is empty.`);
      else if (!said.includes(evidence)) problems.push(`The evidence for stepId "${entry.stepId}" is not copied verbatim from the learner's messages.`);
    }
    if (!(entry.mentioned && entry.correct) && !entry.correction.trim()) problems.push(`stepId "${entry.stepId}" is not covered but its correction is empty.`);
  }
  for (const k of ideas) if (!seen.has(k.stepId)) problems.push(`Key idea "${k.title}" (stepId "${k.stepId}") has no entry.`);
  if (!raw.summary.trim()) problems.push("The summary is empty.");
  return problems;
}

/** The first practice step of the lesson on the node, or of the lesson when none targets the node. */
function practiceStep(lessonId: string, nodeId: string, database: Database): TeachbackAction | null {
  const rows = database
    .query<StepRow, [string]>("SELECT id, idx, kind, content FROM steps WHERE lesson_id = ? AND status = 'published' AND kind = 'practice' ORDER BY idx")
    .all(lessonId)
    .map((row) => ({ row, step: JSON.parse(row.content) as Extract<Step, { kind: "practice" }> }));
  const pick = rows.find(({ step }) => step.item.nodeId === nodeId) ?? rows[0];
  return pick ? { kind: "practice", stepId: pick.row.id, stepIdx: pick.row.idx, title: stripTermMarks(pick.step.title) } : null;
}

export function toDebrief(raw: RawDebrief, ideas: KeyIdea[], practice: TeachbackAction | null): TeachbackDebrief {
  const byStep = new Map(raw.ideas.map((e) => [e.stepId, e]));
  const checked: TeachbackIdea[] = ideas.map((k) => {
    const e = byStep.get(k.stepId)!;
    const verdict = !e.mentioned ? "missing" : e.correct ? "covered" : "wrong";
    return {
      stepId: k.stepId,
      stepIdx: k.idx,
      title: k.title,
      verdict,
      evidence: e.mentioned ? unquote(e.evidence) : null,
      correction: verdict === "covered" ? null : e.correction.trim(),
    };
  });
  const gaps = checked.filter((i) => i.verdict !== "covered");
  const next: TeachbackAction[] = gaps.map((i) => ({ kind: "reread", stepId: i.stepId, stepIdx: i.stepIdx, title: i.title }));
  if (gaps.length && practice) next.push(practice);
  return { summary: raw.summary.trim(), ideas: checked, next };
}

function debriefPrompt(ideas: KeyIdea[], transcript: { role: "user" | "assistant"; text: string }[], problems: string[]): string {
  return [
    "You check a learner's teach-back. After a lesson, the learner explained its topic in their own words to a curious novice. Judge only the learner's messages against the lesson's key ideas below; the novice's messages are context, not the learner's knowledge.",
    "For every key idea, with the stepId given for it, answer two yes/no questions:",
    "- mentioned: did the learner state this idea, in any wording, anywhere in the conversation?",
    "- correct: is what the learner stated about it consistent with the lesson text? (false when not mentioned)",
    "evidence: when mentioned, the learner's words the verdict rests on, copied character for character from one of their messages (a sentence or a clause); otherwise an empty string.",
    "correction: when the idea is not mentioned or not correct, the idea in one or two sentences, restated only from the lesson text given for it; otherwise an empty string.",
    "summary: two sentences addressed to the learner: what they explained well and what to revisit.",
    `${languageInstruction()} The evidence stays exactly as the learner wrote it.`,
    `<key_ideas>\n${ideas.map((k) => `<idea stepId="${k.stepId}">\n<title>${k.title}</title>\n${k.text}\n</idea>`).join("\n")}\n</key_ideas>`,
    `<conversation>\n${transcript.map((m) => `${m.role === "user" ? "Learner" : "Novice"}: ${m.text}`).join("\n\n")}\n</conversation>`,
    problems.length ? `Your previous answer had these problems; fix every one:\n${problems.map((p) => `- ${p}`).join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export type DebriefDeps = { database: Database; runPrompt: JsonPromptRunner; publish: (topicId: string, event: TopicEvent) => void };

const defaultDeps = (): DebriefDeps => ({ database: db(), runPrompt: runJsonPrompt, publish });

export async function writeDebrief(id: string, deps: DebriefDeps = defaultDeps()): Promise<void> {
  const { database } = deps;
  const row = teachbackRow(id, database);
  debriefing.add(id);
  try {
    const ideas = keyIdeas(row.lesson_id, row.node_id, database);
    const transcript = database
      .query<{ role: "user" | "assistant"; text: string }, [string]>(
        "SELECT role, text FROM messages WHERE conversation_id = ? AND role IN ('user','assistant') ORDER BY rowid",
      )
      .all(row.conversation_id);
    const learnerText = transcript.filter((m) => m.role === "user").map((m) => m.text).join("\n");
    let problems: string[] = [];
    let debrief: TeachbackDebrief | null = null;
    for (let attempt = 0; attempt < ATTEMPTS && !debrief; attempt++) {
      const res = await deps.runPrompt<RawDebrief>({ prompt: debriefPrompt(ideas, transcript, problems), schema: DEBRIEF_SCHEMA, purpose: "grading" });
      if (!res.ok) {
        problems = [];
        continue;
      }
      problems = checkDebrief(res.value, ideas, learnerText);
      if (problems.length === 0) debrief = toDebrief(res.value, ideas, practiceStep(row.lesson_id, row.node_id, database));
    }
    if (debrief) {
      database
        .query("UPDATE teachbacks SET status = 'done', debrief = ?, error = NULL, finished_at = ? WHERE id = ?")
        .run(JSON.stringify(debrief), now(), id);
    } else {
      database.query("UPDATE teachbacks SET status = 'failed', error = ? WHERE id = ?").run(t("teachback.debriefFailed"), id);
    }
  } catch (e) {
    console.error(`teach-back ${id} debrief failed:`, e);
    database.query("UPDATE teachbacks SET status = 'failed', error = ? WHERE id = ?").run(t("teachback.debriefFailed"), id);
  } finally {
    debriefing.delete(id);
    deps.publish(row.topic_id, { type: "teachback.updated", teachbackId: id, status: effectiveStatus(teachbackRow(id, database)) });
  }
}

/**
 * Starts the debrief. The learner finishes from the page, which waits for the persona's reply; the persona finishes
 * through teachback_finish while its own turn runs.
 */
export function finishTeachback(id: string, by: "learner" | "persona", deps: DebriefDeps = defaultDeps()): { view: TeachbackView; done: Promise<void> } {
  const { database } = deps;
  const row = teachbackRow(id, database);
  const status = effectiveStatus(row);
  if (status !== "talking" && status !== "failed") fail(409, t("teachback.alreadyFinished"));
  if (by === "learner" && isRunning(row.conversation_id)) fail(409, t("teachback.personaReplying"));
  if (!database.query("SELECT 1 FROM messages WHERE conversation_id = ? AND role = 'user'").get(row.conversation_id)) fail(409, t("teachback.nothingSaid"));
  database.query("UPDATE teachbacks SET status = 'debriefing', error = NULL WHERE id = ?").run(id);
  debriefing.add(id);
  deps.publish(row.topic_id, { type: "teachback.updated", teachbackId: id, status: "debriefing" });
  return { view: teachbackView(id, database), done: writeDebrief(id, deps) };
}

/** A conversation that belongs to a teach-back takes learner messages only while the teach-back is talking. */
export function teachbackOpen(conversationId: string, database: Database = db()): boolean {
  const row = database.query<{ id: string; status: TeachbackStatus }, [string]>("SELECT id, status FROM teachbacks WHERE conversation_id = ?").get(conversationId);
  return !row || effectiveStatus(row) === "talking";
}

/** Ideas left out or got wrong in the latest debriefed teach-back on each node. */
export function teachbackGaps(topicId: string, database: Database = db()): LearnerState["teachbackGaps"] {
  return database
    .query<{ node_id: string; debrief: string; finished_at: string }, [string]>(
      `SELECT node_id, debrief, finished_at FROM teachbacks t WHERE topic_id = ?1 AND status = 'done'
         AND NOT EXISTS (SELECT 1 FROM teachbacks u WHERE u.topic_id = ?1 AND u.node_id = t.node_id AND u.status = 'done'
                         AND (u.finished_at > t.finished_at OR (u.finished_at = t.finished_at AND u.rowid > t.rowid)))
       ORDER BY finished_at DESC`,
    )
    .all(topicId)
    .flatMap((r) =>
      (JSON.parse(r.debrief) as TeachbackDebrief).ideas
        .filter((i) => i.verdict !== "covered")
        .map((i) => ({ nodeId: r.node_id, idea: i.title, verdict: i.verdict as "missing" | "wrong", correction: i.correction ?? "", at: r.finished_at })),
    );
}

export const teachbacks = new Hono();

teachbacks.post("/topics/:topicId/teachbacks", async (c) => {
  const topicId = c.req.param("topicId");
  if (!db().query("SELECT 1 FROM topics WHERE id = ?").get(topicId)) fail(404, "topic not found");
  const req = await readBody(c, z.object({ nodeId: z.string().min(1), lessonId: z.string().min(1).optional() }));
  return c.json(startTeachback(topicId, req) satisfies TeachbackView, 202);
});

teachbacks.get("/teachbacks/:id", (c) => c.json(teachbackView(c.req.param("id")) satisfies TeachbackView));

teachbacks.post("/teachbacks/:id/finish", (c) => c.json(finishTeachback(c.req.param("id"), "learner").view satisfies TeachbackView, 202));
