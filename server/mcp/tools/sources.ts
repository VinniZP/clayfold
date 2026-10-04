import type { SourceAddResult, SourceDiscoverResult, SourceRemoveResult, SourceSearchResult } from "../../../shared/tools";
import { newId } from "../../db";
import { exa as exaClient } from "../../exa";
import { searchPapers, searchWeb, searchWikipedia, type Candidate } from "../../gates/discover";
import { CITED } from "../../gates/materials";
import { fetchSource, searchText } from "../../gates/sources";
import { publisherCounts } from "../../publishers";
import { defineTool, ToolError } from "../context";

export const sourceAdd = defineTool({
  name: "source_add",
  description: `Register a source for this topic. The server downloads the URL itself (an HTML page, a PDF with a text layer, or a plain-text or Markdown file; 20 s timeout, at most 20 MB), extracts the readable text and stores it; that stored text is what every quote is checked against (Q6).
Call it for each source you intend to cite, before writing lessons or cards that cite it. WebFetch shows you a paraphrase, not the page text, so take quotes from source_search, never from WebFetch.
Pages rendered by JavaScript, scanned PDFs and other content types are stored as failed: pick another address. Adding the same URL again re-downloads it.
Returns {ok: true, sourceId, title, chars, headings, published?, publishers} or {ok: false, error}. Cite the source as {sourceId, quote}. published is the latest publication or update date the page states.
nodeIds names the graph nodes the source explains (not merely mentions), once the graph exists: a finished lesson on one of them then offers the learner a rebuild that can use it.
publishers counts the topic's ok sources per publisher (the organisation behind the domain). Check the spread: no publisher should exceed 40% of the sources. The learner's own materials count as one publisher, "learner materials", which the 40% limit leaves out.`,
  async handler(ctx, { url, kind, note, nodeIds = [] }) {
    const existing = ctx.db
      .query<{ id: string; title: string; text: string | null; origin: string; node_ids: string | null }, [string, string]>(
        "SELECT id, title, text, origin, node_ids FROM sources WHERE topic_id = ? AND url = ?",
      )
      .get(ctx.topicId, url);
    const graph = new Set(ctx.db.query<{ id: string }, [string]>("SELECT id FROM nodes WHERE topic_id = ?").all(ctx.topicId).map((n) => n.id));
    const unknown = nodeIds.filter((id) => !graph.has(id));
    if (unknown.length > 0) throw new ToolError(`nodeIds ${unknown.join(", ")} are not nodes of this topic's graph`);
    const covered = [...new Set([...(existing?.node_ids ? (JSON.parse(existing.node_ids) as string[]) : []), ...nodeIds])];
    if (existing?.origin === "learner") {
      const result: SourceAddResult = {
        ok: true,
        sourceId: existing.id,
        title: existing.title,
        chars: existing.text?.length ?? 0,
        headings: [],
        publishers: publisherCounts(ctx.topicId, ctx.db),
      };
      return { result, notes: ["This link is already one of the learner's materials; it is stored as the learner added it. See material_list."] };
    }
    const fetched = await fetchSource(url, ctx.fetch);
    const id = existing?.id ?? newId("src");
    const title = fetched.title || url;
    ctx.db
      .query(
        `INSERT INTO sources (id, topic_id, url, title, kind, note, text, status, error, node_ids, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
         ON CONFLICT (topic_id, url) DO UPDATE SET title = excluded.title, kind = excluded.kind, note = excluded.note,
           text = excluded.text, status = excluded.status, error = excluded.error, node_ids = excluded.node_ids, fetched_at = excluded.fetched_at`,
      )
      .run(
        id,
        ctx.topicId,
        url,
        title,
        kind,
        note,
        fetched.ok ? fetched.text : null,
        fetched.ok ? "ok" : "failed",
        fetched.ok ? null : fetched.error,
        covered.length > 0 ? JSON.stringify(covered) : null,
      );
    ctx.publish({ type: "sources.updated" });
    const result: SourceAddResult = fetched.ok
      ? {
          ok: true,
          sourceId: id,
          title,
          chars: fetched.text.length,
          headings: fetched.headings,
          ...(fetched.published ? { published: fetched.published } : {}),
          publishers: publisherCounts(ctx.topicId, ctx.db),
        }
      : { ok: false, error: fetched.error };
    return { result };
  },
});

export const sourceDiscover = defineTool({
  name: "source_discover",
  description: `Find candidate sources in catalogues, as a complement to WebSearch. Nothing is registered: judge each candidate, then register the ones you keep with source_add, trying its urls in order until one returns ok.
- in: "wikipedia" searches one Wikipedia edition (language: en, de, ja…): overviews, definitions and the terms the field uses in that language. Search the editions where the field is covered best, and the learner's edition for its terms. An encyclopedia is a tertiary source; pair it with primary ones.
- in: "papers" searches OpenAlex for open-access, non-retracted papers, books and reviews; each has year, citations and venue. urls lead with the arXiv HTML version when there is one, then the PDF, then the landing page. Prefer surveys, tutorials and well-cited work; titles and abstracts are mostly English, so English queries find most.
registered marks a candidate the topic already has. Returns {candidates: [{title, urls, snippet, year?, citations?, venue?, published?, author?, registered}]}.`,
  webDescription: `- in: "web" searches the web by meaning through Exa: describe the page you want in a full sentence, as you would to a librarian ("a beginner-friendly explanation of why animated character meshes use quads, by a 3D artist"), not as keywords. Results skip video sites, social networks and forums; each has published and author when known, and snippet holds the passages closest to the query. since (YYYY-MM-DD) keeps pages published on or after it: use it in fields that change quickly.`,
  async handler(ctx, { query, in: where, language, since, limit }) {
    let found: Candidate[];
    try {
      if (where === "web") {
        if (!ctx.exaKey) throw new ToolError('in: "web" needs an Exa key, which the learner has not set; use WebSearch');
        found = await searchWeb(ctx.exa ?? exaClient, ctx.exaKey, { query, limit, since }, ctx.fetch);
      } else {
        found = where === "wikipedia" ? await searchWikipedia(query, language, limit, ctx.fetch) : await searchPapers(query, limit, ctx.fetch);
      }
    } catch (e) {
      if (e instanceof ToolError) throw e;
      throw new ToolError(`${where} search failed: ${e instanceof Error ? e.message : String(e)}; use WebSearch instead`);
    }
    const known = new Set(ctx.db.query<{ url: string }, [string]>("SELECT url FROM sources WHERE topic_id = ?").all(ctx.topicId).map((r) => r.url));
    const result: SourceDiscoverResult = { candidates: found.map((c) => ({ ...c, registered: c.urls.some((u) => known.has(u)) })) };
    return { result };
  },
});

export const sourceRemove = defineTool({
  name: "source_remove",
  description: `Remove a source you registered that the course does not need: it covers no graph node, is shallow or outdated beside a better one, or turned out wrong. Removing it also corrects the publisher spread.
A source that lessons, items or cards cite, or that a lesson plan lists, stays; so do the learner's own materials. Remove its entry from RESOURCES.md too.
Returns {ok: true, publishers} with the counts after removal.`,
  handler(ctx, { sourceId, reason }) {
    const row = ctx.db
      .query<{ origin: string; cited: number }, [string, string]>(`SELECT s.origin, ${CITED} AS cited FROM sources s WHERE s.id = ? AND s.topic_id = ?`)
      .get(sourceId, ctx.topicId);
    if (!row) throw new ToolError(`source "${sourceId}" is not a source of this topic`);
    if (row.origin === "learner") throw new ToolError(`source "${sourceId}" is one of the learner's materials; only the learner removes it`);
    if (row.cited === 1) throw new ToolError(`source "${sourceId}" is cited by lesson content; it stays`);
    const planned = ctx.db
      .query<{ title: string }, [string, string]>("SELECT l.title FROM lessons l, json_each(l.planned_sources) p WHERE l.topic_id = ? AND p.value = ? LIMIT 1")
      .get(ctx.topicId, sourceId);
    if (planned) throw new ToolError(`source "${sourceId}" is planned for the lesson "${planned.title}"; it stays`);
    ctx.db.query("DELETE FROM sources WHERE id = ?").run(sourceId);
    console.log(`[sources] removed ${sourceId}: ${reason}`);
    ctx.publish({ type: "sources.updated" });
    const result: SourceRemoveResult = { ok: true, publishers: publisherCounts(ctx.topicId, ctx.db) };
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
