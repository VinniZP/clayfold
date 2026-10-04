import type { Lang } from "./i18n";
import type { Answer, Card, GoalPlanEntry, GraphNode, Level, PublicFigure, PublicItem, PublicStep } from "./schemas";

// REST contract. All routes are under /api and exchange JSON.
// Errors: non-2xx with body ApiError.

export type ApiError = { error: string };

export type ConversationKind = "onboard" | "lesson" | "tutor" | "review";

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
};

// POST /api/lessons/:lessonId/resume -> StartLessonResponse (continues a failed lesson in its own authoring
// session; 409 when the lesson is not failed or the session is gone)
// POST /api/lessons/:lessonId/rebuild -> StartLessonResponse (a new lesson-author run for the same nodes;
// the old lesson stays until the new one is finished)

export type SourceView = { id: string; url: string; title: string; kind: string; note: string; status: "ok" | "failed" };

export type TopicDetail = {
  topic: TopicSummary;
  nodes: NodeView[];
  lessons: LessonSummary[];
  sources: SourceView[];
  conversations: { id: string; kind: ConversationKind; lessonId: string | null; createdAt: string }[];
  onboarding: OnboardingPhase[];
  /** Goals only, in plan order. */
  plan: GoalPlanEntryView[];
  /** The goal whose plan opened this topic, with the entry's reason for it. */
  goal: { id: string; title: string; why: string } | null;
  /** Goals only: facts the goal's courses recorded that the goal conversation has not received yet. */
  goalNotes: GoalNoteView[];
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
export type AttemptRequest = { answer: Answer; hintsUsed: number; durationMs: number; context: "activate" | "check" | "practice" | "explain" | "review" };
export type AttemptResponse = {
  correct: boolean | null; // null for ungraded prequestions and pending short answers
  /** Option-specific feedback, or general feedback. */
  feedback: string;
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

// Tutor: POST /api/lessons/:lessonId/tutor { itemId?, stepId?, text } -> { conversationId }
/** line: a worked-example line of stepId whose open blank the learner answers through the tutor. */
export type TutorRequest = { itemId?: string; stepId?: string; line?: number; text: string };

// Review
// GET /api/review?topicId= -> ReviewSession
export type ReviewCard = { id: string; topicId: string; kind: Card["kind"]; front: string; back: string; nodeId: string };
export type ReviewSession = { cards: ReviewCard[]; items: PublicItem[] };
// POST /api/cards/:cardId/review { rating: 1|2|3|4, durationMs? } -> { due }
export type ReviewRating = 1 | 2 | 3 | 4;
// GET /api/topics/:topicId/cards?status=proposed -> CardView[]
export type CardView = ReviewCard & { status: "proposed" | "active" | "suspended" | "rejected"; due: string | null; lapses: number };
// POST /api/cards/:cardId/accept | /suspend | /reject ; PATCH /api/cards/:cardId { front, back }

// Notes: POST /api/notes NoteRequest ; GET /api/topics/:topicId/notes -> NoteView[]
export type NoteRequest = { topicId: string; lessonId?: string; stepId?: string; quote?: string; text: string };
export type NoteView = NoteRequest & { id: string; createdAt: string };

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
// days without activity included with zeros). Minutes are the sum of attempt durations and review time.
export type ActivityDay = { date: string; attempts: number; correct: number; reviews: number; minutes: number };

// Weak spots: GET /api/weak?topicId=&limit=10 -> WeakSpot[]
// Items with at least 2 wrong attempts in the last 30 days, and leech cards (lapses >= 8), worst first.
export type WeakSpot =
  | { kind: "item"; itemId: string; topicId: string; lessonId: string | null; nodeId: string; prompt: string; wrongAttempts: number; lastMisconception: string | null }
  | { kind: "card"; cardId: string; topicId: string; nodeId: string; front: string; lapses: number };

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

export const CLAUDE_ROLES = ["onboard", "lesson", "tutor", "review", "critic", "grading", "narration", "video"] as const satisfies readonly ClaudeInstanceKind[];

/** Null fields use the server defaults: CLAYFOLD_MODEL or CLAYFOLD_CRITIC_MODEL, and the role's default effort. */
export type ClaudeRoleSetting = { model: ClaudeModel | null; effort: Effort | null };

export type Settings = {
  language: Lang;
  narration: { keySet: boolean; voiceId: string | null; model: TtsModel };
  /** Video lessons; they use the narration key, voice and model. */
  video: { enabled: boolean };
  claude: Record<ClaudeInstanceKind, ClaudeRoleSetting & { defaultModel: string; defaultEffort: Effort }>;
};

export type SettingsUpdate = {
  language?: Lang;
  voiceId?: string;
  ttsModel?: TtsModel;
  videoEnabled?: boolean;
  claudeRole?: ClaudeRoleSetting & { role: ClaudeInstanceKind };
};

export type VoiceView = { id: string; name: string; previewUrl: string | null };

// Narration: POST /api/steps/:stepId/narration -> NarrationView (explain steps only; 409 without a key)
// The first call writes a spoken script and synthesises it; later calls with the same voice and model return the stored audio.
// GET /api/steps/:stepId/narration/audio -> audio/mpeg

/** `block` indexes the top-level blocks of the step body as rendered; times are seconds into the audio. */
export type NarrationSegment = { block: number; start: number; end: number };

export type NarrationView = { audioUrl: string; segments: NarrationSegment[] };

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

// Claude Code mode: GET /api/system -> SystemView
// The running server and every `claude` process it controls.

export type ClaudeInstanceKind = ConversationKind | "critic" | "grading" | "narration" | "video";

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
