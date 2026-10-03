import type { SourceAddResult, SourceSearchResult } from "../../../shared/tools";
import { newId } from "../../db";
import { fetchSource, searchText } from "../../gates/sources";
import { publisherCounts } from "../../publishers";
import { defineTool, ToolError } from "../context";

export const sourceAdd = defineTool({
  name: "source_add",
  description: `Register a source page for this topic. The server downloads the URL itself (HTML only, 20 s timeout), extracts the readable text and stores it; that stored text is what every quote is checked against (Q6).
Call it for each page you intend to cite, before writing lessons or cards that cite it. WebFetch shows you a paraphrase, not the page text, so take quotes from source_search, never from WebFetch.
PDFs and other non-HTML content are stored as failed: pick an HTML page instead. Adding the same URL again re-downloads it.
Returns {ok: true, sourceId, title, chars, headings, publishers} or {ok: false, error}. Cite the source as {sourceId, quote}.
publishers counts the topic's ok sources per publisher (the organisation behind the domain). Check the spread: no publisher should exceed 40% of the sources.`,
  async handler(ctx, { url, kind, note }) {
    const fetched = await fetchSource(url, ctx.fetch);
    const existing = ctx.db
      .query<{ id: string }, [string, string]>("SELECT id FROM sources WHERE topic_id = ? AND url = ?")
      .get(ctx.topicId, url);
    const id = existing?.id ?? newId("src");
    const title = fetched.title || url;
    ctx.db
      .query(
        `INSERT INTO sources (id, topic_id, url, title, kind, note, text, status, error, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
         ON CONFLICT (topic_id, url) DO UPDATE SET title = excluded.title, kind = excluded.kind, note = excluded.note,
           text = excluded.text, status = excluded.status, error = excluded.error, fetched_at = excluded.fetched_at`,
      )
      .run(id, ctx.topicId, url, title, kind, note, fetched.ok ? fetched.text : null, fetched.ok ? "ok" : "failed", fetched.ok ? null : fetched.error);
    ctx.publish({ type: "sources.updated" });
    const result: SourceAddResult = fetched.ok
      ? { ok: true, sourceId: id, title, chars: fetched.text.length, headings: fetched.headings, publishers: publisherCounts(ctx.topicId, ctx.db) }
      : { ok: false, error: fetched.error };
    return { result };
  },
});

export const sourceSearch = defineTool({
  name: "source_search",
  description: `Find passages in a stored source (see source_add) that match a query. Matching is by query words (any language, inflections tolerated); use the words the source itself would use.
Each passage is a verbatim slice of the stored page text (2-4 sentences, at most 600 characters) with its character offset. Copy a passage, or any contiguous part of it of at least 8 characters, into a cite's "quote" unchanged: quotes are verified against this same text.
Returns {passages: [{quote, offset}]}, best first; an empty list means no sentence contains the query words.`,
  handler(ctx, { sourceId, query, maxPassages }) {
    const row = ctx.db
      .query<{ status: string; text: string | null; error: string | null }, [string, string]>(
        "SELECT status, text, error FROM sources WHERE id = ? AND topic_id = ?",
      )
      .get(sourceId, ctx.topicId);
    if (!row) throw new ToolError(`source "${sourceId}" is not a source of this topic`);
    if (row.status !== "ok" || !row.text) throw new ToolError(`source "${sourceId}" failed to fetch (${row.error ?? "no text"}); it cannot be searched or cited`);
    const result: SourceSearchResult = { passages: searchText(row.text, query, maxPassages) };
    return { result };
  },
});
