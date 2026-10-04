import type { Database } from "bun:sqlite";
import { Hono } from "hono";
import { z } from "zod";
import type { PracticeFrom, PracticeRequest, PracticeResults, PracticeScope, StartLessonResponse } from "../../shared/api";
import { PRACTICE_SIZES, PracticeFocus, type Level } from "../../shared/schemas";
import { runTurn } from "../claude/runner";
import { db, newId } from "../db";
import { okSources } from "../gates/diversity";
import { publish } from "../hub";
import { t } from "../i18n";
import { practiceTargets, type PracticeSpec } from "../mcp/tools/practice";
import { fail, readBody } from "./http";

type Resolved = { topicId: string; nodeIds: string[]; seedItemId: string | null };

/** The topic and graph nodes a practice set started from `from` covers. */
export function resolvePractice(from: PracticeFrom, database: Database = db()): Resolved {
  let resolved: Resolved;
  if ("itemId" in from) {
    const item = database.query<{ topic_id: string; node_id: string }, [string]>("SELECT topic_id, node_id FROM items WHERE id = ?").get(from.itemId);
    if (!item) fail(404, "item not found");
    resolved = { topicId: item.topic_id, nodeIds: [item.node_id], seedItemId: from.itemId };
  } else if ("lessonId" in from) {
    const lesson = database.query<{ topic_id: string; node_ids: string }, [string]>("SELECT topic_id, node_ids FROM lessons WHERE id = ?").get(from.lessonId);
    if (!lesson) fail(404, "lesson not found");
    resolved = { topicId: lesson.topic_id, nodeIds: JSON.parse(lesson.node_ids) as string[], seedItemId: null };
  } else {
    resolved = { topicId: from.topicId, nodeIds: [from.nodeId], seedItemId: null };
  }
  const known = new Set(
    database
      .query<{ id: string }, [string, string]>("SELECT id FROM nodes WHERE topic_id = ? AND id IN (SELECT value FROM json_each(?))")
      .all(resolved.topicId, JSON.stringify(resolved.nodeIds))
      .map((n) => n.id),
  );
  const nodeIds = resolved.nodeIds.filter((id) => known.has(id));
  if (nodeIds.length === 0) fail(404, "node not found");
  return { ...resolved, nodeIds };
}

export function practiceScope(from: PracticeFrom, database: Database = db()): PracticeScope {
  return scopeOf(resolvePractice(from, database), database);
}

function scopeOf({ topicId, nodeIds }: Resolved, database: Database): PracticeScope {
  const nodes = database
    .query<{ id: string; title: string }, [string, string]>("SELECT id, title FROM nodes WHERE topic_id = ? AND id IN (SELECT value FROM json_each(?)) ORDER BY rowid")
    .all(topicId, JSON.stringify(nodeIds));
  return { topicId, nodes, mistakes: practiceTargets(database, topicId, nodeIds).missed.length };
}

/** The level of the newest lesson on these nodes; without one, the placement of the first node. */
function levelFor(database: Database, topicId: string, nodeIds: string[]): Level {
  const lesson = database
    .query<{ level: Level }, [string, string]>(
      `SELECT level FROM lessons WHERE topic_id = ? AND practice IS NULL
         AND EXISTS (SELECT 1 FROM json_each(node_ids) WHERE value IN (SELECT value FROM json_each(?)))
       ORDER BY created_at DESC, rowid DESC LIMIT 1`,
    )
    .get(topicId, JSON.stringify(nodeIds));
  if (lesson) return lesson.level;
  const placement = database.query<{ placement: string | null }, [string, string]>("SELECT placement FROM nodes WHERE topic_id = ? AND id = ?").get(topicId, nodeIds[0]!)?.placement;
  return placement === "known" ? "advanced" : placement === "partial" ? "intermediate" : "novice";
}

/**
 * Creates the practice set as a lesson of `size` practice steps and starts its authoring run. The outline
 * exists before Claude writes anything, so the learner can open the set and watch its items pass the gates.
 */
export function startPractice(req: PracticeRequest, database: Database = db(), run: typeof runTurn = runTurn): StartLessonResponse & { lessonId: string } {
  const resolved = resolvePractice(req.from, database);
  const scope = scopeOf(resolved, database);
  if (req.focus === "mistakes" && scope.mistakes === 0) fail(409, t("practice.noMistakes"));
  const sources = okSources(database, scope.topicId);
  if (sources.length === 0) fail(409, t("practice.noSources"));

  const nodeIds = scope.nodes.map((n) => n.id);
  const title = t("practice.setTitle", { nodes: scope.nodes.map((n) => n.title).join(", ") }).slice(0, 120);
  const objective = t(`practice.objective.${req.focus}`, { count: req.size });
  const outline = Array.from({ length: req.size }, (_, i) => ({ kind: "practice", title: t("practice.itemTitle", { n: i + 1 }) }));
  const spec: PracticeSpec = { focus: req.focus, seedItemId: resolved.seedItemId };
  const lessonId = newId("les");
  const conversationId = newId("cv");
  database.transaction(() => {
    database
      .query(
        `INSERT INTO lessons (id, topic_id, title, objective, level, node_ids, outline, planned_sources, sources_at_plan, announced_sources, practice)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        lessonId,
        scope.topicId,
        title,
        objective,
        levelFor(database, scope.topicId, nodeIds),
        JSON.stringify(nodeIds),
        JSON.stringify(outline),
        JSON.stringify(sources.map((s) => s.id)),
        sources.length,
        JSON.stringify(sources.map((s) => s.id)),
        JSON.stringify(spec),
      );
    database.query("INSERT INTO conversations (id, topic_id, kind, lesson_id) VALUES (?, ?, 'lesson', ?)").run(conversationId, scope.topicId, lessonId);
  })();
  publish(scope.topicId, { type: "lesson.planned", lessonId, title, outline });
  run({ conversationId, text: `/clayfold:practice-set ${lessonId}`, display: null });
  return { lessonId, conversationId };
}

/** Per-node results of a practice set; an item counts as first try when its first attempt was right without hints. */
export function practiceResults(lessonId: string, database: Database = db()): PracticeResults {
  const rows = database
    .query<{ node_id: string; title: string | null; answered: number; first_try: number; solved: number }, [string]>(
      `SELECT i.node_id, n.title,
         EXISTS (SELECT 1 FROM attempts WHERE item_id = i.id) AS answered,
         coalesce((SELECT correct = 1 AND hints_used = 0 AND gave_up = 0 FROM attempts WHERE item_id = i.id ORDER BY created_at, rowid LIMIT 1), 0) AS first_try,
         EXISTS (SELECT 1 FROM attempts WHERE item_id = i.id AND correct = 1 AND gave_up = 0) AS solved
       FROM items i JOIN steps s ON s.id = i.step_id
       LEFT JOIN nodes n ON n.topic_id = i.topic_id AND n.id = i.node_id
       WHERE s.lesson_id = ? AND s.status = 'published'
       ORDER BY s.idx, i.rowid`,
    )
    .all(lessonId);
  const nodes = new Map<string, PracticeResults["nodes"][number]>();
  for (const r of rows) {
    const n = nodes.get(r.node_id) ?? { nodeId: r.node_id, title: r.title ?? r.node_id, total: 0, firstTry: 0, solved: 0 };
    n.total++;
    n.firstTry += r.first_try;
    n.solved += r.solved;
    nodes.set(r.node_id, n);
  }
  const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((s, r) => s + f(r), 0);
  return { total: rows.length, answered: sum((r) => r.answered), firstTry: sum((r) => r.first_try), solved: sum((r) => r.solved), nodes: [...nodes.values()] };
}

const FromQuery = z.union([
  z.object({ itemId: z.string().min(1) }),
  z.object({ lessonId: z.string().min(1) }),
  z.object({ topicId: z.string().min(1), nodeId: z.string().min(1) }),
]);

export const practice = new Hono();

practice.get("/practice/scope", (c) => {
  const parsed = FromQuery.safeParse(c.req.query());
  if (!parsed.success) fail(400, "pass itemId, lessonId, or topicId and nodeId");
  return c.json(practiceScope(parsed.data) satisfies PracticeScope);
});

practice.post("/practice", async (c) => {
  const req = await readBody(
    c,
    z.object({
      from: FromQuery,
      size: z.literal([...PRACTICE_SIZES]),
      focus: PracticeFocus,
    }),
  );
  return c.json(startPractice(req) satisfies StartLessonResponse, 202);
});
