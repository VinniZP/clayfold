import type { GateOutcome } from "../../../shared/tools";
import type { Violation } from "../../../shared/rules";
import type { LessonPlan, LessonReward, Level } from "../../../shared/schemas";
import { newId, now } from "../../db";
import { displayOrderFor, stepItems } from "../../gates/content";
import { checkLessonPlan } from "../../gates/deterministic";
import { checkPlanSources, okSources } from "../../gates/diversity";
import { criticOutage, gateStep, recordGates } from "../../gates/pipeline";
import { checkDrawing, storeLessonReward } from "../../game/rewards";
import { publisherOf } from "../../publishers";
import { defineTool, ToolError, type ToolContext } from "../context";
import type { PracticeSpec } from "./practice";

export const MAX_ATTEMPTS = 3;

type LessonRow = { id: string; status: string; level: Level; outline: string; challenge_idx: number | null; practice: string | null };

function lessonOf(ctx: ToolContext, lessonId: string): LessonRow & { outlineList: { kind: string; title: string }[]; spec: PracticeSpec | null } {
  const row = ctx.db
    .query<LessonRow, [string, string]>("SELECT id, status, level, outline, challenge_idx, practice FROM lessons WHERE id = ? AND topic_id = ?")
    .get(lessonId, ctx.topicId);
  if (!row) throw new ToolError(`lesson "${lessonId}" does not exist in this topic; call lesson_plan first`);
  return { ...row, outlineList: JSON.parse(row.outline), spec: row.practice ? (JSON.parse(row.practice) as PracticeSpec) : null };
}

/**
 * A note listing ok sources added to the topic since the lesson's author last heard about sources, and
 * marks them announced. Lessons planned before announcements were tracked get no note.
 */
export function announceNewSources(ctx: ToolContext, lessonId: string): string | null {
  const row = ctx.db.query<{ announced_sources: string | null }, [string]>("SELECT announced_sources FROM lessons WHERE id = ?").get(lessonId);
  if (!row?.announced_sources) return null;
  const announced = new Set(JSON.parse(row.announced_sources) as string[]);
  const fresh = okSources(ctx.db, ctx.topicId).filter((s) => !announced.has(s.id));
  if (fresh.length === 0) return null;
  ctx.db
    .query("UPDATE lessons SET announced_sources = ? WHERE id = ?")
    .run(JSON.stringify([...announced, ...fresh.map((s) => s.id)]), lessonId);
  const list = fresh.map((s) => `${s.id} — ${s.title} (${publisherOf(s.url)})`).join("; ");
  return `${fresh.length} new sources were added to this topic after the lesson was planned: ${list}; consider citing them in the remaining steps.`;
}

/** G1: the challenge is a practice step before the exit check; G2: the reward's drawing; a gold reward needs a challenge. */
export function checkLessonGame(plan: LessonPlan, challenge: number | undefined, reward: LessonReward | undefined): Violation[] {
  const out: Violation[] = [];
  if (challenge !== undefined && plan.outline[challenge]?.kind !== "practice") {
    out.push({ rule: "G1", message: `outline entry ${challenge} is not a practice step; the challenge is one practice step`, path: "challenge" });
  }
  if (reward) {
    out.push(...checkDrawing(reward.svg, "reward"));
    if (reward.earnedBy === "gold" && challenge === undefined) {
      out.push({ rule: "G1", message: 'a "gold" reward needs a challenge step; set challenge or earn it with "silver"', path: "reward.earnedBy" });
    }
  }
  return out;
}

export const lessonPlan = defineTool({
  name: "lesson_plan",
  description: `Start a lesson: store its title, objective, graph nodes, learner level, the sources it will cite and the outline of steps (kind + title per step). The learner sees the outline at once.
The outline must start with an 'activate' step (2-3 ungraded prequestions, L2) and end with a 'check' step (unaided exit check, L11); every nodeId must already be in the graph.
sourceIds: ok sources of this topic (see get_learner_state). When the topic's sources come from two or more publishers, the planned sources must too (Q8), and the lesson's cites must span at least two publishers by the check step, which the gates enforce.
Returns {lessonId}. Then submit the steps in order with step_submit (index = position in the outline), and close with lesson_finish.`,
  gameDescription: `Gamification is on. challenge: the outline index of one practice step, the lesson's hardest item (G1). reward: the meerkat wearable this lesson awards, drawn per the system prompt (G2); earnedBy "complete" (the exit check answered), "silver" (its crown) or "gold" (crown plus the challenge right on the first try, only with a challenge).`,
  handler(ctx, { plan, challenge, reward }) {
    const known = new Set(
      ctx.db.query<{ id: string }, [string]>("SELECT id FROM nodes WHERE topic_id = ?").all(ctx.topicId).map((r) => r.id),
    );
    const sources = okSources(ctx.db, ctx.topicId);
    const violations = [...checkLessonPlan(plan, known), ...checkPlanSources(plan.sourceIds, sources)];
    if (ctx.game) violations.push(...checkLessonGame(plan, challenge, reward));
    if (violations.length > 0) throw new ToolError("the lesson plan is invalid; nothing was stored", violations);
    const lessonId = newId("les");
    ctx.db
      .query(
        `INSERT INTO lessons (id, topic_id, title, objective, level, node_ids, outline, planned_sources, sources_at_plan, announced_sources)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        lessonId,
        ctx.topicId,
        plan.title,
        plan.objective,
        plan.level,
        JSON.stringify(plan.nodeIds),
        JSON.stringify(plan.outline),
        JSON.stringify(plan.sourceIds),
        sources.length,
        JSON.stringify(sources.map((s) => s.id)),
      );
    if (ctx.game) {
      if (challenge !== undefined) ctx.db.query("UPDATE lessons SET challenge_idx = ? WHERE id = ?").run(challenge, lessonId);
      if (reward) storeLessonReward(ctx.db, ctx.topicId, lessonId, reward);
    }
    ctx.publish({ type: "lesson.planned", lessonId, title: plan.title, outline: plan.outline });
    return { result: { lessonId } };
  },
});

export const stepSubmit = defineTool({
  name: "step_submit",
  description: `Submit one lesson step (the outline entry at "index") for the quality gates; the learner sees it only if it passes. The call can take up to about two minutes.
Gates, in order: schema; deterministic rules (L2 closed prequestions, L4 explain body <= 400 words, L8 a misconception on every distractor and none on the key, Q4 no length/wording cues and no all/none-of-the-above, Q5 >= 30% apply-or-higher items across the lesson when you submit the check step, in a practice set at its last index and on every item of a "harder" set, L13 a practice set mixes recall and choice formats by its last index, Q7 no near-duplicate items in the topic, V3 caption does not repeat the body, V6 figure parses and is self-contained); Q6 every cite's quote occurs verbatim in its stored source (take quotes from source_search); then a critic model: blind solve (Q1, exactly one defensible answer equal to the key), options-only guess (Q2), and yes/no checks (quote supports the claim, distractor plausible and wrong, Bloom label, figure V1/V2, L3, L6, L16).
Returns {status, attempt, violations}. "published": go on to the next index. "rejected": fix exactly the listed violations (rule ID, path into the step, message) and resubmit the same index. A step is "dropped" after ${MAX_ATTEMPTS} rejected attempts; then continue with the next index. step.kind must equal the outline kind at that index; a published or dropped index cannot be resubmitted.`,
  async handler(ctx, { lessonId, index, step }) {
    const lesson = lessonOf(ctx, lessonId);
    if (lesson.status !== "generating") throw new ToolError(`lesson "${lessonId}" is ${lesson.status}; it takes no more steps`);
    const planned = lesson.outlineList[index];
    if (!planned) throw new ToolError(`index ${index} is outside the outline (0..${lesson.outlineList.length - 1})`);
    if (planned.kind !== step.kind) throw new ToolError(`outline entry ${index} is a '${planned.kind}' step, but a '${step.kind}' step was submitted`);

    const existing = ctx.db
      .query<{ id: string; status: string; attempts: number }, [string, number]>("SELECT id, status, attempts FROM steps WHERE lesson_id = ? AND idx = ?")
      .get(lessonId, index);
    if (existing?.status === "published") throw new ToolError(`step ${index} is already published; continue with the next index`);
    if (existing?.status === "dropped") throw new ToolError(`step ${index} was dropped after ${MAX_ATTEMPTS} attempts; continue with the next index`);
    if (existing?.status === "checking") throw new ToolError(`step ${index} is being checked; wait for that result`);

    const attempt = (existing?.attempts ?? 0) + 1;
    const stepId = existing?.id ?? newId("step");
    const content = JSON.stringify(step);
    if (existing) {
      ctx.db.query("UPDATE steps SET content = ?, status = 'checking', attempts = ? WHERE id = ?").run(content, attempt, stepId);
    } else {
      ctx.db
        .query("INSERT INTO steps (id, lesson_id, idx, kind, content, status, attempts) VALUES (?, ?, ?, ?, ?, 'checking', 1)")
        .run(stepId, lessonId, index, step.kind, content);
    }
    ctx.publish({ type: "step.status", lessonId, idx: index, status: "checking", violations: [] });

    const items = stepItems(step);
    const displayOrders = items.map(({ item }) => displayOrderFor(item));
    let run;
    try {
      const practice = lesson.spec ? { focus: lesson.spec.focus, closing: index === lesson.outlineList.length - 1 } : undefined;
      run = await gateStep({ db: ctx.db, critic: ctx.critic }, {
        topicId: ctx.topicId,
        lessonId,
        level: lesson.level,
        step,
        displayOrders,
        challenge: lesson.challenge_idx === index,
        practice,
      });
    } catch (e) {
      ctx.db.query("UPDATE steps SET status = 'rejected' WHERE id = ?").run(stepId);
      throw e;
    }
    if (criticOutage(run.violations)) {
      // An unreachable critic says nothing about the step, so the attempt is not counted.
      if (existing) ctx.db.query("UPDATE steps SET status = ?, attempts = ? WHERE id = ?").run(existing.status, existing.attempts, stepId);
      else ctx.db.query("DELETE FROM steps WHERE id = ?").run(stepId);
      ctx.publish({ type: "step.status", lessonId, idx: index, status: "rejected", violations: run.violations });
      throw new ToolError(`the critic is unavailable right now (${run.violations[0]?.message ?? ""}); this attempt is not counted. Resubmit index ${index} unchanged.`);
    }
    recordGates(ctx.db, { type: "step", id: stepId, attempt }, run.records);

    if (run.violations.length === 0) {
      const insert = ctx.db.query(
        "INSERT INTO items (id, topic_id, lesson_id, step_id, role, node_id, format, content, display_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      );
      ctx.db.transaction(() => {
        ctx.db.query("UPDATE steps SET status = 'published', published_at = ? WHERE id = ?").run(now(), stepId);
        items.forEach(({ item, role }, i) => {
          const order = displayOrders[i];
          insert.run(newId("item"), ctx.topicId, lessonId, stepId, role, item.nodeId, item.format, JSON.stringify(item), order ? JSON.stringify(order) : null);
        });
      })();
      ctx.publish({ type: "step.published", lessonId, step: ctx.publicStep(ctx.db, stepId) });
      const result: GateOutcome = { status: "published", attempt, violations: [] };
      const announcement = announceNewSources(ctx, lessonId);
      return { result, ...(announcement ? { notes: [announcement] } : {}) };
    }

    const status = attempt >= MAX_ATTEMPTS ? "dropped" : "rejected";
    ctx.db.query("UPDATE steps SET status = ? WHERE id = ?").run(status, stepId);
    ctx.publish({ type: "step.status", lessonId, idx: index, status, violations: run.violations });
    const result: GateOutcome = { status, attempt, violations: run.violations };
    const note =
      status === "dropped"
        ? `Step ${index} is dropped after ${attempt} rejected attempts and will not be shown. Continue with index ${index + 1}${index + 1 < lesson.outlineList.length ? "" : " (none left: call lesson_finish)"}.`
        : `Rejected (attempt ${attempt} of ${MAX_ATTEMPTS}). Fix each listed violation and resubmit index ${index}.`;
    const announcement = announceNewSources(ctx, lessonId);
    return { result, notes: announcement ? [note, announcement] : [note] };
  },
});

export const lessonFinish = defineTool({
  name: "lesson_finish",
  description: `Close a lesson after every outline step is published or dropped: stores a short summary of what the lesson covered (shown to the learner and used in later sessions).
Fails, listing the missing indices, while any step is still unsubmitted or rejected. Returns {ok, published, dropped}.`,
  handler(ctx, { lessonId, summary }) {
    const lesson = lessonOf(ctx, lessonId);
    if (lesson.status === "finished") throw new ToolError(`lesson "${lessonId}" is already finished`);
    const states = new Map(
      ctx.db
        .query<{ idx: number; status: string }, [string]>("SELECT idx, status FROM steps WHERE lesson_id = ?")
        .all(lessonId)
        .map((r) => [r.idx, r.status]),
    );
    const missing = lesson.outlineList.map((_, i) => i).filter((i) => !["published", "dropped"].includes(states.get(i) ?? ""));
    if (missing.length > 0) {
      throw new ToolError(`steps ${missing.join(", ")} are not published yet; submit them with step_submit (until published or dropped) before lesson_finish`);
    }
    ctx.db.query("UPDATE lessons SET status = 'finished', summary = ?, finished_at = ? WHERE id = ?").run(summary, now(), lessonId);
    ctx.publish({ type: "lesson.finished", lessonId, summary });
    const counts = [...states.values()];
    return { result: { ok: true, published: counts.filter((s) => s === "published").length, dropped: counts.filter((s) => s === "dropped").length } };
  },
});
