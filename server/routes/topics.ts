import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import type {
  CardView,
  ConversationKind,
  CreateTopicResponse,
  LessonSummary,
  NodeView,
  NoteView,
  SourceView,
  StartLessonResponse,
  TopicDetail,
  TopicSummary,
} from "../../shared/api";
import type { TopicEvent } from "../../shared/events";
import type { Card } from "../../shared/schemas";
import { isTopicRunning, runTurn } from "../claude/runner";
import { db, newId } from "../db";
import { subscribe } from "../hub";
import { createWorkspace, listMemory, uniqueSlug, watchWorkspace } from "../workspace";
import { fail, readBody } from "./http";
import { lessonSummary, type LessonRow } from "./lesson-summary";
import { derivePhases, onboardingFacts } from "./onboarding";

type TopicRow = { id: string; slug: string; title: string; created_at: string };

export function topicRow(topicId: string): TopicRow {
  const row = db().query<TopicRow, [string]>("SELECT id, slug, title, created_at FROM topics WHERE id = ?").get(topicId);
  if (!row) fail(404, "topic not found");
  return row;
}

function summary(t: TopicRow): TopicSummary {
  const counts = db()
    .query<{ due: number; mastered: number; total: number }, [string, string, string, string]>(
      `SELECT
         (SELECT count(*) FROM cards WHERE topic_id = ? AND status = 'active' AND due <= ?) AS due,
         (SELECT count(*) FROM nodes WHERE topic_id = ? AND mastery = 'mastered') AS mastered,
         (SELECT count(*) FROM nodes WHERE topic_id = ?) AS total`,
    )
    .get(t.id, new Date().toISOString(), t.id, t.id)!;
  return {
    id: t.id,
    slug: t.slug,
    title: t.title,
    createdAt: t.created_at,
    dueCards: counts.due,
    nodesMastered: counts.mastered,
    nodesTotal: counts.total,
    running: isTopicRunning(t.id),
  };
}


type CardRow = { id: string; topic_id: string; node_id: string; content: string; status: CardView["status"]; due: string | null; lapses: number };

export function cardView(r: CardRow): CardView {
  const card = JSON.parse(r.content) as Card;
  return { id: r.id, topicId: r.topic_id, kind: card.kind, front: card.front, back: card.back, nodeId: r.node_id, status: r.status, due: r.due, lapses: r.lapses };
}

export function createConversation(topicId: string, kind: ConversationKind, lessonId: string | null = null): string {
  const id = newId("cv");
  db().query("INSERT INTO conversations (id, topic_id, kind, lesson_id) VALUES (?, ?, ?, ?)").run(id, topicId, kind, lessonId);
  return id;
}

export const topics = new Hono();

topics.post("/", async (c) => {
  const { request } = await readBody(c, z.object({ request: z.string().trim().min(3).max(2000) }));
  const slug = uniqueSlug(request);
  const topicId = newId("tp");
  db().query("INSERT INTO topics (id, slug, title, request) VALUES (?, ?, ?, ?)").run(topicId, slug, request.slice(0, 80), request);
  createWorkspace(slug);
  const conversationId = createConversation(topicId, "onboard");
  runTurn({ conversationId, text: `/clayfold:onboard ${request}`, display: request });
  return c.json({ topicId, conversationId } satisfies CreateTopicResponse, 201);
});

topics.get("/", (c) => {
  const rows = db().query<TopicRow, []>("SELECT id, slug, title, created_at FROM topics ORDER BY created_at DESC").all();
  return c.json(rows.map(summary) satisfies TopicSummary[]);
});

topics.get("/:topicId", (c) => {
  const t = topicRow(c.req.param("topicId"));
  const nodes = db()
    .query<
      { id: string; title: string; kind: NodeView["kind"]; summary: string; prereqs: string; placement: NodeView["placement"]; mastery: NodeView["mastery"] },
      [string]
    >("SELECT id, title, kind, summary, prereqs, placement, mastery FROM nodes WHERE topic_id = ? ORDER BY rowid")
    .all(t.id)
    .map((n): NodeView => ({ ...n, prereqs: JSON.parse(n.prereqs) as string[] }));
  const lessons = db()
    .query<LessonRow, [string]>("SELECT * FROM lessons WHERE topic_id = ? ORDER BY created_at")
    .all(t.id)
    .map((l) => lessonSummary(l));
  const sources = db()
    .query<SourceView, [string]>("SELECT id, url, title, kind, note, status FROM sources WHERE topic_id = ? ORDER BY fetched_at")
    .all(t.id);
  const conversations = db()
    .query<{ id: string; kind: ConversationKind; lessonId: string | null; createdAt: string }, [string]>(
      "SELECT id, kind, lesson_id AS lessonId, created_at AS createdAt FROM conversations WHERE topic_id = ? ORDER BY created_at",
    )
    .all(t.id);
  const onboarding = derivePhases(onboardingFacts(t));
  return c.json({ topic: summary(t), nodes, lessons, sources, conversations, onboarding } satisfies TopicDetail);
});

topics.get("/:topicId/memory", async (c) => {
  const t = topicRow(c.req.param("topicId"));
  return c.json(await listMemory(t.slug));
});

topics.get("/:topicId/notes", (c) => {
  const t = topicRow(c.req.param("topicId"));
  const rows = db()
    .query<{ id: string; topic_id: string; lesson_id: string | null; step_id: string | null; quote: string | null; text: string; created_at: string }, [string]>(
      "SELECT * FROM notes WHERE topic_id = ? ORDER BY created_at DESC",
    )
    .all(t.id);
  return c.json(
    rows.map(
      (n): NoteView => ({
        id: n.id,
        topicId: n.topic_id,
        ...(n.lesson_id ? { lessonId: n.lesson_id } : {}),
        ...(n.step_id ? { stepId: n.step_id } : {}),
        ...(n.quote ? { quote: n.quote } : {}),
        text: n.text,
        createdAt: n.created_at,
      }),
    ),
  );
});

topics.get("/:topicId/cards", (c) => {
  const t = topicRow(c.req.param("topicId"));
  const status = c.req.query("status");
  const rows = status
    ? db().query<CardRow, [string, string]>("SELECT * FROM cards WHERE topic_id = ? AND status = ? ORDER BY created_at").all(t.id, status)
    : db().query<CardRow, [string]>("SELECT * FROM cards WHERE topic_id = ? ORDER BY created_at").all(t.id);
  return c.json(rows.map(cardView));
});

topics.post("/:topicId/lessons", async (c) => {
  const t = topicRow(c.req.param("topicId"));
  const { nodeId } = await readBody(c, z.object({ nodeId: z.string().min(1).optional() }));
  if (nodeId && !db().query("SELECT 1 FROM nodes WHERE topic_id = ? AND id = ?").get(t.id, nodeId)) fail(400, `unknown node ${nodeId}`);
  const conversationId = createConversation(t.id, "lesson");
  runTurn({ conversationId, text: `/clayfold:lesson-author ${nodeId ?? "next"}`, display: null });
  return c.json({ lessonId: null, conversationId } satisfies StartLessonResponse, 202);
});

const HEARTBEAT_MS = 15_000;

topics.get("/:topicId/stream", (c) => {
  const t = topicRow(c.req.param("topicId"));
  return streamSSE(c, async (stream) => {
    let chain: Promise<unknown> = Promise.resolve();
    const send = (event: TopicEvent) => {
      chain = chain.then(() => stream.writeSSE({ data: JSON.stringify(event) })).catch(() => {});
    };
    const unsubscribe = subscribe(t.id, send);
    const unwatch = watchWorkspace(t.id, t.slug);
    const heartbeat = setInterval(() => {
      chain = chain.then(() => stream.write(": ping\n\n")).catch(() => {});
    }, HEARTBEAT_MS);
    const closed = new Promise<void>((resolve) => stream.onAbort(resolve));
    await stream.write(": connected\n\n");
    await closed;
    clearInterval(heartbeat);
    unsubscribe();
    unwatch();
  });
});
