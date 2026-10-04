import { CLAUDE_ROLES, type Effort, type ExplainLens, FINAL_PASS_SHARE, lensesFor, MATERIAL_EXTENSIONS } from "@shared/api";
import type { AttemptRequest, AttemptResponse, ChatMessage, FinalExamView, ItemState, LessonView, MaterialView, MistakesView, NarrationView, NoteRequest, PastedMaterial, PracticeAnswerUpdate, PracticeNodeScore, PracticeResults, PracticeScope, PracticeTestOverview, PracticeTestRequest, PracticeTestSummary, PracticeTestView, RetryRequest, RetryResponse, ReviewSession, Settings, SettingsUpdate, TodayView, TopicDetail, TopicSummary, VideoExportView, VideoView, VoiceView } from "@shared/api";
import type { TopicEvent } from "@shared/events";
import type { OutfitRef, OutfitSlot } from "@shared/game";
import type { Answer, PracticeFocus, PublicStep } from "@shared/schemas";
import { marked } from "marked";
import { lang, t } from "../lib/i18n";
import * as fx from "./fixtures";
import { mockBackfill, mockCrowns, mockGameOn, mockGameView, mockIntroSeen, mockSeen, mockWear, setMockGameOn, setMockIntroSeen, startMockBackfill } from "./game";
import * as sim from "./sim";

// Dev-only stand-in for the server: answers /api/* from fixtures and drives the topic
// event streams so the UI can be exercised without Claude.

class MockEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  readonly url: string;
  readyState = 0;
  onopen: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  private entry: { topicId: string; emit: (e: TopicEvent) => void };
  constructor(url: string) {
    this.url = url;
    const topicId = decodeURIComponent(url.match(/\/api\/topics\/([^/]+)\/stream/)?.[1] ?? "");
    this.entry = { topicId, emit: (e) => this.readyState === 1 && this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(e) })) };
    sim.listeners.add(this.entry);
    setTimeout(() => {
      if (this.readyState === 2) return;
      this.readyState = 1;
      this.onopen?.(new Event("open"));
      sim.onStreamOpen(topicId);
    }, 60);
  }
  addEventListener() {}
  removeEventListener() {}
  close() {
    this.readyState = 2;
    sim.listeners.delete(this.entry);
  }
}

const createdTopics: Record<string, TopicSummary> = {};
const openLinesAsked = new Set<string>();
let seq = 0;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const lessonState = sim.lessonState;
const emit = sim.emit;

// ---------- Grading ----------

function stateOf(itemId: string): ItemState {
  return (fx.itemStates[itemId] ??= { attempts: 0, wrongAttempts: 0, solved: false, gaveUp: false, hints: [], lastFeedback: null, lastConfidence: null });
}

function check(key: fx.Key, a: Answer): { correct: boolean; feedback: string; marks?: boolean[] } {
  let correct = false;
  let feedback = key.feedback ?? "";
  let marks: boolean[] | undefined;
  switch (a.format) {
    case "single":
      correct = a.choice === key.correct;
      feedback = key.optionFeedback?.[a.choice] ?? feedback;
      break;
    case "multi":
      correct = JSON.stringify(a.choices) === JSON.stringify(key.correct);
      break;
    case "order":
      correct = JSON.stringify(a.sequence) === JSON.stringify(key.correct);
      break;
    case "match":
    case "sort": {
      const picks = a.format === "match" ? a.pairs : a.categories;
      marks = picks.map((p, i) => p === (key.correct as number[])[i]);
      correct = marks.every(Boolean);
      if (!correct) {
        const lines = marks.flatMap((m, i) => (m || !key.placementFeedback?.[i] ? [] : [`- ${key.placementFeedback[i]}`]));
        feedback = [t("grading.placedRight", { right: marks.filter(Boolean).length, total: marks.length }), lines.join("\n")].filter(Boolean).join("\n\n");
      }
      break;
    }
    case "cloze":
      correct = a.blanks.every((b, i) => (key.correct as string[][])[i]?.some((x) => x.toLowerCase() === b.toLowerCase()));
      break;
    case "number":
      correct = Math.abs(a.value - (key.correct as number)) <= (key.tolerance ?? 0);
      break;
    case "short":
      // The server grades short answers against the rubric; the mock accepts answers naming both groups.
      correct = (key.accept ?? /among/i).test(a.text) && a.text.length >= 20;
      feedback = correct ? "The answer covers the reference criteria." : "The key point is missing: which group the share is computed in.";
      break;
  }
  return { correct, feedback, marks };
}

function grade(itemId: string, body: AttemptRequest): AttemptResponse {
  const key = fx.keys[itemId];
  const st = stateOf(itemId);
  st.attempts++;
  const attemptNo = st.attempts;
  if (!key) return { correct: null, confidence: null, feedback: "No answer key in the mock data.", attemptNo, offerTutor: false };
  const { correct, feedback: given, marks } = check(key, body.answer);
  let feedback = given;
  st.lastFeedback = feedback;
  if (body.context === "activate") {
    st.solution = key.solution;
    st.correctAnswer = key.correctAnswer;
    st.lastConfidence = null;
    return { correct: null, confidence: null, feedback, marks, solution: key.solution, correctAnswer: key.correctAnswer, attemptNo, offerTutor: false };
  }
  const confidence = body.confidence ?? null;
  st.lastConfidence = confidence;
  if (confidence) {
    for (const levels of [fx.calibration.overall, fx.calibration.topics[0]!.levels]) {
      const level = levels.find((l) => l.confidence === confidence)!;
      level.attempts++;
      if (correct) level.correct++;
    }
  }
  if (correct) {
    st.solved = true;
    st.solution = key.solution;
    st.correctAnswer = key.correctAnswer;
    if (!feedback) feedback = "Correct.";
  } else {
    st.wrongAttempts++;
  }
  return {
    correct,
    confidence,
    feedback,
    marks,
    solution: correct ? key.solution : undefined,
    correctAnswer: correct ? key.correctAnswer : undefined,
    attemptNo,
    offerTutor: !correct && !st.solved && st.wrongAttempts >= 2 && (body.context === "practice" || body.context === "explain"),
  };
}

// ---------- Mistakes notebook ----------

const DAY_MS = 24 * 60 * 60 * 1000;

function mistakesView(): MistakesView {
  const open = new Set(fx.mistakes.filter((e) => !e.resolvedAt).map((e) => e.itemId));
  return { entries: fx.mistakes, patterns: fx.mistakePatterns.filter((p) => open.has(p.itemId)) };
}

function mistakeCounts(): TodayView["mistakes"] {
  const open = fx.mistakes.filter((e) => !e.resolvedAt);
  return { open: open.length, ready: open.filter((e) => Date.parse(e.readyAt) <= Date.now()).length };
}

/** The server's rule (L20): a correct retry resolves the entry from a day after its latest error; a wrong one restarts the day. */
function retry(itemId: string, body: RetryRequest): RetryResponse | null {
  const entry = fx.mistakes.find((e) => e.itemId === itemId);
  const key = fx.keys[itemId];
  if (!entry || !key) return null;
  const { correct, feedback } = check(key, body.answer);
  const now = new Date();
  const next = { ...entry, retries: entry.retries + 1 };
  if (!correct) Object.assign(next, { readyAt: new Date(now.getTime() + DAY_MS).toISOString(), resolvedAt: null });
  else if (!entry.resolvedAt && Date.parse(entry.readyAt) <= now.getTime()) next.resolvedAt = now.toISOString();
  fx.mistakes.splice(fx.mistakes.indexOf(entry), 1, next);
  return { correct, feedback: feedback || t(correct ? "grading.right" : "grading.retryWrong"), solution: key.solution, correctAnswer: key.correctAnswer, entry: next };
}

// ---------- Practice tests ----------

type MockTest = { view: PracticeTestView; sources: fx.PracticeSource[] };
const practiceTests: Record<string, MockTest> = {};
const PRACTICE_GRADING_MS = 2500;

/** Round-robin over the nodes, each node's items shuffled. */
function pickPractice(pool: fx.PracticeSource[], n: number): fx.PracticeSource[] {
  const byNode = new Map<string, fx.PracticeSource[]>();
  for (const src of [...pool].sort(() => Math.random() - 0.5)) byNode.set(src.nodeId, [...(byNode.get(src.nodeId) ?? []), src]);
  const lists = [...byNode.values()];
  const out: fx.PracticeSource[] = [];
  for (let i = 0; out.length < Math.min(n, pool.length); i++) for (const l of lists) if (l[i] && out.length < n) out.push(l[i]!);
  return out;
}

function refreshPractice(test: MockTest): PracticeTestView {
  const v = test.view;
  const qs = v.questions;
  v.test.answered = qs.filter((q) => q.answer).length;
  v.test.correct = v.test.status === "open" ? null : qs.filter((q) => q.result?.correct === true).length;
  const scores = new Map<string, PracticeNodeScore>();
  for (const q of qs) {
    const r = q.result;
    if (!r) continue;
    const score = scores.get(r.nodeId) ?? { topicId: r.topicId, topicTitle: v.scope.title, nodeId: r.nodeId, title: r.nodeTitle, correct: 0, total: 0, lessons: [] };
    scores.set(r.nodeId, score);
    score.total++;
    if (r.correct === true) score.correct++;
    if (r.lessonId && !score.lessons.some((l) => l.id === r.lessonId)) score.lessons.push({ id: r.lessonId, title: r.lessonTitle ?? "" });
  }
  v.breakdown = [...scores.values()].sort((a, b) => a.correct / a.total - b.correct / b.total);
  v.reviewFrom = v.test.submittedAt && qs.some((q) => q.result?.correct === false) ? new Date(Date.parse(v.test.submittedAt) + DAY_MS).toISOString() : null;
  return v;
}

function startPractice(topicId: string, req: PracticeTestRequest, createdAt = new Date(), kind: PracticeTestSummary["kind"] = "practice"): MockTest {
  const detail = fx.topicDetails[topicId]!;
  const pool = topicId === "t-bayes" ? fx.practicePool : [];
  const picked = pickPractice(pool, req.length === "all" ? pool.length : req.length);
  const id = `pt-${++seq}`;
  const test: MockTest = {
    sources: picked,
    view: {
      test: {
        id,
        topicId,
        kind,
        status: "open",
        questions: picked.length,
        answered: 0,
        correct: null,
        createdAt: createdAt.toISOString(),
        submittedAt: null,
        timeLimitMin: req.timeLimitMin,
        endsAt: req.timeLimitMin ? new Date(createdAt.getTime() + req.timeLimitMin * 60_000).toISOString() : null,
      },
      scope: { id: topicId, title: detail.topic.title, kind: detail.topic.kind },
      questions: picked.map((src, idx) => ({ idx, item: src.item, answer: null, flagged: false, result: null })),
      breakdown: [],
      reviewFrom: null,
    },
  };
  practiceTests[id] = test;
  return test;
}

function submitPractice(test: MockTest, at = new Date(), gradingMs = PRACTICE_GRADING_MS): void {
  const v = test.view;
  const detail = fx.topicDetails[v.scope.id]!;
  const pending: number[] = [];
  for (const q of v.questions) {
    const src = test.sources[q.idx]!;
    const key = fx.keys[q.item.id]!;
    const graded = q.answer && q.item.format !== "short" ? check(key, q.answer) : null;
    if (q.answer && q.item.format === "short") pending.push(q.idx);
    const lesson = detail.lessons.find((l) => l.id === src.lessonId);
    q.result = {
      correct: q.answer ? (graded?.correct ?? null) : false,
      gradingFailed: false,
      feedback: graded && q.item.format === "single" ? graded.feedback : null,
      correctAnswer: key.correctAnswer,
      solution: key.solution,
      topicId: v.scope.id,
      nodeId: src.nodeId,
      nodeTitle: detail.nodes.find((n) => n.id === src.nodeId)?.title ?? src.nodeId,
      lessonId: src.lessonId,
      lessonTitle: lesson?.title ?? null,
    };
  }
  v.test.status = pending.length ? "grading" : "done";
  v.test.submittedAt = at.toISOString();
  const gradeShort = () => {
    for (const idx of pending) {
      const q = v.questions[idx]!;
      const graded = check(fx.keys[q.item.id]!, q.answer!);
      q.result = { ...q.result!, correct: graded.correct, feedback: graded.feedback };
    }
    v.test.status = "done";
    refreshPractice(test);
    syncTopicFinal(v.scope.id);
  };
  if (pending.length && gradingMs > 0) setTimeout(gradeShort, gradingMs);
  else if (pending.length) gradeShort();
  refreshPractice(test);
  syncTopicFinal(v.scope.id);
}

/** The key's answer, for the seeded history. */
function rightAnswer(key: fx.Key): Answer {
  switch (key.kind) {
    case "single":
      return { format: "single", choice: key.correct as number };
    case "multi":
      return { format: "multi", choices: key.correct as number[] };
    case "order":
      return { format: "order", sequence: key.correct as string[] };
    case "match":
      return { format: "match", pairs: key.correct as number[] };
    case "sort":
      return { format: "sort", categories: key.correct as number[] };
    case "cloze":
      return { format: "cloze", blanks: (key.correct as string[][]).map((a) => a[0]!) };
    case "number":
      return { format: "number", value: key.correct as number };
    case "short":
      return { format: "short", text: "They count within different groups: among the sick versus among the positives." };
  }
}

let practiceHistorySeeded = false;

/** Two earlier tests on the Bayes course, so the history and its trend show. */
function seedPracticeHistory() {
  if (practiceHistorySeeded) return;
  practiceHistorySeeded = true;
  for (const [daysAgo, right] of [
    [14, 5],
    [4, 8],
  ] as const) {
    const test = startPractice("t-bayes", { length: 10, timeLimitMin: null }, new Date(fx.iso(daysAgo)));
    test.view.questions.forEach((q, i) => (q.answer = i < right ? rightAnswer(fx.keys[q.item.id]!) : null));
    submitPractice(test, new Date(Date.parse(fx.iso(daysAgo)) + 25 * 60_000), 0);
  }
}

function practiceOverview(topicId: string): PracticeTestOverview {
  if (topicId === "t-bayes") seedPracticeHistory();
  const tests = Object.values(practiceTests)
    .filter((x) => x.view.test.topicId === topicId)
    .map((x) => x.view.test)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const eligible = topicId === "t-bayes" ? fx.practicePool.length : 0;
  return {
    eligible,
    lessonsFinished: eligible ? new Set(fx.practicePool.map((p) => p.lessonId)).size : 0,
    open: tests.find((x) => x.status === "open") ?? null,
    history: tests.filter((x) => x.status !== "open"),
  };
}

function practiceView(id: string): MockTest | null {
  const test = practiceTests[id];
  if (!test) return null;
  const end = test.view.test.endsAt;
  if (test.view.test.status === "open" && end && Date.parse(end) + 5000 < Date.now()) submitPractice(test);
  return test;
}

// ---------- Final exam ----------

const share = (x: PracticeTestSummary) => (x.questions ? (x.correct ?? 0) / x.questions : 0);

function gradedFinals(topicId: string): PracticeTestView[] {
  return Object.values(practiceTests)
    .map((x) => x.view)
    .filter((v) => v.test.topicId === topicId && v.test.kind === "final" && v.test.status !== "open")
    .sort((a, b) => b.test.createdAt.localeCompare(a.test.createdAt));
}

function syncTopicFinal(topicId: string) {
  const done = gradedFinals(topicId).filter((v) => v.test.status === "done");
  const detail = fx.topicDetails[topicId];
  if (!detail || !done.length) return;
  const best = Math.max(...done.map((v) => share(v.test)));
  detail.topic.final = { percent: Math.round(best * 100), passed: best >= FINAL_PASS_SHARE };
}

function finalView(topicId: string): FinalExamView {
  const detail = fx.topicDetails[topicId]!;
  const { open, eligible } = practiceOverview(topicId);
  const finals = gradedFinals(topicId);
  const done = finals.filter((v) => v.test.status === "done");
  const best = done.reduce<PracticeTestView | null>((b, v) => (!b || share(v.test) > share(b.test) ? v : b), null);
  const latest = finals[0] ?? null;
  const since = latest?.test.submittedAt ?? "";
  const practised = (nodeId: string) =>
    Object.values(practiceTests).some(
      (x) => x.view.test.kind === "practice" && (x.view.test.submittedAt ?? "") > since && x.view.questions.some((q) => q.result?.nodeId === nodeId && q.result.correct === true),
    );
  const weakNodes =
    latest?.test.status === "done"
      ? latest.breakdown
          .filter((n) => n.correct / n.total < FINAL_PASS_SHARE)
          .map((n) => ({ nodeId: n.nodeId, title: n.title, lessonId: n.lessons[0]?.id ?? null, practised: practised(n.nodeId) }))
      : [];
  // The mock Bayes course counts as complete, so its final can be taken.
  const nodesPassed = topicId === "t-bayes" ? detail.nodes.length : detail.nodes.filter((n) => n.mastery === "exit_passed" || n.mastery === "mastered").length;
  const complete = detail.nodes.length > 0 && nodesPassed === detail.nodes.length;
  return {
    nodesPassed,
    nodesTotal: detail.nodes.length,
    questions: eligible,
    open,
    best: best?.test ?? null,
    latest: latest?.test ?? null,
    passed: !!best && share(best.test) >= FINAL_PASS_SHARE,
    weakNodes,
    canStart: complete && !open && eligible > 0 && latest?.test.status !== "grading" && weakNodes.every((n) => n.practised),
  };
}

// ---------- Routes ----------

function createTopic(request: string, kind: TopicSummary["kind"], goal: TopicDetail["goal"] = null) {
  const id = `t-new-${++seq}`;
  const conversationId = `c-new-${seq}`;
  const createdAt = new Date().toISOString();
  createdTopics[id] = { id, slug: id, title: request.slice(0, 60), createdAt, dueCards: 0, nodesMastered: 0, nodesTotal: 0, running: false, kind, goalId: goal?.id ?? null, plan: kind === "goal" ? { total: 0, opened: 0 } : null, final: null };
  fx.topicDetails[id] = {
    topic: createdTopics[id]!,
    nodes: [],
    lessons: [],
    sources: [],
    materials: [],
    conversations: [{ id: conversationId, kind: "onboard", lessonId: null, createdAt }],
    onboarding: kind === "goal" ? sim.goalPhases() : sim.phases(),
    plan: [],
    goal,
    goalNotes: [],
  };
  fx.conversations[conversationId] = { topicId: id, kind: "onboard", messages: [{ id: `u-${seq}`, role: "user", text: request, createdAt }] };
  fx.memoryFiles[id] = [];
  return { id, conversationId };
}

const json = (data: unknown, status = 200) => new Response(data === undefined ? null : JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

// ---------- Learner materials ----------

/** Reads the parts of a materials form the way the server does, with the text measured in the browser. */
async function mockMaterials(form: FormData): Promise<MaterialView[]> {
  await wait(1400);
  const addedAt = new Date().toISOString();
  const out: MaterialView[] = [];
  for (const part of form.getAll("file")) {
    if (typeof part === "string") continue;
    const kind = MATERIAL_EXTENSIONS[(part.name.match(/\.[^.]+$/)?.[0] ?? "").toLowerCase()] ?? "text";
    const raw = kind === "pdf" ? "" : await part.text();
    const chars = kind === "pdf" ? Math.round(part.size / 40) : kind === "html" ? (new DOMParser().parseFromString(raw, "text/html").body.textContent ?? "").trim().length : raw.length;
    out.push({ id: `m-${++seq}`, title: part.name.replace(/\.[^.]+$/, ""), kind, url: null, bytes: part.size, chars, addedAt, cited: false });
  }
  for (const part of form.getAll("text")) {
    const { title, text } = JSON.parse(String(part)) as PastedMaterial;
    out.push({ id: `m-${++seq}`, title, kind: "text", url: null, bytes: new Blob([text]).size, chars: text.length, addedAt, cited: false });
  }
  for (const part of form.getAll("link")) {
    const url = new URL(String(part));
    out.push({ id: `m-${++seq}`, title: url.pathname.split("/").filter(Boolean).pop() ?? url.hostname, kind: "link", url: url.href, bytes: null, chars: 12_400, addedAt, cited: false });
  }
  return out;
}

function summaries(): TopicSummary[] {
  return Object.values(fx.topicDetails).map((d) => d.topic);
}

/** Keeps the generating lesson's counters in step with the simulation. */
function syncBayesLesson() {
  const l = fx.topicDetails["t-bayes"]!.lessons.find((x) => x.id === "l-bayes")!;
  l.stepsReady = lessonState.status.filter((st) => st === "published" || st === "dropped").length;
  l.stepsTotal = lessonState.status.length;
  return l;
}

// ---------- Practice sets ----------

/** The topic and nodes a practice set from these parameters covers; items outside a practice set sit on Bayes' theorem. */
function practiceScope(from: Record<string, unknown>): PracticeScope | null {
  const nodesOf = (topicId: string, ids: string[]): PracticeScope | null => {
    const d = fx.topicDetails[topicId];
    const nodes = (d?.nodes ?? []).filter((n) => ids.includes(n.id)).map((n) => ({ id: n.id, title: n.title }));
    const mistakes = Object.values(fx.itemStates).filter((st) => st.wrongAttempts > 0 || st.gaveUp).length;
    return nodes.length ? { topicId, nodes, mistakes, weakNodeIds: [] } : null;
  };
  if (typeof from.courseId === "string") {
    const d = fx.topicDetails[from.courseId];
    if (!d) return null;
    const weak = finalView(from.courseId).weakNodes.map((n) => n.nodeId);
    const all = nodesOf(from.courseId, d.nodes.map((n) => n.id));
    return all && { ...all, weakNodeIds: weak };
  }
  if (typeof from.lessonId === "string") {
    const lesson = Object.values(fx.topicDetails).flatMap((d) => d.lessons).find((l) => l.id === from.lessonId);
    return lesson ? nodesOf(lesson.topicId, lesson.nodeIds) : null;
  }
  if (typeof from.itemId === "string") {
    const set = [...sim.practiceSets.values()].find((x) => (from.itemId as string).startsWith(`${x.lesson.id}-i`));
    const idx = set ? Number((from.itemId as string).slice(`${set.lesson.id}-i`.length)) : -1;
    const entry = set ? fx.practiceSetPool[(set.offset + idx) % fx.practiceSetPool.length] : undefined;
    return set && entry ? nodesOf(set.lesson.topicId, [entry.nodeId]) : nodesOf("t-bayes", ["bayes-theorem"]);
  }
  return typeof from.topicId === "string" && typeof from.nodeId === "string" ? nodesOf(from.topicId, [from.nodeId]) : null;
}

function practiceItemState(set: sim.PracticeSim, step: PublicStep) {
  const st = step.kind === "practice" ? fx.itemStates[step.item.id] : undefined;
  return {
    nodeId: fx.practiceSetPool[(set.offset + step.idx) % fx.practiceSetPool.length]!.nodeId,
    answered: !!st && (st.attempts > 0 || st.gaveUp),
    firstTry: !!st && st.solved && st.wrongAttempts === 0 && st.hints.length === 0 && !st.gaveUp,
    done: !!st && (st.solved || st.gaveUp),
    solved: !!st && st.solved,
  };
}

function practiceResults(set: sim.PracticeSim): PracticeResults {
  const rows = set.steps.filter((st): st is PublicStep => st !== null).map((st) => practiceItemState(set, st));
  const titles = new Map(fx.topicDetails[set.lesson.topicId]!.nodes.map((n) => [n.id, n.title]));
  const nodes = new Map<string, PracticeResults["nodes"][number]>();
  for (const r of rows) {
    const n = nodes.get(r.nodeId) ?? { nodeId: r.nodeId, title: titles.get(r.nodeId) ?? r.nodeId, total: 0, firstTry: 0, solved: 0 };
    n.total++;
    n.firstTry += Number(r.firstTry);
    n.solved += Number(r.solved);
    nodes.set(r.nodeId, n);
  }
  const count = (f: (r: (typeof rows)[number]) => boolean) => rows.filter(f).length;
  return { total: rows.length, answered: count((r) => r.answered), firstTry: count((r) => r.firstTry), solved: count((r) => r.solved), nodes: [...nodes.values()] };
}

/** Keeps a practice set's learner status in step with the mock's item progress. */
function syncPractice(set: sim.PracticeSim) {
  const rows = set.steps.filter((st): st is PublicStep => st !== null).map((st) => practiceItemState(set, st));
  set.lesson.learnerStatus = rows.length > 0 && rows.every((r) => r.done) ? "completed" : rows.some((r) => r.answered) ? "in_progress" : "not_started";
  return set.lesson;
}

function lessonView(id: string): LessonView | null {
  const set = sim.practiceSets.get(id);
  if (set) {
    return {
      lesson: { ...syncPractice(set), summary: set.summary },
      outline: set.outline,
      stepStatus: [...set.status],
      steps: set.steps.filter((st): st is PublicStep => st !== null),
      authorConversationId: set.convId,
      tutorConversationId: null,
      itemStates: { ...fx.itemStates },
      revealedLines: {},
      challengeIdx: null,
      alternatives: {},
    };
  }
  if (id === "l-bayes") {
    return {
      lesson: { ...syncBayesLesson(), summary: lessonState.finished },
      outline: fx.bayesOutline,
      stepStatus: [...lessonState.status],
      steps: fx.bayesSteps.filter((s, i): s is PublicStep => s !== null && lessonState.status[i] === "published"),
      authorConversationId: "cb-1",
      tutorConversationId: null,
      itemStates: { ...fx.itemStates },
      revealedLines: { ...fx.revealedLines },
      challengeIdx: 7,
      alternatives: { ...fx.alternatives },
    };
  }
  if (id === "l-cond") {
    return {
      lesson: { ...fx.topicDetails["t-bayes"]!.lessons[0]!, summary: "We worked through how joint probability differs from conditional probability." },
      outline: fx.condSteps.map((s) => ({ kind: s.kind, title: s.title })),
      stepStatus: fx.condSteps.map(() => "published"),
      steps: fx.condSteps,
      authorConversationId: null,
      tutorConversationId: null,
      itemStates: { ...fx.itemStates },
      revealedLines: {},
      challengeIdx: 3,
      alternatives: { ...fx.alternatives },
    };
  }
  if (id === "l-bayes-v1") {
    return {
      lesson: { ...fx.topicDetails["t-bayes"]!.lessons.find((l) => l.id === "l-bayes-v1")!, summary: "The first version of the lesson." },
      outline: fx.condSteps.map((st) => ({ kind: st.kind, title: st.title })),
      stepStatus: fx.condSteps.map(() => "published"),
      steps: fx.condSteps,
      authorConversationId: null,
      tutorConversationId: null,
      itemStates: {},
      revealedLines: {},
      challengeIdx: null,
      alternatives: { ...fx.alternatives },
    };
  }
  if (id === "l-git-rebase") {
    const lesson = fx.topicDetails["t-git"]!.lessons.find((l) => l.id === id)!;
    const outline = [
      { kind: "activate", title: "Warm-up" },
      { kind: "explain", title: "What rebase does" },
      { kind: "practice", title: "Rebase a branch" },
      { kind: "check", title: "Final check" },
    ];
    return {
      lesson: { ...lesson, summary: null },
      outline,
      stepStatus: outline.map((_, i) => (i === 0 ? "published" : "pending")),
      steps: [{ ...(fx.condSteps[0] as PublicStep), id: "gr-0" }],
      authorConversationId: null,
      tutorConversationId: null,
      itemStates: {},
      revealedLines: {},
      challengeIdx: null,
      alternatives: { ...fx.alternatives },
    };
  }
  if (id === "l-git") {
    return {
      lesson: { ...fx.topicDetails["t-git"]!.lessons[0]!, summary: null },
      outline: [{ kind: "activate", title: "Warm-up" }],
      stepStatus: ["published"],
      steps: [{ ...(fx.condSteps[0] as PublicStep), id: "g-0" }],
      authorConversationId: null,
      tutorConversationId: null,
      itemStates: {},
      revealedLines: {},
      challengeIdx: null,
      alternatives: { ...fx.alternatives },
    };
  }
  return null;
}

// The language survives the reload that follows a switch through the web app's stored copy.
let settings: Settings = {
  gamification: mockGameOn(),
  introSeen: mockIntroSeen(),
  language: lang(),
  narration: { keySet: false, voiceId: null, model: "eleven_v4" },
  // On in the mock so the Video tab can be looked at; the server default is off.
  video: { enabled: true },
  confidence: { enabled: true },
  claude: Object.fromEntries(
    CLAUDE_ROLES.map((role) => [role, { model: null, effort: null, defaultModel: ["critic", "grading", "narration", "video", "game"].includes(role) ? "sonnet" : "opus", defaultEffort: ({ onboard: "medium", lesson: "high", critic: "high", video: "medium", game: "medium" } as Record<string, Effort>)[role] ?? "low" }]),
  ) as Settings["claude"],
};

// ---------- Narration ----------

const voices: VoiceView[] = [
  { id: "v-aria", name: "Aria - Calm, Clear", previewUrl: null },
  { id: "v-roger", name: "Roger - Warm, Conversational", previewUrl: null },
];

const SECONDS_PER_BLOCK = 4;

/** Silent 8 kHz mono WAV: the mock plays no voice, only the timing that drives the highlight. */
function silentWav(seconds: number): Blob {
  const rate = 8000;
  const n = Math.round(rate * seconds);
  const v = new DataView(new ArrayBuffer(44 + n));
  const tag = (at: number, str: string) => [...str].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
  tag(0, "RIFF");
  v.setUint32(4, 36 + n, true);
  tag(8, "WAVE");
  tag(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate, true);
  v.setUint16(32, 1, true);
  v.setUint16(34, 8, true);
  tag(36, "data");
  v.setUint32(40, n, true);
  new Uint8Array(v.buffer, 44).fill(128);
  return new Blob([v.buffer], { type: "audio/wav" });
}

const readyVideo = (lessonId: string): VideoView => ({ status: "ready", clipUrls: fx.condVideo.clips.map((_, i) => `/api/lessons/${lessonId}/video/clips/${i}`), ...fx.condVideo });

// Every mock lesson gets the same scenes; l-cond has its video already.
const videos: Record<string, VideoView> = { "l-cond": readyVideo("l-cond") };
const exports: Record<string, VideoExportView> = {};

function narration(stepId: string): NarrationView | null {
  const step = fx.condSteps.find((st) => st.id === stepId);
  if (step?.kind !== "explain") return null;
  const blocks = marked.lexer(step.body).filter((tok) => tok.type !== "space" && tok.type !== "def").length;
  return {
    audioUrl: `/api/steps/${stepId}/narration/audio`,
    segments: Array.from({ length: blocks }, (_, i) => ({ block: i, start: i * SECONDS_PER_BLOCK, end: (i + 1) * SECONDS_PER_BLOCK - 0.3 })),
  };
}

async function route(method: string, path: string, body: Record<string, unknown>, form: FormData | null): Promise<Response> {
  const url = new URL(path, location.origin);
  const p = url.pathname;
  let m: RegExpMatchArray | null;

  if (p.startsWith("/api/game")) {
    if (!settings.gamification) return json({ error: t("game.off") }, 409);
    if (p === "/api/game") return json(mockGameView());
    if (p === "/api/game/crowns") return json(mockCrowns());
    if (p === "/api/game/outfit") {
      const view = mockWear(body.slot as OutfitSlot, (body.item ?? null) as OutfitRef | null);
      return view ? json(view) : json({ error: t("game.notWearable") }, 400);
    }
    if (p === "/api/game/seen") {
      mockSeen(body);
      return json(undefined, 204);
    }
    if (p === "/api/game/focus") return json(undefined, 204);
    if (p === "/api/game/backfill") return json(method === "POST" ? startMockBackfill() : mockBackfill(), method === "POST" ? 202 : 200);
  }
  if (p === "/api/topics" && method === "GET") return json(summaries());
  if (p === "/api/topics" && method === "POST") {
    const fields = form ? { request: form.get("request"), kind: form.get("kind") } : body;
    const kind = fields.kind === "goal" ? "goal" : "topic";
    const materials = form ? await mockMaterials(form) : [];
    const { id, conversationId } = createTopic(String(fields.request ?? "New topic"), kind);
    fx.topicDetails[id]!.materials = materials;
    setTimeout(() => (kind === "goal" ? sim.planGoal(id, conversationId) : sim.interview(id, conversationId)), 600);
    return json({ topicId: id, conversationId });
  }
  if ((m = p.match(/^\/api\/topics\/([^/]+)\/materials$/)) && method === "POST" && form) {
    const d = fx.topicDetails[m[1]!];
    if (!d) return json({ error: "topic not found" }, 404);
    const added = await mockMaterials(form);
    d.materials.push(...added);
    emit(d.topic.id, { type: "sources.updated" });
    return json(added, 201);
  }
  if ((m = p.match(/^\/api\/topics\/([^/]+)\/materials\/([^/]+)$/)) && method === "DELETE") {
    const d = fx.topicDetails[m[1]!];
    const material = d?.materials.find((x) => x.id === m![2]);
    if (!d || !material) return json({ error: t("material.error.notFound") }, 404);
    if (material.cited) return json({ error: t("material.error.cited") }, 409);
    d.materials = d.materials.filter((x) => x !== material);
    emit(d.topic.id, { type: "sources.updated" });
    return json(undefined, 204);
  }
  if ((m = p.match(/^\/api\/topics\/([^/]+)\/tests$/))) {
    const topicId = m[1]!;
    if (method === "GET") return json(practiceOverview(topicId));
    const o = practiceOverview(topicId);
    if (o.open) return json({ error: t("practice.openExists") }, 409);
    if (!o.eligible) return json({ error: t("practice.nothingEligible") }, 409);
    return json(startPractice(topicId, body as unknown as PracticeTestRequest).view, 201);
  }
  if ((m = p.match(/^\/api\/topics\/([^/]+)\/final$/))) {
    const topicId = m[1]!;
    if (!fx.topicDetails[topicId] || fx.topicDetails[topicId]!.topic.kind !== "topic") return json({ error: "a goal has no final exam" }, 404);
    if (method === "GET") return json(finalView(topicId));
    const v = finalView(topicId);
    if (!v.canStart) return json({ error: t(v.open ? "practice.openExists" : "final.notReady") }, 409);
    return json(startPractice(topicId, { length: "all", timeLimitMin: null }, new Date(), "final").view, 201);
  }
  if ((m = p.match(/^\/api\/tests\/([^/]+)\/questions\/(\d+)$/))) {
    const test = practiceView(m[1]!);
    if (!test) return json({ error: "test not found" }, 404);
    if (test.view.test.status !== "open") return json({ error: t("practice.submitted") }, 409);
    const q = test.view.questions[Number(m[2])];
    if (!q) return json({ error: "question not found" }, 404);
    const update = body as PracticeAnswerUpdate;
    if (update.answer !== undefined) q.answer = update.answer;
    if (update.flagged !== undefined) q.flagged = update.flagged;
    refreshPractice(test);
    return json(undefined, 204);
  }
  if ((m = p.match(/^\/api\/tests\/([^/]+)\/(submit|regrade)$/))) {
    const test = practiceView(m[1]!);
    if (!test) return json({ error: "test not found" }, 404);
    if (m[2] === "regrade") return json({ error: t("practice.notGraded") }, 409);
    if (test.view.test.status === "open") submitPractice(test);
    return json(test.view);
  }
  if ((m = p.match(/^\/api\/tests\/([^/]+)$/))) {
    const test = practiceView(m[1]!);
    if (!test) return json({ error: "test not found" }, 404);
    if (method !== "DELETE") return json(refreshPractice(test));
    if (test.view.test.status !== "open") return json({ error: t("practice.submitted") }, 409);
    delete practiceTests[m[1]!];
    return json(undefined, 204);
  }
  if ((m = p.match(/^\/api\/topics\/([^/]+)\/notes\/discuss$/))) {
    const goal = fx.topicDetails[m[1]!];
    const convId = goal?.conversations[0]?.id;
    if (!goal || !convId || goal.goalNotes.length === 0) return json({ error: "there are no new notes from the goal's courses" }, 409);
    goal.goalNotes = [];
    fx.conversations[convId]!.messages.push({ id: `u-${++seq}`, role: "user", text: "Let's check the plan against what the courses found out.", createdAt: new Date().toISOString() });
    sim.reply(goal.topic.id, convId, "You build through an AI assistant, so the courses will teach reading and checking code rather than typing it. Shall I update the plan?", ["Reading the notes"]);
    return json({ conversationId: convId }, 202);
  }
  if ((m = p.match(/^\/api\/topics\/([^/]+)\/plan\/([^/]+)\/open$/))) {
    const goal = fx.topicDetails[m[1]!];
    const entry = goal?.plan.find((e) => e.id === m![2]);
    if (!goal || !entry) return json({ error: "Plan entry not found" }, 404);
    if (entry.topic) return json({ error: "This topic is already opened" }, 409);
    const { id, conversationId } = createTopic(entry.title, "topic", { id: goal.topic.id, title: goal.topic.title, why: entry.why });
    entry.topic = fx.topicDetails[id]!.topic;
    goal.topic.plan = { total: goal.plan.length, opened: goal.plan.filter((e) => e.topic).length };
    setTimeout(() => sim.interview(id, conversationId), 600);
    return json({ topicId: id, conversationId });
  }
  if (p === "/api/practice/scope") {
    const scope = practiceScope(Object.fromEntries(url.searchParams));
    return scope ? json(scope) : json({ error: "node not found" }, 404);
  }
  if (p === "/api/practice" && method === "POST") {
    const scope = practiceScope((body.from ?? {}) as Record<string, unknown>);
    if (!scope) return json({ error: "node not found" }, 404);
    const focus = body.focus as PracticeFocus;
    if (focus === "mistakes" && scope.mistakes === 0) return json({ error: t("practiceSet.noMistakes") }, 409);
    const conversationId = `c-practice-${++seq}`;
    fx.conversations[conversationId] = { topicId: scope.topicId, kind: "lesson", messages: [] };
    const course = (body.from as Record<string, unknown> | undefined)?.courseId ? fx.topicDetails[scope.topicId]!.topic.title : null;
    const title = course ? t("practiceSet.courseTitle", { course }) : undefined;
    const set = sim.createPracticeSet(scope.topicId, conversationId, scope.nodes, Number(body.size), focus, title);
    fx.topicDetails[scope.topicId]?.conversations.push({ id: conversationId, kind: "lesson", lessonId: set.lesson.id, createdAt: new Date().toISOString() });
    setTimeout(() => sim.runPracticeGeneration(set), 400);
    return json({ lessonId: set.lesson.id, conversationId }, 202);
  }
  if ((m = p.match(/^\/api\/lessons\/([^/]+)\/practice$/))) {
    const set = sim.practiceSets.get(m[1]!);
    return set ? json(practiceResults(set)) : json({ error: "this lesson is not a practice set" }, 404);
  }
  if ((m = p.match(/^\/api\/topics\/([^/]+)$/))) {
    if (m[1] === "t-bayes") syncBayesLesson();
    for (const set of sim.practiceSets.values()) syncPractice(set);
    const d = fx.topicDetails[m[1]!];
    return d ? json(d) : json({ error: "Topic not found" }, 404);
  }
  if ((m = p.match(/^\/api\/topics\/([^/]+)\/memory$/))) return json(fx.memoryFiles[m[1]!] ?? []);
  if ((m = p.match(/^\/api\/topics\/([^/]+)\/notes$/))) return json(fx.notes.filter((n) => n.topicId === m![1]));
  if ((m = p.match(/^\/api\/topics\/([^/]+)\/cards$/))) {
    const status = url.searchParams.get("status");
    return json(fx.cards.filter((c) => c.topicId === m![1] && (!status || c.status === status)));
  }
  if ((m = p.match(/^\/api\/topics\/([^/]+)\/lessons$/))) {
    const topicId = m[1]!;
    const conversationId = `c-author-${++seq}`;
    fx.conversations[conversationId] = { topicId, kind: "lesson", messages: [] };
    fx.topicDetails[topicId]?.conversations.push({ id: conversationId, kind: "lesson", lessonId: null, createdAt: new Date().toISOString() });
    sim.reply(topicId, conversationId, "I picked the next node and planned the lesson. Steps will appear as they pass checks.", ["Checking progress", "Choosing a node", "Planning the lesson"]);
    setTimeout(() => emit(topicId, { type: "lesson.planned", lessonId: "l-bayes", title: "Bayes' theorem", outline: fx.bayesOutline }), 3500);
    return json({ lessonId: null, conversationId });
  }
  if ((m = p.match(/^\/api\/lessons\/([^/]+)$/))) {
    const v = lessonView(m[1]!);
    return v ? json(v) : json({ error: "Lesson not found" }, 404);
  }
  if ((m = p.match(/^\/api\/lessons\/([^/]+)\/resume$/))) {
    const lesson = Object.values(fx.topicDetails).flatMap((d) => d.lessons).find((l) => l.id === m![1]);
    if (lesson?.status !== "failed") return json({ error: "only an interrupted lesson can be continued" }, 409);
    lesson.status = "generating";
    const set = sim.practiceSets.get(lesson.id);
    if (set) {
      sim.runPracticeGeneration(set);
      return json({ lessonId: lesson.id, conversationId: set.convId }, 202);
    }
    return json({ lessonId: lesson.id, conversationId: "c-author-resume" }, 202);
  }
  if ((m = p.match(/^\/api\/lessons\/([^/]+)\/rebuild$/))) {
    const topicId = "t-bayes";
    const conversationId = `c-rebuild-${++seq}`;
    fx.conversations[conversationId] = { topicId, kind: "lesson", messages: [] };
    fx.topicDetails[topicId]?.conversations.push({ id: conversationId, kind: "lesson", lessonId: null, createdAt: new Date().toISOString() });
    sim.reply(topicId, conversationId, "Rebuilding the lesson with the new sources. The old lesson stays available.", ["Reading new sources", "Planning the lesson"]);
    return json({ lessonId: null, conversationId });
  }
  if ((m = p.match(/^\/api\/lessons\/([^/]+)\/tutor$/))) {
    const conversationId = "c-tutor";
    fx.conversations[conversationId] ??= { topicId: "t-bayes", kind: "tutor", messages: [] };
    const quote = typeof body.quote === "string" ? body.quote : undefined;
    fx.conversations[conversationId].messages.push({ id: `tu-${++seq}`, role: "user", text: String(body.text), quote, createdAt: new Date().toISOString() });
    if (quote) {
      setTimeout(
        () =>
          sim.reply(
            "t-bayes",
            conversationId,
            `Let's read that passage slowly. The key move is **which group you count in**: “${quote.length > 80 ? `${quote.slice(0, 80)}…` : quote}” is about the people with a positive result, not about everyone who was tested. Which number in the problem describes that group?`,
            ["Reading the passage"],
          ),
        400,
      );
      return json({ conversationId });
    }
    const lessonId = m[1]!;
    const stepId = String(body.stepId ?? "");
    const lineIdx = typeof body.line === "number" ? body.line : null;
    const line = lineIdx === null ? undefined : fx.workedLines[stepId]?.[lineIdx];
    if (lineIdx !== null && line) {
      const key = `${stepId}:${lineIdx}`;
      const first = !openLinesAsked.has(key);
      openLinesAsked.add(key);
      setTimeout(() => {
        if (first) {
          sim.reply("t-bayes", conversationId, "Line 6 asks: **why is the answer so far below the test's 90% sensitivity?** Answer in your own words.", ["Reading the line"]);
          return;
        }
        sim.reply("t-bayes", conversationId, "Yes: there are far more healthy people, so even a small share of false alarms among them outnumbers the true detections. I've opened the line.", ["Recording your answer"]);
        setTimeout(() => emit("t-bayes", { type: "worked.answered", lessonId, stepId, idx: lineIdx, correct: true, text: line.text }), 2600);
      }, 400);
      return json({ conversationId });
    }
    setTimeout(
      () =>
        sim.reply(
          "t-bayes",
          conversationId,
          "Let's find where the reasoning goes off track. You picked an answer close to the **test's accuracy**. That is P(test+ | sick). What does the problem ask for: the share among the sick, or among people with a positive result?",
          ["Looking at your attempts"],
        ),
      400,
    );
    return json({ conversationId });
  }
  if ((m = p.match(/^\/api\/conversations\/([^/]+)$/))) {
    const c = fx.conversations[m[1]!];
    const run = sim.runs.get(m[1]!);
    return json({
      id: m[1],
      topicId: c?.topicId ?? "t-bayes",
      kind: c?.kind ?? "lesson",
      running: !!run,
      runningSince: run?.since ?? null,
      currentActivity: run?.activity ?? null,
      messages: c?.messages ?? [],
    });
  }
  if ((m = p.match(/^\/api\/conversations\/([^/]+)\/messages$/))) {
    const id = m[1]!;
    const c = fx.conversations[id];
    const msg: ChatMessage = { id: `u-${++seq}`, role: "user", text: String(body.text), createdAt: new Date().toISOString() };
    c?.messages.push(msg);
    const topicId = c?.topicId ?? "t-bayes";
    const text = String(body.text);
    const phase = c?.kind === "onboard" ? sim.activePhase(topicId) : null;
    setTimeout(() => {
      if (phase === "interview" && fx.topicDetails[topicId]?.topic.kind === "goal") sim.finishGoalPlan(topicId, id, text);
      else if (phase === "interview") sim.runOnboarding(topicId, id, "mission", text);
      else if (phase === "placement") sim.runPlacementAnswer(topicId, id, text);
      else sim.reply(topicId, id, "Noted. If you want to change anything in the plan, tell me and I'll adjust the map and the upcoming lessons.", ["Reading the message"]);
    }, 300);
    return json({ accepted: true }, 202);
  }
  if ((m = p.match(/^\/api\/conversations\/([^/]+)\/cancel$/))) {
    sim.failPracticeRun(m[1]!);
    sim.finishRun(fx.conversations[m[1]!]?.topicId ?? "t-bayes", m[1]!, "Stopped");
    return json(undefined, 202);
  }
  if ((m = p.match(/^\/api\/items\/([^/]+)\/attempt$/))) return json(grade(m[1]!, body as unknown as AttemptRequest));
  if ((m = p.match(/^\/api\/items\/([^/]+)\/hint$/))) {
    const key = fx.keys[m[1]!];
    const level = Number(body.level ?? 1);
    const hint = key?.hints[level - 1];
    if (hint) stateOf(m[1]!).hints = key!.hints.slice(0, level);
    return hint ? json({ level, hint, hintCount: key!.hints.length }) : json({ error: "No more hints" }, 400);
  }
  if ((m = p.match(/^\/api\/items\/([^/]+)\/giveup$/))) {
    const key = fx.keys[m[1]!];
    Object.assign(stateOf(m[1]!), { gaveUp: true, solution: key?.solution, correctAnswer: key?.correctAnswer });
    return json({ solution: key?.solution ?? "", correctAnswer: key?.correctAnswer ?? "" });
  }
  if ((m = p.match(/^\/api\/worked\/([^/]+)\/lines\/(\d+)\/reveal$/))) {
    const line = fx.workedLines[m[1]!]?.[Number(m[2])];
    if (!line) return json({ error: "No such line" }, 404);
    (fx.revealedLines[m[1]!] ??= []).push({ idx: Number(m[2]), text: line.text });
    return json({ correct: false, text: line.text });
  }
  if ((m = p.match(/^\/api\/worked\/([^/]+)\/lines\/(\d+)$/))) {
    const line = fx.workedLines[m[1]!]?.[Number(m[2])];
    if (!line) return json({ error: "No such line" }, 404);
    const ans = String(body.answer ?? "").replace(/\s/g, "").toLowerCase();
    (fx.revealedLines[m[1]!] ??= []).push({ idx: Number(m[2]), text: line.text });
    return json({ correct: line.answers.some((a) => a.replace(/\s/g, "").toLowerCase() === ans), text: line.text });
  }
  if (p.match(/^\/api\/steps\/[^/]+\/reflect$/)) return json(undefined, 202);
  if (p === "/api/review") {
    const topicId = url.searchParams.get("topicId");
    const session: ReviewSession = {
      cards: fx.cards.filter((c) => c.status === "active" && c.due && new Date(c.due) <= new Date() && (!topicId || c.topicId === topicId)),
      items: !topicId || topicId === "t-bayes" ? fx.reviewItems : [],
      retests: !topicId || topicId === "t-bayes" ? fx.reviewRetests : [],
    };
    return json(session);
  }
  if ((m = p.match(/^\/api\/cards\/([^/]+)\/review$/))) {
    const c = fx.cards.find((x) => x.id === m![1]);
    if (c) c.due = fx.iso(-Number(body.rating ?? 3));
    return json({ due: c?.due ?? "" });
  }
  if ((m = p.match(/^\/api\/cards\/([^/]+)\/(accept|suspend|reject)$/))) {
    const c = fx.cards.find((x) => x.id === m![1]);
    if (c) c.status = m[2] === "accept" ? "active" : m[2] === "suspend" ? "suspended" : "rejected";
    return json(undefined, 202);
  }
  if ((m = p.match(/^\/api\/cards\/([^/]+)$/)) && method === "PATCH") {
    const c = fx.cards.find((x) => x.id === m![1]);
    if (c) Object.assign(c, { front: body.front, back: body.back });
    return json(undefined, 202);
  }
  if (p === "/api/notes") {
    const note = { ...(body as unknown as NoteRequest), id: `n-${++seq}`, createdAt: new Date().toISOString() };
    fx.notes.push(note);
    return json(note, 201);
  }
  if ((m = p.match(/^\/api\/notes\/([^/]+)$/)) && method === "PATCH") {
    const note = fx.notes.find((n) => n.id === m![1]);
    if (note) note.text = String(body.text ?? "");
    return json(undefined, 204);
  }
  if (p === "/api/reports") return json(undefined, 202);
  if (p === "/api/stats/activity") return json(fx.activity(Number(url.searchParams.get("days") ?? 7)));
  if (p === "/api/stats/calibration") return json(fx.calibration);
  if (p === "/api/today") return json({ ...fx.today, mistakes: mistakeCounts() });
  if (p === "/api/mistakes") return json(mistakesView());
  if ((m = p.match(/^\/api\/mistakes\/([^/]+)\/solution$/))) {
    const key = fx.mistakes.some((e) => e.itemId === m![1]) ? fx.keys[m[1]!] : undefined;
    return key ? json({ solution: key.solution, correctAnswer: key.correctAnswer }) : json({ error: "this item is not in the mistakes notebook" }, 404);
  }
  if ((m = p.match(/^\/api\/mistakes\/([^/]+)\/retry$/))) {
    const res = retry(m[1]!, body as unknown as RetryRequest);
    return res ? json(res) : json({ error: "this item is not in the mistakes notebook" }, 404);
  }
  if (p === "/api/settings") {
    if (method === "PUT") {
      const { language, voiceId, ttsModel, videoEnabled, claudeRole, confidenceEnabled, gamification, introSeen } = body as SettingsUpdate;
      if (gamification !== undefined) setMockGameOn(gamification);
      settings = {
        gamification: gamification ?? settings.gamification,
        introSeen: introSeen ? setMockIntroSeen(introSeen) : settings.introSeen,
        language: language ?? settings.language,
        narration: { ...settings.narration, voiceId: voiceId ?? settings.narration.voiceId, model: ttsModel ?? settings.narration.model },
        video: { enabled: videoEnabled ?? settings.video.enabled },
        confidence: { enabled: confidenceEnabled ?? settings.confidence.enabled },
        claude: claudeRole
          ? { ...settings.claude, [claudeRole.role]: { ...settings.claude[claudeRole.role], model: claudeRole.model, effort: claudeRole.effort } }
          : settings.claude,
      };
    }
    return json(settings);
  }
  if (p === "/api/settings/elevenlabs-key") {
    const keySet = method === "PUT";
    settings = { ...settings, narration: { ...settings.narration, keySet, voiceId: settings.narration.voiceId ?? voices[0]!.id } };
    return json(settings);
  }
  if (p === "/api/settings/voices") return settings.narration.keySet ? json(voices) : json({ error: t("narration.noKey") }, 409);
  if ((m = p.match(/^\/api\/steps\/([^/]+)\/narration$/))) {
    if (!settings.narration.keySet) return json({ error: t("narration.noKey") }, 409);
    const view = narration(m[1]!);
    if (!view) return json({ error: "only explain steps are narrated" }, 400);
    await wait(1500);
    return json(view);
  }
  if ((m = p.match(/^\/api\/steps\/([^/]+)\/alternatives$/))) {
    const step = [...fx.condSteps, ...fx.bayesSteps].find((st) => st?.id === m![1]);
    if (step?.kind !== "explain" && step?.kind !== "worked_example") return json({ error: "only explain and worked_example steps are explained differently" }, 400);
    const lens = body.lens as ExplainLens;
    if (!lensesFor(step.kind).includes(lens)) return json({ error: `a ${step.kind} step has no ${String(lens)} lens` }, 400);
    await wait(1800);
    const list = (fx.alternatives[step.id] ??= []);
    const variants = fx.alternativeBodies[lens];
    const alt = { id: `alt-${++seq}`, lens, body: variants[list.filter((a) => a.lens === lens).length % variants.length]!, createdAt: new Date().toISOString() };
    list.push(alt);
    return json(alt);
  }
  if ((m = p.match(/^\/api\/steps\/([^/]+)\/narration\/audio$/))) {
    const view = narration(m[1]!);
    return view ? new Response(silentWav(view.segments.length * SECONDS_PER_BLOCK)) : json({ error: "narration not found" }, 404);
  }
  if ((m = p.match(/^\/api\/lessons\/([^/]+)\/video$/))) {
    const id = m[1]!;
    if (method === "POST") {
      if (!settings.video.enabled) return json({ error: t("video.disabled") }, 409);
      if (!settings.narration.keySet) return json({ error: t("video.noKey") }, 409);
      const total = 2 * fx.condVideo.chapters.length + 3;
      videos[id] = { status: "building", done: 0, total };
      for (let done = 1; done <= total; done++) setTimeout(() => (videos[id] = done < total ? { status: "building", done, total } : readyVideo(id)), done * 600);
    }
    return videos[id] ? json(videos[id]) : json({ error: "no video for this lesson" }, 404);
  }
  if ((m = p.match(/^\/api\/lessons\/([^/]+)\/video\/export$/))) {
    const id = m[1]!;
    if (method === "POST") {
      const steps = 8;
      for (let k = 0; k <= steps; k++) {
        setTimeout(() => {
          exports[id] = k < steps ? { status: "rendering", progress: k / steps } : { status: "ready", url: `/api/lessons/${id}/video/export/file`, sizeBytes: 84_000_000 };
        }, k * 700);
      }
      exports[id] = { status: "rendering", progress: 0 };
    }
    return json(exports[id] ?? { status: "none" });
  }
  if ((m = p.match(/^\/api\/lessons\/[^/]+\/video\/clips\/(\d+)$/))) return new Response(silentWav(fx.condVideo.clips[Number(m[1])]?.duration ?? 1));
  if (p === "/api/goal") {
    fx.today.goal.minutes = body.minutes as TodayView["goal"]["minutes"];
    return json(fx.today);
  }
  if (p === "/api/weak") {
    const topicId = url.searchParams.get("topicId");
    return json(fx.weak.filter((w) => !topicId || w.topicId === topicId).slice(0, Number(url.searchParams.get("limit") ?? 10)));
  }
  if (p === "/api/audit/sample") return json(fx.audit);
  if (p === "/api/glossary") return json(fx.glossary);
  if (p === "/api/system") return json(fx.system());
  if (p === "/api/update" && method === "POST") fx.update.state = body.mode === "now" ? "installing" : "waiting";
  if (p === "/api/update") return json(fx.update);
  if (p.match(/^\/api\/audit\/[^/]+$/)) return json(undefined, 202);
  return json({ error: `No mock for ${method} ${p}` }, 404);
}

export function installMock() {
  const realFetch = window.fetch.bind(window);
  const mockFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = url.startsWith(location.origin) ? url.slice(location.origin.length) : url;
    if (!path.startsWith("/api/")) return realFetch(input, init);
    const method = (init?.method ?? "GET").toUpperCase();
    let body: Record<string, unknown> = {};
    if (typeof init?.body === "string") {
      try {
        body = JSON.parse(init.body) as Record<string, unknown>;
      } catch {
        body = {};
      }
    }
    await wait(120 + Math.random() * 220);
    return route(method, path, body, init?.body instanceof FormData ? init.body : null);
  };
  window.fetch = mockFetch as typeof fetch;
  (window as unknown as { EventSource: unknown }).EventSource = MockEventSource;
  console.info("[mock] /api/* answered from web/src/mock");
}
