import { beforeEach, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { HABITS, RANKS } from "../../shared/game";
import { openDb } from "../db";
import { submitAttempt } from "../routes/grading";
import { insertStep, items, seed } from "../routes/test-fixtures";
import { backfillView, startBackfill, type GameRunner } from "./backfill";
import { lessonProgress } from "./progress";
import { gameInstruction } from "./prompt";
import { checkDrawing, storeCourseRewards, storeLessonReward, storeResident, storeStageTrophies } from "./rewards";
import { gameView, markSeen, wearable } from "./view";

const DRAWING = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="30" fill="#CBC9F5"/></svg>';
const wear = { name: "Branch antlers", description: "Every tip is a commit.", slot: "head" as const, svg: DRAWING };

let db: Database;
beforeEach(() => {
  db = openDb(":memory:");
  seed(db);
});

const answer = (itemId: string, choice: number, hintsUsed = 0) =>
  submitAttempt(itemId, { answer: { format: "single", choice }, hintsUsed, durationMs: 20_000, context: "check" }, { database: db });

/** Lesson ls1 with a practice step at index 1 (the challenge) and a check of five single-choice items. */
function lessonWithCheck(challenge: boolean) {
  const practice = insertStep(db, 1, { kind: "practice", title: "Hard one", item: items.single("p") });
  const check = insertStep(db, 2, { kind: "check", title: "Check", items: ["c1", "c2", "c3", "c4", "c5"].map((tag) => items.single(tag)) });
  if (challenge) db.query("UPDATE lessons SET challenge_idx = 1 WHERE id = 'ls1'").run();
  return { challengeItem: practice.itemIds[0]!, checkItems: check.itemIds };
}

// The fixtures display options in reverse, so the key (authoring index 0) of a three-option item shows last.
const KEY = 2;
const WRONG = 0;

test("a lesson crown needs 80% of the exit check right on the first try; gold also needs the challenge first try without hints", async () => {
  const { challengeItem, checkItems } = lessonWithCheck(true);
  for (const [i, id] of checkItems.entries()) await answer(id, i === 0 ? WRONG : KEY);
  expect(lessonProgress(db).get("ls1")).toMatchObject({ checkItems: 5, answered: 5, firstRight: 4, crown: "silver" });

  await answer(challengeItem, KEY, 1);
  expect(lessonProgress(db).get("ls1")?.crown).toBe("silver");
});

test("a later right answer does not turn a first miss into a crown", async () => {
  const { checkItems } = lessonWithCheck(false);
  for (const [i, id] of checkItems.entries()) await answer(id, i < 2 ? WRONG : KEY);
  for (const id of checkItems.slice(0, 2)) await answer(id, KEY);
  expect(lessonProgress(db).get("ls1")).toMatchObject({ firstRight: 3, crown: null });
});

test("the gold crown unlocks a gold lesson reward, and its points raise the rank", async () => {
  const { challengeItem, checkItems } = lessonWithCheck(true);
  storeLessonReward(db, "tp1", "ls1", { ...wear, earnedBy: "gold" });
  expect(gameView(new Date(), db).rewards[0]).toMatchObject({ tier: "epic", unlockedAt: null, done: 0, total: 2 });

  await answer(challengeItem, KEY);
  for (const id of checkItems) await answer(id, KEY);
  const view = gameView(new Date(), db);
  const unlockedAt = view.rewards[0]!.unlockedAt;
  expect(unlockedAt).not.toBeNull();
  expect(view.rewards[0]).toMatchObject({ seen: false, done: 2 });
  // epic reward 4 + first_answer habit 1
  expect(view.rank).toMatchObject({ points: 5, rank: 1, seen: false });
  expect(wearable(view).get(`reward:${view.rewards[0]!.id}`)).toBe("head");
  expect(wearable(view).get(RANKS[1].item!)).toBe("face");

  markSeen({ rewards: [view.rewards[0]!.id], ranks: [1] }, db);
  const again = gameView(new Date(), db);
  expect(again.rewards[0]!.seen).toBe(true);
  expect(again.rank.seen).toBe(true);
  expect(again.rewards[0]!.unlockedAt).toBe(unlockedAt);
});

test("habits unlock from learning history, including history from before the meerkat was on", async () => {
  const { checkItems } = lessonWithCheck(false);
  await answer(checkItems[0]!, WRONG);
  await answer(checkItems[0]!, KEY);
  const habits = gameView(new Date(), db).habits;
  expect(habits.find((h) => h.id === "first_answer")).toMatchObject({ done: 1, unlockedAt: expect.any(String) });
  expect(habits.find((h) => h.id === "comebacks")).toMatchObject({ done: 1, target: 10, unlockedAt: null });
  expect(habits).toHaveLength(HABITS.length);
});

test("a course milestone unlocks when its nodes pass, and a resident becomes a friend after a completed lesson", async () => {
  storeCourseRewards(db, "tp1", [{ ...wear, key: "core", nodeIds: ["a", "b"], mastery: "exit_passed" }]);
  storeResident(db, "tp1", { name: "Octavia", species: "octopus", bio: "Archivist of the deep.", svg: DRAWING, lines: { greet: ["Hello there"], cheer: ["Well done", "Nice one"], support: ["Try again", "So close"], nudge: ["Come back"] } });
  db.query("UPDATE nodes SET mastery = 'exit_passed' WHERE id = 'a'").run();
  let view = gameView(new Date(), db);
  expect(view.rewards[0]).toMatchObject({ done: 1, total: 2, unlockedAt: null });
  expect(view.rooms[0]).toMatchObject({ topicId: "tp1", passed: 1, total: 4, resident: { befriendedAt: null } });

  db.query("UPDATE nodes SET mastery = 'mastered' WHERE id = 'b'").run();
  const { checkItems } = lessonWithCheck(false);
  for (const id of checkItems) await answer(id, KEY);
  view = gameView(new Date(), db);
  expect(view.rewards[0]!.unlockedAt).not.toBeNull();
  expect(view.rooms[0]!.resident?.befriendedAt).not.toBeNull();
});

test("stage trophies follow the plan's stages and report the stages still without one", () => {
  db.query("INSERT INTO topics (id, slug, title, request, kind) VALUES ('g1', 'g1', 'Goal', 'goal', 'goal')").run();
  expect(storeStageTrophies(db, "g1", [{ ...wear, stage: "Prototype" }], ["Prototype", "Launch"])).toEqual(["Launch"]);
  expect(storeStageTrophies(db, "g1", [], ["Launch"])).toEqual(["Launch"]);
  expect(db.query("SELECT count(*) AS n FROM rewards WHERE topic_id = 'g1'").get()).toEqual({ n: 0 });
});

test("an unlocked reward keeps its drawing when Claude sends the slot again", async () => {
  const { checkItems } = lessonWithCheck(false);
  storeLessonReward(db, "tp1", "ls1", { ...wear, earnedBy: "complete" });
  for (const id of checkItems) await answer(id, KEY);
  gameView(new Date(), db);
  storeLessonReward(db, "tp1", "ls1", { ...wear, name: "Renamed", earnedBy: "complete" });
  expect(gameView(new Date(), db).rewards[0]!.name).toBe("Branch antlers");
});

test("checkDrawing accepts a 100 x 100 drawing and rejects text, scripts and another canvas", () => {
  expect(checkDrawing(DRAWING, "reward")).toEqual([]);
  const rules = (svg: string) => checkDrawing(svg, "reward").map((v) => v.rule);
  expect(rules(DRAWING.replace("0 0 100 100", "0 0 200 100"))).toEqual(["G2"]);
  expect(rules(DRAWING.replace("</svg>", "<text>hat</text></svg>"))).toEqual(["G2"]);
  expect(rules(DRAWING.replace("</svg>", "<script>alert(1)</script></svg>"))).toContain("G2");
});

test("backfill picks the last apply-level practice as the challenge and redraws a drawing that fails G2", async () => {
  insertStep(db, 1, { kind: "practice", title: "Easy", item: items.single("e") });
  insertStep(db, 2, { kind: "practice", title: "Hard", item: items.single("h") });
  insertStep(db, 3, { kind: "check", title: "Check", items: [items.single("c1"), items.single("c2")] });
  db.query("UPDATE lessons SET status = 'finished', outline = ? WHERE id = 'ls1'").run(JSON.stringify([{ kind: "practice", title: "Easy" }]));
  db.query("UPDATE steps SET content = json_set(content, '$.item.bloom', 'remember') WHERE idx = 1").run();
  const resident = { name: "Octavia", species: "octopus", bio: "Archivist of the deep.", svg: DRAWING, lines: { greet: ["Hello there"], cheer: ["Well done", "Nice one"], support: ["Try again", "So close"], nudge: ["Come back"] } };
  const prompts: string[] = [];
  const call: GameRunner = async <T,>(opts: { prompt: string }) => {
    prompts.push(opts.prompt);
    const value = opts.prompt.includes("knowledge graph")
      ? { resident, rewards: [{ ...wear, key: "core", nodeIds: ["a"], mastery: "exit_passed" }, { ...wear, key: "all", nodeIds: ["a", "b"], mastery: "mastered" }] }
      : { reward: { ...wear, earnedBy: "gold", svg: prompts.filter((p) => p.includes("lesson's reward")).length === 1 ? DRAWING.replace("100 100", "50 50") : DRAWING } };
    return { ok: true, value: value as T, costUsd: 0 };
  };
  expect(startBackfill(db, call)).toMatchObject({ running: true, total: 2 });
  while (backfillView(db).running) await Bun.sleep(5);

  expect(db.query("SELECT challenge_idx FROM lessons WHERE id = 'ls1'").get()).toEqual({ challenge_idx: 2 });
  expect(backfillView(db)).toMatchObject({ done: 2, failed: [], missing: 0 });
  expect(db.query("SELECT source, ref FROM rewards ORDER BY source, ref").all()).toEqual([
    { source: "course", ref: "all" },
    { source: "course", ref: "core" },
    { source: "lesson", ref: "ls1" },
  ]);
  expect(prompts.filter((p) => p.includes("lesson's reward"))[1]).toContain("viewBox");
});

test("only the runs that build content get the meerkat's tasks", () => {
  expect(gameInstruction("lesson")).toContain("challenge");
  expect(gameInstruction("onboard")).toContain("resident");
  expect(gameInstruction("goal")).toContain("trophies");
  expect(gameInstruction("tutor")).toBeNull();
  expect(gameInstruction("review")).toBeNull();
});
