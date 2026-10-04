import type { Scope } from "../claude/scope";

export const DRAWING = `Drawings: each is one <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"> under 8 KB, with no <text>, <image>, scripts or external references (G2). The look is soft clay: rounded shapes, pastel fills (cream #FFF9F3, butter #FBE6C4, lilac #CBC9F5, peach #FFC9B4, pistachio #D9E9AD; accents #A99BFF, #F29C76, #A3CC66), no outlines except a thin #32253F line where shapes need separating, a lighter highlight on each main shape and a slightly darker shade along its lower edge for volume. Leave the background empty.
Wearables are odd, funny and specific to the subject (for Git a headband with tiny branching antlers, for statistics a bowler hat shaped like a bell curve), never generic. Where each slot sits on the 100 x 100 box: head - headgear whose brim rests at y=78, about 70 wide, centred at x=50; face - glasses or a mask over eyes at (34,50) and (66,50); neck - a collar, scarf or medal around a neck at y=30, about 50 wide, free to hang down; back - a cape, pack or wings behind a body that spans x 25-75 and y 10-95; paw - a held object centred at (50,50), about 60 tall.
Names, descriptions, bios and lines are in the learner's language.`;

export const RESIDENT = `A resident is an anthropomorphic animal that fits the subject (an octopus archivist for Git, an owl for statistics), drawn whole, standing and facing the viewer, centred, feet at y=95, in the same clay look. Give them a name, a bio, and lines that are short, warm and specific to the subject: they praise effort and retrieval, invite the learner back to study, and never give answers.`;

const BY_SCOPE: Partial<Record<Scope, string>> = {
  lesson: `In lesson_plan, set challenge to the index of one practice step after the lesson's other practice steps: its hardest item, bloom apply or higher, a transfer problem in a context this lesson has not used, solvable with what it taught (G1). It is an ordinary practice step: no game words in it; the app frames it. Also pass reward: one wearable that nods to this lesson's content, earnedBy "silver" by default, "gold" when the lesson has a challenge and builds a key skill, "complete" for the first lesson of a course.`,
  onboard: `With the first graph_set call pass resident and rewards: 2-4 milestones on the graph's key nodes in learning order (for example the first core skill past its exit check, the whole core mastered), each a wearable.\n${RESIDENT}`,
  goal: `With every goal_plan_set call pass trophies for the stages without one (the result lists trophiesMissing): one per stage; the last stage's trophy is the goal's grand prize, the most spectacular of them.`,
};

/**
 * Appended to the system prompt of the runs that build content while gamification is on: Claude designs
 * the meerkat's rewards with the content, so playing costs no extra runs. Lesson text stays free of game
 * elements (V1).
 */
export function gameInstruction(scope: Scope): string | null {
  const task = BY_SCOPE[scope];
  if (!task) return null;
  return `Gamification is on: the learner has a meerkat mascot who wears rewards earned by learning, and a burrow whose chambers are their courses.\n${task}\n${DRAWING}`;
}
