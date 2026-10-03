import type { GoalPlanSetResult } from "../../../shared/tools";
import { newId } from "../../db";
import { checkDrawing, storeStageTrophies } from "../../game/rewards";
import { defineTool, ToolError } from "../context";

export const goalPlanSet = defineTool({
  name: "goal_plan_set",
  description: `Store the goal's plan: the topics the learner opens, in the order to learn them. Each entry is one future topic.
The call replaces the whole plan; entries keep their id across calls. An entry the learner already opened as a topic must stay in every later call: the server rejects a call that drops one (isError) and names it.
brief is the request the topic's onboarding receives when the learner opens it: the goal, why this topic serves it, what the learner already knows, and what neighbouring topics cover.
Returns {ok, total}.`,
  gameDescription: `Gamification is on. trophies: one meerkat trophy per stage of the plan, drawn per the system prompt (G2); the trophy of the last stage is the goal's grand prize. The result lists trophiesMissing: the stages still without one.`,
  handler(ctx, { entries, trophies }) {
    const kind = ctx.db.query<{ kind: string }, [string]>("SELECT kind FROM topics WHERE id = ?").get(ctx.topicId)?.kind;
    if (kind !== "goal") throw new ToolError("goal_plan_set works only in a goal; this topic is not one");
    const ids = entries.map((e) => e.id);
    const repeated = ids.filter((id, i) => ids.indexOf(id) !== i);
    if (repeated.length > 0) throw new ToolError(`entry ids repeat: ${[...new Set(repeated)].join(", ")}; nothing was stored`);
    const opened = ctx.db
      .query<{ id: string }, [string]>("SELECT id FROM goal_plan WHERE goal_id = ? AND topic_id IS NOT NULL")
      .all(ctx.topicId)
      .map((r) => r.id);
    const dropped = opened.filter((id) => !ids.includes(id));
    if (dropped.length > 0) throw new ToolError(`the learner already opened ${dropped.join(", ")}; keep these entries in the plan. Nothing was stored`);
    const stages = [...new Set(entries.map((e) => e.stage))];
    if (ctx.game && trophies) {
      const violations = trophies.flatMap((t, i) => [
        ...checkDrawing(t.svg, `trophies.${i}`),
        ...(stages.includes(t.stage) ? [] : [{ rule: "S1" as const, message: `"${t.stage}" is not a stage of the plan`, path: `trophies.${i}.stage` }]),
      ]);
      if (violations.length > 0) throw new ToolError("a trophy is invalid; nothing was stored", violations);
    }

    const upsert = ctx.db.query(
      `INSERT INTO goal_plan (goal_id, id, idx, stage, title, why, brief) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (goal_id, id) DO UPDATE SET idx = excluded.idx, stage = excluded.stage, title = excluded.title, why = excluded.why, brief = excluded.brief`,
    );
    ctx.db.transaction(() => {
      ctx.db.query("DELETE FROM goal_plan WHERE goal_id = ? AND id NOT IN (SELECT value FROM json_each(?))").run(ctx.topicId, JSON.stringify(ids));
      entries.forEach((e, i) => upsert.run(ctx.topicId, e.id, i, e.stage, e.title, e.why, e.brief));
    })();
    ctx.publish({ type: "plan.updated" });
    if (!ctx.game) return { result: { ok: true, total: entries.length } satisfies GoalPlanSetResult };
    const trophiesMissing = storeStageTrophies(ctx.db, ctx.topicId, trophies ?? [], stages);
    return { result: { ok: true, total: entries.length, trophiesMissing } satisfies GoalPlanSetResult };
  },
});

export const goalNote = defineTool({
  name: "goal_note",
  description: `Tell the learner's goal something you learned in this topic that bears on the goal's plan: how they build (by hand or through an AI assistant), knowledge or gaps that differ from what the plan assumed, a new constraint, a shift in what they want. One fact per call, in the learner's language, one or two sentences.
Works only in a topic opened from a goal's plan (get_learner_state.topic.goal is set); elsewhere it fails. The learner reviews the facts on the goal's page. Returns {ok}.`,
  handler(ctx, { text }) {
    const goalId = ctx.db.query<{ goal_id: string | null }, [string]>("SELECT goal_id FROM topics WHERE id = ?").get(ctx.topicId)?.goal_id;
    if (!goalId) throw new ToolError("this topic was not opened from a goal; there is no goal to tell");
    ctx.db.query("INSERT INTO goal_notes (id, goal_id, topic_id, text) VALUES (?, ?, ?, ?)").run(newId("gn"), goalId, ctx.topicId, text);
    return { result: { ok: true } };
  },
});
