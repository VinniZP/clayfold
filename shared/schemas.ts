import { z } from "zod";
import { OUTFIT_SLOTS } from "./game";

// Authoring schemas: what Claude submits through MCP tools. They carry answer keys and
// solutions, so they never reach the browser. Public* schemas below are the browser view.

export const Slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "lowercase-dash-slug").max(64);
export const Markdown = z.string().min(1).max(6000);

export const Cite = z
  .object({
    sourceId: z.string().min(1),
    /** Verbatim passage from the fetched source text, as returned by source_search. */
    quote: z.string().min(8).max(600),
  })
  .strict();
export type Cite = z.infer<typeof Cite>;

// ---------- Figures (V1-V6) ----------

const FigureCommon = {
  /** The structure, process or relationship this figure shows (V1). */
  teaches: z.string().min(10).max(300),
  /** Text alternative describing the figure's content. */
  alt: z.string().min(10).max(1000),
  caption: z.string().max(300).optional(),
};

export const Figure = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("mermaid"), code: z.string().min(10).max(8000), ...FigureCommon }).strict(),
  z.object({ kind: z.literal("svg"), svg: z.string().min(20).max(60000), ...FigureCommon }).strict(),
  z
    .object({ kind: z.literal("chart"), spec: z.record(z.string(), z.unknown()), ...FigureCommon })
    .strict(),
  z
    .object({
      kind: z.literal("widget"),
      html: z.string().min(20).max(60000),
      /** Why a static figure is not enough (V4). */
      purpose: z.enum(["motion", "procedure", "parameter"]),
      ...FigureCommon,
    })
    .strict(),
]);
export type Figure = z.infer<typeof Figure>;

// ---------- Items ----------

export const Bloom = z.enum(["remember", "understand", "apply", "analyze", "evaluate", "create"]);
export type Bloom = z.infer<typeof Bloom>;

export const Option = z
  .object({
    text: z.string().min(1).max(300),
    /** For a distractor: the specific error in thinking that leads to it (L8). Omit for the key. */
    misconception: z.string().min(5).max(300).optional(),
    /** Shown right after the learner picks this option (L9). */
    feedback: z.string().min(5).max(600),
  })
  .strict();
export type Option = z.infer<typeof Option>;

const ItemCommon = {
  prompt: Markdown,
  bloom: Bloom,
  /** Full worked solution the tutor sees (L8). */
  solution: Markdown,
  /** Hint ladder, from a nudge to a near-complete step (L8). */
  hints: z.array(z.string().min(5).max(500)).min(2).max(3),
  cites: z.array(Cite).min(1).max(4),
  /** Graph node this item exercises. */
  nodeId: Slug,
};

export const Item = z.discriminatedUnion("format", [
  z
    .object({
      format: z.literal("single"),
      ...ItemCommon,
      options: z.array(Option).min(3).max(4),
      /** Index of the key in `options` as authored. The server shuffles display order (Q3). */
      correct: z.number().int().min(0).max(3),
    })
    .strict(),
  z
    .object({
      format: z.literal("multi"),
      ...ItemCommon,
      options: z.array(Option).min(3).max(5),
      correct: z.array(z.number().int().min(0).max(4)).min(1).max(4),
    })
    .strict(),
  z
    .object({
      format: z.literal("order"),
      ...ItemCommon,
      /** Correct order; the server shuffles for display. */
      sequence: z.array(z.string().min(1).max(200)).min(3).max(7),
    })
    .strict(),
  z
    .object({
      format: z.literal("cloze"),
      ...ItemCommon,
      /** Text with blanks written as {{1}}, {{2}}, ... */
      text: z.string().min(10).max(1500),
      /** Accepted answers per blank, in blank order. */
      blanks: z.array(z.array(z.string().min(1).max(100)).min(1).max(6)).min(1).max(4),
    })
    .strict(),
  z
    .object({
      format: z.literal("number"),
      ...ItemCommon,
      answer: z.number(),
      tolerance: z.number().min(0),
      unit: z.string().max(30).optional(),
    })
    .strict(),
  z
    .object({
      format: z.literal("short"),
      ...ItemCommon,
      referenceAnswer: z.string().min(5).max(1500),
      /** Criteria a correct answer meets; graded by a model against the reference. */
      rubric: z.array(z.string().min(5).max(300)).min(1).max(5),
    })
    .strict(),
]);
export type Item = z.infer<typeof Item>;
export type ItemFormat = Item["format"];

// ---------- Steps ----------

export const StepKind = z.enum(["activate", "explain", "worked_example", "practice", "reflect", "check"]);
export type StepKind = z.infer<typeof StepKind>;

/** A closed blank takes a short exact answer: a value, identifier, command or term. */
const ClosedBlank = z.object({ prompt: z.string().min(5).max(300), answers: z.array(z.string().min(1).max(200)).min(1).max(6) }).strict();
/** An open blank takes an action or reason in the learner's words; the tutor judges it by meaning against the criteria. */
const OpenBlank = z.object({ prompt: z.string().min(5).max(300), criteria: z.array(z.string().min(5).max(300)).min(1).max(4) }).strict();
export type Blank = z.infer<typeof ClosedBlank> | z.infer<typeof OpenBlank>;

/** Words in a closed answer written in plain words; a longer plain-words answer is a phrase that people word differently. */
export const CLOSED_ANSWER_MAX_WORDS = 3;

/** A sentence-like answer: more than CLOSED_ANSWER_MAX_WORDS words of letters only, unlike a value, identifier or command. */
export function isPhraseAnswer(answer: string): boolean {
  const a = answer.trim();
  return /^[\p{L}\s,]+$/u.test(a) && a.split(/\s+/).length > CLOSED_ANSWER_MAX_WORDS;
}

/** True for a blank answered through the tutor: an open blank, or a closed one with a phrase among its answers. */
export function isOpenBlank(blank: Blank): boolean {
  return "criteria" in blank || blank.answers.some(isPhraseAnswer);
}

export const WorkedLine = z
  .object({
    text: Markdown,
    /** A faded line: the learner fills it in before `text` is shown (L5). */
    blank: z.union([ClosedBlank, OpenBlank]).optional(),
  })
  .strict();

export const Step = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("activate"),
      title: z.string().min(3).max(120),
      /** Ungraded prequestions (L2); closed formats only. */
      items: z.array(Item).min(2).max(3),
    })
    .strict(),
  z
    .object({
      kind: z.literal("explain"),
      title: z.string().min(3).max(120),
      body: Markdown,
      figure: Figure.optional(),
      cites: z.array(Cite).min(1).max(6),
      /** Retrieval checks after the segment (L4). */
      checks: z.array(Item).min(1).max(3),
    })
    .strict(),
  z
    .object({
      kind: z.literal("worked_example"),
      title: z.string().min(3).max(120),
      problem: Markdown,
      lines: z.array(WorkedLine).min(2).max(12),
      figure: Figure.optional(),
      cites: z.array(Cite).min(1).max(4),
    })
    .strict(),
  z.object({ kind: z.literal("practice"), title: z.string().min(3).max(120), item: Item }).strict(),
  z
    .object({
      kind: z.literal("reflect"),
      title: z.string().min(3).max(120),
      prompt: z.string().min(10).max(500),
      purpose: z.enum(["why", "connect", "confidence"]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("check"),
      title: z.string().min(3).max(120),
      /** Unaided exit check (L11). */
      items: z.array(Item).min(2).max(6),
    })
    .strict(),
]);
export type Step = z.infer<typeof Step>;

// ---------- Cards ----------

export const CardLens = z.enum(["fact", "attribute", "difference", "part", "cause", "significance", "procedure"]);

export const Card = z
  .object({
    kind: z.enum(["basic", "cloze"]),
    /** For cloze: contains exactly one "____". */
    front: z.string().min(5).max(300),
    back: z.string().min(1).max(300),
    nodeId: Slug,
    lens: CardLens,
    cites: z.array(Cite).min(1).max(2),
  })
  .strict();
export type Card = z.infer<typeof Card>;

// ---------- Graph and lessons ----------

export const GraphNode = z
  .object({
    id: Slug,
    title: z.string().min(2).max(120),
    kind: z.enum(["knowledge", "skill"]),
    summary: z.string().min(10).max(500),
    prereqs: z.array(Slug).max(8),
  })
  .strict();
export type GraphNode = z.infer<typeof GraphNode>;

export const GlossaryTerm = z
  .object({
    term: z.string().min(1).max(80),
    /** What it is, in one or two sentences. */
    definition: z.string().min(10).max(400),
    /** The field's original term when the learner's language uses another word, usually English. */
    original: z.string().min(1).max(80).optional(),
    /** Words not to use for this concept. */
    avoid: z.array(z.string().min(1).max(80)).max(6).optional(),
  })
  .strict();
export type GlossaryTerm = z.infer<typeof GlossaryTerm>;

export const GoalPlanEntry = z
  .object({
    id: Slug,
    stage: z.string().min(2).max(80),
    title: z.string().min(2).max(120),
    why: z.string().min(10).max(300),
    brief: z.string().min(20).max(2000),
  })
  .strict();
export type GoalPlanEntry = z.infer<typeof GoalPlanEntry>;

// ---------- Meerkat rewards (gamification only) ----------

/** A wearable Claude designs for the learner's meerkat. */
const Wearable = {
  name: z.string().min(2).max(60),
  /** What earning it means, in one sentence. */
  description: z.string().min(10).max(200),
  slot: z.enum(OUTFIT_SLOTS),
  /** `<svg viewBox="0 0 100 100">` with the item alone; no text, scripts or external references (G2). */
  svg: z.string().min(40).max(12000),
};

/** The reward of one lesson: complete (every exit-check item answered), silver or gold crown. */
export const LessonReward = z.object({ ...Wearable, earnedBy: z.enum(["complete", "silver", "gold"]) }).strict();
export type LessonReward = z.infer<typeof LessonReward>;

/** A course milestone: unlocked when every listed node reaches the mastery level. */
export const CourseReward = z
  .object({ ...Wearable, key: Slug, nodeIds: z.array(Slug).min(1).max(12), mastery: z.enum(["exit_passed", "mastered"]) })
  .strict();
export type CourseReward = z.infer<typeof CourseReward>;

/** A character who lives in the course's chamber of the meerkat's burrow and cheers the learner on in its lessons. */
export const Resident = z
  .object({
    name: z.string().min(2).max(40),
    /** The animal, e.g. "owl", "octopus". */
    species: z.string().min(2).max(40),
    /** Who they are and why they care about this subject, in one or two sentences. */
    bio: z.string().min(10).max(300),
    /** `<svg viewBox="0 0 100 100">`: the whole character standing, facing the viewer (G2). */
    svg: z.string().min(40).max(16000),
    /** Short lines in the character's voice: on meeting, after a right answer, after a wrong one, inviting back to study. */
    lines: z
      .object({
        greet: z.array(z.string().min(3).max(140)).min(1).max(3),
        cheer: z.array(z.string().min(3).max(140)).min(2).max(5),
        support: z.array(z.string().min(3).max(140)).min(2).max(5),
        nudge: z.array(z.string().min(3).max(140)).min(1).max(3),
      })
      .strict(),
  })
  .strict();
export type Resident = z.infer<typeof Resident>;

/** The trophy of one stage of a goal's plan, as written in the entries' `stage`. */
export const StageTrophy = z.object({ ...Wearable, stage: z.string().min(2).max(80) }).strict();
export type StageTrophy = z.infer<typeof StageTrophy>;

export const Level = z.enum(["novice", "intermediate", "advanced"]);
export type Level = z.infer<typeof Level>;

/** What a practice set aims at: the learner's level, a step up (apply or higher), or the misconceptions they chose. */
export const PracticeFocus = z.enum(["same", "harder", "mistakes"]);
export type PracticeFocus = z.infer<typeof PracticeFocus>;

/** Items in a practice set, one practice step each. */
export const PRACTICE_SIZES = [3, 5, 8] as const;
export type PracticeSize = (typeof PRACTICE_SIZES)[number];

export const LessonPlan = z
  .object({
    title: z.string().min(3).max(120),
    objective: z.string().min(10).max(400),
    nodeIds: z.array(Slug).min(1).max(4),
    level: Level,
    /** Sources the lesson will cite; at least two publishers when the topic has them (Q8). */
    sourceIds: z.array(z.string().min(1)).min(1).max(12),
    /** Must start with activate and end with check (L2, L11). */
    outline: z
      .array(z.object({ kind: StepKind, title: z.string().min(3).max(120) }).strict())
      .min(4)
      .max(16),
  })
  .strict();
export type LessonPlan = z.infer<typeof LessonPlan>;

// ---------- Public (browser) views ----------

export type PublicOption = { text: string };

export type PublicItem = {
  id: string;
  format: ItemFormat;
  prompt: string;
  bloom: Bloom;
  /** single/multi: options in display order. */
  options?: PublicOption[];
  /** order: entries shuffled for display. */
  entries?: string[];
  /** cloze: text with {{n}} blanks. */
  text?: string;
  blankCount?: number;
  unit?: string;
  hintCount: number;
};

export type PublicFigure = Figure; // figures carry no keys

export type PublicStep =
  | { id: string; idx: number; kind: "activate"; title: string; items: PublicItem[] }
  | { id: string; idx: number; kind: "explain"; title: string; body: string; figure?: PublicFigure; checks: PublicItem[]; cites: PublicCite[] }
  | {
      id: string;
      idx: number;
      kind: "worked_example";
      title: string;
      problem: string;
      /** Faded lines arrive with `text` omitted until answered. */
      /** blankOpen: the learner answers this line through the tutor. */
      lines: { idx: number; text?: string; blankPrompt?: string; blankOpen?: boolean }[];
      figure?: PublicFigure;
      cites: PublicCite[];
    }
  | { id: string; idx: number; kind: "practice"; title: string; item: PublicItem }
  | { id: string; idx: number; kind: "reflect"; title: string; prompt: string; purpose: "why" | "connect" | "confidence" }
  | { id: string; idx: number; kind: "check"; title: string; items: PublicItem[] };

export type PublicCite = { sourceId: string; quote: string; url: string; title: string };

/**
 * Learner answer payloads, by format.
 * single: option index in display order; multi: display indices; order: entries in chosen order;
 * cloze: one string per blank; number: value; short: free text.
 */
export type Answer =
  | { format: "single"; choice: number }
  | { format: "multi"; choices: number[] }
  | { format: "order"; sequence: string[] }
  | { format: "cloze"; blanks: string[] }
  | { format: "number"; value: number }
  | { format: "short"; text: string };
