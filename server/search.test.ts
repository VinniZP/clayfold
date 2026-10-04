import { beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SearchHit } from "../shared/api";
import type { Card, Step } from "../shared/schemas";
import { openDb } from "./db";
import { insertCard, insertStep, items, seed } from "./routes/test-fixtures";
import { search } from "./search";

const cites = [{ sourceId: "src1", quote: "A verbatim quote from the source." }];

const explain: Step = {
  kind: "explain",
  title: "How a rebase moves commits",
  body: "A **rebase** replays your [[commits|Commit]] on top of another branch.\n\n- It rewrites history",
  cites,
  checks: [items.single("ex1")],
};

const worked: Step = {
  kind: "worked_example",
  title: "Rebasing a feature branch",
  problem: "Your branch is behind main by three commits.",
  cites,
  lines: [{ text: "Fetch the remote first." }, { text: "SECRET-WORKED-LINE", blank: { prompt: "What comes next?", answers: ["SECRET-WORKED-ANS"] } }],
};

let database: Database;

const marked = (h: SearchHit["title"]) => h.marks.map(([a, b]) => h.text.slice(a, b));
const kinds = (q: string) => search(q, database).hits.map((h) => `${h.kind}:${h.title.text}`);

beforeEach(() => {
  database = openDb(":memory:");
  seed(database);
});

describe("search", () => {
  test("finds published step text, highlights it and links the step", () => {
    const { stepId } = insertStep(database, 1, explain);
    const [hit] = search("replays", database).hits;
    expect(hit).toMatchObject({ kind: "step", id: stepId, topicId: "tp1", topicTitle: "Topic", lessonId: "ls1", lessonTitle: "Lesson", stepIdx: 1 });
    expect(hit!.snippet!.text).toBe("A rebase replays your commits on top of another branch. It rewrites history");
    expect(marked(hit!.snippet!)).toEqual(["replays"]);
  });

  test("returns no keys, solutions, hints, feedback, faded lines or card backs (L7)", () => {
    const steps: Step[] = [
      { kind: "activate", title: "Warm-up", items: [items.single("act1"), items.cloze("act2")] },
      explain,
      worked,
      { kind: "practice", title: "Practice", item: items.short("pr1") },
      { kind: "check", title: "Check", items: [items.multi("ch1"), items.number("ch2")] },
    ];
    steps.forEach((s, i) => insertStep(database, i, s));
    insertCard(database, "a", "active");
    for (const q of ["SECRET", "first node", "9137"]) expect(search(q, database).hits).toEqual([]);
    const stored = database.query<{ title: string; body: string }, []>("SELECT title, body FROM search_entries").all();
    expect(JSON.stringify(stored)).not.toContain("SECRET");
    expect(kinds("node")).toEqual(["card:What is node A?"]);
  });

  test("follows the write paths: publish, edit, accept, delete", () => {
    database.query("INSERT INTO steps (id, lesson_id, idx, kind, content, status) VALUES ('st1', 'ls1', 0, 'explain', ?, 'checking')").run(JSON.stringify(explain));
    expect(kinds("replays")).toEqual([]);
    database.query("UPDATE steps SET status = 'published' WHERE id = 'st1'").run();
    expect(kinds("replays")).toEqual(["step:How a rebase moves commits"]);

    database.query("UPDATE topics SET title = 'Git internals' WHERE id = 'tp1'").run();
    expect(kinds("internals")).toEqual(["topic:Git internals"]);
    expect(search("replays", database).hits[0]!.topicTitle).toBe("Git internals");

    const card = insertCard(database);
    expect(kinds("node a")).toEqual([]);
    database.query("UPDATE cards SET status = 'active' WHERE id = ?").run(card);
    expect(kinds("node a")).toEqual(["card:What is node A?"]);
    database.query("UPDATE cards SET status = 'rejected' WHERE id = ?").run(card);
    expect(kinds("node a")).toEqual([]);

    const term = (definition: string) =>
      database
        .query(
          `INSERT INTO glossary_terms (topic_id, key, term, definition, original) VALUES ('tp1', 'rebase', 'Rebase', ?, 'rebase')
           ON CONFLICT (topic_id, key) DO UPDATE SET definition = excluded.definition`,
        )
        .run(definition);
    term("Moves commits onto a new base.");
    term("Replays commits onto another base.");
    const [hit] = search("onto", database).hits;
    expect(hit).toMatchObject({ kind: "term", id: "rebase", title: { text: "Rebase (rebase)" } });
    expect(hit!.snippet!.text).toBe("Replays commits onto another base.");

    database.query("INSERT INTO notes (id, topic_id, lesson_id, step_id, quote, text) VALUES ('nt1', 'tp1', 'ls1', 'st1', 'replays your commits', 'Ask about force push')").run();
    expect(search("force push", database).hits[0]).toMatchObject({ kind: "note", stepIdx: 0, snippet: { text: "replays your commits" } });
    database.query("DELETE FROM notes WHERE id = 'nt1'").run();
    expect(kinds("force push")).toEqual([]);

    database.query("DELETE FROM topics WHERE id = 'tp1'").run();
    expect(search("replays", database).hits).toEqual([]);
    expect(database.query("SELECT count(*) AS n FROM search_entries").get()).toEqual({ n: 0 });
  });

  test("matches parts of words, ignores case and ё, and keeps the original letters", () => {
    database.query("UPDATE topics SET title = 'Ёмкость конденсатора' WHERE id = 'tp1'").run();
    const [hit] = search("ЕМКОСТ", database).hits;
    expect(hit!.title.text).toBe("Ёмкость конденсатора");
    expect(marked(hit!.title)).toEqual(["Ёмкост"]);
    expect(kinds("денсат")).toEqual(["topic:Ёмкость конденсатора"]);
  });

  test("every long word must occur; a query without one matches titles", () => {
    insertStep(database, 0, worked);
    expect(kinds("branch remote")).toEqual(["step:Rebasing a feature branch"]);
    expect(kinds("branch nowhere")).toEqual([]);
    expect(kinds("ss")).toEqual(["lesson:Lesson"]);
    expect(kinds("re")).toEqual(["step:Rebasing a feature branch"]);
  });

  test("leaves out a lesson and its steps once a newer version supersedes it", () => {
    insertStep(database, 0, explain);
    expect(kinds("replays")).toEqual(["step:How a rebase moves commits"]);
    database
      .query("INSERT INTO lessons (id, topic_id, title, objective, level, node_ids, outline, status, created_at) VALUES ('ls2', 'tp1', 'Lesson', 'Objective of the lesson', 'novice', '[\"a\"]', '[]', 'finished', '2999-01-01T00:00:00.000Z')")
      .run();
    insertStep(database, 0, { ...explain, title: "Rebase, second version" }, "ls2");
    expect(kinds("replays")).toEqual(["step:Rebase, second version"]);
    expect(search("objective", database).hits.map((h) => h.lessonId)).toEqual(["ls2"]);
  });

  test("groups hits by kind, at most five of a kind", () => {
    const card: Card = { kind: "basic", front: "Rebase card", back: "back", nodeId: "a", lens: "fact", cites };
    for (let i = 0; i < 7; i++) {
      database.query("INSERT INTO cards (id, topic_id, node_id, content, status) VALUES (?, 'tp1', 'a', ?, 'active')").run(`cd${i}`, JSON.stringify(card));
    }
    insertStep(database, 0, explain);
    expect(kinds("rebase")).toEqual(["step:How a rebase moves commits", ...Array(5).fill("card:Rebase card")]);
  });

  test("indexes the rows of a database created before search", () => {
    const file = join(mkdtempSync(join(tmpdir(), "clayfold-search-")), "db.sqlite");
    const old = openDb(file);
    seed(old);
    insertStep(old, 0, explain);
    for (const { type, name } of old.query<{ type: string; name: string }, []>("SELECT type, name FROM sqlite_master WHERE name LIKE 'search%' AND type IN ('table', 'trigger')").all()) {
      if (!name.startsWith("search_index_")) old.exec(`DROP ${type} IF EXISTS ${name}`);
    }
    old.close();
    database = openDb(file);
    expect(kinds("replays")).toEqual(["step:How a rebase moves commits"]);
    expect(kinds("objective")).toEqual(["lesson:Lesson"]);
  });
});
