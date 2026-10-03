import { Hono } from "hono";
import type { GlossaryEntry } from "../../shared/api";
import { db } from "../db";

export const glossary = new Hono();

glossary.get("/glossary", (c) => {
  const rows = db()
    .query<{ topic_id: string; title: string; term: string; definition: string; original: string | null; avoid: string; updated_at: string }, []>(
      `SELECT g.topic_id, t.title, g.term, g.definition, g.original, g.avoid, g.updated_at
       FROM glossary_terms g JOIN topics t ON t.id = g.topic_id ORDER BY g.term COLLATE NOCASE`,
    )
    .all();
  return c.json(
    rows.map(
      (r): GlossaryEntry => ({
        topicId: r.topic_id,
        topicTitle: r.title,
        term: r.term,
        definition: r.definition,
        original: r.original,
        avoid: JSON.parse(r.avoid) as string[],
        updatedAt: r.updated_at,
      }),
    ),
  );
});
