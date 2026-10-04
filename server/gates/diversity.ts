import type { Database } from "bun:sqlite";
import type { Violation } from "../../shared/rules";
import type { Step } from "../../shared/schemas";
import { sourcePublisher, type SourceOrigin } from "../publishers";
import { stepCites } from "./content";
import type { Report } from "./deterministic";

// Q8: a lesson cites at least two publishers when the topic's sources span two or more.

export const MIN_PUBLISHERS = 2;

export type OkSource = SourceOrigin & { id: string; title: string };

export function okSources(db: Database, topicId: string): OkSource[] {
  return db.query<OkSource, [string]>("SELECT id, url, title, origin FROM sources WHERE topic_id = ? AND status = 'ok' ORDER BY rowid").all(topicId);
}

const publishersOf = (sources: OkSource[]) => new Set(sources.map(sourcePublisher));

/** "Publisher: id, id; Publisher: id" for messages that point Claude at sources to use. */
export function describePublishers(sources: OkSource[], exclude: Set<string> = new Set()): string {
  const byPublisher = new Map<string, string[]>();
  for (const s of sources) {
    const p = sourcePublisher(s);
    if (!exclude.has(p)) byPublisher.set(p, [...(byPublisher.get(p) ?? []), s.id]);
  }
  return [...byPublisher].map(([p, ids]) => `${p}: ${ids.join(", ")}`).join("; ");
}

/** lesson_plan: planned sources are ok sources of the topic, from two publishers when the topic has two. */
export function checkPlanSources(sourceIds: string[], sources: OkSource[]): Violation[] {
  const byId = new Map(sources.map((s) => [s.id, s]));
  const out: Violation[] = [];
  sourceIds.forEach((id, i) => {
    if (!byId.has(id)) out.push({ rule: "S1", message: `"${id}" is not an ok source of this topic; add it with source_add or pick another`, path: `plan.sourceIds.${i}` });
  });
  if (out.length > 0) return out;
  const planned = publishersOf(sourceIds.map((id) => byId.get(id)!));
  if (publishersOf(sources).size >= MIN_PUBLISHERS && planned.size < MIN_PUBLISHERS) {
    out.push({
      rule: "Q8",
      message: `the planned sources all come from ${[...planned].join(", ")}; plan sources from at least ${MIN_PUBLISHERS} publishers. Available: ${describePublishers(sources)}`,
      path: "plan.sourceIds",
    });
  }
  return out;
}

/** Publishers cited by the lesson's published steps, plus any extra steps. */
export function lessonCitedPublishers(db: Database, lessonId: string, extra: Step[] = []): Set<string> {
  const published = db
    .query<{ content: string }, [string]>("SELECT content FROM steps WHERE lesson_id = ? AND status = 'published'")
    .all(lessonId)
    .map((r) => JSON.parse(r.content) as Step);
  const sources = new Map(db.query<SourceOrigin & { id: string }, []>("SELECT id, url, origin FROM sources").all().map((s) => [s.id, s]));
  const out = new Set<string>();
  for (const step of [...published, ...extra]) {
    for (const { cite } of stepCites(step)) {
      const source = sources.get(cite.sourceId);
      if (source) out.add(sourcePublisher(source));
    }
  }
  return out;
}

/** The check step closes the lesson, so it is where the lesson's publisher spread is enforced. */
export function checkLessonDiversity(db: Database, input: { topicId: string; lessonId: string; step: Step }, r: Report): void {
  if (input.step.kind !== "check") return;
  const sources = okSources(db, input.topicId);
  if (publishersOf(sources).size < MIN_PUBLISHERS) return;
  r.check("Q8");
  const cited = lessonCitedPublishers(db, input.lessonId, [input.step]);
  if (cited.size >= MIN_PUBLISHERS) return;
  const planned = db.query<{ planned_sources: string | null }, [string]>("SELECT planned_sources FROM lessons WHERE id = ?").get(input.lessonId);
  const plannedIds = new Set(planned?.planned_sources ? (JSON.parse(planned.planned_sources) as string[]) : []);
  const pool = sources.filter((s) => plannedIds.size === 0 || plannedIds.has(s.id));
  const others = describePublishers(pool.length ? pool : sources, cited) || describePublishers(sources, cited);
  r.fail("Q8", `the lesson cites only ${[...cited].join(", ") || "no publisher"}; cite a second publisher from the planned sources: ${others}`);
}
