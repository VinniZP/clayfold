import { z } from "zod";
import { Card, GraphNode, Item, LessonPlan, Slug, Step } from "./schemas";
import type { RuleId, Violation } from "./rules";

// MCP tool contract between the plugin skills and the server.
// Tool names as Claude sees them: mcp__plugin_clayfold_clayfold__<name>.

export const TOOL_INPUTS = {
  ask_learner: {
    question: z.string().min(3).max(500),
    options: z
      .array(z.object({ label: z.string().min(1).max(120), description: z.string().max(300).optional() }).strict())
      .min(2)
      .max(6),
    multi: z.boolean().default(false),
    allowFree: z.boolean().default(true),
    /** Shuffle option order for display (Q3); a "don't know" option stays last. Set it for every question with a correct answer. */
    shuffle: z
      .boolean()
      .default(false)
      .describe("Shuffle option order for display; a 'don't know' option stays last. Set true for every question with a correct answer (placement)."),
  },
  source_add: {
    url: z.string().url(),
    kind: z.enum(["docs", "article", "book", "paper", "course", "video", "reference"]),
    /** One line: what it covers and when to use it. */
    note: z.string().min(10).max(300),
  },
  source_search: {
    sourceId: z.string().min(1),
    query: z.string().min(2).max(200),
    maxPassages: z.number().int().min(1).max(8).default(4),
  },
  graph_set: { nodes: z.array(GraphNode).min(1).max(60) },
  placement_record: {
    nodeId: Slug,
    outcome: z.enum(["known", "partial", "unknown"]),
    evidence: z.string().min(5).max(500),
  },
  lesson_plan: { plan: LessonPlan },
  step_submit: { lessonId: z.string().min(1), index: z.number().int().min(0).max(15), step: Step },
  lesson_finish: { lessonId: z.string().min(1), summary: z.string().min(10).max(1000) },
  cards_propose: { lessonId: z.string().min(1).optional(), cards: z.array(Card).min(1).max(12) },
  get_learner_state: { nodeIds: z.array(Slug).max(20).optional() },
  item_replace: {
    queueId: z.string().min(1),
    item: Item.optional(),
    card: Card.optional(),
  },
} as const;

export type ToolName = keyof typeof TOOL_INPUTS;

// Tool results (serialized as JSON text content).

export type AskLearnerResult = { shown: true; instruction: "End your turn now and wait for the learner's answer." };

export type SourceAddResult =
  | {
      ok: true;
      sourceId: string;
      title: string;
      chars: number;
      headings: string[];
      /** Ok sources of the topic per publisher (organisation behind the domain), this one included. */
      publishers: Record<string, number>;
    }
  | { ok: false; error: string };

export type SourceSearchResult = {
  passages: { quote: string; offset: number }[];
};

export type GateOutcome = {
  status: "published" | "rejected" | "dropped";
  /** Attempt number for this step index, starting at 1. A step is dropped after 3 rejected attempts. */
  attempt: number;
  violations: Violation[];
};

export type GraphSetResult = { ok: true; total: number; added: number; updated: number };
export type PlacementRecordResult = { ok: true };
export type LessonPlanResult = { lessonId: string };
export type LessonFinishResult = { ok: true; published: number; dropped: number };
export type ItemReplaceResult = { status: "replaced" | "rejected"; violations: Violation[] };

export type CardsProposeResult = {
  results: { index: number; status: "proposed" | "rejected"; cardId?: string; violations: Violation[] }[];
};

export type LearnerState = {
  topic: { id: string; title: string };
  nodes: {
    id: string;
    title: string;
    placement: "known" | "partial" | "unknown" | null;
    mastery: "new" | "learning" | "exit_passed" | "mastered";
    prereqs: string[];
    unmasteredPrereqs: string[];
  }[];
  /** Sources registered with source_add; cite them by id. */
  sources: { id: string; title: string; url: string; kind: string; status: "ok" | "failed" }[];
  recentAttempts: {
    itemId: string;
    nodeId: string;
    prompt: string;
    correct: boolean;
    misconception: string | null;
    hintsUsed: number;
    at: string;
  }[];
  misconceptionsSeen: { misconception: string; count: number; nodeId: string }[];
  notes: { text: string; lessonId: string | null; at: string }[];
  regenQueue: { queueId: string; targetType: "item" | "card"; reason: RegenReason; content: unknown }[];
  lessonsDone: { lessonId: string; title: string; nodeIds: string[]; finishedAt: string }[];
};

export type RegenReason = "possible_leak" | "dead_distractor" | "leech" | "learner_report";

export type { RuleId };
