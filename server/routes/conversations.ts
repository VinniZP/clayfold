import { Hono } from "hono";
import { z } from "zod";
import type { ChatMessage, ConversationKind, ConversationView } from "../../shared/api";
import { cancel, isRunning, runInfo, runTurn } from "../claude/runner";
import { db } from "../db";
import { t } from "../i18n";
import { fail, parseJson, readBody } from "./http";
import { teachbackOpen } from "./teachback";

type MessageRow = { id: string; role: ChatMessage["role"]; text: string; meta: string | null; created_at: string };

export function conversationView(id: string): ConversationView {
  const conv = db()
    .query<{ id: string; topic_id: string; kind: ConversationKind }, [string]>("SELECT id, topic_id, kind FROM conversations WHERE id = ?")
    .get(id);
  if (!conv) fail(404, "conversation not found");
  const messages = db()
    .query<MessageRow, [string]>("SELECT id, role, text, meta, created_at FROM messages WHERE conversation_id = ? ORDER BY rowid")
    .all(id)
    .map((m): ChatMessage => {
      const meta = parseJson<{ options?: ChatMessage["options"]; multi?: boolean; allowFree?: boolean; doneText?: string; quote?: string }>(m.meta);
      return {
        id: m.id,
        role: m.role,
        text: m.text,
        ...(m.role === "ask" && meta?.options ? { options: meta.options, multi: meta.multi ?? false, allowFree: meta.allowFree ?? true } : {}),
        ...(m.role === "activity" && meta?.doneText ? { doneText: meta.doneText } : {}),
        ...(m.role === "user" && meta?.quote ? { quote: meta.quote } : {}),
        createdAt: m.created_at,
      };
    });
  return { id: conv.id, topicId: conv.topic_id, kind: conv.kind, running: isRunning(conv.id), ...runInfo(conv.id), messages };
}

export const conversations = new Hono();

conversations.get("/:id", (c) => c.json(conversationView(c.req.param("id"))));

conversations.post("/:id/messages", async (c) => {
  const id = c.req.param("id");
  if (!db().query("SELECT 1 FROM conversations WHERE id = ?").get(id)) fail(404, "conversation not found");
  const { text } = await readBody(c, z.object({ text: z.string().trim().min(1).max(8000) }));
  if (!teachbackOpen(id)) fail(409, t("teachback.closed"));
  runTurn({ conversationId: id, text });
  return c.json({ accepted: true }, 202);
});

conversations.post("/:id/cancel", (c) => {
  cancel(c.req.param("id"), "user");
  return c.body(null, 202);
});
