import type { Database } from "bun:sqlite";
import { z } from "zod";
import type { GameBackfillView } from "../../shared/api";
import { CONTENT_RULES } from "../../shared/i18n";
import type { Violation } from "../../shared/rules";
import { CourseReward, LessonReward, Resident, StageTrophy, type Item, type Step } from "../../shared/schemas";
import { runJsonPrompt, type OneShotResult } from "../claude/oneshot";
import { db } from "../db";
import { HIGHER_BLOOM } from "../gates/deterministic";
import { language } from "../i18n";
import { supersedingLesson } from "../routes/lesson-summary";
import { DRAWING, RESIDENT } from "./prompt";
import { checkDrawing, storeCourseRewards, storeLessonReward, storeResident, storeStageTrophies } from "./rewards";

// Content built before the meerkat was on gets its rewards here, one tool-less Claude call per course,
// goal and lesson. Content built while it is on gets them in its own run (server/game/prompt.ts).

export type GameRunner = <T>(opts: { prompt: string; schema: object; purpose: "game" }) => Promise<OneShotResult<T>>;

const ATTEMPTS = 2;
const PARALLEL = 3;

type Task = { label: string; run: (call: GameRunner) => Promise<void> };

let job: { done: number; total: number; failed: string[]; running: boolean; finishedAt: string | null } | null = null;

/** The latest backfill, and how much content still lacks its rewards. */
export function backfillView(database: Database = db()): GameBackfillView {
  return {
    running: job?.running ?? false,
    done: job?.done ?? 0,
    total: job?.total ?? 0,
    failed: job?.failed ?? [],
    finishedAt: job?.finishedAt ?? null,
    missing: pending(database).length,
  };
}

/** Starts the backfill in the background; a running one is left alone. */
export function startBackfill(database: Database = db(), call: GameRunner = runJsonPrompt): GameBackfillView {
  if (job?.running) return backfillView(database);
  pickChallenges(database);
  const tasks = pending(database);
  job = { done: 0, total: tasks.length, failed: [], running: true, finishedAt: null };
  const current = job;
  void (async () => {
    const queue = [...tasks];
    await Promise.all(
      Array.from({ length: PARALLEL }, async () => {
        for (let task = queue.shift(); task; task = queue.shift()) {
          try {
            await task.run(call);
          } catch (e) {
            console.error(`[game] backfill of ${task.label} failed:`, e);
            current.failed.push(task.label);
          }
          current.done++;
        }
      }),
    );
    current.running = false;
    current.finishedAt = new Date().toISOString();
  })();
  return backfillView(database);
}

/** A lesson planned before the meerkat was on gets as its challenge its last practice step with an apply-or-higher item (G1). */
export function pickChallenges(database: Database): void {
  const rows = database
    .query<{ lesson_id: string; idx: number; content: string }, []>(
      `SELECT s.lesson_id, s.idx, s.content FROM steps s JOIN lessons l ON l.id = s.lesson_id
       WHERE l.challenge_idx IS NULL AND s.kind = 'practice' AND s.status = 'published' ORDER BY s.lesson_id, s.idx`,
    )
    .all();
  const last = new Map<string, number>();
  for (const r of rows) if (HIGHER_BLOOM.has((JSON.parse(r.content) as Extract<Step, { kind: "practice" }>).item.bloom)) last.set(r.lesson_id, r.idx);
  const set = database.query("UPDATE lessons SET challenge_idx = ? WHERE id = ?");
  for (const [lessonId, idx] of last) set.run(idx, lessonId);
}

/** Asks Claude for JSON matching `schema`; drawings that fail G2 go back with their violations once more. */
async function design<T>(call: GameRunner, prompt: string, schema: z.ZodType<T>, check: (value: T) => Violation[]): Promise<T> {
  // claude --json-schema rejects the draft 2020-12 "$schema" key that zod adds.
  const { $schema: _, ...json } = z.toJSONSchema(schema);
  let problems: Violation[] = [];
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const fix = problems.length ? `\n\nYour previous answer broke these rules; fix them:\n${problems.map((p) => `- ${p.path ?? ""}: ${p.message}`).join("\n")}` : "";
    const res = await call<T>({ prompt: prompt + fix, schema: json, purpose: "game" });
    if (!res.ok) throw new Error(res.error);
    const parsed = schema.safeParse(res.value);
    problems = parsed.success ? check(parsed.data) : parsed.error.issues.map((i) => ({ rule: "S1" as const, message: i.message, path: i.path.join(".") }));
    if (parsed.success && problems.length === 0) return parsed.data;
  }
  throw new Error(problems.map((p) => `${p.path}: ${p.message}`).join("; "));
}

const intro = () =>
  `You design rewards for a learner's meerkat mascot in a learning app. Rewards follow learning only; the learner earns them later.\n${DRAWING}\nWrite every name, description, bio and line in ${CONTENT_RULES[language()].name}.`;

function pending(database: Database): Task[] {
  const tasks: Task[] = [];

  const courses = database
    .query<{ id: string; title: string; request: string }, []>(
      `SELECT t.id, t.title, t.request FROM topics t WHERE t.kind = 'topic'
       AND NOT EXISTS (SELECT 1 FROM residents r WHERE r.topic_id = t.id) AND EXISTS (SELECT 1 FROM nodes n WHERE n.topic_id = t.id)`,
    )
    .all();
  for (const course of courses) {
    tasks.push({
      label: course.title,
      run: async (call) => {
        const nodes = database.query<{ id: string; title: string; prereqs: string }, [string]>("SELECT id, title, prereqs FROM nodes WHERE topic_id = ? ORDER BY rowid").all(course.id);
        const ids = new Set(nodes.map((n) => n.id));
        const schema = z.object({ resident: Resident, rewards: z.array(CourseReward).min(2).max(4) }).strict();
        const value = await design(
          call,
          `${intro()}\n${RESIDENT}\n\nThe course: "${course.title}" (the learner asked: ${course.request}).\nIts knowledge graph, in learning order (id: title, prerequisites):\n${nodes.map((n) => `- ${n.id}: ${n.title} (${(JSON.parse(n.prereqs) as string[]).join(", ") || "none"})`).join("\n")}\n\nReturn the resident of this course's chamber of the burrow, and 2-4 milestones on the graph's key nodes in learning order (for example the first core skill past its exit check, the whole core mastered), each a wearable; nodeIds come from the list above.`,
          schema,
          (v) => [
            ...checkDrawing(v.resident.svg, "resident"),
            ...v.rewards.flatMap((r, i) => [
              ...checkDrawing(r.svg, `rewards.${i}`),
              ...r.nodeIds.filter((id) => !ids.has(id)).map((id) => ({ rule: "S1" as const, message: `"${id}" is not a node of the graph`, path: `rewards.${i}.nodeIds` })),
            ]),
          ],
        );
        storeResident(database, course.id, value.resident);
        storeCourseRewards(database, course.id, value.rewards);
      },
    });
  }

  const goals = database.query<{ id: string; title: string }, []>("SELECT id, title FROM topics WHERE kind = 'goal'").all();
  for (const goal of goals) {
    const entries = database.query<{ stage: string; title: string }, [string]>("SELECT stage, title FROM goal_plan WHERE goal_id = ? ORDER BY idx").all(goal.id);
    const stages = [...new Set(entries.map((e) => e.stage))];
    const have = new Set(database.query<{ ref: string }, [string]>("SELECT ref FROM rewards WHERE topic_id = ? AND source = 'stage'").all(goal.id).map((r) => r.ref));
    const missing = stages.filter((s) => !have.has(s));
    if (missing.length === 0) continue;
    tasks.push({
      label: goal.title,
      run: async (call) => {
        const schema = z.object({ trophies: z.array(StageTrophy).min(missing.length).max(8) }).strict();
        const value = await design(
          call,
          `${intro()}\n\nThe goal: "${goal.title}". Its plan, stage by stage:\n${stages.map((s) => `- ${s}: ${entries.filter((e) => e.stage === s).map((e) => e.title).join("; ")}`).join("\n")}\n\nReturn one trophy for each of these stages, with stage written exactly as here: ${missing.map((s) => `"${s}"`).join(", ")}. The trophy of the last stage is the goal's grand prize, the most spectacular of them.`,
          schema,
          (v) => [
            ...v.trophies.flatMap((t, i) => checkDrawing(t.svg, `trophies.${i}`)),
            ...missing.filter((s) => !v.trophies.some((t) => t.stage === s)).map((s) => ({ rule: "S1" as const, message: `no trophy for the stage "${s}"`, path: "trophies" })),
          ],
        );
        storeStageTrophies(database, goal.id, value.trophies, stages);
      },
    });
  }

  const lessons = database
    .query<{ id: string; topic_id: string; title: string; objective: string; outline: string; node_ids: string; challenge_idx: number | null; course: string }, []>(
      `SELECT l.id, l.topic_id, l.title, l.objective, l.outline, l.node_ids, l.challenge_idx, t.title AS course FROM lessons l JOIN topics t ON t.id = l.topic_id
       WHERE l.status IN ('ready','finished') AND NOT EXISTS (SELECT 1 FROM rewards r WHERE r.source = 'lesson' AND r.ref = l.id)`,
    )
    .all()
    .filter((l) => supersedingLesson(l, database) === null);
  for (const lesson of lessons) {
    tasks.push({
      label: lesson.title,
      run: async (call) => {
        const outline = (JSON.parse(lesson.outline) as { title: string }[]).map((o) => o.title).join("; ");
        const challenge = lesson.challenge_idx === null ? null : database.query<{ content: string }, [string, number]>("SELECT content FROM steps WHERE lesson_id = ? AND idx = ?").get(lesson.id, lesson.challenge_idx);
        const prompt = challenge ? (JSON.parse(challenge.content) as { item: Item }).item.prompt : null;
        const schema = z.object({ reward: LessonReward }).strict();
        const value = await design(
          call,
          `${intro()}\n\nThe lesson "${lesson.title}" of the course "${lesson.course}". Objective: ${lesson.objective}. Steps: ${outline}.\n${prompt ? `Its challenge, the hardest exercise: ${prompt}` : "It has no challenge step."}\n\nReturn the lesson's reward: one wearable that nods to this lesson's content, earnedBy "silver" by default, "gold" when the lesson has a challenge and builds a key skill${prompt ? "" : " (not possible here: it has no challenge)"}, "complete" for a first lesson of a course.`,
          schema,
          (v) => [
            ...checkDrawing(v.reward.svg, "reward"),
            ...(v.reward.earnedBy === "gold" && !prompt ? [{ rule: "G1" as const, message: 'a "gold" reward needs a challenge step; use "silver"', path: "reward.earnedBy" }] : []),
          ],
        );
        storeLessonReward(database, lesson.topic_id, lesson.id, value.reward);
      },
    });
  }
  return tasks;
}
