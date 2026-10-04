import type { Database } from "bun:sqlite";
import type { RewardCondition } from "../../shared/game";
import type { Violation } from "../../shared/rules";
import type { CourseReward, LessonReward, Resident, StageTrophy } from "../../shared/schemas";
import { newId } from "../db";
import { checkSvg } from "../gates/figures";

const VIEWBOX = /^\s*0\s+0\s+100\s+100\s*$/;

/** G2: a drawing the meerkat page can place in a slot: well-formed, safe, 100 x 100, no text. */
export function checkDrawing(svg: string, path: string): Violation[] {
  const out = checkSvg(svg, path, { rule: "G2", labels: false });
  if (out.length > 0) return out;
  const root = svg.match(/<svg\b[^>]*>/i)?.[0] ?? "";
  const viewBox = root.match(/viewBox\s*=\s*["']([^"']*)["']/i)?.[1] ?? "";
  if (!VIEWBOX.test(viewBox)) out.push({ rule: "G2", message: `viewBox is "${viewBox}"; draw on viewBox="0 0 100 100"`, path: `${path}.svg` });
  if (/<text\b/i.test(svg)) out.push({ rule: "G2", message: "a drawing carries no <text>; the name is shown beside it", path: `${path}.svg` });
  return out;
}

type Wearable = { name: string; description: string; slot: string; svg: string };

function upsert(database: Database, topicId: string, source: "lesson" | "course" | "stage", ref: string, condition: RewardCondition, w: Wearable): void {
  database
    .query(
      `INSERT INTO rewards (id, topic_id, source, ref, condition, name, description, slot, svg) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (topic_id, source, ref) DO UPDATE SET condition = excluded.condition, name = excluded.name,
         description = excluded.description, slot = excluded.slot, svg = excluded.svg
       WHERE rewards.unlocked_at IS NULL`,
    )
    .run(newId("rw"), topicId, source, ref, JSON.stringify(condition), w.name, w.description, w.slot, w.svg);
}

export function storeLessonReward(database: Database, topicId: string, lessonId: string, reward: LessonReward): void {
  upsert(database, topicId, "lesson", lessonId, { kind: "lesson", lessonId, earnedBy: reward.earnedBy }, reward);
}

/** Milestones keep their key across graph_set calls; one whose nodes all left the graph is dropped unless unlocked. */
export function storeCourseRewards(database: Database, topicId: string, rewards: CourseReward[]): void {
  for (const r of rewards) upsert(database, topicId, "course", r.key, { kind: "nodes", nodeIds: r.nodeIds, mastery: r.mastery }, r);
}

/** Trophies follow the plan's stages: a stage that left the plan takes its locked trophy with it. */
export function storeStageTrophies(database: Database, goalId: string, trophies: StageTrophy[], stages: string[]): string[] {
  for (const t of trophies) if (stages.includes(t.stage)) upsert(database, goalId, "stage", t.stage, { kind: "stage", stage: t.stage }, t);
  database
    .query("DELETE FROM rewards WHERE topic_id = ? AND source = 'stage' AND unlocked_at IS NULL AND ref NOT IN (SELECT value FROM json_each(?))")
    .run(goalId, JSON.stringify(stages));
  const have = new Set(
    database.query<{ ref: string }, [string]>("SELECT ref FROM rewards WHERE topic_id = ? AND source = 'stage'").all(goalId).map((r) => r.ref),
  );
  return stages.filter((s) => !have.has(s));
}

/** A resident keeps its look once befriended. */
export function storeResident(database: Database, topicId: string, resident: Resident): void {
  database
    .query(
      `INSERT INTO residents (topic_id, content) VALUES (?, ?)
       ON CONFLICT (topic_id) DO UPDATE SET content = excluded.content WHERE residents.befriended_at IS NULL`,
    )
    .run(topicId, JSON.stringify(resident));
}

export const hasResident = (database: Database, topicId: string): boolean => !!database.query("SELECT 1 FROM residents WHERE topic_id = ?").get(topicId);
