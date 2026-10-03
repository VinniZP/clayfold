import { basename } from "node:path";
import type { ChatMessage } from "../../shared/api";
import type { TopicEvent } from "../../shared/events";
import { CONTENT_RULES } from "../../shared/i18n";
import { t } from "../i18n";

export const PLUGIN_TOOL_PREFIX = "mcp__plugin_clayfold_clayfold__";

export type StoredMessage = {
  id: string;
  role: ChatMessage["role"];
  text: string;
  meta?: Record<string, unknown>;
};

export type Effect =
  | { kind: "event"; event: TopicEvent }
  /** Insert the chat message, or replace its text and meta when the id exists. */
  | { kind: "message"; message: StoredMessage }
  | { kind: "session"; sessionId: string }
  /** Result of a plugin MCP tool; `tool` is the short name, `text` the joined text content. */
  | { kind: "tool_result"; tool: string; isError: boolean; text: string }
  | { kind: "result"; sessionId: string | null; costUsd: number | null; error: string | null; permissionDenials: unknown[] };

export type ActivityLabels = { label: string; doneLabel: string };

type Activity = "webSearch" | "webFetch" | "readNotes" | "sourceAdd" | "sourceSearch" | "graphSet" | "goalPlan" | "glossarySet" | "workedLine" | "lessonPlan" | "lessonFinish" | "cardsPropose" | "learnerState" | "placement" | "itemReplace" | "recordWrite" | "recordEdit" | "mission" | "resources" | "glossary" | "notes" | "files";

const ACTIVITIES: Record<string, Activity> = {
  WebSearch: "webSearch",
  WebFetch: "webFetch",
  Read: "readNotes",
  Glob: "readNotes",
  Grep: "readNotes",
  source_add: "sourceAdd",
  source_search: "sourceSearch",
  graph_set: "graphSet",
  goal_plan_set: "goalPlan",
  glossary_set: "glossarySet",
  worked_line_record: "workedLine",
  lesson_plan: "lessonPlan",
  lesson_finish: "lessonFinish",
  cards_propose: "cardsPropose",
  get_learner_state: "learnerState",
  placement_record: "placement",
  item_replace: "itemReplace",
};

const MEMORY_FILES: Record<string, Activity> = {
  "MISSION.md": "mission",
  "RESOURCES.md": "resources",
  "GLOSSARY.md": "glossary",
  "NOTES.md": "notes",
};

/** Present tense while the action runs, past tense once it is finished. */
const labels = (a: Activity): ActivityLabels => ({ label: t(`activity.${a}`), doneLabel: t(`activity.${a}.done`) });

function fileActivity(tool: "Write" | "Edit", filePath: string): Activity {
  if (/(^|\/)learning-records\/[^/]+\.md$/.test(filePath)) return tool === "Write" ? "recordWrite" : "recordEdit";
  return MEMORY_FILES[basename(filePath)] ?? "files";
}

export function activityLabels(tool: string, input: Record<string, unknown>): ActivityLabels {
  const name = tool.startsWith(PLUGIN_TOOL_PREFIX) ? tool.slice(PLUGIN_TOOL_PREFIX.length) : tool;
  if (name === "Write" || name === "Edit") return labels(fileActivity(name, typeof input.file_path === "string" ? input.file_path : ""));
  if (name === "step_submit" && typeof input.index === "number") {
    const n = input.index + 1;
    return { label: t("activity.stepCheck", { n }), doneLabel: t("activity.stepCheck.done", { n }) };
  }
  const known = ACTIVITIES[name];
  return known ? labels(known) : { label: t("activity.other", { name }), doneLabel: t("activity.other.done", { name }) };
}

/** Past-tense text for a step_submit result, from its GateOutcome status. */
function stepOutcomeText(stepNo: number, resultText: string): string | null {
  let status: unknown;
  try {
    status = (JSON.parse(resultText) as { status?: unknown }).status;
  } catch {
    return null;
  }
  if (status === "published") return t("activity.stepPublished", { n: stepNo });
  if (status === "rejected") return t("activity.stepRejected", { n: stepNo });
  if (status === "dropped") return t("activity.stepDropped", { n: stepNo });
  return null;
}

/** Tools whose results change the onboarding phases (sources, graph, placement, goal plan). */
const ONBOARDING_TOOLS = new Set(["source_add", "graph_set", "placement_record", "goal_plan_set"]);

type Json = Record<string, any>;

function toolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((c): c is { type: "text"; text: string } => c?.type === "text" && typeof c.text === "string")
      .map((c) => c.text)
      .join("");
  }
  return "";
}

/**
 * Turns `claude -p --output-format stream-json --verbose --include-partial-messages` lines into effects.
 * Holds per-run state only (open text blocks, tool names by id); performs no I/O.
 */
export class StreamParser {
  /** Ids of text blocks started by stream events whose full text has not arrived yet, oldest first. */
  private pendingText: string[] = [];
  private toolNames = new Map<string, string>();
  /** Stored activity message per tool_use id, so a result can refine its past-tense text. */
  private activities = new Map<string, { message: StoredMessage; stepNo: number | null }>();

  constructor(
    private readonly conversationId: string,
    private readonly newMessageId: () => string,
  ) {}

  feed(line: string): Effect[] {
    if (!line.trim()) return [];
    let msg: Json;
    try {
      msg = JSON.parse(line);
    } catch {
      return [];
    }
    // Subagent traffic is not part of the conversation shown to the learner.
    if (msg.parent_tool_use_id) return [];
    switch (msg.type) {
      case "system":
        return this.system(msg);
      case "stream_event":
        return this.streamEvent(msg.event ?? {});
      case "assistant":
        return this.assistant(msg.message?.content ?? []);
      case "user":
        return this.user(msg.message?.content ?? []);
      case "result":
        return [
          {
            kind: "result",
            sessionId: msg.session_id ?? null,
            costUsd: typeof msg.total_cost_usd === "number" ? msg.total_cost_usd : null,
            error: msg.is_error ? String(msg.result || msg.subtype || "error") : null,
            permissionDenials: Array.isArray(msg.permission_denials) ? msg.permission_denials : [],
          },
        ];
      default:
        return [];
    }
  }

  private system(msg: Json): Effect[] {
    if (msg.subtype === "init" && typeof msg.session_id === "string") return [{ kind: "session", sessionId: msg.session_id }];
    if (msg.subtype === "api_retry") {
      return [
        {
          kind: "event",
          event: {
            type: "conv.retry",
            conversationId: this.conversationId,
            attempt: Number(msg.attempt ?? 0),
            delayMs: Number(msg.retry_delay_ms ?? 0),
          },
        },
      ];
    }
    return [];
  }

  private streamEvent(ev: Json): Effect[] {
    if (ev.type === "content_block_start" && ev.content_block?.type === "text") {
      this.pendingText.push(this.newMessageId());
      return [];
    }
    if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta" && ev.delta.text) {
      const messageId = this.pendingText.at(-1);
      if (!messageId) return [];
      return [{ kind: "event", event: { type: "conv.text", conversationId: this.conversationId, messageId, delta: ev.delta.text } }];
    }
    return [];
  }

  private assistant(content: Json[]): Effect[] {
    const out: Effect[] = [];
    for (const block of content) {
      if (block.type === "text" && typeof block.text === "string") {
        let id = this.pendingText.shift();
        if (!id) {
          // No partial stream for this block: deliver the whole text as one delta.
          id = this.newMessageId();
          out.push({ kind: "event", event: { type: "conv.text", conversationId: this.conversationId, messageId: id, delta: block.text } });
        }
        if (block.text.trim()) out.push({ kind: "message", message: { id, role: "assistant", text: block.text } });
      } else if (block.type === "tool_use" && typeof block.name === "string") {
        this.toolNames.set(block.id, block.name);
        out.push(...this.toolUse(block.id, block.name, block.input ?? {}));
      }
    }
    return out;
  }

  private toolUse(toolUseId: string, tool: string, input: Json): Effect[] {
    if (tool === `${PLUGIN_TOOL_PREFIX}ask_learner`) {
      const authored = Array.isArray(input.options) ? input.options : [];
      const options = input.shuffle === true ? shuffleOptions(authored) : authored;
      const multi = input.multi === true;
      const allowFree = input.allowFree !== false;
      const question = String(input.question ?? "");
      return [
        { kind: "event", event: { type: "conv.ask", conversationId: this.conversationId, question, options, multi, allowFree } },
        { kind: "message", message: { id: this.newMessageId(), role: "ask", text: question, meta: { options, multi, allowFree } } },
      ];
    }
    const { label, doneLabel } = activityLabels(tool, input);
    const message: StoredMessage = { id: this.newMessageId(), role: "activity", text: label, meta: { tool, doneText: doneLabel } };
    const stepNo = tool === `${PLUGIN_TOOL_PREFIX}step_submit` && typeof input.index === "number" ? input.index + 1 : null;
    this.activities.set(toolUseId, { message, stepNo });
    return [
      { kind: "event", event: { type: "conv.activity", conversationId: this.conversationId, label, doneLabel, tool } },
      { kind: "message", message },
    ];
  }

  private user(content: unknown): Effect[] {
    if (!Array.isArray(content)) return [];
    const out: Effect[] = [];
    for (const block of content as Json[]) {
      if (block.type !== "tool_result") continue;
      const tool = this.toolNames.get(block.tool_use_id);
      if (!tool?.startsWith(PLUGIN_TOOL_PREFIX)) continue;
      const name = tool.slice(PLUGIN_TOOL_PREFIX.length);
      const isError = block.is_error === true;
      const text = toolResultText(block.content);
      out.push({ kind: "tool_result", tool: name, isError, text });
      const activity = this.activities.get(block.tool_use_id);
      const outcome = activity?.stepNo && !isError ? stepOutcomeText(activity.stepNo, text) : null;
      if (activity && outcome) {
        out.push({ kind: "message", message: { ...activity.message, meta: { ...activity.message.meta, doneText: outcome } } });
      }
      if (!isError && ONBOARDING_TOOLS.has(name)) out.push({ kind: "event", event: { type: "onboarding.updated" } });
    }
    return out;
  }
}

const dontKnow = (label: string) => Object.values(CONTENT_RULES).some((r) => r.dontKnow.test(label));

/** Random display order for options of a question with a correct answer (Q3); "don't know" options stay last. */
export function shuffleOptions<T extends { label?: unknown }>(options: T[]): T[] {
  const last = options.filter((o) => dontKnow(String(o.label ?? "").trim()));
  const rest = options.filter((o) => !last.includes(o));
  for (let i = rest.length - 1; i > 0; i--) {
    const j = crypto.getRandomValues(new Uint32Array(1))[0]! % (i + 1);
    [rest[i], rest[j]] = [rest[j]!, rest[i]!];
  }
  return [...rest, ...last];
}
