import type { Database } from "bun:sqlite";
import type { LessonSummary } from "../../shared/api";
import { db } from "../db";
import { lessonCitedPublishers, MIN_PUBLISHERS } from "../gates/diversity";
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
};

const nodeSet = (nodeIdsJson: string) => JSON.stringify([...new Set(JSON.parse(nodeIdsJson) as string[])].sort());

/**
 * The newest later lesson of the topic on the same set of nodes. Only a complete version supersedes: while
 * a new version is generating, the learner keeps the old lesson as the current one.
 */
export function supersedingLesson(l: Pick<LessonRow, "id" | "node_ids">, database: Database = db()): string | null {
  const nodes = nodeSet(l.node_ids);
  const later = database
    .query<{ id: string; node_ids: string }, [string]>(
      `SELECT other.id, other.node_ids FROM lessons self JOIN lessons other ON other.topic_id = self.topic_id
       WHERE self.id = ? AND other.id != self.id AND other.status IN ('ready','finished')
         AND (other.created_at > self.created_at OR (other.created_at = self.created_at AND other.rowid > self.rowid))
       ORDER BY other.created_at DESC, other.rowid DESC`,
    )
    .all(l.id);
  return later.find((other) => nodeSet(other.node_ids) === nodes)?.id ?? null;
}

/** Completed once every item of the published check step has an attempt; in progress after any learner action. */
export function learnerStatus(lessonId: string, database: Database = db()): LessonSummary["learnerStatus"] {
  const check = database
    .query<{ items: number; attempted: number }, [string]>(
      `SELECT count(*) AS items, count(*) FILTER (WHERE EXISTS (SELECT 1 FROM attempts a WHERE a.item_id = i.id)) AS attempted
       FROM steps s JOIN items i ON i.step_id = s.id
       WHERE s.lesson_id = ? AND s.kind = 'check' AND s.status = 'published'`,
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
  const sourcesStale = supersededBy === null && sourcesGrew && citesOnePublisher;
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
    supersededBy,
    learnerStatus: learnerStatus(l.id, database),
    video: videoStatus(l.id, database),
  };
}
