import type { ConversationKind } from "../../shared/api";
import { TOOL_INPUTS, type ToolName } from "../../shared/tools";
import { PLUGIN_TOOL_PREFIX } from "./stream";

const ALL_PLUGIN_TOOLS = Object.keys(TOOL_INPUTS) as ToolName[];
const MEMORY = ["Read", "Write", "Edit", "Glob", "Grep"];
const WEB = ["WebSearch", "WebFetch"];
const AUTHORING: ToolName[] = ["lesson_plan", "step_submit", "lesson_finish", "cards_propose", "item_replace", "practice_brief"];
const TUTORING: ToolName[] = ["ask_learner", "get_learner_state", "source_search", "goal_note"];
const TOPIC_TOOLS = ALL_PLUGIN_TOOLS.filter((t) => t !== "goal_plan_set" && t !== "worked_line_record");

/** A goal's onboarding conversation runs with the "goal" scope; every other conversation with its kind's. */
export type Scope = ConversationKind | "goal";

/**
 * Tools each conversation kind may use. Only lesson runs (lesson-author and practice-set) build lessons and cards:
 * a tutor or onboarding session that could call lesson_plan would author without the authoring skill's rules.
 */
export const SCOPES: Record<Scope, { builtin: string[]; plugin: ToolName[] }> = {
  lesson: { builtin: [...MEMORY, ...WEB], plugin: TOPIC_TOOLS },
  onboard: { builtin: [...MEMORY, ...WEB], plugin: TOPIC_TOOLS.filter((t) => !AUTHORING.includes(t)) },
  tutor: { builtin: MEMORY, plugin: [...TUTORING, "worked_line_record"] },
  review: { builtin: MEMORY, plugin: [...TUTORING, "item_replace"] },
  goal: { builtin: [...MEMORY, ...WEB], plugin: ["ask_learner", "goal_plan_set"] },
};

/** `--tools` limits the built-in tools; MCP tools are scoped by allowing some and removing the rest from context. */
export function toolArgs(kind: Scope): string[] {
  const scope = SCOPES[kind];
  const allowed = [...scope.builtin, ...scope.plugin.map((t) => PLUGIN_TOOL_PREFIX + t)];
  const denied = ALL_PLUGIN_TOOLS.filter((t) => !scope.plugin.includes(t)).map((t) => PLUGIN_TOOL_PREFIX + t);
  return [
    "--tools",
    scope.builtin.join(","),
    "--allowedTools",
    allowed.join(","),
    ...(denied.length ? ["--disallowedTools", denied.join(",")] : []),
  ];
}
