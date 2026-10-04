import { z } from "zod";
import { Card, CourseReward, GlossaryTerm, GoalPlanEntry, GraphNode, Item, LessonPlan, LessonReward, Resident, Slug, StageTrophy, Step } from "./schemas";
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
  graph_set: {
    nodes: z.array(GraphNode).min(1).max(60),
    rewards: z.array(CourseReward).max(6).optional().describe("Meerkat milestones of the course, by key; a stored milestone stays when omitted."),
    resident: Resident.optional().describe("The character who lives in this course's chamber of the burrow; a stored one stays when omitted."),
  },
  placement_record: {
    nodeId: Slug,
    outcome: z.enum(["known", "partial", "unknown"]),
    evidence: z.string().min(5).max(500),
  },
  lesson_plan: {
    plan: LessonPlan,
    challenge: z
      .number()
      .int()
      .min(1)
      .max(15)
      .optional()
      .describe("Outline index of the practice step that is the lesson's challenge: its item is apply or higher, in a new context (G1)."),
    reward: LessonReward.optional().describe("The meerkat wearable this lesson awards."),
  },
  step_submit: { lessonId: z.string().min(1), index: z.number().int().min(0).max(15), step: Step },
  lesson_finish: { lessonId: z.string().min(1), summary: z.string().min(10).max(1000) },
  cards_propose: { lessonId: z.string().min(1).optional(), cards: z.array(Card).min(1).max(12) },
  goal_plan_set: {
    entries: z.array(GoalPlanEntry).min(1).max(15),
    trophies: z.array(StageTrophy).max(8).optional().describe("One meerkat trophy per plan stage; a stage keeps its stored trophy when omitted."),
  },
  goal_note: { text: z.string().min(10).max(500) },
  glossary_set: { terms: z.array(GlossaryTerm).min(1).max(30) },
  worked_line_record: {
    stepId: z.string().min(1),
    line: z.number().int().min(0).max(11),
    /** The learner's answer as they gave it, or what they said when giving up. */
    answer: z.string().min(1).max(1000),
    outcome: z.enum(["correct", "gave_up"]),
  },
  teachback_finish: { teachbackId: z.string().min(1) },
  get_learner_state: { nodeIds: z.array(Slug).max(20).optional() },
  item_replace: {
    queueId: z.string().min(1),
    item: Item.optional(),
    card: Card.optional(),
  },
} as const;

export type ToolName = keyof typeof TOOL_INPUTS;

/** Input fields that exist only while gamification is on; the MCP server leaves them out of the schema otherwise. */
export const GAME_FIELDS: Partial<Record<ToolName, readonly string[]>> = {
  lesson_plan: ["challenge", "reward"],
  graph_set: ["rewards", "resident"],
  goal_plan_set: ["trophies"],
};

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

/** trophiesMissing: plan stages without a trophy, listed while gamification is on. */
export type GoalPlanSetResult = { ok: true; total: number; trophiesMissing?: string[] };
export type GoalNoteResult = { ok: true };
export type GlossarySetResult = { ok: true; total: number };
export type WorkedLineRecordResult = { ok: true };
export type TeachbackFinishResult = { ok: true; instruction: string };
export type GraphSetResult = { ok: true; total: number; added: number; updated: number };
export type PlacementRecordResult = { ok: true };
export type LessonPlanResult = { lessonId: string };
export type LessonFinishResult = { ok: true; published: number; dropped: number };
export type ItemReplaceResult = { status: "replaced" | "rejected"; violations: Violation[] };

export type CardsProposeResult = {
  results: { index: number; status: "proposed" | "rejected"; cardId?: string; violations: Violation[] }[];
};

export type LearnerState = {
  /** goal: the title of the goal whose plan opened this topic, or null. */
  topic: { id: string; title: string; goal: string | null };
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
  /** Key ideas the learner left out or got wrong in the latest debriefed teach-back on each node (L20). */
  teachbackGaps: { nodeId: string; idea: string; verdict: "missing" | "wrong"; correction: string; at: string }[];
  notes: { text: string; lessonId: string | null; at: string }[];
  regenQueue: { queueId: string; targetType: "item" | "card"; reason: RegenReason; content: unknown }[];
  lessonsDone: { lessonId: string; title: string; nodeIds: string[]; finishedAt: string }[];
  /** The topic glossary; text marks terms from it as [[surface|Term]]. */
  glossary: { term: string; definition: string; original: string | null }[];
};

export type RegenReason = "possible_leak" | "dead_distractor" | "leech" | "learner_report";

export type { RuleId };
