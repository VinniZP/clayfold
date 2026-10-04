// The meerkat: optional gamification, off by default (Settings.gamification). Rewards follow learning
// actions only; docs/learning-design.md, section G.
//
// Two kinds of reward unlock wearables:
// - rewards Claude designs and draws while it builds content: one per lesson (lesson_plan), milestones of a
//   course (graph_set) and one trophy per stage of a goal (goal_plan_set). Their number grows with the content.
// - habits: a fixed set for study habits no lesson can measure (streaks, reviews, focus), with built-in items.
// Every unlock adds points by tier; points raise the meerkat's rank, and each rank unlocks a built-in item.

export const OUTFIT_SLOTS = ["back", "neck", "head", "face", "paw"] as const;
export type OutfitSlot = (typeof OUTFIT_SLOTS)[number];

/** Built-in wearables, drawn in web/src/components/meerkat, by the slot they occupy. */
export const OUTFIT_ITEMS = {
  propeller: "head",
  wizard: "head",
  viking: "head",
  teacozy: "head",
  ufo: "head",
  bucket: "head",
  glasses: "face",
  monocle: "face",
  goggles: "face",
  mustache: "face",
  bowtie: "neck",
  scarf: "neck",
  cape: "back",
  backpack: "back",
  jetpack: "back",
  duck: "paw",
  walkie: "paw",
  binoculars: "paw",
} as const satisfies Record<string, OutfitSlot>;
export type OutfitItemId = keyof typeof OUTFIT_ITEMS;

export const REWARD_PREFIX = "reward:";

/** A worn item: a built-in item id, or `reward:<id>` for a reward Claude drew. */
export type OutfitRef = OutfitItemId | `reward:${string}`;
export type Outfit = Partial<Record<OutfitSlot, OutfitRef>>;

export const TIERS = ["common", "rare", "epic", "legendary"] as const;
export type Tier = (typeof TIERS)[number];
export const TIER_POINTS: Record<Tier, number> = { common: 1, rare: 2, epic: 4, legendary: 8 };

/** Study-habit counts the habits measure; server/game/metrics.ts computes them. */
export type Metric = "answers" | "comebacks" | "tutorChats" | "reflections" | "reviews" | "reviewDays" | "streak" | "goalDays" | "focusedLessons";

export const HABITS = [
  { id: "first_answer", metric: "answers", target: 1, item: "propeller", tier: "common" },
  { id: "streak_3", metric: "streak", target: 3, item: "scarf", tier: "common" },
  { id: "ask_tutor", metric: "tutorChats", target: 1, item: "walkie", tier: "common" },
  { id: "reflections", metric: "reflections", target: 5, item: "monocle", tier: "rare" },
  { id: "focused", metric: "focusedLessons", target: 3, item: "binoculars", tier: "rare" },
  { id: "goal_days", metric: "goalDays", target: 5, item: "teacozy", tier: "rare" },
  { id: "streak_7", metric: "streak", target: 7, item: "goggles", tier: "rare" },
  { id: "comebacks", metric: "comebacks", target: 10, item: "duck", tier: "rare" },
  { id: "review_days", metric: "reviewDays", target: 7, item: "bucket", tier: "epic" },
  { id: "reviews", metric: "reviews", target: 50, item: "wizard", tier: "epic" },
  { id: "streak_30", metric: "streak", target: 30, item: "jetpack", tier: "legendary" },
] as const satisfies readonly { id: string; metric: Metric; target: number; item: OutfitItemId; tier: Tier }[];
export type HabitId = (typeof HABITS)[number]["id"];

/** Ranks by points; reaching one unlocks its item. Rank 0 is where every meerkat starts. */
export const RANKS = [
  { points: 0, item: null },
  { points: 3, item: "glasses" },
  { points: 8, item: "bowtie" },
  { points: 16, item: "backpack" },
  { points: 28, item: "cape" },
  { points: 45, item: "mustache" },
  { points: 70, item: "viking" },
  { points: 100, item: "ufo" },
] as const satisfies readonly { points: number; item: OutfitItemId | null }[];

/** Share of the exit check's items answered right on the first attempt that earns a lesson crown (L12's 80%). */
export const CROWN_SHARE = 0.8;

/** A lesson counts as focused when the learner never left its page for longer than this. */
export const FOCUS_AWAY_MS = 120_000;

/** What unlocks a reward Claude designed. */
export type RewardCondition =
  /** complete: every exit-check item answered; silver/gold: the lesson's crown. */
  | { kind: "lesson"; lessonId: string; earnedBy: "complete" | "silver" | "gold" }
  | { kind: "nodes"; nodeIds: string[]; mastery: "exit_passed" | "mastered" }
  /** Every course of the stage has all its nodes past the exit check. */
  | { kind: "stage"; stage: string };

export function rewardTier(condition: RewardCondition): Tier {
  switch (condition.kind) {
    case "lesson":
      return condition.earnedBy === "complete" ? "common" : condition.earnedBy === "silver" ? "rare" : "epic";
    case "nodes":
      return condition.mastery === "mastered" ? "epic" : "rare";
    case "stage":
      return "legendary";
  }
}

export function rankOf(points: number): { rank: number; next: number | null } {
  let rank = 0;
  RANKS.forEach((r, i) => {
    if (points >= r.points) rank = i;
  });
  return { rank, next: RANKS[rank + 1]?.points ?? null };
}
