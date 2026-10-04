import type { BurrowRoom, CrownsView, GameBackfillView, GameView, HabitView, ResidentView, RewardView } from "@shared/api";
import { HABITS, OUTFIT_ITEMS, rankOf, RANKS, REWARD_PREFIX, rewardTier, TIER_POINTS, type Outfit, type OutfitRef, type OutfitSlot, type RewardCondition } from "@shared/game";
import type { Resident } from "@shared/schemas";
import { iso, topicDetails } from "./fixtures";

// The meerkat for VITE_MOCK=1. The drawings stand in for what Claude draws with a lesson, a course or a goal.

const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${body}</svg>`;
const shine = (cx: number, cy: number, rx: number, ry: number) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="#FFFFFF" opacity="0.55"/>`;

const DRAWINGS = {
  compass: svg(
    `<circle cx="50" cy="52" r="34" fill="#F29C76"/><circle cx="50" cy="52" r="27" fill="#FFF9F3"/><path d="M50 29 L57 52 L50 75 L43 52 Z" fill="#CBC9F5"/><path d="M50 29 L57 52 L43 52 Z" fill="#A99BFF"/><circle cx="50" cy="52" r="4" fill="#32253F"/><rect x="44" y="11" width="12" height="10" rx="5" fill="#F29C76"/><rect x="69" y="42" width="3.5" height="20" rx="1.7" fill="#32253F" opacity="0.55"/>${shine(36, 36, 7, 4)}`,
  ),
  bowler: svg(
    `<path d="M18 79 C30 79 34 28 50 28 C66 28 70 79 82 79 Z" fill="#CBC9F5"/><path d="M50 28 C66 28 70 79 82 79 L64 79 C62 60 58 34 50 28 Z" fill="#32253F" opacity="0.1"/><path d="M23 70 Q50 63 77 70 L79 77 Q50 70 21 77 Z" fill="#F6C453"/><path d="M8 80 Q50 68 92 80 Q90 91 50 91 Q10 91 8 80 Z" fill="#A99BFF"/>${shine(42, 40, 4, 9)}`,
  ),
  antlers: svg(
    `<path d="M18 82 Q50 60 82 82" stroke="#F29C76" stroke-width="8" fill="none" stroke-linecap="round"/><g stroke="#FBE6C4" stroke-width="6" stroke-linecap="round" fill="none"><path d="M32 72 L28 38 M28 52 L14 40 M28 40 L36 22"/><path d="M68 72 L72 38 M72 52 L86 40 M72 40 L64 22"/></g><g><circle cx="14" cy="40" r="6" fill="#A3CC66"/><circle cx="36" cy="22" r="6" fill="#A99BFF"/><circle cx="86" cy="40" r="6" fill="#F29C76"/><circle cx="64" cy="22" r="6" fill="#A3CC66"/><circle cx="28" cy="38" r="5" fill="#CBC9F5"/><circle cx="72" cy="38" r="5" fill="#CBC9F5"/></g>`,
  ),
  lenses: svg(
    `<circle cx="34" cy="50" r="15" fill="#D9E9AD" opacity="0.85" stroke="#32253F" stroke-width="4"/><circle cx="66" cy="50" r="15" fill="#FFC9B4" opacity="0.85" stroke="#32253F" stroke-width="4"/><path d="M47 46 Q50 41 53 46" stroke="#32253F" stroke-width="4" fill="none" stroke-linecap="round"/><path d="M28 50 L38 50 M35 46 L39 50 L35 54" stroke="#4A7419" stroke-width="2.5" fill="none" stroke-linecap="round"/>${shine(28, 44, 4, 3)}${shine(60, 44, 4, 3)}`,
  ),
  medal: svg(
    `<path d="M30 26 L46 58 L54 58 L40 26 Z" fill="#A99BFF"/><path d="M70 26 L54 58 L46 58 L60 26 Z" fill="#CBC9F5"/><circle cx="50" cy="68" r="20" fill="#F6C453"/><circle cx="50" cy="68" r="14" fill="#FBE6C4"/><path d="M38 74 C44 74 45 58 50 58 C55 58 56 74 62 74" stroke="#865000" stroke-width="3" fill="none" stroke-linecap="round"/>${shine(43, 60, 5, 3)}`,
  ),
  chain: svg(
    `<path d="M18 30 Q50 52 82 30" stroke="#32253F" stroke-width="2" fill="none" opacity="0.5"/><circle cx="20" cy="32" r="6" fill="#A99BFF"/><circle cx="33" cy="40" r="6" fill="#A3CC66"/><circle cx="67" cy="40" r="6" fill="#A3CC66"/><circle cx="80" cy="32" r="6" fill="#A99BFF"/><circle cx="50" cy="56" r="13" fill="#F29C76"/><path d="M45 50 L45 62 M45 55 Q52 55 55 50" stroke="#FFF9F3" stroke-width="3" fill="none" stroke-linecap="round"/><circle cx="45" cy="50" r="2.5" fill="#FFF9F3"/><circle cx="45" cy="62" r="2.5" fill="#FFF9F3"/><circle cx="55" cy="50" r="2.5" fill="#FFF9F3"/>`,
  ),
  wrench: svg(
    `<rect x="44" y="40" width="12" height="50" rx="6" fill="#A3CC66"/><path d="M50 8 C36 8 28 20 32 32 L42 42 L58 42 L68 32 C72 20 64 8 50 8 Z" fill="#F29C76"/><path d="M42 8 L50 22 L58 8 Z" fill="#FFF9F3"/><rect x="44" y="70" width="12" height="6" fill="#4A7419" opacity="0.4"/>${shine(40, 22, 4, 6)}`,
  ),
  floppyCape: svg(
    `<path d="M30 12 Q50 6 70 12 L90 92 Q76 86 64 94 Q50 86 36 94 Q24 86 10 92 Z" fill="#D9E9AD"/><path d="M70 12 L90 92 Q76 86 64 94 L56 20 Z" fill="#32253F" opacity="0.1"/><rect x="36" y="44" width="28" height="28" rx="4" fill="#A99BFF"/><rect x="42" y="44" width="16" height="9" fill="#FFF9F3"/><rect x="40" y="60" width="20" height="10" rx="2" fill="#E7E5FB"/>`,
  ),
  partyHat: svg(
    `<path d="M26 80 L50 8 L74 80 Z" fill="#FFC9B4"/><path d="M34 56 L66 56 L70 68 L30 68 Z" fill="#A99BFF"/><path d="M42 32 L58 32 L61 42 L39 42 Z" fill="#A3CC66"/><path d="M50 8 L74 80 L62 80 Z" fill="#32253F" opacity="0.08"/><path d="M50 2 l3 6 7 1 -5 5 1 7 -6 -3 -6 3 1 -7 -5 -5 7 -1 Z" fill="#F6C453"/><path d="M16 82 Q50 72 84 82 Q82 90 50 90 Q18 90 16 82 Z" fill="#F29C76"/><circle cx="20" cy="50" r="3" fill="#F6C453"/><circle cx="82" cy="40" r="3" fill="#A3CC66"/><circle cx="86" cy="60" r="2.5" fill="#A99BFF"/>`,
  ),
};

const OWL = svg(
  `<path d="M30 30 L26 16 L40 26 Z" fill="#A99BFF"/><path d="M70 30 L74 16 L60 26 Z" fill="#A99BFF"/><ellipse cx="50" cy="58" rx="30" ry="34" fill="#CBC9F5"/><ellipse cx="50" cy="68" rx="18" ry="22" fill="#FFF9F3"/><path d="M42 62 q4 3 8 0 M50 70 q4 3 8 0 M42 78 q4 3 8 0" stroke="#CBC9F5" stroke-width="2.5" fill="none"/><path d="M20 56 Q12 72 24 86 Q30 72 28 58 Z" fill="#A99BFF"/><path d="M80 56 Q88 72 76 86 Q70 72 72 58 Z" fill="#A99BFF"/><circle cx="39" cy="42" r="12" fill="#FFF9F3"/><circle cx="61" cy="42" r="12" fill="#FFF9F3"/><circle cx="40" cy="43" r="6" fill="#32253F"/><circle cx="60" cy="43" r="6" fill="#32253F"/><circle cx="42" cy="41" r="2" fill="#FFFFFF"/><circle cx="62" cy="41" r="2" fill="#FFFFFF"/><path d="M45 52 L55 52 L50 60 Z" fill="#F6C453"/><ellipse cx="40" cy="93" rx="7" ry="3.5" fill="#F29C76"/><ellipse cx="60" cy="93" rx="7" ry="3.5" fill="#F29C76"/><path d="M70 74 C74 74 75 66 78 66 C81 66 82 74 86 74" stroke="#32253F" stroke-width="2" fill="none"/>${shine(40, 30, 8, 4)}`,
);

const OCTOPUS = svg(
  `<g stroke="#F29C76" stroke-width="8" stroke-linecap="round" fill="none"><path d="M30 60 Q18 76 24 92"/><path d="M40 64 Q34 80 40 94"/><path d="M50 66 Q50 82 50 95"/><path d="M60 64 Q66 80 60 94"/><path d="M70 60 Q84 70 86 58"/></g><path d="M30 60 Q22 66 16 62" stroke="#F29C76" stroke-width="8" stroke-linecap="round" fill="none"/><rect x="80" y="40" width="12" height="20" rx="3" fill="#FBE6C4"/><path d="M82 46 L90 46 M82 51 L90 51" stroke="#A99BFF" stroke-width="2"/><ellipse cx="50" cy="40" rx="28" ry="28" fill="#FFC9B4"/><ellipse cx="50" cy="48" rx="26" ry="16" fill="#FFC9B4"/><circle cx="40" cy="44" r="8" fill="#FFF9F3" stroke="#32253F" stroke-width="2.5"/><circle cx="60" cy="44" r="8" fill="#FFF9F3" stroke="#32253F" stroke-width="2.5"/><path d="M48 44 L52 44" stroke="#32253F" stroke-width="2.5"/><circle cx="41" cy="45" r="3.5" fill="#32253F"/><circle cx="61" cy="45" r="3.5" fill="#32253F"/><path d="M45 56 Q50 60 55 56" stroke="#32253F" stroke-width="2" fill="none" stroke-linecap="round"/><circle cx="34" cy="28" r="3" fill="#F29C76"/><circle cx="62" cy="24" r="2.4" fill="#F29C76"/>${shine(40, 24, 9, 5)}`,
);

const RESIDENTS: Record<string, Resident> = {
  "t-bayes": {
    name: "Olive",
    species: "owl",
    bio: "A night-shift statistician who updates her beliefs every time a new mouse runs by.",
    svg: OWL,
    lines: {
      greet: ["Hoo! Every answer you give is new evidence. Let's update together."],
      cheer: ["Posterior confidence: rising!", "Spot on. Your prior was well chosen.", "That's the likelihood talking. Well done."],
      support: ["One data point is not a verdict. Look at the feedback.", "Even owls misjudge base rates. Try again."],
      nudge: ["The forest is quiet. Shall we get back to the numbers?"],
    },
  },
  "t-git": {
    name: "Octavia",
    species: "octopus",
    bio: "Archivist of the deep: eight arms, eight branches, and not one lost commit.",
    svg: OCTOPUS,
    lines: {
      greet: ["Welcome to the archive! Every change you make, I file away."],
      cheer: ["Committed to memory!", "Clean merge. Lovely.", "Fast-forward! Onwards."],
      support: ["A conflict is just two ideas meeting. Read both sides.", "Nothing is lost in git. Let's try again."],
      nudge: ["Your branch is waiting where you left it."],
    },
  },
};

type MockReward = Omit<RewardView, "tier" | "seen" | "topicTitle"> & { met: boolean };

const reward = (r: Omit<MockReward, "unlockedAt"> & { unlocked?: number }): MockReward => ({ ...r, unlockedAt: r.unlocked === undefined ? null : iso(r.unlocked) });

const REWARDS: MockReward[] = [
  reward({ id: "rw-cond", topicId: "t-bayes", source: "lesson", name: "Conditional compass", description: "Points to the part that matters: divide by the condition.", slot: "paw", svg: DRAWINGS.compass, condition: { kind: "lesson", lessonId: "l-cond", earnedBy: "silver" }, done: 3, total: 3, met: true, unlocked: 2 }),
  reward({ id: "rw-bayes", topicId: "t-bayes", source: "lesson", name: "Bell-curve bowler", description: "For the one who tames Bayes' theorem on the first try.", slot: "head", svg: DRAWINGS.bowler, condition: { kind: "lesson", lessonId: "l-bayes", earnedBy: "gold" }, done: 0, total: 2, met: false }),
  reward({ id: "rw-lenses", topicId: "t-bayes", source: "course", name: "Prior-posterior lenses", description: "One lens for what you believed, one for what the data says.", slot: "face", svg: DRAWINGS.lenses, condition: { kind: "nodes", nodeIds: ["prob-basics", "cond-prob"], mastery: "exit_passed" }, done: 2, total: 2, met: true }),
  reward({ id: "rw-medal", topicId: "t-bayes", source: "course", name: "Golden likelihood medal", description: "Bayes' theorem and the base rate, mastered for good.", slot: "neck", svg: DRAWINGS.medal, condition: { kind: "nodes", nodeIds: ["bayes-theorem", "base-rate"], mastery: "mastered" }, done: 0, total: 2, met: false }),
  reward({ id: "rw-antlers", topicId: "t-git", source: "lesson", name: "Branching antlers", description: "Every tip is a commit; every fork is a branch.", slot: "head", svg: DRAWINGS.antlers, condition: { kind: "lesson", lessonId: "l-git", earnedBy: "complete" }, done: 0, total: 3, met: false }),
  reward({ id: "rw-chain", topicId: "t-git", source: "course", name: "Commit-chain necklace", description: "A history you can always walk back.", slot: "neck", svg: DRAWINGS.chain, condition: { kind: "nodes", nodeIds: ["commits", "staging", "branches"], mastery: "exit_passed" }, done: 3, total: 3, met: true, unlocked: 6 }),
  reward({ id: "rw-wrench", topicId: "t-goal", source: "stage", name: "Prototype pocket wrench", description: "The first version runs. Time to tighten the bolts.", slot: "paw", svg: DRAWINGS.wrench, condition: { kind: "stage", stage: "A working prototype" }, done: 0, total: 3, met: false }),
  reward({ id: "rw-cape", topicId: "t-goal", source: "stage", name: "Save-point cape", description: "Your workouts survive any restart.", slot: "back", svg: DRAWINGS.floppyCape, condition: { kind: "stage", stage: "Data that survives a restart" }, done: 0, total: 1, met: false }),
  reward({ id: "rw-party", topicId: "t-goal", source: "stage", name: "Launch-day party hat", description: "Friends have your app on their phones. Celebrate!", slot: "head", svg: DRAWINGS.partyHat, condition: { kind: "stage", stage: "Friends can install it" }, done: 0, total: 2, met: false }),
];

const HABIT_PROGRESS: Record<string, number> = { first_answer: 1, streak_3: 3, ask_tutor: 1, reflections: 3, focused: 1, goal_days: 5, streak_7: 4, comebacks: 6, review_days: 3, reviews: 31, streak_30: 4 };

let outfit: Outfit = { paw: `${REWARD_PREFIX}rw-cond`, neck: `${REWARD_PREFIX}rw-chain` };
const seen = new Set<string>(["rw-cond", "rw-chain", "first_answer", "streak_3", "ask_tutor", "rank:1", "rank:2", "f:t-git"]);
const unlockedNow = new Map<string, string>();
const befriended: Record<string, string> = { "t-git": iso(6), "t-bayes": iso(0) };

const stamp = (id: string) => {
  if (!unlockedNow.has(id)) unlockedNow.set(id, new Date().toISOString());
  return unlockedNow.get(id)!;
};

export function mockGameView(): GameView {
  const rewards: RewardView[] = REWARDS.map((r) => ({
    ...r,
    topicTitle: topicDetails[r.topicId]?.topic.title ?? "",
    tier: rewardTier(r.condition as RewardCondition),
    unlockedAt: r.unlockedAt ?? (r.met ? stamp(r.id) : null),
    seen: seen.has(r.id),
  }));
  const habits: HabitView[] = HABITS.map((h) => {
    const done = Math.min(HABIT_PROGRESS[h.id] ?? 0, h.target);
    return { id: h.id, item: h.item, tier: h.tier, done, target: h.target, unlockedAt: done >= h.target ? iso(3) : null, seen: seen.has(h.id) };
  });
  const points = [...rewards, ...habits].reduce((sum, x) => sum + (x.unlockedAt ? TIER_POINTS[x.tier] : 0), 0);
  const { rank, next } = rankOf(points);
  const rooms: BurrowRoom[] = Object.values(topicDetails)
    .filter((d) => d.topic.kind === "topic")
    .map((d) => {
      const r = RESIDENTS[d.topic.id];
      const resident: ResidentView | null = r ? { ...r, befriendedAt: befriended[d.topic.id] ?? null, seen: seen.has(`f:${d.topic.id}`) } : null;
      const passed = d.nodes.filter((n) => n.mastery === "exit_passed" || n.mastery === "mastered").length;
      return { topicId: d.topic.id, title: d.topic.title, passed, total: d.nodes.length, goalId: d.topic.goalId, resident };
    });
  return {
    outfit,
    rewards,
    habits,
    rank: { rank, points, next, seen: seen.has(`rank:${rank}`) },
    crowns: { silver: 2, gold: 1, days: 5 },
    rooms,
    nudge: { kind: "continue", lessonId: "l-bayes", title: "Bayes' theorem through a medical test" },
  };
}

export function mockCrowns(): CrownsView {
  const days = [1, 2, 4, 6, 9].map((n) => {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  return { lessons: { "l-cond": "gold", "l-bayes-v1": "silver" }, days };
}

export function mockWear(slot: OutfitSlot, item: OutfitRef | null): GameView | null {
  const view = mockGameView();
  if (item === null) {
    const { [slot]: _, ...rest } = outfit;
    outfit = rest;
    return mockGameView();
  }
  const fits = item.startsWith(REWARD_PREFIX)
    ? view.rewards.find((r) => `${REWARD_PREFIX}${r.id}` === item && r.unlockedAt)?.slot
    : (view.habits.some((h) => h.item === item && h.unlockedAt) || RANKS.slice(1, view.rank.rank + 1).some((r) => r.item === item)) && OUTFIT_ITEMS[item as keyof typeof OUTFIT_ITEMS];
  if (fits !== slot) return null;
  outfit = { ...outfit, [slot]: item };
  return mockGameView();
}

export function mockSeen(marks: { rewards?: string[]; habits?: string[]; ranks?: number[]; residents?: string[] }): void {
  for (const id of marks.rewards ?? []) seen.add(id);
  for (const id of marks.habits ?? []) seen.add(id);
  for (const r of marks.ranks ?? []) seen.add(`rank:${r}`);
  for (const id of marks.residents ?? []) seen.add(`f:${id}`);
}

let backfill: GameBackfillView = { running: false, done: 0, total: 0, failed: [], finishedAt: null, missing: 3 };

export const mockBackfill = (): GameBackfillView => backfill;

/** Pretends to draw three rewards, one a second. */
export function startMockBackfill(): GameBackfillView {
  if (backfill.running) return backfill;
  backfill = { ...backfill, running: true, done: 0, total: backfill.missing, failed: [] };
  const tick = () => {
    const done = backfill.done + 1;
    backfill = done < backfill.total ? { ...backfill, done } : { ...backfill, done, running: false, missing: 0, finishedAt: new Date().toISOString() };
    if (backfill.running) setTimeout(tick, 1000);
  };
  setTimeout(tick, 1000);
  return backfill;
}

const GAME_KEY = "clayfold-mock-game";

/** The mock keeps the switch across the reload that follows a language change. */
export function mockGameOn(): boolean {
  try {
    return localStorage.getItem(GAME_KEY) === "1";
  } catch {
    return false;
  }
}

export function setMockGameOn(on: boolean): void {
  try {
    localStorage.setItem(GAME_KEY, on ? "1" : "0");
  } catch {
    // Storage may be unavailable; the switch then lasts until the next reload.
  }
}
