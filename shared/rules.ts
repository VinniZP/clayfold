// Rule catalogue IDs. Sources and rationale: docs/learning-design.md.
export const RULES = {
  L1: "Lesson is a fixed sequence of small steps shown one at a time",
  L2: "Lesson opens with 2-3 ungraded prequestions on its core targets",
  L3: "Terms and parts are introduced before the mechanism",
  L4: "An explanation segment is at most 400 words and ends with 1-3 retrieval checks",
  L5: "Novices get worked -> faded -> independent; experienced learners get problems first",
  L6: "No self-explanation prompts on worked examples for novices",
  L7: "Learner answers before any explanation; keys stay on the server",
  L8: "Every practice item has a solution, a misconception per distractor and 2-3 hints",
  L9: "On error: diagnose, one guiding question; full solution only after an attempt or give-up",
  L10: "After 2 wrong attempts or idle time the tutor offers help",
  L11: "Lesson ends with an unaided check",
  L12: "A node is mastered after the exit check and a delayed retrieval at least 1 day later",
  L13: "Formats mix recall and choice; choice items have 3 options, at most 4",
  L14: "Review interleaves only confusable categories",
  L15: "Sessions open with a warm-up on earlier lessons; FSRS target retention 0.90",
  L16: "Problem contexts come from the learner's interests; logic unchanged and realistic",
  L17: "Tutor context includes recent attempts, unmastered prerequisites and the last 24 h",
  L18: "Tutor steers from 'do it for me' to explanation and asks for confidence",
  L19: "Lessons use the field's established terms, each marked and defined in the topic glossary",
  L20: "After a completed lesson the learner explains the node to a novice who probes and never teaches; a checklist per key idea, grounded in the lesson, debriefs it",
  V1: "No decorative visuals; each figure states what it teaches",
  V2: "Labels sit inside the figure next to the parts they name; no legend",
  V3: "A caption does not repeat the body text",
  V4: "Static stepwise figure by default; widgets only for motion, procedure or parameter play",
  V5: "Figure kind matches content: process mermaid, quantities chart, structure svg, manipulation widget",
  V6: "A figure parses and renders without errors; its labels match terms in the text",
  Q1: "Exactly one correct answer, confirmed by a blind solve",
  Q2: "The key cannot be found from the options alone",
  Q3: "Key position is shuffled by code",
  Q4: "Options have similar length; no stem cues; no all/none of the above",
  Q5: "Every item has a Bloom level; at least 30% of a lesson's items are apply or higher",
  Q6: "Every key, explanation and card answer cites a verbatim quote from a fetched source",
  Q7: "No near-duplicate items within a topic",
  Q8: "A lesson cites at least two publishers when the topic has sources from two or more",
  C1: "A card holds one fact, no lists or yes/no, a self-contained front and one answer",
  C2: "A concept is covered by several cards from different lenses",
  C3: "The learner accepts, edits or suspends every card and can report an error",
  C4: "A card with 8 or more lapses goes to the rewrite queue",
  G1: "A lesson challenge is one practice step whose item is apply or higher",
  G2: "A trophy is a self-contained drawing on a 100 x 100 canvas without text",
  S1: "Content matches its schema",
} as const;

export type RuleId = keyof typeof RULES;

export type Violation = {
  rule: RuleId;
  message: string;
  /** JSON path inside the submitted object, e.g. "items.1.options.2". */
  path?: string;
};
