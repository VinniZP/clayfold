import type { Database } from "bun:sqlite";
import type { LessonSummary } from "../../shared/api";
import { db } from "../db";
import { lessonCitedPublishers, MIN_PUBLISHERS } from "../gates/diversity";
import type { PracticeSpec } from "../mcp/tools/practice";
import { publisherCounts } from "../publishers";
import { videoStatus } from "./video";

export type LessonRow = {
  id: string;
  topic_id: string;
  title: string;
  objective: string;
  level: LessonSummary["level"];
  node_ids: string;
  outline: string;
  status: LessonSummary["status"];
  created_at: string;
  sources_at_plan: number | null;
  /** JSON ids of the sources the author knew: those at planning and those step_submit announced. */
  announced_sources?: string | null;
  practice: string | null;
};

const nodeSet = (nodeIdsJson: string) => JSON.stringify([...new Set(JSON.parse(nodeIdsJson) as string[])].sort());

/**
 * The newest later lesson of the topic on the same set of nodes. Only a complete version supersedes: while
 * a new version is generating, the learner keeps the old lesson as the current one. Practice sets neither
 * supersede nor are superseded.
 */
export function supersedingLesson(l: Pick<LessonRow, "id" | "node_ids">, database: Database = db()): string | null {
  const nodes = nodeSet(l.node_ids);
  const later = database
    .query<{ id: string; node_ids: string }, [string]>(
      `SELECT other.id, other.node_ids FROM lessons self JOIN lessons other ON other.topic_id = self.topic_id
       WHERE self.id = ? AND self.practice IS NULL AND other.practice IS NULL AND other.id != self.id AND other.status IN ('ready','finished')
         AND (other.created_at > self.created_at OR (other.created_at = self.created_at AND other.rowid > self.rowid))
       ORDER BY other.created_at DESC, other.rowid DESC`,
    )
    .all(l.id);
  return later.find((other) => nodeSet(other.node_ids) === nodes)?.id ?? null;
}

/**
 * Completed once every item of the published check step has an attempt, or for a practice set once every item
 * is solved or given up; in progress after any learner action.
 */
export function learnerStatus(lessonId: string, database: Database = db(), practice = false): LessonSummary["learnerStatus"] {
  const done = practice ? "a.item_id = i.id AND (a.correct = 1 OR a.gave_up = 1)" : "a.item_id = i.id";
  const check = database
    .query<{ items: number; attempted: number }, [string]>(
      `SELECT count(*) AS items, count(*) FILTER (WHERE EXISTS (SELECT 1 FROM attempts a WHERE ${done})) AS attempted
       FROM steps s JOIN items i ON i.step_id = s.id
       WHERE s.lesson_id = ? AND s.kind = '${practice ? "practice" : "check"}' AND s.status = 'published'`,
    )
    .get(lessonId)!;
  if (check.items > 0 && check.attempted === check.items) return "completed";
  const touched = database
    .query<{ any: number }, [string]>(
      `SELECT EXISTS (SELECT 1 FROM attempts a JOIN items i ON i.id = a.item_id WHERE i.lesson_id = ?1)
           OR EXISTS (SELECT 1 FROM hint_views h JOIN items i ON i.id = h.item_id WHERE i.lesson_id = ?1)
           OR EXISTS (SELECT 1 FROM worked_answers w JOIN steps s ON s.id = w.step_id WHERE s.lesson_id = ?1)
           OR EXISTS (SELECT 1 FROM notes WHERE lesson_id = ?1) AS any`,
    )
    .get(lessonId)!;
  return touched.any ? "in_progress" : "not_started";
}

/**
 * Ok sources that source_add tied to one of the lesson's nodes and that its author never knew of: neither at
 * planning nor announced by step_submit while writing (for a lesson planned before announcements were tracked,
 * added after it was created). Sources the lesson cites do not count.
 */
export function newSourcesFor(l: Pick<LessonRow, "id" | "topic_id" | "node_ids" | "created_at" | "announced_sources">, database: Database = db()): number {
  return database
    .query<{ n: number }, [string, string, string, string, string | null]>(
      `SELECT count(DISTINCT s.id) AS n FROM sources s JOIN json_each(s.node_ids) node
       WHERE s.topic_id = ?1 AND s.status = 'ok' AND s.node_ids IS NOT NULL
         AND node.value IN (SELECT value FROM json_each(?3))
         AND CASE WHEN ?5 IS NULL THEN s.fetched_at > ?2 ELSE s.id NOT IN (SELECT value FROM json_each(?5)) END
         AND NOT EXISTS (SELECT 1 FROM steps st WHERE st.lesson_id = ?4 AND instr(st.content, '"sourceId":"' || s.id || '"') > 0)`,
    )
    .get(l.topic_id, l.created_at, l.node_ids, l.id, l.announced_sources ?? null)!.n;
}

export function lessonSummary(l: LessonRow, database: Database = db()): LessonSummary {
  const stepsReady = database
    .query<{ n: number }, [string]>("SELECT count(*) AS n FROM steps WHERE lesson_id = ? AND status IN ('published','dropped')")
    .get(l.id)!.n;
  const supersededBy = supersedingLesson(l, database);
  const okNow = database.query<{ n: number }, [string]>("SELECT count(*) AS n FROM sources WHERE topic_id = ? AND status = 'ok'").get(l.topic_id)!.n;
  // More sources alone is no reason to rebuild a lesson that already cites several publishers. A lesson planned
  // before the source count was recorded is judged by the topic's publishers today. A newer version answers staleness.
  const citesOnePublisher = lessonCitedPublishers(database, l.id).size < MIN_PUBLISHERS;
  const sourcesGrew =
    l.sources_at_plan === null ? Object.keys(publisherCounts(l.topic_id, database)).length >= MIN_PUBLISHERS : okNow > l.sources_at_plan;
  const sourcesStale = l.practice === null && supersededBy === null && sourcesGrew && citesOnePublisher;
  const current = l.practice === null && supersededBy === null && (l.status === "ready" || l.status === "finished");
  const practice = l.practice ? { size: (JSON.parse(l.outline) as unknown[]).length, focus: (JSON.parse(l.practice) as PracticeSpec).focus } : null;
  return {
    id: l.id,
    topicId: l.topic_id,
    title: l.title,
    objective: l.objective,
    level: l.level,
    nodeIds: JSON.parse(l.node_ids) as string[],
    status: l.status,
    createdAt: l.created_at,
    stepsReady,
    stepsTotal: (JSON.parse(l.outline) as unknown[]).length,
    sourcesStale,
    newSources: current ? newSourcesFor(l, database) : 0,
    supersededBy,
    learnerStatus: learnerStatus(l.id, database, practice !== null),
    video: videoStatus(l.id, database),
    practice,
  };
}
