import type { HabitId, Outfit, OutfitItemId, OutfitSlot, RewardCondition, Tier } from "./game";
import type { Lang } from "./i18n";
import { COURSE_PRACTICE_SIZES, PRACTICE_SIZES, type Answer, type Card, type GoalPlanEntry, type GraphNode, type Level, type PracticeFocus, type PracticeSize, type PublicFigure, type PublicItem, type PublicStep, type Resident } from "./schemas";

// REST contract. All routes are under /api and exchange JSON.
// Errors: non-2xx with body ApiError.

export type ApiError = { error: string };

export type ConversationKind = "onboard" | "lesson" | "tutor" | "review" | "teachback";

export type TopicSummary = {
  id: string;
  slug: string;
  title: string;
  createdAt: string;
  dueCards: number;
  nodesMastered: number;
  nodesTotal: number;
  /** A Claude run is in progress in one of the topic's conversations. */
  running: boolean;
  /** A goal holds no lessons: its onboarding plans the topics that lead to it. */
  kind: "topic" | "goal";
  /** The goal whose plan opened this topic. */
  goalId: string | null;
  /** Goals only: plan entries, and how many of them are opened as topics. */
  plan: { total: number; opened: number } | null;
  /** Best graded final exam of the topic, in percent; null before one. */
  final: { percent: number; passed: boolean } | null;
};

/** Onboarding stages, derived from stored state (workspace files, sources, graph, placement). */
export type OnboardingPhase = {
  key: "interview" | "mission" | "sources" | "graph" | "placement" | "plan";
  label: string;
  status: "done" | "active" | "pending";
  /** Short fact about the stage, e.g. "10 sources", "14 topics". */
  detail: string | null;
};

export type NodeView = GraphNode & {
  placement: "known" | "partial" | "unknown" | null;
  mastery: "new" | "learning" | "exit_passed" | "mastered";
};

export type LessonSummary = {
  id: string;
  topicId: string;
  title: string;
  objective: string;
  level: Level;
  nodeIds: string[];
  status: "generating" | "ready" | "finished" | "failed";
  createdAt: string;
  /** Published or dropped steps, and the outline length; lets the UI say "8 of 10 steps ready". */
  stepsReady: number;
  stepsTotal: number;
  /** Sources were added to the topic after this lesson was planned; the lesson can be rebuilt. */
  sourcesStale: boolean;
  /** A newer lesson covers the same nodes; this one is an earlier version. */
  supersededBy: string | null;
  /** The learner's progress, separate from the authoring `status`: completed once every exit-check item has an attempt. */
  learnerStatus: "not_started" | "in_progress" | "completed";
  /** The lesson's video, if one was requested. */
  video: VideoStatus | null;
  /** Set for a practice set: a lesson of practice steps only, with no exit check. */
  practice: { size: number; focus: PracticeFocus } | null;
};

// POST /api/lessons/:lessonId/resume -> StartLessonResponse (continues a failed lesson in its own authoring
// session; 409 when the lesson is not failed or the session is gone)
// POST /api/lessons/:lessonId/rebuild -> StartLessonResponse (a new lesson-author run for the same nodes;
// the old lesson stays until the new one is finished)

export type SourceView = { id: string; url: string; title: string; kind: string; note: string; status: "ok" | "failed" };

export const MATERIAL_KINDS = ["text", "markdown", "html", "pdf", "link"] as const;
export type MaterialKind = (typeof MATERIAL_KINDS)[number];

/** File name extensions a learner material may have, and the kind each one is read as. */
export const MATERIAL_EXTENSIONS: Record<string, Exclude<MaterialKind, "link">> = {
  ".txt": "text",
  ".md": "markdown",
  ".markdown": "markdown",
  ".html": "html",
  ".htm": "html",
  ".pdf": "pdf",
};

export const MATERIAL_LIMITS = {
  /** A file, a pasted text or a downloaded link. */
  bytes: 20 * 1024 * 1024,
  /** Extracted text of one material. */
  chars: 2_000_000,
  /** Materials in one request. */
  perRequest: 10,
} as const;

/** A source the learner brought. Its extracted text is stored like a fetched page, so lessons cite it (Q6). */
export type MaterialView = {
  id: string;
  title: string;
  kind: MaterialKind;
  /** The address of a link; null for a file or pasted text. */
  url: string | null;
  /** Size of the file or the pasted text; null for a link. */
  bytes: number | null;
  /** Characters of extracted text. */
  chars: number;
  addedAt: string;
  /** Lesson steps, exercises or cards cite it, so it cannot be removed. */
  cited: boolean;
};

/** A `text` part of a materials request. */
export type PastedMaterial = { title: string; text: string };

// POST /api/topics/:topicId/materials  multipart/form-data -> MaterialView[] (201; the added materials)
// Parts, up to MATERIAL_LIMITS.perRequest in all: `file` (a file with an extension of MATERIAL_EXTENSIONS),
// `text` (JSON PastedMaterial), `link` (an http(s) address). The server extracts the text of every part before it
// stores any; a part that fails fails the request with a message naming it.
// DELETE /api/topics/:topicId/materials/:materialId -> 204 (409 when lesson content cites it)

export type TopicDetail = {
  topic: TopicSummary;
  nodes: NodeView[];
  lessons: LessonSummary[];
  /** Sources Claude registered; the learner's own are in `materials`. */
  sources: SourceView[];
  materials: MaterialView[];
  conversations: { id: string; kind: ConversationKind; lessonId: string | null; createdAt: string }[];
  onboarding: OnboardingPhase[];
  /** Goals only, in plan order. */
  plan: GoalPlanEntryView[];
  /** The goal whose plan opened this topic, with the entry's reason for it. */
  goal: { id: string; title: string; why: string } | null;
  /** Goals only: facts the goal's courses recorded that the goal conversation has not received yet. */
  goalNotes: GoalNoteView[];
  /** Teach-back sessions, newest first; their conversations are not in `conversations`. */
  teachbacks: TeachbackSummary[];
};

// GET /api/glossary -> GlossaryEntry[]  (every topic's terms, by term)
export type GlossaryEntry = {
  topicId: string;
  topicTitle: string;
  term: string;
  definition: string;
  original: string | null;
  avoid: string[];
  updatedAt: string;
};

export type GoalNoteView = { id: string; text: string; topicId: string; topicTitle: string; createdAt: string };

export type GoalPlanEntryView = Omit<GoalPlanEntry, "brief"> & { topic: TopicSummary | null };

// POST /api/topics  { request, kind? }  -> CreateTopicResponse  (starts the onboarding run)
// A topic created with materials is posted as multipart/form-data: `request`, `kind` and the parts of a materials
// request. The materials are stored before the onboarding run starts; one that fails creates nothing.
export type CreateTopicRequest = { request: string; kind?: TopicSummary["kind"] };
export type CreateTopicResponse = { topicId: string; conversationId: string };

// POST /api/topics/:goalId/plan/:entryId/open -> CreateTopicResponse  (creates the entry's topic and starts its onboarding)
// POST /api/topics/:goalId/notes/discuss -> { conversationId }  (sends the unseen goal notes to the goal conversation)

// GET /api/topics -> TopicSummary[]
// GET /api/topics/:topicId -> TopicDetail
// GET /api/topics/:topicId/memory -> MemoryFile[]   (MISSION.md, RESOURCES.md, GLOSSARY.md, NOTES.md, learning-records/*)
export type MemoryFile = { path: string; content: string; updatedAt: string };

// GET /api/topics/:topicId/stream -> text/event-stream of TopicEvent, one unnamed `data: <json>` event per
// TopicEvent; `:` comment lines are heartbeats.

// POST /api/topics/:topicId/lessons { nodeId? } -> StartLessonResponse (starts a lesson-author run)
export type StartLessonRequest = { nodeId?: string };
export type StartLessonResponse = { lessonId: string | null; conversationId: string };

// Practice sets: fresh practice items on demand, written by a practice-set run and gated like lesson steps.
// GET  /api/practice/scope?topicId=&nodeId= | ?lessonId= | ?itemId= | ?courseId= -> PracticeScope (the nodes a set from there covers)
// POST /api/practice PracticeRequest -> StartLessonResponse (lessonId set: the set exists at once, its steps follow)
// GET  /api/lessons/:lessonId/practice -> PracticeResults (practice sets only)
/**
 * Where the learner asked for practice: a graph node, a lesson's nodes, the node of an item ("more like this"),
 * or every node of a course that passed its exit check.
 */
export type PracticeFrom = { topicId: string; nodeId: string } | { lessonId: string } | { itemId: string } | { courseId: string };

export function practiceSizes(from: PracticeFrom): readonly PracticeSize[] {
  return "courseId" in from ? COURSE_PRACTICE_SIZES : PRACTICE_SIZES;
}
export type PracticeRequest = { from: PracticeFrom; size: PracticeSize; focus: PracticeFocus };
export type PracticeScope = {
  topicId: string;
  nodes: { id: string; title: string }[];
  /** Items on these nodes the learner answered wrongly or gave up on; the "mistakes" focus needs at least one. */
  mistakes: number;
  /** A course set only: nodes its latest final exam found weak, which get more items. */
  weakNodeIds: string[];
};
/** First try: correct on the first attempt, without hints. */
export type PracticeResults = {
  total: number;
  answered: number;
  firstTry: number;
  solved: number;
  nodes: { nodeId: string; title: string; total: number; firstTry: number; solved: number }[];
};

// GET /api/lessons/:lessonId -> LessonView
export type LessonView = {
  lesson: LessonSummary & { summary: string | null };
  outline: { kind: string; title: string }[];
  steps: PublicStep[];
  /** Index of each outline entry's state. */
  stepStatus: ("pending" | "checking" | "published" | "dropped")[];
  /** Conversation of the lesson-author run, and of the tutor if one exists. */
  authorConversationId: string | null;
  tutorConversationId: string | null;
  /** The learner's progress on each published item, keyed by item id, so a reload restores it. */
  itemStates: Record<string, ItemState>;
  /** Faded worked-example lines already answered: stepId -> line indices, with their revealed text. */
  revealedLines: Record<string, { idx: number; text: string }[]>;
  /** Outline index of the lesson's challenge step, planned while gamification was on (G1). */
  challengeIdx: number | null;
  /** Alternative explanations the learner asked for: stepId -> oldest first. */
  alternatives: Record<string, AlternativeView[]>;
};

export type ItemState = {
  attempts: number;
  wrongAttempts: number;
  /** Answered correctly at least once. */
  solved: boolean;
  gaveUp: boolean;
  /** Hints shown so far, in ladder order. */
  hints: string[];
  /** Feedback of the latest attempt. */
  lastFeedback: string | null;
  /** Confidence the learner gave with the latest answer. */
  lastConfidence: Confidence | null;
  /** Present once solved, given up, or for an answered prequestion (L7). */
  solution?: string;
  correctAnswer?: string;
};

// Conversations
// GET  /api/conversations/:id -> ConversationView
// POST /api/conversations/:id/messages { text } -> 202 { accepted: true }
// POST /api/conversations/:id/cancel -> 202
export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "activity" | "ask" | "error";
  text: string;
  /** For role "ask": the options shown. */
  options?: { label: string; description?: string }[];
  multi?: boolean;
  allowFree?: boolean;
  /** For role "activity": the past-tense label shown once the action is finished. */
  doneText?: string;
  /** For role "user": the passage the learner asked about. */
  quote?: string;
  createdAt: string;
};
export type ConversationView = {
  id: string;
  topicId: string;
  kind: ConversationKind;
  running: boolean;
  /** When the current run started; null when idle. */
  runningSince: string | null;
  /** Label of the latest activity in the current run, e.g. "Searching for sources"; null when idle. */
  currentActivity: string | null;
  messages: ChatMessage[];
};
export type SendMessageRequest = { text: string };

// Items (grading happens on the server; keys never leave it)
// POST /api/items/:itemId/attempt AttemptRequest -> AttemptResponse

/** How sure the learner was before checking an answer (L23). Self-reported: it changes neither the grade nor mastery. */
export const CONFIDENCE_LEVELS = ["guess", "unsure", "sure"] as const;
export type Confidence = (typeof CONFIDENCE_LEVELS)[number];

export type AttemptRequest = {
  answer: Answer;
  hintsUsed: number;
  durationMs: number;
  context: "activate" | "check" | "practice" | "explain" | "review";
  confidence?: Confidence;
};
export type AttemptResponse = {
  correct: boolean | null; // null for ungraded prequestions and pending short answers
  /** The confidence stored with the attempt; prequestions store none. */
  confidence: Confidence | null;
  /** Option-specific feedback, or general feedback. */
  feedback: string;
  /** match and sort: per entry in display order, whether the learner placed it right. */
  marks?: boolean[];
  /** Present when the learner answered correctly, gave up, or the item is a prequestion. */
  solution?: string;
  correctAnswer?: string;
  attemptNo: number;
  /** True when the client should offer the tutor (L10). */
  offerTutor: boolean;
};
// POST /api/items/:itemId/hint { level } -> { level, hint }
export type HintResponse = { level: number; hint: string; hintCount: number };
// POST /api/items/:itemId/giveup -> { solution, correctAnswer }
export type GiveUpResponse = { solution: string; correctAnswer: string };
// POST /api/worked/:stepId/lines/:lineIdx { answer } -> { correct, text }
export type WorkedLineResponse = { correct: boolean; text: string };
// POST /api/steps/:stepId/reflect { text } -> 202

// Tutor: POST /api/lessons/:lessonId/tutor { itemId?, stepId?, line?, quote?, text } -> { conversationId }
/**
 * line: a worked-example line of stepId whose open blank the learner answers through the tutor.
 * quote: text the learner selected on the page and asks about.
 */
export type TutorRequest = { itemId?: string; stepId?: string; line?: number; quote?: string; text: string };

// Teach-back (L24): after completing a lesson the learner explains a node to a novice persona.
// POST /api/topics/:topicId/teachbacks StartTeachbackRequest -> TeachbackView (starts the conversation; without lessonId
// the newest lesson on the node the learner completed; 409 when there is none)
// GET /api/teachbacks/:id -> TeachbackView
// POST /api/teachbacks/:id/finish -> TeachbackView (starts the debrief; 409 while the persona is replying, before the
// learner has written anything, or once the debrief is running or done)
// A teach-back unlocks nothing (L12).
export type StartTeachbackRequest = { nodeId: string; lessonId?: string };

export type TeachbackStatus = "talking" | "debriefing" | "done" | "failed";

export type TeachbackSummary = {
  id: string;
  topicId: string;
  nodeId: string;
  nodeTitle: string;
  lessonId: string;
  lessonTitle: string;
  conversationId: string;
  status: TeachbackStatus;
  createdAt: string;
  finishedAt: string | null;
  /** Key ideas covered; null until the debrief is done. */
  score: { covered: number; total: number } | null;
};

/** A key idea: one published explain or worked_example step of the lesson, checked against the learner's words. */
export type TeachbackIdea = {
  stepId: string;
  /** Position of the step in the lesson, for a link to it. */
  stepIdx: number;
  title: string;
  verdict: "covered" | "missing" | "wrong";
  /** The learner's words the verdict rests on, verbatim; null for a missing idea. */
  evidence: string | null;
  /** The idea as the lesson states it; null for a covered idea. */
  correction: string | null;
};

export type TeachbackAction = { kind: "reread" | "practice"; stepId: string; stepIdx: number; title: string };

export type TeachbackDebrief = { summary: string; ideas: TeachbackIdea[]; next: TeachbackAction[] };

export type TeachbackView = TeachbackSummary & { debrief: TeachbackDebrief | null; error: string | null };

// Review
// GET /api/review?topicId= -> ReviewSession
export type ReviewCard = { id: string; topicId: string; kind: Card["kind"]; front: string; back: string; nodeId: string };
export type ReviewSession = {
  cards: ReviewCard[];
  items: PublicItem[];
  /** Ids of `items` that return because the learner was sure of a wrong answer to them (L23). */
  retests: string[];
};
// POST /api/cards/:cardId/review { rating: 1|2|3|4, durationMs? } -> { due }
export type ReviewRating = 1 | 2 | 3 | 4;
// GET /api/topics/:topicId/cards?status=proposed -> CardView[]
export type CardView = ReviewCard & { status: "proposed" | "active" | "suspended" | "rejected"; due: string | null; lapses: number };
// POST /api/cards/:cardId/accept | /suspend | /reject ; PATCH /api/cards/:cardId { front, back }

// Practice tests (L20): a cumulative, unaided test over the finished lessons of a topic, or of every topic of a goal.
// GET    /api/topics/:topicId/tests -> PracticeTestOverview
// POST   /api/topics/:topicId/tests PracticeTestRequest -> PracticeTestView (201; 409 while a test of the topic is open
//        or when it has no finished lesson)
// GET    /api/tests/:testId -> PracticeTestView (submits an open test whose time is up; restarts grading a server restart stopped)
// PATCH  /api/tests/:testId/questions/:idx PracticeAnswerUpdate -> 204 (409 once the test is submitted or its time is up)
// POST   /api/tests/:testId/submit -> PracticeTestView (short answers are graded in the background: status "grading")
// POST   /api/tests/:testId/regrade -> PracticeTestView (grades the answers whose grading failed again)
// DELETE /api/tests/:testId -> 204 (open tests only)
// GET    /api/topics/:topicId/final -> FinalExamView
// POST   /api/topics/:topicId/final -> PracticeTestView (201; 409 unless FinalExamView.canStart)
// Test answers stay out of `attempts`: first-try results, exit checks and learner signals do not see them.

export const PRACTICE_LENGTHS = [10, 20, 30] as const;
/** Questions in an "all" test at most. */
export const PRACTICE_MAX_QUESTIONS = 100;
export const PRACTICE_TIME_LIMITS = [10, 20, 30, 60] as const;

export type PracticeTestRequest = {
  length: (typeof PRACTICE_LENGTHS)[number] | "all";
  /** Minutes; null for an untimed test. */
  timeLimitMin: (typeof PRACTICE_TIME_LIMITS)[number] | null;
};

/** Fields left out stay as they are; `spentMs` adds to the time spent on the question. */
export type PracticeAnswerUpdate = { answer?: Answer | null; flagged?: boolean; spentMs?: number };

export type PracticeTestSummary = {
  id: string;
  topicId: string;
  kind: "practice" | "final";
  status: "open" | "grading" | "done";
  questions: number;
  answered: number;
  /** Graded correct answers; null while the test is open. */
  correct: number | null;
  createdAt: string;
  submittedAt: string | null;
  timeLimitMin: number | null;
  /** When the time is up; null for an untimed test. */
  endsAt: string | null;
};

export type PracticeTestOverview = {
  /** Questions a new test can draw on. */
  eligible: number;
  lessonsFinished: number;
  open: PracticeTestSummary | null;
  /** Submitted tests, newest first. */
  history: PracticeTestSummary[];
};

/** A final exam holds at least this many questions, or one per node of a larger course. */
export const FINAL_MIN_QUESTIONS = 30;
/** Share of a final answered right to pass it, and the share under which a node is weak: the L12 threshold. */
export const FINAL_PASS_SHARE = 0.8;

/** The closing test of a topic (L21): it opens once every node has passed its exit check. */
export type FinalExamView = {
  nodesPassed: number;
  nodesTotal: number;
  /** Questions a final started now would hold. */
  questions: number;
  /** The topic's open test of either kind: one test runs at a time. */
  open: PracticeTestSummary | null;
  /** Best graded final. */
  best: PracticeTestSummary | null;
  /** Latest final, while it is being graded or after. */
  latest: PracticeTestSummary | null;
  passed: boolean;
  /** Nodes under the pass share in the latest final; a retake waits until each is practised again after it. */
  weakNodes: { nodeId: string; title: string; lessonId: string | null; practised: boolean }[];
  canStart: boolean;
};

/** Present once the test is submitted (L9, L11). */
export type PracticeResult = {
  /** null while grading runs or after it failed. */
  correct: boolean | null;
  gradingFailed: boolean;
  /** The chosen option's feedback, or the rubric verdict of a short answer. */
  feedback: string | null;
  correctAnswer: string;
  solution: string;
  topicId: string;
  nodeId: string;
  nodeTitle: string;
  lessonId: string | null;
  lessonTitle: string | null;
};

export type PracticeQuestion = { idx: number; item: PublicItem; answer: Answer | null; flagged: boolean; result: PracticeResult | null };

export type PracticeNodeScore = {
  topicId: string;
  topicTitle: string;
  nodeId: string;
  title: string;
  correct: number;
  total: number;
  /** Lessons the node's questions came from. */
  lessons: { id: string; title: string }[];
};

export type PracticeTestView = {
  test: PracticeTestSummary;
  scope: { id: string; title: string; kind: TopicSummary["kind"] };
  questions: PracticeQuestion[];
  /** Weakest node first; empty while the test is open. */
  breakdown: PracticeNodeScore[];
  /** Missed questions come back in Review from this time; null while open or with nothing missed. */
  reviewFrom: string | null;
};

// Notes: POST /api/notes NoteRequest -> NoteView ; PATCH /api/notes/:noteId { text } -> 204 ; GET /api/topics/:topicId/notes -> NoteView[]
/** text may be empty when the note keeps a quote. */
export type NoteRequest = { topicId: string; lessonId?: string; stepId?: string; quote?: string; text: string };
export type NoteView = NoteRequest & { id: string; createdAt: string };

// Search: GET /api/search?q= -> SearchResults
// Matches what the learner can see: topic and goal titles and requests, lesson titles and objectives, the text of
// published explain and worked-example steps without faded lines, glossary terms and definitions, notes, and the
// fronts of accepted cards. Lessons that a newer version supersedes, and their steps, are left out. Case and the
// letters of ContentRules.fold are ignored. Every word of at least MIN_WORD (shared/search.ts) characters must occur
// and shorter words are ignored; a query with no such word matches titles that contain it.
// Hits come grouped in SEARCH_KINDS order, best first, at most SEARCH_PER_KIND of a kind.

export const SEARCH_KINDS = ["topic", "lesson", "step", "term", "note", "card"] as const;
export type SearchKind = (typeof SEARCH_KINDS)[number];
export const SEARCH_PER_KIND = 5;

/** `marks` are the matched [start, end) ranges of `text`, as UTF-16 offsets. */
export type SearchText = { text: string; marks: [number, number][] };

export type SearchHit = {
  kind: SearchKind;
  /** The topic, lesson, step, note or card id; for a term, its glossary key. */
  id: string;
  title: SearchText;
  /** The passage that matched; a lesson's objective, a term's definition, a note's quote. */
  snippet: SearchText | null;
  topicId: string;
  topicTitle: string;
  topicKind: TopicSummary["kind"];
  lessonId: string | null;
  lessonTitle: string | null;
  /** The step the hit is in, as a 0-based index into the lesson outline. */
  stepIdx: number | null;
};

export type SearchResults = { query: string; hits: SearchHit[] };

// Reports: POST /api/reports { targetType, targetId, text } -> 202
export type ReportRequest = { targetType: "item" | "card" | "step"; targetId: string; text: string };

// Audit: GET /api/audit/sample?n=10 -> AuditEntry[] ; POST /api/audit/:itemId { verdict, note }
export type AuditEntry = {
  itemId: string;
  topicTitle: string;
  item: unknown; // authoring view, shown only on the audit page
  gate: { stage: string; rule: string; pass: boolean; message: string }[];
};
export type AuditVerdict = { verdict: "ok" | "missed_defect"; note?: string };

// Stats: GET /api/stats/activity?days=7&topicId= -> ActivityDay[] (oldest first, one entry per local day,
// days without activity included with zeros). Attempts include notebook retries and the answers of submitted practice
// tests. Minutes are the sum of attempt and retry durations, time on practice-test answers and review time.
export type ActivityDay = { date: string; attempts: number; correct: number; reviews: number; minutes: number };

// Calibration: GET /api/stats/calibration -> CalibrationView
// Graded answers that carry a confidence rating (prequestions and give-ups excluded), all time.
export type CalibrationLevel = { confidence: Confidence; attempts: number; correct: number };
export type CalibrationView = {
  /** One entry per confidence level, in CONFIDENCE_LEVELS order. */
  overall: CalibrationLevel[];
  /** Topics with rated answers, most rated first; levels as in `overall`. */
  topics: { topicId: string; title: string; levels: CalibrationLevel[] }[];
};

// Weak spots: GET /api/weak?topicId=&limit=10 -> WeakSpot[]
// Items with at least 2 wrong attempts in the last 30 days, and leech cards (lapses >= 8), worst first.
export type WeakSpot =
  | { kind: "item"; itemId: string; topicId: string; lessonId: string | null; nodeId: string; prompt: string; wrongAttempts: number; lastMisconception: string | null }
  | { kind: "card"; cardId: string; topicId: string; nodeId: string; front: string; lapses: number };

// Mistakes notebook (L22): GET /api/mistakes -> MistakesView
// GET /api/mistakes/:itemId/solution -> MistakeSolution ; POST /api/mistakes/:itemId/retry RetryRequest -> RetryResponse
// Both 404 for an item that is not in the notebook, so a solution never leaves the server before an attempt (L7, L9).
// A graded item (not a prequestion) is in the notebook when its first attempt was wrong or the learner gave up on it.
// Retries are stored apart from attempts: first-try results, the exit check, mastery and learner signals ignore them.
export type MistakeEntry = {
  itemId: string;
  topicId: string;
  topicTitle: string;
  nodeId: string;
  nodeTitle: string;
  lessonId: string | null;
  lessonTitle: string | null;
  /** Position of the item's step in its lesson, from 0. */
  stepIdx: number | null;
  item: PublicItem;
  /** The learner's first wrong answer as text; null when they gave up without answering. */
  answer: string | null;
  /** Named misconception of the distractor in `answer`. */
  misconception: string | null;
  gaveUp: boolean;
  /** When the first wrong answer or give-up happened. */
  at: string;
  retries: number;
  /** A day after the latest wrong answer, give-up or wrong retry: from then on a correct retry resolves the entry. */
  readyAt: string;
  resolvedAt: string | null;
};

/** A distractor of an open entry chosen at least twice, in attempts and retries: a confirmed misconception. */
export type MistakePattern = {
  itemId: string;
  topicId: string;
  nodeTitle: string;
  option: string;
  misconception: string | null;
  times: number;
};

/** Entries newest first; patterns most frequent first. */
export type MistakesView = { entries: MistakeEntry[]; patterns: MistakePattern[] };
export type MistakeSolution = { solution: string; correctAnswer: string };
export type RetryRequest = { answer: Answer; durationMs: number };
export type RetryResponse = MistakeSolution & { correct: boolean; feedback: string; entry: MistakeEntry };

// Today: GET /api/today -> TodayView ; PUT /api/goal { minutes } -> TodayView
// A day with an answered item or a reviewed card extends the streak; the daily goal does not affect it.
// Every 7 streak days earn a freeze, at most 2 held; a freeze covers one missed day and keeps the streak.
export type GoalMinutes = 5 | 10 | 20;
export type TodayView = {
  streak: {
    /** Active days in the current streak, today included once it is active. */
    days: number;
    best: number;
    activeToday: boolean;
    freezes: number;
    /** Streak days left until the next freeze; null while the maximum is held. */
    nextFreezeIn: number | null;
    /** Missed days of the current streak that freezes covered, oldest first. */
    frozen: string[];
  };
  /** Minutes as in ActivityDay. */
  goal: { minutes: GoalMinutes; done: number };
  /** Nodes that passed the exit check or became mastered today. */
  advanced: { topicId: string; nodeId: string; title: string; mastery: "exit_passed" | "mastered" }[];
  /** Earliest local day with cards that are not due yet, and how many come due by its end. */
  nextReview: { date: string; cards: number } | null;
  /** Open entries of the mistakes notebook, and how many of them a correct retry would resolve now. */
  mistakes: { open: number; ready: number };
};

// Settings: GET /api/settings -> Settings ; PUT /api/settings SettingsUpdate -> Settings
// The language applies to the UI and to everything Claude writes from the next run on; existing content keeps its language.
// A Claude role's model and effort apply from the next `claude` process of that role.
// PUT /api/settings/elevenlabs-key { key } -> Settings (400 when ElevenLabs rejects the key) ; DELETE -> Settings
// The key goes to the OS credential store and never leaves the server.
// GET /api/settings/voices -> VoiceView[] (409 without a key)

export const TTS_MODELS = ["eleven_v4", "eleven_v4_turbo"] as const;
export type TtsModel = (typeof TTS_MODELS)[number];

export const CLAUDE_MODELS = ["fable", "opus", "sonnet", "haiku"] as const;
export type ClaudeModel = (typeof CLAUDE_MODELS)[number];

export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof EFFORTS)[number];

/** Haiku models take no effort parameter (supportedModels of the Claude API effort docs). */
export const supportsEffort = (model: string): boolean => !model.includes("haiku");

export const CLAUDE_ROLES = ["onboard", "lesson", "tutor", "review", "teachback", "critic", "grading", "narration", "video", "game"] as const satisfies readonly ClaudeInstanceKind[];

/** Null fields use the server defaults: CLAYFOLD_MODEL or CLAYFOLD_CRITIC_MODEL, and the role's default effort. */
export type ClaudeRoleSetting = { model: ClaudeModel | null; effort: Effort | null };

export type Settings = {
  language: Lang;
  /** `prefetch`: the lesson player voices the next explanation while one plays. */
  narration: { keySet: boolean; voiceId: string | null; model: TtsModel; prefetch: boolean };
  /** Video lessons; they use the narration key, voice and model. */
  video: { enabled: boolean };
  /** Graded answers offer a confidence rating before they are checked (L23); on by default. */
  confidence: { enabled: boolean };
  /** Key badges on answer options and primary buttons, shown on devices with a fine pointer. */
  shortcuts: { hints: boolean };
  /** Teach-back (L24) is offered only while on; off by default. */
  teachback: { enabled: boolean };
  claude: Record<ClaudeInstanceKind, ClaudeRoleSetting & { defaultModel: string; defaultEffort: Effort }>;
  /** The meerkat; off by default. While on, goal plans carry trophies and lessons a challenge step. */
  gamification: boolean;
  /** Entries of the "What's new" tour already seen. */
  introSeen: IntroFeature[];
};

/**
 * Entries of the "What's new" tour, shown on entering the app like a changelog: each entry the learner has not
 * seen yet, oldest first. A new optional feature adds an entry here with its release date.
 */
export const INTRO_FEATURES = ["video", "game", "practice", "lessons", "comfort", "teachback"] as const;
export type IntroFeature = (typeof INTRO_FEATURES)[number];
export const INTRO_RELEASED: Record<IntroFeature, string> = {
  video: "2026-10-04",
  game: "2026-10-04",
  practice: "2026-10-05",
  lessons: "2026-10-05",
  comfort: "2026-10-05",
  teachback: "2026-10-05",
};

export type SettingsUpdate = {
  gamification?: boolean;
  /** Replaces the list of tour entries seen; an empty list shows the whole tour again. */
  introSeen?: IntroFeature[];
  language?: Lang;
  voiceId?: string;
  ttsModel?: TtsModel;
  narrationPrefetch?: boolean;
  videoEnabled?: boolean;
  confidenceEnabled?: boolean;
  shortcutHints?: boolean;
  teachbackEnabled?: boolean;
  claudeRole?: ClaudeRoleSetting & { role: ClaudeInstanceKind };
};

export type VoiceView = { id: string; name: string; previewUrl: string | null };

// Meerkat (gamification). Every route answers 409 while Settings.gamification is off.
// GET /api/game -> GameView (first unlocks every reward and habit whose condition holds now)
// PUT /api/game/outfit { slot, item: OutfitRef | null } -> GameView (400 for a locked item or one of another slot)
// POST /api/game/seen { rewards?: string[], habits?: HabitId[], ranks?: number[], residents?: string[] (topic ids) } -> 204
// POST /api/game/focus { lessonId, longestAwayMs } -> 204 (sent when the learner completes a lesson)
// GET /api/game/crowns -> CrownsView

/** A reward Claude designed with a lesson, a course or a goal. */
export type RewardView = {
  id: string;
  /** The course or goal it belongs to. */
  topicId: string;
  topicTitle: string;
  source: "lesson" | "course" | "stage";
  name: string;
  description: string;
  slot: OutfitSlot;
  svg: string;
  tier: Tier;
  condition: RewardCondition;
  /** Progress: check items answered (complete) or right on the first try (crowns), nodes reached, courses of the stage completed. */
  done: number;
  total: number;
  unlockedAt: string | null;
  /** The learner has seen the unlock. */
  seen: boolean;
};

export type HabitView = {
  id: HabitId;
  item: OutfitItemId;
  tier: Tier;
  /** Progress towards `target`, capped at it. */
  done: number;
  target: number;
  unlockedAt: string | null;
  seen: boolean;
};

// GET /api/game/backfill -> GameBackfillView ; POST -> GameBackfillView (starts one Claude call per course, goal and
// lesson that was built before the meerkat was on and lacks its rewards; a running backfill is left alone)
export type GameBackfillView = {
  running: boolean;
  done: number;
  total: number;
  /** Titles of the courses, goals and lessons whose rewards could not be made. */
  failed: string[];
  finishedAt: string | null;
  /** Courses, goals and lessons still without their rewards. */
  missing: number;
};

/** silver: at least CROWN_SHARE of the exit check right on the first attempt; gold: also the challenge right on the first attempt without hints. */
export type Crown = "silver" | "gold";

/** Lesson crowns by lesson id; days are local dates on which the daily goal was met. */
export type CrownsView = { lessons: Record<string, Crown>; days: string[] };

/** The learning step the meerkat points at. */
export type GameNudge =
  | { kind: "continue"; lessonId: string; title: string }
  | { kind: "review"; count: number }
  | { kind: "start"; lessonId: string; title: string }
  | { kind: "new" };

/** A course's resident; befriended once the learner completes a lesson of the course. */
export type ResidentView = Resident & { befriendedAt: string | null; seen: boolean };

/** A course as a chamber of the burrow: it grows with the nodes past the exit check. */
export type BurrowRoom = { topicId: string; title: string; passed: number; total: number; goalId: string | null; resident: ResidentView | null };

export type GameView = {
  outfit: Outfit;
  rewards: RewardView[];
  habits: HabitView[];
  /** Points of every unlock by tier; the rank indexes RANKS; next is the points of the next rank. */
  rank: { rank: number; points: number; next: number | null; seen: boolean };
  crowns: { silver: number; gold: number; days: number };
  rooms: BurrowRoom[];
  nudge: GameNudge;
};


// Narration: POST /api/steps/:stepId/narration -> NarrationView (explain steps only; 409 without a key)
// The first call writes a spoken script and synthesises it; later calls with the same voice and model return the stored audio.
// GET /api/steps/:stepId/narration/audio -> audio/mpeg

/** `block` indexes the top-level blocks of the step body as rendered; times are seconds into the audio. */
export type NarrationSegment = { block: number; start: number; end: number };

export type NarrationView = { audioUrl: string; segments: NarrationSegment[] };

// Explain differently: POST /api/steps/:stepId/alternatives { lens } -> AlternativeView (explain and worked_example
// steps; 409 while the lesson's exit check is under way, L11). Claude writes it from the step text the learner has
// seen, never from the step's items or unanswered lines (L7); each one is stored and returned in LessonView.alternatives.
export const EXPLAIN_LENSES = ["simpler", "analogy", "steps", "example", "precise"] as const;
export type ExplainLens = (typeof EXPLAIN_LENSES)[number];

/** A worked example is a concrete case already, so it has no example-first lens. */
export const lensesFor = (kind: "explain" | "worked_example"): readonly ExplainLens[] =>
  kind === "explain" ? EXPLAIN_LENSES : EXPLAIN_LENSES.filter((lens) => lens !== "example");

export type AlternativeView = { id: string; lens: ExplainLens; body: string; createdAt: string };

// Video lessons: GET /api/lessons/:lessonId/video -> VideoView (404 when none was requested)
// POST /api/lessons/:lessonId/video -> VideoView: starts a build, or a rebuild of a ready or failed video
// (409 when video lessons are off, without a key, or for a lesson that is still being written).
// GET /api/lessons/:lessonId/video/clips/:idx -> audio/mpeg
// The video covers every explain and worked_example step of the lesson, one chapter per step. The browser plays
// the scenes in time with the narration clips; the timeline holds everything needed to render it to a file later.

export type VideoStatus = "building" | "ready" | "failed";

/** Text that appears when the narration reaches it; `at` is seconds into the video. */
export type CuedText = { text: string; at: number };

/** What a scene shows; text is inline markdown unless the field says otherwise. */
export type VideoScreen =
  | { kind: "intro"; heading: string; subheading: string; chapters: CuedText[] }
  | { kind: "chapter"; number: number; heading: string }
  | { kind: "points"; heading: string; points: CuedText[] }
  | { kind: "statement"; text: string; note: string | null }
  /** One block of the step body as written (code, a table, a formula), as block markdown. */
  | { kind: "block"; heading: string; markdown: string }
  | { kind: "figure"; heading: string; figure: PublicFigure; caption: string | null }
  | { kind: "example"; heading: string; problem: string; lines: CuedText[] }
  | { kind: "summary"; heading: string; points: CuedText[] };

/** Seconds into the video; a scene lasts until the next one starts. */
export type VideoScene = { screen: VideoScreen; start: number };

export type VideoTimeline = {
  duration: number;
  scenes: VideoScene[];
  /** Narration clips in order; `start` is where each one begins in the video. */
  clips: { start: number; duration: number }[];
  /** One entry per lesson step, for the chapter list and the progress bar. */
  chapters: { title: string; start: number }[];
  /** Subtitle lines of the narration, timed from the voice. */
  captions: { text: string; start: number; end: number }[];
};

export type VideoView =
  /** `done` of `total` scripts and narration clips are finished. */
  | { status: "building"; done: number; total: number }
  | { status: "failed"; error: string }
  | ({ status: "ready"; clipUrls: string[] } & VideoTimeline);

// Export: GET /api/lessons/:lessonId/video/export -> VideoExportView ; POST -> VideoExportView (starts rendering the
// ready video to MP4; 409 when it is not ready or another video is rendering)
// GET /api/lessons/:lessonId/video/export/file -> video/mp4 attachment

export type VideoExportView =
  | { status: "none" }
  | { status: "rendering"; progress: number }
  | { status: "ready"; url: string; sizeBytes: number }
  | { status: "failed"; error: string };

// Take-away files: attachments with a Content-Disposition filename; errors are ApiError JSON.
// GET /api/export/anki?format=apkg|txt&topicId= -> the accepted (active) cards of the topic, or of every topic
// without topicId (404 when there are none). One deck per topic, tags `clayfold node::<nodeId> lens::<lens>`, the
// card id as note GUID, so importing a newer export updates the notes. apkg carries its own note types and imports
// into Anki in any language; txt is Anki's text import (2.1.54+) and needs the stock note types named Basic and Cloze.
// GET /api/topics/:topicId/book -> text/markdown: the course book of the topic's finished lessons. It holds what the
// lesson pages show (L7): an item's answer and solution only once ItemState carries them, a faded worked-example
// line only once answered.

export const ANKI_FORMATS = ["apkg", "txt"] as const;
export type AnkiFormat = (typeof ANKI_FORMATS)[number];

// Claude Code mode: GET /api/system -> SystemView
// The running server and every `claude` process it controls.

export type ClaudeInstanceKind = ConversationKind | "critic" | "grading" | "narration" | "video" | "game";

export type ClaudeInstance = {
  pid: number;
  kind: ClaudeInstanceKind;
  model: string;
  /** Null when the model takes no --effort. */
  effort: Effort | null;
  startedAt: string;
  /** Conversation runs only; critic and grading calls belong to no conversation. */
  conversationId: string | null;
  topicId: string | null;
  topicTitle: string | null;
  lessonId: string | null;
  /** Labels of the latest activities in the run, oldest first. */
  activities: string[];
  /** Turns waiting behind the running one. */
  queued: number;
  /** Null when `ps` did not report the process. */
  rssMb: number | null;
  cpuPercent: number | null;
};

export type SystemView = {
  backend: {
    pid: number;
    startedAt: string;
    bun: string;
    port: number;
    rssMb: number;
    heapMb: number;
    /** Share of one core since the previous request. */
    cpuPercent: number;
    dbMb: number;
    model: string;
    criticModel: string;
    maxBudgetUsd: number;
  };
  frontend: {
    /** Modification time of web/dist/index.html; null when the UI is not built. */
    builtAt: string | null;
    /** Open SSE streams of /api/topics/:id/stream. */
    streams: number;
  };
  /** Oldest first. */
  instances: ClaudeInstance[];
  /** Conversation turns finished since the server started, newest first; the latest 20. */
  finished: FinishedRun[];
};

export type FinishedRun = {
  conversationId: string;
  kind: ConversationKind;
  topicId: string;
  topicTitle: string;
  lessonId: string | null;
  startedAt: string;
  finishedAt: string;
  costUsd: number | null;
  error: string | null;
  /** Stopped by the learner or by a server shutdown. */
  cancelled: boolean;
};

// Updates: GET /api/update -> UpdateView; POST /api/update { mode: UpdateMode } -> UpdateView
// A new version is any commit on origin/main that HEAD does not contain.

export type UpdateCommit = { sha: string; subject: string };

/** Why this checkout cannot update itself; the UI still lists the new commits. */
export type UpdateBlock = "dirty" | "branch" | "ahead" | "launcher";

/** `now` restarts at once and re-runs the cut-off Claude turns; `idle` waits until no Claude process runs. */
export type UpdateMode = "now" | "idle";

export type UpdateView = {
  /** Short HEAD commit; null outside a git checkout. */
  version: string | null;
  /** Commits on origin/main missing from HEAD, newest first. */
  commits: UpdateCommit[];
  blocked: UpdateBlock | null;
  state: "idle" | "waiting" | "installing" | "restarting" | "failed";
  /** Claude processes the server runs now. */
  running: number;
  /** The last failed update, while `state` is `failed`. */
  error: string | null;
};
