import { z } from "zod";

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

export const WorkedLine = z
  .object({
    text: Markdown,
    /** A faded line: the learner fills it in before `text` is shown (L5). */
    blank: z
      .object({ prompt: z.string().min(5).max(300), answers: z.array(z.string().min(1).max(200)).min(1).max(6) })
      .strict()
      .optional(),
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

export const Level = z.enum(["novice", "intermediate", "advanced"]);
export type Level = z.infer<typeof Level>;

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
      lines: { idx: number; text?: string; blankPrompt?: string }[];
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
