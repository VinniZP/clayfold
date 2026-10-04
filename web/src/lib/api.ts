import type {
  ActivityDay,
  AlternativeView,
  AnkiFormat,
  AttemptRequest,
  AttemptResponse,
  AuditEntry,
  AuditVerdict,
  CalibrationView,
  CardView,
  ConversationView,
  CreateTopicResponse,
  CrownsView,
  FinalExamView,
  GameBackfillView,
  GameView,
  ExplainLens,
  GiveUpResponse,
  GlossaryEntry,
  GoalMinutes,
  HintResponse,
  LessonView,
  MaterialView,
  MemoryFile,
  MistakeSolution,
  MistakesView,
  NarrationView,
  NoteRequest,
  NoteView,
  PastedMaterial,
  PracticeAnswerUpdate,
  PracticeFrom,
  PracticeRequest,
  PracticeResults,
  PracticeScope,
  PracticeTestOverview,
  PracticeTestRequest,
  PracticeTestView,
  ReportRequest,
  ReviewRating,
  RetryRequest,
  RetryResponse,
  ReviewSession,
  SearchResults,
  Settings,
  SettingsUpdate,
  StartLessonResponse,
  SystemView,
  TeachbackView,
  TodayView,
  TopicDetail,
  TopicSummary,
  TutorRequest,
  UpdateMode,
  UpdateView,
  VideoExportView,
  VideoView,
  VoiceView,
  WeakSpot,
  WorkedLineResponse,
} from "@shared/api";
import type { OutfitRef, OutfitSlot } from "@shared/game";
import { t } from "./i18n";

export class ApiFailure extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function send(method: string, path: string, body?: unknown): Promise<Response> {
  try {
    return await fetch(path, {
      method,
      headers: body === undefined || body instanceof FormData ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    });
  } catch {
    throw new ApiFailure(t("error.offline"), 0);
  }
}

function parseJson(text: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function failure(res: Response, data: unknown): ApiFailure {
  const message =
    data && typeof data === "object" && "error" in data && typeof data.error === "string"
      ? data.error
      : t("error.server", { status: res.status });
  return new ApiFailure(message, res.status);
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await send(method, path, body);
  const data = parseJson(await res.text());
  if (!res.ok) throw failure(res, data);
  return data as T;
}

export type DownloadedFile = { blob: Blob; name: string };

/** The file name from Content-Disposition, preferring the UTF-8 `filename*`. */
function fileName(res: Response, path: string): string {
  const header = res.headers.get("content-disposition") ?? "";
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(header)?.[1];
  if (utf8) {
    try {
      return decodeURIComponent(utf8);
    } catch {
      // A malformed encoding falls back to the ASCII name.
    }
  }
  return /filename="([^"]+)"/i.exec(header)?.[1] ?? path.split("?")[0]!.split("/").pop()!;
}

/** GET of an attachment route; a failure arrives as ApiFailure, as from the JSON routes. */
async function file(path: string): Promise<DownloadedFile> {
  const res = await send("GET", path);
  if (!res.ok) throw failure(res, parseJson(await res.text()));
  return { blob: await res.blob(), name: fileName(res, path) };
}

// Revoking the object URL right after the click can cancel the download in some browsers.
const REVOKE_AFTER_MS = 40_000;

/** Hands the file to the browser's download. */
export function saveFile({ blob, name }: DownloadedFile) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
}

const get = <T>(path: string) => request<T>("GET", path);
const post = <T>(path: string, body: unknown = {}) => request<T>("POST", path, body);
const e = encodeURIComponent;

/** A material the learner picked and has not sent yet. */
export type MaterialDraft = { kind: "file"; file: File } | { kind: "text"; title: string; text: string } | { kind: "link"; url: string };

function materialsForm(drafts: MaterialDraft[], form = new FormData()): FormData {
  for (const d of drafts) {
    if (d.kind === "file") form.append("file", d.file, d.file.name);
    else if (d.kind === "text") form.append("text", JSON.stringify({ title: d.title, text: d.text } satisfies PastedMaterial));
    else form.append("link", d.url);
  }
  return form;
}

function newTopicForm(request: string, kind: TopicSummary["kind"], drafts: MaterialDraft[]): FormData {
  const form = new FormData();
  form.append("request", request);
  form.append("kind", kind);
  return materialsForm(drafts, form);
}

export const api = {
  topics: () => get<TopicSummary[]>("/api/topics"),
  createTopic: (text: string, kind: TopicSummary["kind"] = "topic", materials: MaterialDraft[] = []) =>
    post<CreateTopicResponse>("/api/topics", materials.length > 0 ? newTopicForm(text, kind, materials) : { request: text, kind }),
  addMaterials: (topicId: string, drafts: MaterialDraft[]) => post<MaterialView[]>(`/api/topics/${e(topicId)}/materials`, materialsForm(drafts)),
  removeMaterial: (topicId: string, id: string) => request<unknown>("DELETE", `/api/topics/${e(topicId)}/materials/${e(id)}`),
  glossary: () => get<GlossaryEntry[]>("/api/glossary"),
  discussGoalNotes: (goalId: string) => post<{ conversationId: string }>(`/api/topics/${e(goalId)}/notes/discuss`),
  openPlanEntry: (goalId: string, entryId: string) => post<CreateTopicResponse>(`/api/topics/${e(goalId)}/plan/${e(entryId)}/open`),
  topic: (id: string) => get<TopicDetail>(`/api/topics/${e(id)}`),
  memory: (id: string) => get<MemoryFile[]>(`/api/topics/${e(id)}/memory`),
  startLesson: (id: string, nodeId?: string) =>
    post<StartLessonResponse>(`/api/topics/${e(id)}/lessons`, nodeId ? { nodeId } : {}),
  lesson: (id: string) => get<LessonView>(`/api/lessons/${e(id)}`),
  rebuildLesson: (id: string) => post<StartLessonResponse>(`/api/lessons/${e(id)}/rebuild`),
  resumeLesson: (id: string) => post<StartLessonResponse>(`/api/lessons/${e(id)}/resume`),
  practiceScope: (from: PracticeFrom) => get<PracticeScope>(`/api/practice/scope?${new URLSearchParams(from)}`),
  startPractice: (body: PracticeRequest) => post<StartLessonResponse>("/api/practice", body),
  practiceResults: (lessonId: string) => get<PracticeResults>(`/api/lessons/${e(lessonId)}/practice`),

  conversation: (id: string) => get<ConversationView>(`/api/conversations/${e(id)}`),
  sendMessage: (id: string, text: string) => post<{ accepted: boolean }>(`/api/conversations/${e(id)}/messages`, { text }),
  cancel: (id: string) => post<unknown>(`/api/conversations/${e(id)}/cancel`),

  attempt: (itemId: string, body: AttemptRequest) => post<AttemptResponse>(`/api/items/${e(itemId)}/attempt`, body),
  hint: (itemId: string, level: number) => post<HintResponse>(`/api/items/${e(itemId)}/hint`, { level }),
  giveUp: (itemId: string) => post<GiveUpResponse>(`/api/items/${e(itemId)}/giveup`),
  revealWorkedLine: (stepId: string, idx: number) => post<WorkedLineResponse>(`/api/worked/${e(stepId)}/lines/${idx}/reveal`),
  workedLine: (stepId: string, idx: number, answer: string) =>
    post<WorkedLineResponse>(`/api/worked/${e(stepId)}/lines/${idx}`, { answer }),
  reflect: (stepId: string, text: string) => post<unknown>(`/api/steps/${e(stepId)}/reflect`, { text }),
  tutor: (lessonId: string, body: TutorRequest) => post<{ conversationId: string }>(`/api/lessons/${e(lessonId)}/tutor`, body),
  startTeachback: (topicId: string, nodeId: string, lessonId?: string) =>
    post<TeachbackView>(`/api/topics/${e(topicId)}/teachbacks`, lessonId ? { nodeId, lessonId } : { nodeId }),
  teachback: (id: string) => get<TeachbackView>(`/api/teachbacks/${e(id)}`),
  finishTeachback: (id: string) => post<TeachbackView>(`/api/teachbacks/${e(id)}/finish`),

  review: (topicId?: string) => get<ReviewSession>(`/api/review${topicId ? `?topicId=${e(topicId)}` : ""}`),
  reviewCard: (cardId: string, rating: ReviewRating, durationMs?: number) =>
    post<{ due: string }>(`/api/cards/${e(cardId)}/review`, { rating, durationMs }),
  mistakes: () => get<MistakesView>("/api/mistakes"),
  mistakeSolution: (itemId: string) => get<MistakeSolution>(`/api/mistakes/${e(itemId)}/solution`),
  retryMistake: (itemId: string, body: RetryRequest) => post<RetryResponse>(`/api/mistakes/${e(itemId)}/retry`, body),
  cards: (topicId: string, status: CardView["status"]) => get<CardView[]>(`/api/topics/${e(topicId)}/cards?status=${status}`),
  cardAction: (cardId: string, action: "accept" | "suspend" | "reject") => post<unknown>(`/api/cards/${e(cardId)}/${action}`),
  editCard: (cardId: string, front: string, back: string) => request<unknown>("PATCH", `/api/cards/${e(cardId)}`, { front, back }),

  practiceTests: (topicId: string) => get<PracticeTestOverview>(`/api/topics/${e(topicId)}/tests`),
  startPracticeTest: (topicId: string, body: PracticeTestRequest) => post<PracticeTestView>(`/api/topics/${e(topicId)}/tests`, body),
  practiceTest: (testId: string) => get<PracticeTestView>(`/api/tests/${e(testId)}`),
  savePracticeAnswer: (testId: string, idx: number, body: PracticeAnswerUpdate) =>
    request<unknown>("PATCH", `/api/tests/${e(testId)}/questions/${idx}`, body),
  submitPracticeTest: (testId: string) => post<PracticeTestView>(`/api/tests/${e(testId)}/submit`),
  regradePracticeTest: (testId: string) => post<PracticeTestView>(`/api/tests/${e(testId)}/regrade`),
  discardPracticeTest: (testId: string) => request<unknown>("DELETE", `/api/tests/${e(testId)}`),
  finalExam: (topicId: string) => get<FinalExamView>(`/api/topics/${e(topicId)}/final`),
  startFinal: (topicId: string) => post<PracticeTestView>(`/api/topics/${e(topicId)}/final`),

  search: (q: string) => get<SearchResults>(`/api/search?q=${e(q)}`),

  notes: (topicId: string) => get<NoteView[]>(`/api/topics/${e(topicId)}/notes`),
  addNote: (body: NoteRequest) => post<NoteView>("/api/notes", body),
  editNote: (noteId: string, text: string) => request<unknown>("PATCH", `/api/notes/${e(noteId)}`, { text }),
  report: (body: ReportRequest) => post<unknown>("/api/reports", body),

  activity: (days: number, topicId?: string) =>
    get<ActivityDay[]>(`/api/stats/activity?days=${days}${topicId ? `&topicId=${e(topicId)}` : ""}`),
  calibration: () => get<CalibrationView>("/api/stats/calibration"),
  today: () => get<TodayView>("/api/today"),
  setGoal: (minutes: GoalMinutes) => request<TodayView>("PUT", "/api/goal", { minutes }),
  weak: (limit = 10, topicId?: string) => get<WeakSpot[]>(`/api/weak?limit=${limit}${topicId ? `&topicId=${e(topicId)}` : ""}`),

  settings: () => get<Settings>("/api/settings"),
  setSettings: (body: SettingsUpdate) => request<Settings>("PUT", "/api/settings", body),
  setElevenLabsKey: (key: string) => request<Settings>("PUT", "/api/settings/elevenlabs-key", { key }),
  removeElevenLabsKey: () => request<Settings>("DELETE", "/api/settings/elevenlabs-key"),
  voices: () => get<VoiceView[]>("/api/settings/voices"),
  lessonVideo: (lessonId: string) => get<VideoView>(`/api/lessons/${e(lessonId)}/video`),
  makeLessonVideo: (lessonId: string) => post<VideoView>(`/api/lessons/${e(lessonId)}/video`),
  videoExport: (lessonId: string) => get<VideoExportView>(`/api/lessons/${e(lessonId)}/video/export`),
  startVideoExport: (lessonId: string) => post<VideoExportView>(`/api/lessons/${e(lessonId)}/video/export`),
  narrate: (stepId: string) => post<NarrationView>(`/api/steps/${e(stepId)}/narration`),
  explainDifferently: (stepId: string, lens: ExplainLens) => post<AlternativeView>(`/api/steps/${e(stepId)}/alternatives`, { lens }),

  /** Accepted cards of the topic, or of every topic when topicId is null. */
  ankiExport: (topicId: string | null, format: AnkiFormat) => file(`/api/export/anki?format=${format}${topicId ? `&topicId=${e(topicId)}` : ""}`),
  courseBook: (topicId: string) => file(`/api/topics/${e(topicId)}/book`),

  auditSample: (n = 10) => get<AuditEntry[]>(`/api/audit/sample?n=${n}`),
  audit: (itemId: string, body: AuditVerdict) => post<unknown>(`/api/audit/${e(itemId)}`, body),

  game: () => get<GameView>("/api/game"),
  gameCrowns: () => get<CrownsView>("/api/game/crowns"),
  wear: (slot: OutfitSlot, item: OutfitRef | null) => request<GameView>("PUT", "/api/game/outfit", { slot, item }),
  gameSeen: (marks: { rewards?: string[]; habits?: string[]; ranks?: number[]; residents?: string[] }) => post<unknown>("/api/game/seen", marks),
  gameFocus: (lessonId: string, longestAwayMs: number) => post<unknown>("/api/game/focus", { lessonId, longestAwayMs }),
  gameBackfill: () => get<GameBackfillView>("/api/game/backfill"),
  startGameBackfill: () => post<GameBackfillView>("/api/game/backfill"),

  system: () => get<SystemView>("/api/system"),
  update: () => get<UpdateView>("/api/update"),
  startUpdate: (mode: UpdateMode) => post<UpdateView>("/api/update", { mode }),
};

export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : t("error.unknown");
}
