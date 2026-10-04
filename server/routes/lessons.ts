import type { Database } from "bun:sqlite";
import { Hono } from "hono";
import { z } from "zod";
import type { LessonView, StartLessonResponse } from "../../shared/api";
import type { PublicStep } from "../../shared/schemas";
import { runTurn } from "../claude/runner";
import { db, newId } from "../db";
import { fail, readBody } from "./http";
import { lessonItemStates, lessonRevealedLines } from "./progress";
import { publicStep, type StepRow } from "./public";
import { lessonSummary, type LessonRow as SummaryRow } from "./lesson-summary";
import { createConversation } from "./topics";
import { buildTutorContext } from "./tutor-context";

type LessonRow = SummaryRow & { summary: string | null; challenge_idx: number | null };

function lessonRow(id: string): LessonRow {
  const row = db().query<LessonRow, [string]>("SELECT * FROM lessons WHERE id = ?").get(id);
  if (!row) fail(404, "lesson not found");
  return row;
}

const latestConversation = (lessonId: string, kind: "lesson" | "tutor") =>
  db()
    .query<{ id: string }, [string, string]>(
      "SELECT id FROM conversations WHERE lesson_id = ? AND kind = ? ORDER BY created_at DESC, rowid DESC LIMIT 1",
    )
    .get(lessonId, kind)?.id ?? null;

export const lessons = new Hono();

lessons.get("/:lessonId", (c) => {
  const lesson = lessonRow(c.req.param("lessonId"));
  const outline = JSON.parse(lesson.outline) as LessonView["outline"];
  const rows = db().query<StepRow, [string]>("SELECT * FROM steps WHERE lesson_id = ? ORDER BY idx").all(lesson.id);
  const steps: PublicStep[] = [];
  const stepStatus: LessonView["stepStatus"] = outline.map(() => "pending");
  for (const row of rows) {
    if (row.status === "published") {
      try {
        steps.push(publicStep(row));
      } catch (e) {
        console.error(e);
        continue;
      }
    }
    if (row.idx < stepStatus.length) {
      stepStatus[row.idx] = row.status === "published" ? "published" : row.status === "checking" ? "checking" : row.status === "dropped" ? "dropped" : "pending";
    }
  }
  return c.json({
    lesson: { ...lessonSummary(lesson), summary: lesson.summary },
    outline,
    steps,
    stepStatus,
    authorConversationId: latestConversation(lesson.id, "lesson"),
    tutorConversationId: latestConversation(lesson.id, "tutor"),
    itemStates: lessonItemStates(lesson.id),
    revealedLines: lessonRevealedLines(lesson.id),
    challengeIdx: lesson.challenge_idx,
  } satisfies LessonView);
});

/** Starts a new lesson-author run on the old lesson's first node; the old lesson stays as it is. */
export function rebuildLesson(
  lesson: { topic_id: string; node_ids: string },
  database: Database = db(),
  run: typeof runTurn = runTurn,
): StartLessonResponse {
  const nodeId = (JSON.parse(lesson.node_ids) as string[])[0] ?? "next";
  const conversationId = newId("cv");
  database.query("INSERT INTO conversations (id, topic_id, kind) VALUES (?, ?, 'lesson')").run(conversationId, lesson.topic_id);
  run({ conversationId, text: `/clayfold:lesson-author ${nodeId}`, display: null });
  return { lessonId: null, conversationId };
}

lessons.post("/:lessonId/rebuild", (c) => c.json(rebuildLesson(lessonRow(c.req.param("lessonId"))), 202));

/**
 * Continues a failed lesson in its own authoring session: the outline and published steps stay, and Claude
 * submits the steps still missing. A step left mid-check by the dead run counts as a rejected attempt.
 */
export function resumeLesson(
  lesson: { id: string; status: string },
  database: Database = db(),
  run: typeof runTurn = runTurn,
): StartLessonResponse {
  if (lesson.status !== "failed") fail(409, "only an interrupted lesson can be continued");
  const conv = database
    .query<{ id: string; session_id: string | null }, [string]>(
      "SELECT id, session_id FROM conversations WHERE lesson_id = ? AND kind = 'lesson' ORDER BY created_at DESC, rowid DESC LIMIT 1",
    )
    .get(lesson.id);
  if (!conv?.session_id) fail(409, "the lesson's authoring session is gone; rebuild the lesson instead");
  database.transaction(() => {
    database.query("UPDATE steps SET status = 'rejected' WHERE lesson_id = ? AND status = 'checking'").run(lesson.id);
    database.query("UPDATE lessons SET status = 'generating' WHERE id = ?").run(lesson.id);
  })();
  run({
    conversationId: conv.id,
    text: `[Platform: the run that authored lesson ${lesson.id} stopped before the lesson was finished. Continue it: submit with step_submit every outline step that is not published or dropped yet, then finish the lesson and propose cards as the lesson-author skill says.]`,
    display: null,
  });
  return { lessonId: lesson.id, conversationId: conv.id };
}

lessons.post("/:lessonId/resume", (c) => c.json(resumeLesson(lessonRow(c.req.param("lessonId"))), 202));

lessons.post("/:lessonId/tutor", async (c) => {
  const lesson = lessonRow(c.req.param("lessonId"));
  const req = await readBody(
    c,
    z.object({
      itemId: z.string().min(1).optional(),
      stepId: z.string().min(1).optional(),
      line: z.number().int().min(0).max(11).optional(),
      quote: z.string().trim().min(1).max(2000).optional(),
      text: z.string().trim().min(1).max(4000),
    }),
  );
  if (req.itemId && !db().query("SELECT 1 FROM items WHERE id = ? AND topic_id = ?").get(req.itemId, lesson.topic_id)) fail(404, "item not found");
  if (req.stepId && !db().query("SELECT 1 FROM steps WHERE id = ? AND lesson_id = ?").get(req.stepId, lesson.id)) fail(404, "step not found");
  const conversationId = latestConversation(lesson.id, "tutor") ?? createConversation(lesson.topic_id, "tutor", lesson.id);
  if (req.line !== undefined && !req.stepId) fail(400, "line needs stepId");
  const context = buildTutorContext({ lessonId: lesson.id, itemId: req.itemId, stepId: req.stepId, line: req.line, quote: req.quote });
  runTurn({ conversationId, text: `<context>\n${context}\n</context>\n<learner>${req.text}</learner>`, display: req.text, quote: req.quote });
  return c.json({ conversationId }, 202);
});
