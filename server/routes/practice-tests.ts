import type { Database } from "bun:sqlite";
import { Hono } from "hono";
import { z } from "zod";
import {
  FINAL_MIN_QUESTIONS,
  FINAL_PASS_SHARE,
  PRACTICE_LENGTHS,
  PRACTICE_MAX_QUESTIONS,
  PRACTICE_TIME_LIMITS,
  type FinalExamView,
  type PracticeAnswerUpdate,
  type PracticeNodeScore,
  type PracticeQuestion,
  type PracticeTestOverview,
  type PracticeTestRequest,
  type PracticeTestSummary,
  type PracticeTestView,
} from "../../shared/api";
import type { Answer, Item } from "../../shared/schemas";
import { db, newId } from "../db";
import { t } from "../i18n";
import { updateMasteryAfterTestAnswer } from "../review/mastery";
import { assembleTest, eligibleCount, finishedLessons, practisedSince, topicNodes } from "../review/practice-test";
import { correctAnswerText, gradeClosedItem, gradeShort, GradingError, type JsonPromptRunner } from "./grading";
import { fail, readBody } from "./http";
import { AnswerSchema } from "./items";
import { publicItem } from "./public";
import { topicRow } from "./topics";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Answers saved this long after the time is up still count: the browser submits when its countdown ends. */
const GRACE_MS = 5000;
/** Longest stretch on one question that one save adds to the answer time. */
const MAX_SPENT_MS = 10 * 60 * 1000;
const GRADING_CONCURRENCY = 3;
const HISTORY_LIMIT = 30;

type TestRow = { id: string; topic_id: string; kind: PracticeTestSummary["kind"]; status: PracticeTestSummary["status"]; time_limit_min: number | null; created_at: string; submitted_at: string | null };

type QuestionRow = {
  test_id: string;
  idx: number;
  item_id: string;
  topic_id: string;
  lesson_id: string | null;
  node_id: string;
  content: string;
  display_order: string | null;
  answer: string | null;
  answered_at: string | null;
  flagged: number;
  duration_ms: number;
  correct: number | null;
  feedback: string | null;
  grade_error: string | null;
};

type Opts = { database?: Database; at?: Date; runPrompt?: JsonPromptRunner };

function testRow(testId: string, database: Database): TestRow {
  const row = database.query<TestRow, [string]>("SELECT * FROM practice_tests WHERE id = ?").get(testId);
  if (!row) fail(404, "test not found");
  return row;
}

const questionRows = (testId: string, database: Database) =>
  database.query<QuestionRow, [string]>("SELECT * FROM practice_test_items WHERE test_id = ? ORDER BY idx").all(testId);

const endsAt = (t: TestRow): Date | null => (t.time_limit_min ? new Date(Date.parse(t.created_at) + t.time_limit_min * 60_000) : null);

function summary(t: TestRow, database: Database): PracticeTestSummary {
  const counts = database
    .query<{ questions: number; answered: number; correct: number }, [string]>(
      "SELECT count(*) AS questions, count(answer) AS answered, count(*) FILTER (WHERE correct = 1) AS correct FROM practice_test_items WHERE test_id = ?",
    )
    .get(t.id)!;
  return {
    id: t.id,
    topicId: t.topic_id,
    kind: t.kind,
    status: t.status,
    questions: counts.questions,
    answered: counts.answered,
    correct: t.status === "open" ? null : counts.correct,
    createdAt: t.created_at,
    submittedAt: t.submitted_at,
    timeLimitMin: t.time_limit_min,
    endsAt: endsAt(t)?.toISOString() ?? null,
  };
}

// ---------- Grading ----------

const grading = new Map<string, Promise<void>>();

/** The background grading of a submitted test's short answers, while it runs. */
export function gradingOf(testId: string): Promise<void> | undefined {
  return grading.get(testId);
}

function recordGrade(q: QuestionRow, correct: boolean, feedback: string | null, database: Database): void {
  database
    .query("UPDATE practice_test_items SET correct = ?, feedback = ?, grade_error = NULL WHERE test_id = ? AND idx = ?")
    .run(correct ? 1 : 0, feedback, q.test_id, q.idx);
  if (correct) updateMasteryAfterTestAnswer(q.topic_id, q.node_id, new Date(q.answered_at!), database);
}

/** Closes a submitted test once no answer waits for the grader. */
function finishIfGraded(testId: string, database: Database): void {
  database
    .query(
      `UPDATE practice_tests SET status = 'done' WHERE id = ?1 AND status = 'grading'
         AND NOT EXISTS (SELECT 1 FROM practice_test_items WHERE test_id = ?1 AND correct IS NULL AND grade_error IS NULL)`,
    )
    .run(testId);
}

/** Grades the test's ungraded short answers by model, a few at a time; a failed call is kept for a later regrade. */
function gradeShortAnswers(testId: string, database: Database, run?: JsonPromptRunner): Promise<void> {
  const running = grading.get(testId);
  if (running) return running;
  const queue = database
    .query<QuestionRow, [string]>("SELECT * FROM practice_test_items WHERE test_id = ? AND correct IS NULL AND grade_error IS NULL ORDER BY idx")
    .all(testId);
  const worker = async () => {
    for (let q = queue.shift(); q; q = queue.shift()) {
      const item = JSON.parse(q.content) as Item;
      const answer = JSON.parse(q.answer!) as Answer;
      try {
        if (item.format !== "short" || answer.format !== "short") throw new GradingError(t("grading.failed"));
        const grade = await gradeShort(item, answer.text, run);
        recordGrade(q, grade.correct, grade.feedback, database);
      } catch (e) {
        const message = e instanceof GradingError ? e.message : t("grading.failed");
        database.query("UPDATE practice_test_items SET grade_error = ? WHERE test_id = ? AND idx = ?").run(message, q.test_id, q.idx);
      }
    }
  };
  const done = Promise.all(Array.from({ length: GRADING_CONCURRENCY }, worker))
    .then(() => finishIfGraded(testId, database))
    .finally(() => grading.delete(testId));
  grading.set(testId, done);
  return done;
}

/**
 * Grades every closed answer at once and leaves short answers to the background grader. An unanswered question is
 * wrong. Correct answers count as delayed retrievals for L12.
 */
export function submitTest(testId: string, opts: Opts = {}): PracticeTestView {
  const database = opts.database ?? db();
  const at = opts.at ?? new Date();
  const test = testRow(testId, database);
  if (test.status !== "open") return testView(testId, opts);
  database.transaction(() => {
    for (const q of questionRows(testId, database)) {
      if (q.answer === null) {
        recordGrade(q, false, null, database);
        continue;
      }
      const item = JSON.parse(q.content) as Item;
      if (item.format === "short") continue;
      const grade = gradeClosedItem(q, item, JSON.parse(q.answer) as Answer);
      recordGrade(q, grade.correct, grade.feedback, database);
    }
    database.query("UPDATE practice_tests SET status = 'grading', submitted_at = ? WHERE id = ?").run(at.toISOString(), testId);
    finishIfGraded(testId, database);
  })();
  if (testRow(testId, database).status === "grading") void gradeShortAnswers(testId, database, opts.runPrompt);
  return testView(testId, opts);
}

/** Submits an open test whose time is up. */
function expireIfDue(test: TestRow, opts: Opts): void {
  const end = endsAt(test);
  if (test.status === "open" && end && (opts.at ?? new Date()).getTime() > end.getTime() + GRACE_MS) submitTest(test.id, opts);
}

// ---------- Views ----------

function questions(test: TestRow, database: Database): PracticeQuestion[] {
  const node = database.query<{ title: string }, [string, string]>("SELECT title FROM nodes WHERE topic_id = ? AND id = ?");
  const lesson = database.query<{ title: string }, [string]>("SELECT title FROM lessons WHERE id = ?");
  return questionRows(test.id, database).map((q) => {
    const item = JSON.parse(q.content) as Item;
    return {
      idx: q.idx,
      item: publicItem({ id: q.item_id, content: q.content, display_order: q.display_order }),
      answer: q.answer === null ? null : (JSON.parse(q.answer) as Answer),
      flagged: q.flagged === 1,
      result:
        test.status === "open"
          ? null
          : {
              correct: q.correct === null ? null : q.correct === 1,
              gradingFailed: q.grade_error !== null,
              feedback: q.feedback,
              correctAnswer: correctAnswerText(item),
              solution: item.solution,
              topicId: q.topic_id,
              nodeId: q.node_id,
              nodeTitle: node.get(q.topic_id, q.node_id)?.title ?? q.node_id,
              lessonId: q.lesson_id,
              lessonTitle: q.lesson_id ? (lesson.get(q.lesson_id)?.title ?? null) : null,
            },
    };
  });
}

function breakdown(qs: PracticeQuestion[], database: Database): PracticeNodeScore[] {
  const topicTitle = database.query<{ title: string }, [string]>("SELECT title FROM topics WHERE id = ?");
  const byNode = new Map<string, PracticeNodeScore>();
  for (const { result: r } of qs) {
    if (!r) continue;
    const key = `${r.topicId}/${r.nodeId}`;
    let score = byNode.get(key);
    if (!score) {
      score = { topicId: r.topicId, topicTitle: topicTitle.get(r.topicId)?.title ?? "", nodeId: r.nodeId, title: r.nodeTitle, correct: 0, total: 0, lessons: [] };
      byNode.set(key, score);
    }
    score.total++;
    if (r.correct === true) score.correct++;
    if (r.lessonId && !score.lessons.some((l) => l.id === r.lessonId)) score.lessons.push({ id: r.lessonId, title: r.lessonTitle ?? "" });
  }
  return [...byNode.values()].sort((a, b) => a.correct / a.total - b.correct / b.total || a.title.localeCompare(b.title));
}

export function testView(testId: string, opts: Opts = {}): PracticeTestView {
  const database = opts.database ?? db();
  expireIfDue(testRow(testId, database), opts);
  const test = testRow(testId, database);
  if (test.status === "grading" && !grading.has(test.id)) void gradeShortAnswers(test.id, database, opts.runPrompt);
  const scope = database.query<{ id: string; title: string; kind: "topic" | "goal" }, [string]>("SELECT id, title, kind FROM topics WHERE id = ?").get(test.topic_id)!;
  const qs = questions(test, database);
  const missed = qs.some((q) => q.result?.correct === false);
  return {
    test: summary(test, database),
    scope,
    questions: qs,
    breakdown: breakdown(qs, database),
    reviewFrom: test.submitted_at && missed ? new Date(Date.parse(test.submitted_at) + DAY_MS).toISOString() : null,
  };
}

export function overview(scopeId: string, opts: Opts = {}): PracticeTestOverview {
  const database = opts.database ?? db();
  const tests = () => database.query<TestRow, [string]>("SELECT * FROM practice_tests WHERE topic_id = ? ORDER BY created_at DESC, rowid DESC").all(scopeId);
  for (const test of tests()) expireIfDue(test, opts);
  const all = tests();
  const open = all.find((x) => x.status === "open");
  return {
    eligible: eligibleCount(scopeId, database),
    lessonsFinished: finishedLessons(scopeId, database).length,
    open: open ? summary(open, database) : null,
    history: all
      .filter((x) => x.status !== "open")
      .slice(0, HISTORY_LIMIT)
      .map((x) => summary(x, database)),
  };
}

// ---------- Taking a test ----------

function createTest(scopeId: string, picked: ReturnType<typeof assembleTest>, timeLimitMin: number | null, kind: PracticeTestSummary["kind"], opts: Opts): PracticeTestView {
  const database = opts.database ?? db();
  const at = opts.at ?? new Date();
  const testId = newId("pt");
  database.transaction(() => {
    database
      .query("INSERT INTO practice_tests (id, topic_id, kind, time_limit_min, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(testId, scopeId, kind, timeLimitMin, at.toISOString());
    const insert = database.query(
      `INSERT INTO practice_test_items (test_id, idx, item_id, topic_id, lesson_id, node_id, content, display_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    picked.forEach((r, idx) => insert.run(testId, idx, r.id, r.topic_id, r.lesson_id, r.node_id, r.content, r.display_order));
  })();
  return testView(testId, opts);
}

export function startTest(scopeId: string, req: PracticeTestRequest, opts: Opts & { random?: () => number } = {}): PracticeTestView {
  const database = opts.database ?? db();
  if (overview(scopeId, opts).open) fail(409, t("practice.openExists"));
  const length = req.length === "all" ? PRACTICE_MAX_QUESTIONS : req.length;
  const picked = assembleTest(scopeId, length, database, opts.random);
  if (picked.length === 0) fail(409, t("practice.nothingEligible"));
  return createTest(scopeId, picked, req.timeLimitMin, "practice", opts);
}

// ---------- Final exam (L21) ----------

const share = (x: PracticeTestSummary) => (x.questions ? (x.correct ?? 0) / x.questions : 0);

export function finalView(topicId: string, opts: Opts = {}): FinalExamView {
  const database = opts.database ?? db();
  const { open } = overview(topicId, opts);
  const nodes = topicNodes(topicId, database);
  const finals = database
    .query<TestRow, [string]>("SELECT * FROM practice_tests WHERE topic_id = ? AND kind = 'final' AND status != 'open' ORDER BY created_at DESC, rowid DESC")
    .all(topicId)
    .map((x) => ({ row: x, summary: summary(x, database) }));
  const graded = finals.filter((f) => f.row.status === "done");
  const best = graded.reduce<(typeof graded)[number] | null>((b, f) => (!b || share(f.summary) > share(b.summary) ? f : b), null);
  const latest = finals[0] ?? null;
  const weakNodes =
    latest?.row.status === "done"
      ? breakdown(questions(latest.row, database), database)
          .filter((n) => n.correct / n.total < FINAL_PASS_SHARE)
          .map((n) => ({
            nodeId: n.nodeId,
            title: n.title,
            lessonId: n.lessons[0]?.id ?? null,
            practised: practisedSince(topicId, n.nodeId, latest.row.submitted_at!, database),
          }))
      : [];
  const complete = nodes.total > 0 && nodes.passed === nodes.total;
  const questionCount = Math.min(eligibleCount(topicId, database), Math.max(FINAL_MIN_QUESTIONS, nodes.total), PRACTICE_MAX_QUESTIONS);
  return {
    nodesPassed: nodes.passed,
    nodesTotal: nodes.total,
    questions: questionCount,
    open,
    best: best?.summary ?? null,
    latest: latest?.summary ?? null,
    passed: !!best && share(best.summary) >= FINAL_PASS_SHARE,
    weakNodes,
    canStart: complete && !open && questionCount > 0 && latest?.row.status !== "grading" && weakNodes.every((n) => n.practised),
  };
}

/** Starts the topic's final: every node is covered before a weak node gets more questions; untimed. */
export function startFinal(topicId: string, opts: Opts & { random?: () => number } = {}): PracticeTestView {
  const database = opts.database ?? db();
  const view = finalView(topicId, opts);
  if (!view.canStart) fail(409, t(view.open ? "practice.openExists" : "final.notReady"));
  return createTest(topicId, assembleTest(topicId, view.questions, database, opts.random), null, "final", opts);
}

export function saveAnswer(testId: string, idx: number, update: PracticeAnswerUpdate, opts: Opts = {}): void {
  const database = opts.database ?? db();
  const at = opts.at ?? new Date();
  const test = testRow(testId, database);
  expireIfDue(test, opts);
  if (testRow(testId, database).status !== "open") fail(409, t(test.status === "open" ? "practice.timeUp" : "practice.submitted"));
  const q = database.query<QuestionRow, [string, number]>("SELECT * FROM practice_test_items WHERE test_id = ? AND idx = ?").get(testId, idx);
  if (!q) fail(404, "question not found");
  if (update.answer) {
    const item = JSON.parse(q.content) as Item;
    if (update.answer.format !== item.format) fail(400, `answer format ${update.answer.format} does not match item format ${item.format}`);
    if (item.format !== "short") {
      try {
        gradeClosedItem(q, item, update.answer);
      } catch (e) {
        if (e instanceof GradingError) fail(400, e.message);
        throw e;
      }
    }
  }
  database
    .query(
      `UPDATE practice_test_items SET
         answer = CASE WHEN ?1 THEN ?2 ELSE answer END,
         answered_at = CASE WHEN ?1 THEN ?3 ELSE answered_at END,
         flagged = coalesce(?4, flagged),
         duration_ms = duration_ms + ?5
       WHERE test_id = ?6 AND idx = ?7`,
    )
    .run(
      update.answer !== undefined ? 1 : 0,
      update.answer ? JSON.stringify(update.answer) : null,
      update.answer ? at.toISOString() : null,
      update.flagged === undefined ? null : update.flagged ? 1 : 0,
      Math.round(Math.min(Math.max(update.spentMs ?? 0, 0), MAX_SPENT_MS)),
      testId,
      idx,
    );
}

/** Grades again the answers whose grading failed. */
export function regradeTest(testId: string, opts: Opts = {}): PracticeTestView {
  const database = opts.database ?? db();
  const test = testRow(testId, database);
  if (test.status !== "done") fail(409, t("practice.notGraded"));
  const { changes } = database
    .query("UPDATE practice_test_items SET grade_error = NULL WHERE test_id = ? AND grade_error IS NOT NULL")
    .run(testId);
  if (changes === 0) fail(409, t("practice.notGraded"));
  database.query("UPDATE practice_tests SET status = 'grading' WHERE id = ?").run(testId);
  void gradeShortAnswers(testId, database, opts.runPrompt);
  return testView(testId, opts);
}

export function discardTest(testId: string, database: Database = db()): void {
  if (testRow(testId, database).status !== "open") fail(409, t("practice.submitted"));
  database.query("DELETE FROM practice_tests WHERE id = ?").run(testId);
}

// ---------- Routes ----------

const RequestSchema = z.object({
  length: z.union([z.literal("all"), ...PRACTICE_LENGTHS.map((n) => z.literal(n))]),
  timeLimitMin: z.union([z.null(), ...PRACTICE_TIME_LIMITS.map((n) => z.literal(n))]).default(null),
});

const UpdateSchema = z.object({
  answer: AnswerSchema.nullable().optional(),
  flagged: z.boolean().optional(),
  spentMs: z.number().min(0).optional(),
});

export const practiceTests = new Hono();

practiceTests.get("/topics/:topicId/tests", (c) => c.json(overview(topicRow(c.req.param("topicId")).id) satisfies PracticeTestOverview));

practiceTests.post("/topics/:topicId/tests", async (c) => {
  const topic = topicRow(c.req.param("topicId"));
  const req = await readBody(c, RequestSchema);
  return c.json(startTest(topic.id, req as PracticeTestRequest) satisfies PracticeTestView, 201);
});

/** A final belongs to a topic; a goal has none. */
function finalTopic(topicId: string): string {
  const topic = topicRow(topicId);
  if (topic.kind !== "topic") fail(404, "a goal has no final exam");
  return topic.id;
}

practiceTests.get("/topics/:topicId/final", (c) => c.json(finalView(finalTopic(c.req.param("topicId"))) satisfies FinalExamView));

practiceTests.post("/topics/:topicId/final", (c) => c.json(startFinal(finalTopic(c.req.param("topicId"))) satisfies PracticeTestView, 201));

practiceTests.get("/tests/:testId", (c) => c.json(testView(c.req.param("testId")) satisfies PracticeTestView));

practiceTests.patch("/tests/:testId/questions/:idx", async (c) => {
  const update = await readBody(c, UpdateSchema);
  saveAnswer(c.req.param("testId"), Number(c.req.param("idx")), update);
  return c.body(null, 204);
});

practiceTests.post("/tests/:testId/submit", (c) => c.json(submitTest(c.req.param("testId")) satisfies PracticeTestView));

practiceTests.post("/tests/:testId/regrade", (c) => c.json(regradeTest(c.req.param("testId")) satisfies PracticeTestView));

practiceTests.delete("/tests/:testId", (c) => {
  discardTest(c.req.param("testId"));
  return c.body(null, 204);
});
