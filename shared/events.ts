import type { TeachbackStatus } from "./api";
import type { PublicStep } from "./schemas";
import type { Violation } from "./rules";

// Server-sent events on GET /api/topics/:topicId/stream. One stream per topic page.

export type TopicEvent =
  | { type: "conv.status"; conversationId: string; running: boolean; startedAt: string | null }
  | { type: "conv.text"; conversationId: string; messageId: string; delta: string }
  | {
      type: "conv.activity";
      conversationId: string;
      /** Present tense, for the live status row: "Searching for sources". */
      label: string;
      /** Past tense, for the list of finished actions: "Found sources". */
      doneLabel: string;
      tool: string;
    }
  | {
      type: "conv.ask";
      conversationId: string;
      question: string;
      options: { label: string; description?: string }[];
      multi: boolean;
      allowFree: boolean;
    }
  | { type: "conv.retry"; conversationId: string; attempt: number; delayMs: number }
  | { type: "conv.done"; conversationId: string; costUsd: number | null; error: string | null }
  | { type: "lesson.planned"; lessonId: string; title: string; outline: { kind: string; title: string }[] }
  | { type: "step.status"; lessonId: string; idx: number; status: "checking" | "rejected" | "dropped"; violations: Violation[] }
  | { type: "step.published"; lessonId: string; step: PublicStep }
  | { type: "lesson.finished"; lessonId: string; summary: string }
  | { type: "worked.answered"; lessonId: string; stepId: string; idx: number; correct: boolean; text: string }
  | { type: "cards.proposed"; cardIds: string[] }
  | { type: "graph.updated" }
  | { type: "plan.updated" }
  | { type: "onboarding.updated" }
  | { type: "sources.updated" }
  | { type: "memory.updated" }
  | { type: "tutor.offer"; lessonId: string; itemId: string; reason: "wrong_twice" | "idle" }
  | { type: "teachback.updated"; teachbackId: string; status: TeachbackStatus };

export type TopicEventType = TopicEvent["type"];
