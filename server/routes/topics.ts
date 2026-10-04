import type { Database } from "bun:sqlite";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import type {
  CardView,
  ConversationKind,
  CreateTopicResponse,
  GoalNoteView,
  GoalPlanEntryView,
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
import { FINAL_PASS_SHARE } from "../../shared/api";
import { isTopicRunning, runTurn } from "../claude/runner";
import { db, newId, now } from "../db";
import { materialViews, storeMaterials, type Material } from "../gates/materials";
import { t } from "../i18n";
import { publish, subscribe } from "../hub";
import { bestFinalShare } from "../review/practice-test";
import { createWorkspace, listMemory, uniqueSlug, watchWorkspace } from "../workspace";
import { fail, parseBody, readBody } from "./http";
import { lessonSummary, type LessonRow } from "./lesson-summary";
import { extractMaterials, materialsBodyLimit, readForm } from "./materials";
import { deriveGoalPhases, derivePhases, onboardingFacts } from "./onboarding";

type TopicRow = { id: string; slug: string; title: string; created_at: string; kind: TopicSummary["kind"]; goal_id: string | null };

const TOPIC_COLUMNS = "id, slug, title, created_at, kind, goal_id";

export function topicRow(topicId: string): TopicRow {
  const row = db().query<TopicRow, [string]>(`SELECT ${TOPIC_COLUMNS} FROM topics WHERE id = ?`).get(topicId);
  if (!row) fail(404, "topic not found");
  return row;
}

const finalSummary = (best: number | null): TopicSummary["final"] => (best === null ? null : { percent: Math.round(best * 100), passed: best >= FINAL_PASS_SHARE });

function summary(t: TopicRow): TopicSummary {
  const counts = db()
    .query<{ due: number; mastered: number; total: number }, [string, string, string, string]>(
      `SELECT
         (SELECT count(*) FROM cards WHERE topic_id = ? AND status = 'active' AND due <= ?) AS due,
         (SELECT count(*) FROM nodes WHERE topic_id = ? AND mastery = 'mastered') AS mastered,
         (SELECT count(*) FROM nodes WHERE topic_id = ?) AS total`,
    )
    .get(t.id, new Date().toISOString(), t.id, t.id)!;
  const plan =
    t.kind === "goal"
      ? db()
          .query<{ total: number; opened: number }, [string]>("SELECT count(*) AS total, count(topic_id) AS opened FROM goal_plan WHERE goal_id = ?")
          .get(t.id)!
      : null;
  return {
    id: t.id,
    slug: t.slug,
    title: t.title,
    createdAt: t.created_at,
    dueCards: counts.due,
    nodesMastered: counts.mastered,
    nodesTotal: counts.total,
    running: isTopicRunning(t.id),
    kind: t.kind,
    goalId: t.goal_id,
    plan,
    final: finalSummary(bestFinalShare(t.id)),
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

function insertTopic(opts: { title: string; request: string; kind: TopicSummary["kind"]; goalId?: string }): string {
  const topicId = newId("tp");
  const slug = uniqueSlug(opts.title);
  db()
    .query("INSERT INTO topics (id, slug, title, request, kind, goal_id) VALUES (?, ?, ?, ?, ?, ?)")
    .run(topicId, slug, opts.title.slice(0, 80), opts.request, opts.kind, opts.goalId ?? null);
  createWorkspace(slug);
  return topicId;
}

function startOnboarding(topicId: string, kind: TopicSummary["kind"], request: string): string {
  const conversationId = createConversation(topicId, "onboard");
  runTurn({ conversationId, text: `/clayfold:${kind === "goal" ? "goal-plan" : "onboard"} ${request}`, display: request });
  return conversationId;
}

const NewTopic = z.object({ request: z.string().trim().min(3).max(2000), kind: z.enum(["topic", "goal"]).default("topic") });

topics.post("/", materialsBodyLimit, async (c) => {
  let topic: z.infer<typeof NewTopic>;
  let found: Material[] = [];
  if (c.req.header("content-type")?.startsWith("multipart/form-data")) {
    const form = await readForm(c);
    topic = parseBody(NewTopic, { request: form.get("request") ?? undefined, kind: form.get("kind") ?? undefined });
    if (topic.kind === "goal" && ["file", "text", "link"].some((part) => form.has(part))) fail(400, t("material.error.goal"));
    found = await extractMaterials(form);
  } else {
    topic = await readBody(c, NewTopic);
  }
  const { request, kind } = topic;
  const topicId = insertTopic({ title: request, request, kind });
  storeMaterials(db(), topicId, found);
  const conversationId = startOnboarding(topicId, kind, request);
  return c.json({ topicId, conversationId } satisfies CreateTopicResponse, 201);
});

topics.post("/:goalId/plan/:entryId/open", (c) => {
  const goal = topicRow(c.req.param("goalId"));
  if (goal.kind !== "goal") fail(400, "this topic is not a goal");
  const entry = db()
    .query<{ title: string; brief: string; topic_id: string | null }, [string, string]>("SELECT title, brief, topic_id FROM goal_plan WHERE goal_id = ? AND id = ?")
    .get(goal.id, c.req.param("entryId"));
  if (!entry) fail(404, "plan entry not found");
  if (entry.topic_id) fail(409, "this topic is already opened");
  const topicId = db().transaction(() => {
    const id = insertTopic({ title: entry.title, request: entry.brief, kind: "topic", goalId: goal.id });
    db().query("UPDATE goal_plan SET topic_id = ? WHERE goal_id = ? AND id = ?").run(id, goal.id, c.req.param("entryId"));
    return id;
  })();
  const conversationId = startOnboarding(topicId, "topic", entry.brief);
  publish(goal.id, { type: "plan.updated" });
  return c.json({ topicId, conversationId } satisfies CreateTopicResponse, 201);
});

/** Hands the goal's unseen notes to its planning conversation, which reviews the plan against them. */
export function discussGoalNotes(goalId: string, database: Database = db(), run: typeof runTurn = runTurn): { conversationId: string } {
  const notes = database
    .query<{ id: string; text: string; title: string }, [string]>(
      "SELECT n.id, n.text, t.title FROM goal_notes n JOIN topics t ON t.id = n.topic_id WHERE n.goal_id = ? AND n.seen_at IS NULL ORDER BY n.created_at",
    )
    .all(goalId);
  if (notes.length === 0) fail(409, "there are no new notes from the goal's courses");
  const conv = database
    .query<{ id: string }, [string]>("SELECT id FROM conversations WHERE topic_id = ? AND kind = 'onboard' ORDER BY created_at DESC, rowid DESC LIMIT 1")
    .get(goalId);
  if (!conv) fail(409, "the goal has no planning conversation");
  database.query("UPDATE goal_notes SET seen_at = ? WHERE id IN (SELECT value FROM json_each(?))").run(now(), JSON.stringify(notes.map((n) => n.id)));
  const facts = notes.map((n) => `- ${n.title}: ${n.text}`).join("\n");
  run({
    conversationId: conv.id,
    text: `[Platform: the goal's courses recorded these facts about the learner since the plan was made:\n${facts}\nCheck the plan and MISSION.md against them, as the goal-plan skill's later turns say.]`,
    display: t("goal.discussNotes"),
  });
  return { conversationId: conv.id };
}

topics.post("/:goalId/notes/discuss", (c) => {
  const goal = topicRow(c.req.param("goalId"));
  if (goal.kind !== "goal") fail(400, "this topic is not a goal");
  return c.json(discussGoalNotes(goal.id), 202);
});

topics.get("/", (c) => {
  const rows = db().query<TopicRow, []>(`SELECT ${TOPIC_COLUMNS} FROM topics ORDER BY created_at DESC`).all();
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
    .query<SourceView, [string]>("SELECT id, url, title, kind, note, status FROM sources WHERE topic_id = ? AND origin = 'web' ORDER BY fetched_at")
    .all(t.id);
  const conversations = db()
    .query<{ id: string; kind: ConversationKind; lessonId: string | null; createdAt: string }, [string]>(
      "SELECT id, kind, lesson_id AS lessonId, created_at AS createdAt FROM conversations WHERE topic_id = ? ORDER BY created_at",
    )
    .all(t.id);
  const facts = onboardingFacts(t);
  const onboarding = t.kind === "goal" ? deriveGoalPhases(facts) : derivePhases(facts);
  const plan = db()
    .query<{ id: string; stage: string; title: string; why: string; topic_id: string | null }, [string]>(
      "SELECT id, stage, title, why, topic_id FROM goal_plan WHERE goal_id = ? ORDER BY idx",
    )
    .all(t.id)
    .map(({ topic_id, ...e }): GoalPlanEntryView => ({ ...e, topic: topic_id ? summary(topicRow(topic_id)) : null }));
  const goal = t.goal_id
    ? (db()
        .query<{ id: string; title: string; why: string }, [string, string]>(
          "SELECT g.id, g.title, coalesce(p.why, '') AS why FROM topics g LEFT JOIN goal_plan p ON p.goal_id = g.id AND p.topic_id = ? WHERE g.id = ?",
        )
        .get(t.id, t.goal_id) ?? null)
    : null;
  const goalNotes = db()
    .query<GoalNoteView, [string]>(
      `SELECT n.id, n.text, n.topic_id AS topicId, t.title AS topicTitle, n.created_at AS createdAt
       FROM goal_notes n JOIN topics t ON t.id = n.topic_id WHERE n.goal_id = ? AND n.seen_at IS NULL ORDER BY n.created_at`,
    )
    .all(t.id);
  const materials = materialViews(db(), t.id);
  return c.json({ topic: summary(t), nodes, lessons, sources, materials, conversations, onboarding, plan, goal, goalNotes } satisfies TopicDetail);
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
