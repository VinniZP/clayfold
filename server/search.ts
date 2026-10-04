import type { Database } from "bun:sqlite";
import { SEARCH_KINDS, SEARCH_PER_KIND, type SearchHit, type SearchKind, type SearchResults, type TopicSummary } from "../shared/api";
import type { Card, Step } from "../shared/schemas";
import { foldForSearch, hitSnippet, markText, markWords, plainText, queryWords } from "../shared/search";
import { stripTermMarks } from "../shared/terms";
import { db } from "./db";
import { supersedingLesson } from "./routes/lesson-summary";

// Triggers in schema.sql queue every change to a searchable row; syncSearch turns the queue into entries before a
// query reads them, so every write path is covered without calls from it.

type Entry = { topicId: string; lessonId: string | null; stepId: string | null; title: string; body: string };

/** The visible text of a published explain or worked-example step: faded lines are answers until the learner gives them. */
function stepText(step: Step): string | null {
  if (step.kind === "explain") return plainText(step.body);
  if (step.kind === "worked_example") return [step.problem, ...step.lines.filter((l) => !l.blank).map((l) => l.text)].map(plainText).join(" ");
  return null;
}

/** What the learner can see of a queued row (L7); null when the row is gone or not searchable. */
function entryOf(database: Database, kind: SearchKind, ref: string): Entry | null {
  switch (kind) {
    case "topic": {
      const r = database.query<{ title: string; request: string }, [string]>("SELECT title, request FROM topics WHERE id = ?").get(ref);
      return r && { topicId: ref, lessonId: null, stepId: null, title: r.title, body: r.request };
    }
    case "lesson": {
      const r = database.query<{ topic_id: string; title: string; objective: string }, [string]>("SELECT topic_id, title, objective FROM lessons WHERE id = ?").get(ref);
      return r && { topicId: r.topic_id, lessonId: ref, stepId: null, title: r.title, body: r.objective };
    }
    case "step": {
      const r = database
        .query<{ topic_id: string; lesson_id: string; content: string }, [string]>(
          "SELECT l.topic_id, s.lesson_id, s.content FROM steps s JOIN lessons l ON l.id = s.lesson_id WHERE s.id = ? AND s.status = 'published'",
        )
        .get(ref);
      if (!r) return null;
      const step = JSON.parse(r.content) as Step;
      const body = stepText(step);
      return body === null ? null : { topicId: r.topic_id, lessonId: r.lesson_id, stepId: ref, title: step.title, body };
    }
    case "term": {
      const slash = ref.indexOf("/");
      const r = database
        .query<{ term: string; definition: string; original: string | null }, [string, string]>("SELECT term, definition, original FROM glossary_terms WHERE topic_id = ? AND key = ?")
        .get(ref.slice(0, slash), ref.slice(slash + 1));
      return r && { topicId: ref.slice(0, slash), lessonId: null, stepId: null, title: r.original ? `${r.term} (${r.original})` : r.term, body: r.definition };
    }
    case "note": {
      const r = database
        .query<{ topic_id: string; lesson_id: string | null; step_id: string | null; quote: string | null; text: string }, [string]>(
          "SELECT topic_id, lesson_id, step_id, quote, text FROM notes WHERE id = ?",
        )
        .get(ref);
      return r && { topicId: r.topic_id, lessonId: r.lesson_id, stepId: r.step_id, title: r.text, body: r.quote ?? "" };
    }
    case "card": {
      const r = database
        .query<{ topic_id: string; lesson_id: string | null; content: string }, [string]>(
          "SELECT topic_id, lesson_id, content FROM cards WHERE id = ? AND status IN ('active', 'suspended')",
        )
        .get(ref);
      return r && { topicId: r.topic_id, lessonId: r.lesson_id, stepId: null, title: stripTermMarks((JSON.parse(r.content) as Card).front), body: "" };
    }
  }
}

/** Indexes the queued rows. */
export function syncSearch(database: Database = db()): void {
  const last = database.query<{ n: number | null }, []>("SELECT max(rowid) AS n FROM search_queue").get()!.n;
  if (last === null) return;
  const queued = database.query<{ kind: SearchKind; ref: string }, [number]>("SELECT DISTINCT kind, ref FROM search_queue WHERE rowid <= ?").all(last);
  const find = database.query<{ id: number }, [string, string]>("SELECT id FROM search_entries WHERE kind = ? AND ref = ?");
  const dropIndex = database.query("DELETE FROM search_index WHERE rowid = ?");
  const dropEntry = database.query("DELETE FROM search_entries WHERE id = ?");
  const addEntry = database.query<{ id: number }, [string, string, string, string | null, string | null, string, string]>(
    "INSERT INTO search_entries (kind, ref, topic_id, lesson_id, step_id, title, body) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id",
  );
  const addIndex = database.query("INSERT INTO search_index (rowid, title, body) VALUES (?, ?, ?)");
  database.transaction(() => {
    for (const { kind, ref } of queued) {
      const old = find.get(kind, ref);
      if (old) {
        dropIndex.run(old.id);
        dropEntry.run(old.id);
      }
      const entry = entryOf(database, kind, ref);
      if (entry) {
        const { id } = addEntry.get(kind, ref, entry.topicId, entry.lessonId, entry.stepId, entry.title, entry.body)!;
        addIndex.run(id, foldForSearch(entry.title), foldForSearch(entry.body));
      }
    }
    database.query("DELETE FROM search_queue WHERE rowid <= ?").run(last);
  })();
}

type Row = {
  kind: SearchKind;
  ref: string;
  topic_id: string;
  lesson_id: string | null;
  title: string;
  body: string;
  topic_title: string;
  topic_kind: TopicSummary["kind"];
  lesson_title: string | null;
  lesson_nodes: string | null;
  step_idx: number | null;
};

const SELECT = `SELECT e.kind, e.ref, e.topic_id, e.lesson_id, e.title, e.body, t.title AS topic_title, t.kind AS topic_kind,
    l.title AS lesson_title, l.node_ids AS lesson_nodes, s.idx AS step_idx
  FROM search_index m
  JOIN search_entries e ON e.id = m.rowid
  JOIN topics t ON t.id = e.topic_id
  LEFT JOIN lessons l ON l.id = e.lesson_id
  LEFT JOIN steps s ON s.id = e.step_id`;

/** More rows than the hits can use, so that every kind fills its share. */
const ROW_LIMIT = 500;

const phrase = (word: string) => `"${word.replaceAll('"', '""')}"`;
const likePattern = (text: string) => `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export function search(query: string, database: Database = db()): SearchResults {
  syncSearch(database);
  const { all, long } = queryWords(query);
  if (!all.length) return { query, hits: [] };
  const rows = long.length
    ? database
        .query<Row, [string, number]>(`${SELECT} WHERE search_index MATCH ? ORDER BY bm25(search_index, 10.0, 1.0) LIMIT ?`)
        .all(long.map(phrase).join(" "), ROW_LIMIT)
    : database
        .query<Row, [string, string, number]>(`${SELECT} WHERE m.title LIKE ? ESCAPE '\\' ORDER BY instr(m.title, ?), length(m.title) LIMIT ?`)
        .all(likePattern(all.join(" ")), all.join(" "), ROW_LIMIT);

  const words = markWords(query);
  const superseded = new Map<string, boolean>();
  const isSuperseded = (lessonId: string, nodeIds: string) => {
    let known = superseded.get(lessonId);
    if (known === undefined) superseded.set(lessonId, (known = supersedingLesson({ id: lessonId, node_ids: nodeIds }, database) !== null));
    return known;
  };
  const byKind = new Map<SearchKind, SearchHit[]>(SEARCH_KINDS.map((k) => [k, []]));
  for (const row of rows) {
    const hits = byKind.get(row.kind)!;
    if (hits.length >= SEARCH_PER_KIND) continue;
    // A newer version of the lesson holds the same content; the learner's notes and cards stay findable.
    if ((row.kind === "lesson" || row.kind === "step") && row.lesson_id && row.lesson_nodes && isSuperseded(row.lesson_id, row.lesson_nodes)) continue;
    hits.push({
      kind: row.kind,
      id: row.kind === "term" ? row.ref.slice(row.ref.indexOf("/") + 1) : row.ref,
      title: markText(row.title, words),
      snippet: hitSnippet(row.kind, row.body, words),
      topicId: row.topic_id,
      topicTitle: row.topic_title,
      topicKind: row.topic_kind,
      lessonId: row.lesson_id,
      lessonTitle: row.lesson_title,
      stepIdx: row.step_idx,
    });
  }
  return { query, hits: SEARCH_KINDS.flatMap((k) => byKind.get(k)!) };
}
