import { Hono } from "hono";
import { z } from "zod";
import type { AttemptResponse, WorkedLineResponse } from "../../shared/api";
import { db, newId } from "../db";
import { publish } from "../hub";
import { fail, readBody } from "./http";
import { answerWorkedLine, giveUp, GradingError, revealWorkedLine, submitAttempt, takeHint } from "./grading";
import type { StepRow } from "./public";

const AnswerSchema = z.discriminatedUnion("format", [
  z.object({ format: z.literal("single"), choice: z.number().int().min(0) }),
  z.object({ format: z.literal("multi"), choices: z.array(z.number().int().min(0)).max(5) }),
  z.object({ format: z.literal("order"), sequence: z.array(z.string()).max(7) }),
  z.object({ format: z.literal("match"), pairs: z.array(z.number().int().min(0)).max(6) }),
  z.object({ format: z.literal("sort"), categories: z.array(z.number().int().min(0)).max(8) }),
  z.object({ format: z.literal("cloze"), blanks: z.array(z.string().max(200)).max(4) }),
  z.object({ format: z.literal("number"), value: z.number() }),
  z.object({ format: z.literal("short"), text: z.string().trim().min(1).max(3000) }),
]);

const AttemptSchema = z.object({
  answer: AnswerSchema,
  hintsUsed: z.number().int().min(0).default(0),
  durationMs: z.number().min(0).default(0),
  context: z.enum(["activate", "check", "practice", "explain", "review"]),
});

function guard<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof GradingError) fail(e.status, e.message);
    throw e;
  }
}

export const items = new Hono();

items.post("/items/:itemId/attempt", async (c) => {
  const itemId = c.req.param("itemId");
  const req = await readBody(c, AttemptSchema);
  let res: Awaited<ReturnType<typeof submitAttempt>>;
  try {
    res = await submitAttempt(itemId, req);
  } catch (e) {
    if (e instanceof GradingError) fail(e.status, e.message);
    throw e;
  }
  const { attemptId: _, ...body } = res;
  if (body.offerTutor) {
    const item = db().query<{ topic_id: string; lesson_id: string | null }, [string]>("SELECT topic_id, lesson_id FROM items WHERE id = ?").get(itemId);
    if (item?.lesson_id) publish(item.topic_id, { type: "tutor.offer", lessonId: item.lesson_id, itemId, reason: "wrong_twice" });
  }
  return c.json(body satisfies AttemptResponse);
});

items.post("/items/:itemId/hint", async (c) => {
  const { level } = await readBody(c, z.object({ level: z.number().int().min(1).default(1) }));
  return c.json(guard(() => takeHint(c.req.param("itemId"), level)));
});

items.post("/items/:itemId/giveup", (c) => c.json(guard(() => giveUp(c.req.param("itemId")))));

function stepRow(stepId: string): StepRow & { topic_id: string } {
  const row = db()
    .query<StepRow & { topic_id: string }, [string]>(
      "SELECT s.*, l.topic_id FROM steps s JOIN lessons l ON l.id = s.lesson_id WHERE s.id = ?",
    )
    .get(stepId);
  if (!row) fail(404, "step not found");
  return row;
}

items.post("/worked/:stepId/lines/:lineIdx", async (c) => {
  const step = stepRow(c.req.param("stepId"));
  const { answer } = await readBody(c, z.object({ answer: z.string().max(500) }));
  const lineIdx = Number(c.req.param("lineIdx"));
  return c.json(guard(() => answerWorkedLine(step, lineIdx, answer)) satisfies WorkedLineResponse);
});

items.post("/worked/:stepId/lines/:lineIdx/reveal", (c) => {
  const step = stepRow(c.req.param("stepId"));
  return c.json(guard(() => revealWorkedLine(step, Number(c.req.param("lineIdx")))) satisfies WorkedLineResponse);
});

items.post("/steps/:stepId/reflect", async (c) => {
  const step = stepRow(c.req.param("stepId"));
  const { text } = await readBody(c, z.object({ text: z.string().trim().min(1).max(4000) }));
  const content = JSON.parse(step.content) as { kind: string; prompt?: string };
  db()
    .query("INSERT INTO notes (id, topic_id, lesson_id, step_id, quote, text) VALUES (?, ?, ?, ?, ?, ?)")
    .run(newId("nt"), step.topic_id, step.lesson_id, step.id, content.kind === "reflect" ? (content.prompt ?? null) : null, text);
  return c.body(null, 202);
});
