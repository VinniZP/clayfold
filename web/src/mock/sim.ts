import type { NodeView, OnboardingPhase, SourceView, TopicDetail } from "@shared/api";
import type { TopicEvent } from "@shared/events";
import type { PublicStep } from "@shared/schemas";
import * as fx from "./fixtures";

// Simulated Claude runs for the dev mock: event bus, per-conversation run state,
// the onboarding script and gradual lesson generation.

type Listener = { topicId: string; emit: (e: TopicEvent) => void };
export const listeners = new Set<Listener>();
export const emit = (topicId: string, e: TopicEvent) => {
  for (const l of listeners) if (l.topicId === topicId) l.emit(e);
};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toISOString();
let seq = 0;

// ---------- Runs ----------

type Run = { since: string; activity: string | null };
export const runs = new Map<string, Run>([["c-onb-stretch", { since: new Date(Date.now() - 25_000).toISOString(), activity: "Searching for sources" }]]);

class Cancelled extends Error {}

function syncRunning(topicId: string) {
  const d = fx.topicDetails[topicId];
  if (d) d.topic.running = [...runs.keys()].some((c) => fx.conversations[c]?.topicId === topicId);
}

function conv(convId: string, topicId: string, kind: TopicDetail["conversations"][number]["kind"] = "lesson") {
  return (fx.conversations[convId] ??= { topicId, kind, messages: [] });
}

export function startRun(topicId: string, convId: string, since = now()) {
  runs.set(convId, { since, activity: null });
  syncRunning(topicId);
  emit(topicId, { type: "conv.status", conversationId: convId, running: true, startedAt: since });
}

export function finishRun(topicId: string, convId: string, error: string | null = null) {
  if (!runs.delete(convId)) return;
  syncRunning(topicId);
  emit(topicId, { type: "conv.done", conversationId: convId, costUsd: 0.05 + Math.random() * 0.4, error });
}

/** Waits, then aborts the script if the run was cancelled meanwhile. */
async function pause(convId: string, ms: number) {
  await wait(ms);
  if (!runs.has(convId)) throw new Cancelled();
}

const PAST: [RegExp, string][] = [
  [/^Reading /, "Read "],
  [/^Updating /, "Updated "],
  [/^Searching for sources/, "Found sources"],
  [/^Checking /, "Checked "],
  [/^Building /, "Built "],
  [/^Linking /, "Linked "],
  [/^Preparing /, "Prepared "],
  [/^Recording /, "Recorded "],
  [/^Writing /, "Wrote "],
  [/^Reworking /, "Reworked "],
  [/^Choosing /, "Chose "],
  [/^Planning /, "Planned "],
  [/^Looking /, "Looked "],
];

/** Past-tense form of a mock activity label; labels already in the past stay as they are. */
function past(label: string): string {
  for (const [re, to] of PAST) if (re.test(label)) return label.replace(re, to);
  return label;
}

function activity(topicId: string, convId: string, label: string) {
  const run = runs.get(convId);
  if (run) run.activity = label;
  const doneLabel = past(label);
  conv(convId, topicId).messages.push({ id: `act-${++seq}`, role: "activity", text: label, doneText: doneLabel, createdAt: now() });
  emit(topicId, { type: "conv.activity", conversationId: convId, label, doneLabel, tool: "mock" });
}

/** Stores the result of a step check on its activity line, as the server does for step_submit. */
function stepDone(topicId: string, convId: string, idx: number, result: string) {
  const msgs = conv(convId, topicId).messages;
  const at = msgs.findLastIndex((m) => m.role === "activity" && new RegExp(`step ${idx + 1}(?!\\d)`, "i").test(m.text));
  if (at !== -1) msgs[at] = { ...msgs[at]!, doneText: result };
}

async function say(topicId: string, convId: string, text: string) {
  const messageId = `mm-${++seq}`;
  const words = text.split(/(\s+)/);
  for (let i = 0; i < words.length; i += 3) {
    await pause(convId, 50);
    emit(topicId, { type: "conv.text", conversationId: convId, messageId, delta: words.slice(i, i + 3).join("") });
  }
  conv(convId, topicId).messages.push({ id: messageId, role: "assistant", text, createdAt: now() });
}

function ask(topicId: string, convId: string, question: string, options: { label: string; description?: string }[], multi = false) {
  emit(topicId, { type: "conv.ask", conversationId: convId, question, options, multi, allowFree: true });
  conv(convId, topicId).messages.push({ id: `ask-${++seq}`, role: "ask", text: question, options, multi, allowFree: true, createdAt: now() });
}

function script(topicId: string, convId: string, body: () => Promise<void>) {
  void body().then(
    () => finishRun(topicId, convId),
    (err) => {
      if (!(err instanceof Cancelled)) finishRun(topicId, convId, String(err));
    },
  );
}

/** Reply in a conversation that has no scripted flow (tutor, lesson author, review). */
export function reply(topicId: string, convId: string, text: string, activities: string[] = []) {
  startRun(topicId, convId);
  script(topicId, convId, async () => {
    for (const a of activities) {
      activity(topicId, convId, a);
      await pause(convId, 1200);
    }
    await say(topicId, convId, text);
  });
}

// ---------- Onboarding ----------

export function phases(): OnboardingPhase[] {
  return [
    { key: "interview", label: "Interview", status: "active", detail: null },
    { key: "mission", label: "Mission", status: "pending", detail: null },
    { key: "sources", label: "Sources", status: "pending", detail: null },
    { key: "graph", label: "Knowledge map", status: "pending", detail: null },
    { key: "placement", label: "Level", status: "pending", detail: null },
  ];
}

export function goalPhases(): OnboardingPhase[] {
  return [
    { key: "interview", label: "Interview", status: "active", detail: null },
    { key: "plan", label: "Course plan", status: "pending", detail: null },
  ];
}

/** First goal-planning turn: one multi-choice interview question. */
export function planGoal(topicId: string, convId: string) {
  startRun(topicId, convId);
  script(topicId, convId, async () => {
    activity(topicId, convId, "Reading the request");
    await pause(convId, 1500);
    ask(
      topicId,
      convId,
      "What have you already done that is close to this goal?",
      [{ label: "Wrote code at work" }, { label: "Built a website without code" }, { label: "Used an AI assistant to write code" }, { label: "Nothing yet" }],
      true,
    );
  });
}

/** The rest of the goal-planning run after the interview answer. */
export function finishGoalPlan(topicId: string, convId: string, answer: string) {
  startRun(topicId, convId);
  const d = fx.topicDetails[topicId]!;
  script(topicId, convId, async () => {
    setPhase(topicId, "interview", "done", answer.split("\n")[0]!.toLowerCase());
    setPhase(topicId, "plan", "active");
    activity(topicId, convId, "Planning the courses");
    await pause(convId, 2500);
    d.plan = fx.goalPlan(fx.GOAL_PLAN.map(([stage, id, title, why]) => [stage, id, title, why]));
    d.topic.plan = { total: d.plan.length, opened: 0 };
    emit(topicId, { type: "plan.updated" });
    setPhase(topicId, "plan", "done", `${d.plan.length} courses`);
    await say(topicId, convId, `I planned **${d.plan.length} courses** in three stages. Open the first course from the plan; if you want to change it, tell me here.`);
  });
}

function setPhase(topicId: string, key: OnboardingPhase["key"], status: OnboardingPhase["status"], detail: string | null = null) {
  const p = fx.topicDetails[topicId]?.onboarding.find((x) => x.key === key);
  if (!p) return;
  p.status = status;
  p.detail = detail;
  emit(topicId, { type: "onboarding.updated" });
}

export function activePhase(topicId: string): OnboardingPhase["key"] | null {
  return fx.topicDetails[topicId]?.onboarding.find((p) => p.status === "active")?.key ?? null;
}

const NEW_SOURCES: Omit<SourceView, "id">[] = [
  { url: "https://www.nhs.uk/live-well/exercise/exercises-for-back-pain/", title: "NHS: exercises for back pain", kind: "article", note: "basic routine", status: "ok" },
  { url: "https://www.mayoclinic.org/healthy-lifestyle/fitness/in-depth/back-pain/art-20546859", title: "Mayo Clinic: exercises for the lower back", kind: "article", note: "stretching and strengthening", status: "ok" },
  { url: "https://pubmed.ncbi.nlm.nih.gov/34580864/", title: "Review: exercise for chronic low back pain", kind: "study", note: "what works", status: "ok" },
  { url: "https://example.org/yoga-back", title: "Yoga for the back (page unavailable)", kind: "course", note: "", status: "failed" },
];

const NEW_NODES: Omit<NodeView, "summary">[] = [
  { id: "spine-basics", title: "How the lower back works", kind: "knowledge", prereqs: [], placement: null, mastery: "new" },
  { id: "safe-range", title: "Safe range of motion", kind: "knowledge", prereqs: ["spine-basics"], placement: null, mastery: "new" },
  { id: "breathing", title: "Breathing while stretching", kind: "skill", prereqs: [], placement: null, mastery: "new" },
  { id: "hip-flexors", title: "Hip flexor stretch", kind: "skill", prereqs: ["safe-range", "breathing"], placement: null, mastery: "new" },
  { id: "hamstrings", title: "Hamstrings", kind: "skill", prereqs: ["safe-range", "breathing"], placement: null, mastery: "new" },
  { id: "cat-cow", title: "Cat–cow", kind: "skill", prereqs: ["safe-range"], placement: null, mastery: "new" },
  { id: "routine", title: "Daily 10-minute routine", kind: "skill", prereqs: ["hip-flexors", "hamstrings", "cat-cow"], placement: null, mastery: "new" },
];

/** First onboarding turn: read the request and ask about the goal. */
export function interview(topicId: string, convId: string) {
  startRun(topicId, convId);
  script(topicId, convId, async () => {
    activity(topicId, convId, "Reading the request");
    await pause(convId, 1500);
    await say(topicId, convId, "Interesting topic. Before gathering sources, I'd like to understand your goal.");
    ask(topicId, convId, "What do you need this for?", [
      { label: "For work", description: "to solve specific problems" },
      { label: "For an exam" },
      { label: "Just curious" },
    ]);
    await say(topicId, convId, "Pick an option or describe it in your own words.");
  });
}

/** The rest of the onboarding run after the interview answer, or from `from` onwards. */
export function runOnboarding(topicId: string, convId: string, from: "mission" | "sources", answer?: string, since?: string) {
  if (!runs.has(convId)) startRun(topicId, convId, since);
  const d = fx.topicDetails[topicId]!;
  script(topicId, convId, async () => {
    if (from === "mission") {
      setPhase(topicId, "interview", "done", answer ? `goal: ${answer.toLowerCase()}` : "goal recorded");
      setPhase(topicId, "mission", "active");
      activity(topicId, convId, "Updating the mission");
      await pause(convId, 3500);
      (fx.memoryFiles[topicId] ??= []).push({
        path: "MISSION.md",
        updatedAt: now(),
        content: `# Mission: ${d.topic.title}\n\n## Why\n\n${answer ?? "Goal from the interview"}.\n\n## Success means\n\nTo be agreed.\n\n## Constraints\n\nNone stated.\n\n## Already know\n\nTo be checked by the placement question.\n\n## Interests and context\n\nNone stated.\n\n## Out of scope\n\nNone stated.`,
      });
      emit(topicId, { type: "memory.updated" });
      setPhase(topicId, "mission", "done", "MISSION.md written");
    }

    setPhase(topicId, "sources", "active", "searching for sources");
    activity(topicId, convId, "Searching for sources");
    await pause(convId, 4000);
    for (const s of NEW_SOURCES) {
      activity(topicId, convId, `Reading a page: ${s.title}`);
      await pause(convId, 3200);
      d.sources.push({ ...s, id: `src-${++seq}` });
      emit(topicId, { type: "sources.updated" });
      const ok = d.sources.filter((x) => x.status === "ok").length;
      setPhase(topicId, "sources", "active", `${ok} found`);
    }
    activity(topicId, convId, "Checking quotes");
    await pause(convId, 2500);
    activity(topicId, convId, "Checking quotes");
    await pause(convId, 2500);
    const ok = d.sources.filter((x) => x.status === "ok").length;
    setPhase(topicId, "sources", "done", `${ok} sources`);
    activity(topicId, convId, `Added ${ok} sources`);

    setPhase(topicId, "graph", "active", "building the map");
    activity(topicId, convId, "Building the knowledge map");
    await pause(convId, 4000);
    const addNodes = (list: typeof NEW_NODES) => {
      d.nodes.push(...list.map((n) => ({ ...n, summary: `${n.title}: a node of the topic "${d.topic.title}".` })));
      d.topic.nodesTotal = d.nodes.length;
      emit(topicId, { type: "graph.updated" });
      setPhase(topicId, "graph", "active", `${d.nodes.length} topics`);
    };
    addNodes(NEW_NODES.slice(0, 3));
    activity(topicId, convId, "Linking prerequisites");
    await pause(convId, 3500);
    addNodes(NEW_NODES.slice(3));
    setPhase(topicId, "graph", "done", `${d.nodes.length} topics`);
    activity(topicId, convId, `Knowledge map: ${d.nodes.length} topics`);

    setPhase(topicId, "placement", "active", "placement question");
    activity(topicId, convId, "Preparing a placement question");
    await pause(convId, 2500);
    await say(topicId, convId, "Sources gathered, the map is ready. One last question to see where to start.");
    ask(topicId, convId, "What do you do first when your lower back aches after work?", [
      { label: "Stretch however I can" },
      { label: "Do a couple of exercises I know", description: "for example, cat–cow" },
      { label: "I don't know, I'm afraid of making it worse" },
    ]);
    // Real runs often add a line after ask_learner; the open question must stay answerable.
    await say(topicId, convId, "Pick an option or describe it in your own words.");
  });
}

export function runPlacementAnswer(topicId: string, convId: string, answer: string) {
  startRun(topicId, convId);
  const d = fx.topicDetails[topicId]!;
  script(topicId, convId, async () => {
    activity(topicId, convId, "Recording the level");
    await pause(convId, 2000);
    for (const n of d.nodes) n.placement = n.prereqs.length === 0 ? "partial" : "unknown";
    emit(topicId, { type: "graph.updated" });
    setPhase(topicId, "placement", "done", `${d.nodes.length} marked`);
    await say(topicId, convId, "Done. We'll start with a safe range of motion: without it, stretching can do harm. Click \"Next lesson\" when you're ready.");
  });
}

// ---------- Lesson generation ----------

export const lessonState = {
  status: fx.bayesOutline.map((_, i) => (i < 3 ? "published" : i === 3 ? "checking" : "pending")) as ("pending" | "checking" | "published" | "dropped")[],
  started: false,
  finished: null as string | null,
};

type Plan = [idx: number, what: "write" | "checking" | "published" | "rejected" | "dropped", ms: number, note?: string][];

export function runLessonGeneration() {
  if (lessonState.started) return;
  lessonState.started = true;
  const topicId = "t-bayes";
  const convId = "cb-1";
  conv(convId, topicId);
  startRun(topicId, convId, new Date(Date.now() - 95_000).toISOString());
  const plan: Plan = [
    [3, "published", 6000],
    [4, "write", 1500],
    [4, "checking", 1500],
    [4, "rejected", 7000, "the key is noticeably longer than the other options and can be guessed by length"],
    [4, "checking", 3000],
    [4, "published", 6000],
    [5, "write", 1500],
    [5, "checking", 1500],
    [5, "published", 8000],
    [6, "write", 1500],
    [6, "checking", 1500],
    [6, "published", 5000],
    [7, "write", 1500],
    [7, "checking", 1500],
    [7, "rejected", 5000, "the answer is not supported by a quote from the source"],
    [7, "checking", 2500],
    [7, "dropped", 5000],
    [8, "write", 1500],
    [8, "checking", 1500],
    [8, "published", 4000],
    [9, "write", 1500],
    [9, "checking", 1500],
    [9, "published", 8000],
  ];
  script(topicId, convId, async () => {
    for (const [idx, what, ms, note] of plan) {
      await pause(convId, ms);
      const n = idx + 1;
      if (what === "write") activity(topicId, convId, `Writing step ${n}`);
      else if (what === "published") {
        lessonState.status[idx] = "published";
        stepDone(topicId, convId, idx, `Step ${n} published`);
        emit(topicId, { type: "step.published", lessonId: "l-bayes", step: fx.bayesSteps[idx] as PublicStep });
      } else {
        if (what === "checking") activity(topicId, convId, `Checking step ${n}`);
        if (what === "rejected") {
          stepDone(topicId, convId, idx, `Step ${n} sent back for revision`);
          activity(topicId, convId, `Reworking step ${n}`);
        }
        if (what === "dropped") stepDone(topicId, convId, idx, `Step ${n} dropped`);
        if (what !== "rejected") lessonState.status[idx] = what;
        emit(topicId, {
          type: "step.status",
          lessonId: "l-bayes",
          idx,
          status: what,
          violations: note ? [{ rule: what === "rejected" && idx === 4 ? "Q4" : "Q6", message: note }] : [],
        });
      }
    }
    await pause(convId, 1500);
    lessonState.finished = "You learned to turn percentages into natural frequencies and find **P(sick | test+)**. The key point: a test result cannot be read without the prevalence.";
    const lesson = fx.topicDetails[topicId]!.lessons.find((l) => l.id === "l-bayes");
    if (lesson) lesson.status = "ready";
    emit(topicId, { type: "lesson.finished", lessonId: "l-bayes", summary: lessonState.finished });
    emit(topicId, { type: "cards.proposed", cardIds: ["pc1", "pc2", "pc3"] });
  });
}

// ---------- Stream hooks ----------

let stretchStarted = false;

export function onStreamOpen(topicId: string) {
  if (topicId === "t-bayes" && location.pathname.startsWith("/lessons/l-bayes")) runLessonGeneration();
  if (topicId === "t-stretch" && !stretchStarted) {
    stretchStarted = true;
    runOnboarding("t-stretch", "c-onb-stretch", "sources", undefined, runs.get("c-onb-stretch")?.since);
  }
  if (location.pathname.startsWith("/memory/")) {
    setTimeout(() => {
      const f = fx.memoryFiles[topicId]?.find((m) => m.path === "NOTES.md");
      if (!f || f.content.includes("Updated after the lesson")) return;
      f.content += "\n- Updated after the lesson: confidently converts percentages into frequencies.";
      f.updatedAt = now();
      emit(topicId, { type: "memory.updated" });
    }, 5000);
  }
}
