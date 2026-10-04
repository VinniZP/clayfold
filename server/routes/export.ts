import type { Database } from "bun:sqlite";
import { Hono } from "hono";
import { ANKI_FORMATS, type AnkiFormat } from "../../shared/api";
import type { Card } from "../../shared/schemas";
import { db } from "../db";
import { ankiNotes, ankiPackage, ankiText, type AnkiCard } from "../export/anki";
import { courseBook, readMission } from "../export/book";
import { t } from "../i18n";
import { attachment, fail } from "./http";
import { topicRow } from "./topics";

/** Accepted cards of one topic, or of all topics, with the topic title as their deck. */
export function acceptedCards(topicId: string | null, database: Database = db()): AnkiCard[] {
  return database
    .query<{ id: string; content: string; title: string }, [string | null]>(
      `SELECT c.id, c.content, t.title FROM cards c JOIN topics t ON t.id = c.topic_id
       WHERE c.status = 'active' AND (?1 IS NULL OR c.topic_id = ?1) ORDER BY t.created_at, t.rowid, c.created_at, c.rowid`,
    )
    .all(topicId)
    .map((r) => ({ id: r.id, deck: r.title, card: JSON.parse(r.content) as Card }));
}

export const exportRoutes = new Hono();

exportRoutes.get("/export/anki", (c) => {
  const format = (c.req.query("format") ?? "apkg") as AnkiFormat;
  if (!ANKI_FORMATS.includes(format)) fail(400, `format must be one of ${ANKI_FORMATS.join(", ")}`);
  const topicId = c.req.query("topicId") || null;
  const topic = topicId ? topicRow(topicId) : null;
  const notes = ankiNotes(acceptedCards(topic?.id ?? null));
  if (notes.length === 0) fail(404, t("export.noCards"));
  const disposition = attachment(topic?.title ?? t("export.allCourses"), topic?.slug ?? "clayfold-cards", format);
  return format === "txt"
    ? c.body(ankiText(notes), 200, { "content-type": "text/plain; charset=utf-8", "content-disposition": disposition })
    : c.body(ankiPackage(notes), 200, { "content-type": "application/octet-stream", "content-disposition": disposition });
});

exportRoutes.get("/topics/:topicId/book", (c) => {
  const topic = topicRow(c.req.param("topicId"));
  const book = courseBook(topic.id, { mission: readMission(topic.slug) });
  return c.body(book, 200, { "content-type": "text/markdown; charset=utf-8", "content-disposition": attachment(topic.title, topic.slug, "md") });
});
