import { beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { HTTPException } from "hono/http-exception";
import type { Answer } from "../../shared/schemas";
import { openDb } from "../db";
import { bestFinalShare } from "../review/practice-test";
import { reviewSession } from "../review/session";
import { submitAttempt, type JsonPromptRunner } from "./grading";
import { learnerStatus } from "./lesson-summary";
import { discardTest, finalView, gradingOf, overview, regradeTest, saveAnswer, startFinal, startTest, submitTest, testView } from "./practice-tests";
import { activity } from "./stats";
import { insertItem, insertStep, items, seed } from "./test-fixtures";

const DAY = 24 * 60 * 60 * 1000;
const T0 = new Date("2026-01-10T10:00:00.000Z");
const later = (ms: number) => new Date(T0.getTime() + ms);

let database: Database;
beforeEach(() => {
  database = openDb(":memory:");
  seed(database);
});

const fakeRunner =
  (met: boolean[] | null): JsonPromptRunner =>
  async <T>() =>
    (met ? { ok: true, value: { met } as T, costUsd: 0 } : { ok: false, error: "boom" }) as never;

function statusOf(fn: () => unknown): number | null {
  try {
    fn();
    return null;
  } catch (e) {
    if (e instanceof HTTPException) return e.status;
    throw e;
  }
}

/** Lesson ls1 with an exit check on node a, answered in full at T0, and a practice item; returns the item ids. */
function finishedLesson(): { checks: string[]; practice: string } {
  const { itemIds } = insertStep(database, 9, { kind: "check", title: "Final check", items: [items.single("c1"), items.number("c2")] });
  for (const id of itemIds) {
    database
      .query("INSERT INTO attempts (id, item_id, answer, correct, context, created_at) VALUES (?, ?, '{}', 1, 'check', ?)")
      .run(crypto.randomUUID(), id, T0.toISOString());
  }
  const practice = insertItem(database, items.short("p"), { role: "practice", lessonId: "ls1" });
  return { checks: itemIds, practice };
}

const start = (at = later(DAY), timeLimitMin: 10 | null = null) => startTest("tp1", { length: 10, timeLimitMin }, { database, at, random: () => 0.5 });
/** Fixture items show options reversed: display 2 is the key of a three-option single. */
const RIGHT = { single: { format: "single", choice: 2 }, number: { format: "number", value: 9137.25 } } satisfies Record<string, Answer>;
const WRONG = { single: { format: "single", choice: 0 }, number: { format: "number", value: 1 } } satisfies Record<string, Answer>;

describe("practice tests", () => {
  test("an open test's browser view carries no keys, solutions or results (L7, L11)", () => {
    finishedLesson();
    const view = start();
    expect(view.questions).toHaveLength(3);
    expect(JSON.stringify(view)).not.toContain("SECRET");
    expect(view.questions.every((q) => q.result === null)).toBe(true);
    expect(view.breakdown).toEqual([]);
  });

  test("answers and flags persist until submission; grading keeps attempts, first tries and exit checks untouched", async () => {
    finishedLesson();
    const before = database.query<{ n: number }, []>("SELECT count(*) AS n FROM attempts").get()!.n;
    const view = start();
    const byFormat = (f: string) => view.questions.find((q) => q.item.format === f)!;
    saveAnswer(view.test.id, byFormat("single").idx, { answer: RIGHT.single, spentMs: 4000 }, { database, at: later(DAY) });
    saveAnswer(view.test.id, byFormat("number").idx, { answer: WRONG.number, flagged: true }, { database, at: later(DAY) });

    const resumed = testView(view.test.id, { database, at: later(DAY) });
    expect(resumed.test).toMatchObject({ status: "open", answered: 2, correct: null });
    expect(byFormatOf(resumed, "number")).toMatchObject({ answer: WRONG.number, flagged: true, result: null });

    const done = submitTest(view.test.id, { database, at: later(DAY), runPrompt: fakeRunner([true, true]) });
    expect(done.test).toMatchObject({ status: "done", correct: 1 });
    expect(byFormatOf(done, "single").result).toMatchObject({ correct: true, feedback: "SECRET-FB0-c1", solution: "SECRET-SOL-c1", correctAnswer: "key c1" });
    expect(byFormatOf(done, "number").result).toMatchObject({ correct: false, correctAnswer: "9137.25 ± 0.5 kg" });
    expect(byFormatOf(done, "short").result).toMatchObject({ correct: false, nodeTitle: "Node A", lessonId: "ls1" });
    expect(done.breakdown).toEqual([{ topicId: "tp1", topicTitle: "Topic", nodeId: "a", title: "Node A", correct: 1, total: 3, lessons: [{ id: "ls1", title: "Lesson" }] }]);
    expect(done.reviewFrom).toBe(later(2 * DAY).toISOString());

    expect(database.query<{ n: number }, []>("SELECT count(*) AS n FROM attempts").get()!.n).toBe(before);
    expect(database.query<{ n: number }, []>("SELECT count(*) AS n FROM regen_queue").get()!.n).toBe(0);
    expect(learnerStatus("ls1", database)).toBe("completed");
    expect(statusOf(() => saveAnswer(view.test.id, 0, { flagged: false }, { database }))).toBe(409);
  });

  test("an answer of another format or out of range is refused", () => {
    finishedLesson();
    const view = start();
    const single = view.questions.find((q) => q.item.format === "single")!.idx;
    expect(statusOf(() => saveAnswer(view.test.id, single, { answer: { format: "number", value: 1 } }, { database }))).toBe(400);
    expect(statusOf(() => saveAnswer(view.test.id, single, { answer: { format: "single", choice: 7 } }, { database }))).toBe(400);
  });

  test("short answers are graded in the background; a failed grading can run again", async () => {
    finishedLesson();
    const view = start();
    const short = view.questions.find((q) => q.item.format === "short")!.idx;
    saveAnswer(view.test.id, short, { answer: { format: "short", text: "my answer" } }, { database });

    const submitted = submitTest(view.test.id, { database, at: later(DAY), runPrompt: fakeRunner(null) });
    expect(submitted.test.status).toBe("grading");
    expect(submitted.questions[short]!.result).toMatchObject({ correct: null, gradingFailed: false });
    await gradingOf(view.test.id);
    const failed = testView(view.test.id, { database });
    expect(failed.test.status).toBe("done");
    expect(failed.questions[short]!.result).toMatchObject({ correct: null, gradingFailed: true });

    regradeTest(view.test.id, { database, runPrompt: fakeRunner([true, true]) });
    await gradingOf(view.test.id);
    expect(testView(view.test.id, { database }).questions[short]!.result).toMatchObject({ correct: true, gradingFailed: false });
  });

  test("a timed test closes when its time is up and is submitted on the next read", () => {
    finishedLesson();
    const view = start(later(DAY), 10);
    expect(view.test.endsAt).toBe(later(DAY + 10 * 60_000).toISOString());
    expect(statusOf(() => saveAnswer(view.test.id, 0, { flagged: true }, { database, at: later(DAY + 9 * 60_000) }))).toBeNull();
    expect(statusOf(() => saveAnswer(view.test.id, 0, { flagged: true }, { database, at: later(DAY + 11 * 60_000) }))).toBe(409);
    expect(testView(view.test.id, { database }).test.status).not.toBe("open");
  });

  test("one open test per topic; discarding removes it, and history lists submitted tests only", () => {
    expect(statusOf(() => start())).toBe(409);
    finishedLesson();
    const first = start();
    expect(statusOf(() => start())).toBe(409);
    discardTest(first.test.id, database);
    const second = start();
    submitTest(second.test.id, { database, runPrompt: fakeRunner([true, true]) });
    const o = overview("tp1", { database });
    expect(o).toMatchObject({ eligible: 3, lessonsFinished: 1, open: null });
    expect(o.history.map((h) => h.id)).toEqual([second.test.id]);
  });
});

function byFormatOf(view: ReturnType<typeof testView>, format: string) {
  return view.questions.find((q) => q.item.format === format)!;
}

describe("practice tests and L12 mastery", () => {
  const mastery = () => database.query<{ mastery: string }, []>("SELECT mastery FROM nodes WHERE topic_id = 'tp1' AND id = 'a'").get()!.mastery;
  const exitPassed = () => database.query("UPDATE nodes SET mastery = 'exit_passed', exit_passed_at = ? WHERE topic_id = 'tp1' AND id = 'a'").run(T0.toISOString());

  function answerSingleRight(at: Date) {
    const view = startTest("tp1", { length: 10, timeLimitMin: null }, { database, at });
    const single = view.questions.find((q) => q.item.format === "single")!.idx;
    saveAnswer(view.test.id, single, { answer: RIGHT.single }, { database, at });
    submitTest(view.test.id, { database, at, runPrompt: fakeRunner([true, true]) });
  }

  test("a correct test answer a day after the exit check is the delayed retrieval that masters the node", () => {
    finishedLesson();
    exitPassed();
    answerSingleRight(later(DAY + 60_000));
    expect(mastery()).toBe("mastered");
  });

  test("a correct test answer within a day of the exit check does not", () => {
    finishedLesson();
    exitPassed();
    answerSingleRight(later(2 * 60 * 60 * 1000));
    expect(mastery()).toBe("exit_passed");
  });

  test("test answers never pass an exit check", () => {
    finishedLesson();
    database.query("UPDATE nodes SET mastery = 'learning' WHERE topic_id = 'tp1' AND id = 'a'").run();
    answerSingleRight(later(DAY));
    expect(mastery()).toBe("learning");
  });
});

describe("missed questions and activity", () => {
  test("a missed question comes back in Review a day after the test, until a review attempt answers it", async () => {
    const { checks } = finishedLesson();
    const view = start(later(DAY));
    const single = view.questions.find((q) => q.item.format === "single")!;
    saveAnswer(view.test.id, single.idx, { answer: WRONG.single, spentMs: 30_000 }, { database, at: later(DAY) });
    submitTest(view.test.id, { database, at: later(DAY), runPrompt: fakeRunner([true, true]) });
    const missedId = checks[0]!;

    expect(reviewSession("tp1", later(DAY + 60 * 60 * 1000), database).items.map((i) => i.id)).not.toContain(missedId);
    expect(reviewSession("tp1", later(2 * DAY + 1), database).items.map((i) => i.id)).toContain(missedId);

    await submitAttempt(missedId, { answer: RIGHT.single, hintsUsed: 0, durationMs: 5000, context: "review" }, { database, at: later(2 * DAY + 2) });
    expect(reviewSession("tp1", later(2 * DAY + 3), database).items.map((i) => i.id)).not.toContain(missedId);
  });

  test("answers of submitted tests count as activity; an open test does not yet", () => {
    finishedLesson();
    const view = start(later(DAY));
    const single = view.questions.find((q) => q.item.format === "single")!.idx;
    saveAnswer(view.test.id, single, { answer: WRONG.single, spentMs: 60_000 }, { database, at: later(DAY) });
    const day = () => activity(1, "tp1", later(DAY), database)[0]!;
    expect(day().attempts).toBe(0);
    submitTest(view.test.id, { database, at: later(DAY), runPrompt: fakeRunner([true, true]) });
    expect(day()).toMatchObject({ attempts: 1, minutes: 1 });
  });
});

describe("final exam (L21)", () => {
  const passAllNodes = () => database.query("UPDATE nodes SET mastery = 'exit_passed', exit_passed_at = ? WHERE topic_id = 'tp1'").run(T0.toISOString());
  const final = (at: Date) => startFinal("tp1", { database, at, random: () => 0.5 });

  /** Takes a final with every closed answer right or wrong; the short answer is graded as `right` too. */
  async function takeFinal(at: Date, right: boolean) {
    const view = final(at);
    for (const q of view.questions) {
      const answer = q.item.format === "short" ? { format: "short", text: "answer" } : right ? RIGHT[q.item.format as "single" | "number"] : WRONG[q.item.format as "single" | "number"];
      saveAnswer(view.test.id, q.idx, { answer: answer as Answer }, { database, at });
    }
    submitTest(view.test.id, { database, at, runPrompt: fakeRunner(right ? [true, true] : [false, false]) });
    await gradingOf(view.test.id);
    return view.test.id;
  }

  test("stays locked until every node of the topic passed its exit check", () => {
    finishedLesson();
    expect(finalView("tp1", { database })).toMatchObject({ nodesPassed: 0, nodesTotal: 4, canStart: false });
    expect(statusOf(() => final(later(DAY)))).toBe(409);
    passAllNodes();
    expect(finalView("tp1", { database })).toMatchObject({ nodesPassed: 4, questions: 3, canStart: true, passed: false });
  });

  test("a final is a test of its own kind that shares the one open slot with practice tests", () => {
    finishedLesson();
    passAllNodes();
    const view = final(later(DAY));
    expect(view.test).toMatchObject({ kind: "final", timeLimitMin: null, questions: 3 });
    expect(finalView("tp1", { database }).open?.id).toBe(view.test.id);
    expect(statusOf(() => start())).toBe(409);
    expect(statusOf(() => final(later(DAY)))).toBe(409);
  });

  test("a failed final waits until each weak node is practised again after it", async () => {
    const { checks } = finishedLesson();
    passAllNodes();
    await takeFinal(later(DAY), false);
    const failed = finalView("tp1", { database });
    expect(failed).toMatchObject({ passed: false, canStart: false, weakNodes: [{ nodeId: "a", lessonId: "ls1", practised: false }] });
    expect(bestFinalShare("tp1", database)).toBe(0);

    database
      .query("INSERT INTO attempts (id, item_id, answer, correct, context, created_at) VALUES (?, ?, '{}', 1, 'review', ?)")
      .run(crypto.randomUUID(), checks[0]!, later(DAY + 60_000).toISOString());
    expect(finalView("tp1", { database })).toMatchObject({ canStart: true, weakNodes: [{ nodeId: "a", practised: true }] });
  });

  test("a passed final keeps its best score and can be taken again at once", async () => {
    finishedLesson();
    passAllNodes();
    await takeFinal(later(DAY), true);
    expect(finalView("tp1", { database })).toMatchObject({ passed: true, canStart: true, weakNodes: [] });
    expect(bestFinalShare("tp1", database)).toBe(1);
    await takeFinal(later(DAY + 60_000), false);
    expect(finalView("tp1", { database })).toMatchObject({ passed: true, best: { correct: 3 } });
    expect(bestFinalShare("tp1", database)).toBe(1);
  });
});
