import type {
  ActivityDay,
  AttemptRequest,
  AttemptResponse,
  AuditEntry,
  AuditVerdict,
  CardView,
  ConversationView,
  CreateTopicResponse,
  GiveUpResponse,
  GlossaryEntry,
  GoalMinutes,
  HintResponse,
  LessonView,
  MemoryFile,
  NarrationView,
  NoteRequest,
  NoteView,
  ReportRequest,
  ReviewRating,
  ReviewSession,
  Settings,
  SettingsUpdate,
  StartLessonResponse,
  SystemView,
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
import { t } from "./i18n";

export class ApiFailure extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiFailure(t("error.offline"), 0);
  }
  const text = await res.text();
  let data: unknown = undefined;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = undefined;
    }
  }
  if (!res.ok) {
    const message =
      data && typeof data === "object" && "error" in data && typeof data.error === "string"
        ? data.error
        : t("error.server", { status: res.status });
    throw new ApiFailure(message, res.status);
  }
  return data as T;
}

const get = <T>(path: string) => request<T>("GET", path);
const post = <T>(path: string, body: unknown = {}) => request<T>("POST", path, body);
const e = encodeURIComponent;

export const api = {
  topics: () => get<TopicSummary[]>("/api/topics"),
  createTopic: (text: string, kind: TopicSummary["kind"] = "topic") => post<CreateTopicResponse>("/api/topics", { request: text, kind }),
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

  review: (topicId?: string) => get<ReviewSession>(`/api/review${topicId ? `?topicId=${e(topicId)}` : ""}`),
  reviewCard: (cardId: string, rating: ReviewRating, durationMs?: number) =>
    post<{ due: string }>(`/api/cards/${e(cardId)}/review`, { rating, durationMs }),
  cards: (topicId: string, status: CardView["status"]) => get<CardView[]>(`/api/topics/${e(topicId)}/cards?status=${status}`),
  cardAction: (cardId: string, action: "accept" | "suspend" | "reject") => post<unknown>(`/api/cards/${e(cardId)}/${action}`),
  editCard: (cardId: string, front: string, back: string) => request<unknown>("PATCH", `/api/cards/${e(cardId)}`, { front, back }),

  notes: (topicId: string) => get<NoteView[]>(`/api/topics/${e(topicId)}/notes`),
  addNote: (body: NoteRequest) => post<unknown>("/api/notes", body),
  report: (body: ReportRequest) => post<unknown>("/api/reports", body),

  activity: (days: number, topicId?: string) =>
    get<ActivityDay[]>(`/api/stats/activity?days=${days}${topicId ? `&topicId=${e(topicId)}` : ""}`),
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

  auditSample: (n = 10) => get<AuditEntry[]>(`/api/audit/sample?n=${n}`),
  audit: (itemId: string, body: AuditVerdict) => post<unknown>(`/api/audit/${e(itemId)}`, body),

  system: () => get<SystemView>("/api/system"),
  update: () => get<UpdateView>("/api/update"),
  startUpdate: (mode: UpdateMode) => post<UpdateView>("/api/update", { mode }),
};

export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : t("error.unknown");
}
