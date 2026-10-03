import type { AttemptRequest, AttemptResponse, ChatMessage, ItemState, LessonView, NoteRequest, ReviewSession, Settings, TodayView, TopicSummary } from "@shared/api";
import type { TopicEvent } from "@shared/events";
import type { PublicStep } from "@shared/schemas";
import { lang } from "../lib/i18n";
import * as fx from "./fixtures";
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
let seq = 0;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const lessonState = sim.lessonState;
const emit = sim.emit;

// ---------- Grading ----------

function stateOf(itemId: string): ItemState {
  return (fx.itemStates[itemId] ??= { attempts: 0, wrongAttempts: 0, solved: false, gaveUp: false, hints: [], lastFeedback: null });
}

function grade(itemId: string, body: AttemptRequest): AttemptResponse {
  const key = fx.keys[itemId];
  const st = stateOf(itemId);
  st.attempts++;
  const attemptNo = st.attempts;
  if (!key) return { correct: null, feedback: "No answer key in the mock data.", attemptNo, offerTutor: false };
  const a = body.answer;
  let correct = false;
  let feedback = key.feedback ?? "";
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
    case "cloze":
      correct = a.blanks.every((b, i) => (key.correct as string[][])[i]?.some((x) => x.toLowerCase() === b.toLowerCase()));
      break;
    case "number":
      correct = Math.abs(a.value - (key.correct as number)) <= (key.tolerance ?? 0);
      break;
    case "short":
      // The server grades short answers against the rubric; the mock accepts answers naming both groups.
      correct = /among/i.test(a.text) && a.text.length >= 20;
      feedback = correct ? "The answer covers the reference criteria." : "The key point is missing: which group the share is computed in.";
      break;
  }
  st.lastFeedback = feedback;
  if (body.context === "activate") {
    st.solution = key.solution;
    st.correctAnswer = key.correctAnswer;
    return { correct: null, feedback, solution: key.solution, correctAnswer: key.correctAnswer, attemptNo, offerTutor: false };
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
    feedback,
    solution: correct ? key.solution : undefined,
    correctAnswer: correct ? key.correctAnswer : undefined,
    attemptNo,
    offerTutor: !correct && !st.solved && st.wrongAttempts >= 2 && (body.context === "practice" || body.context === "explain"),
  };
}

// ---------- Routes ----------

const json = (data: unknown, status = 200) => new Response(data === undefined ? null : JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

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

function lessonView(id: string): LessonView | null {
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
    };
  }
  return null;
}

// The language survives the reload that follows a switch through the web app's stored copy.
let settings: Settings = { language: lang() };

async function route(method: string, path: string, body: Record<string, unknown>): Promise<Response> {
  const url = new URL(path, location.origin);
  const p = url.pathname;
  let m: RegExpMatchArray | null;

  if (p === "/api/topics" && method === "GET") return json(summaries());
  if (p === "/api/topics" && method === "POST") {
    const id = `t-new-${++seq}`;
    const conversationId = `c-new-${seq}`;
    const title = String(body.request ?? "New topic").slice(0, 60);
    createdTopics[id] = { id, slug: id, title, createdAt: new Date().toISOString(), dueCards: 0, nodesMastered: 0, nodesTotal: 0, running: false };
    fx.topicDetails[id] = {
      topic: createdTopics[id]!,
      nodes: [],
      lessons: [],
      sources: [],
      conversations: [{ id: conversationId, kind: "onboard", lessonId: null, createdAt: new Date().toISOString() }],
      onboarding: sim.phases(),
    };
    fx.conversations[conversationId] = { topicId: id, kind: "onboard", messages: [{ id: `u-${seq}`, role: "user", text: String(body.request), createdAt: new Date().toISOString() }] };
    fx.memoryFiles[id] = [];
    setTimeout(() => sim.interview(id, conversationId), 600);
    return json({ topicId: id, conversationId });
  }
  if ((m = p.match(/^\/api\/topics\/([^/]+)$/))) {
    if (m[1] === "t-bayes") syncBayesLesson();
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
    fx.conversations[conversationId].messages.push({ id: `tu-${++seq}`, role: "user", text: String(body.text), createdAt: new Date().toISOString() });
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
      if (phase === "interview") sim.runOnboarding(topicId, id, "mission", text);
      else if (phase === "placement") sim.runPlacementAnswer(topicId, id, text);
      else sim.reply(topicId, id, "Noted. If you want to change anything in the plan, tell me and I'll adjust the map and the upcoming lessons.", ["Reading the message"]);
    }, 300);
    return json({ accepted: true }, 202);
  }
  if ((m = p.match(/^\/api\/conversations\/([^/]+)\/cancel$/))) {
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
    fx.notes.push({ ...(body as unknown as NoteRequest), id: `n-${++seq}`, createdAt: new Date().toISOString() });
    return json(undefined, 202);
  }
  if (p === "/api/reports") return json(undefined, 202);
  if (p === "/api/stats/activity") return json(fx.activity(Number(url.searchParams.get("days") ?? 7)));
  if (p === "/api/today") return json(fx.today);
  if (p === "/api/settings") {
    if (method === "PUT") settings = body as Settings;
    return json(settings);
  }
  if (p === "/api/goal") {
    fx.today.goal.minutes = body.minutes as TodayView["goal"]["minutes"];
    return json(fx.today);
  }
  if (p === "/api/weak") {
    const topicId = url.searchParams.get("topicId");
    return json(fx.weak.filter((w) => !topicId || w.topicId === topicId).slice(0, Number(url.searchParams.get("limit") ?? 10)));
  }
  if (p === "/api/audit/sample") return json(fx.audit);
  if (p === "/api/system") return json(fx.system());
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
    return route(method, path, body);
  };
  window.fetch = mockFetch as typeof fetch;
  (window as unknown as { EventSource: unknown }).EventSource = MockEventSource;
  console.info("[mock] /api/* answered from web/src/mock");
}
