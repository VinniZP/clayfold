import { expect, test } from "bun:test";
import { openDb } from "../db";
import { discussGoalNotes, startSourceRefresh } from "./topics";

test("discussGoalNotes sends the unseen notes to the goal's planning conversation once", () => {
  const database = openDb(":memory:");
  database.query("INSERT INTO topics (id, slug, title, request, kind) VALUES ('goal', 'goal', 'Workout app', 'r', 'goal')").run();
  database.query("INSERT INTO topics (id, slug, title, request, goal_id) VALUES ('git', 'git', 'Git basics', 'r', 'goal')").run();
  database.query("INSERT INTO conversations (id, topic_id, kind) VALUES ('cv', 'goal', 'onboard')").run();
  database.query("INSERT INTO goal_notes (id, goal_id, topic_id, text, seen_at) VALUES ('old', 'goal', 'git', 'Already discussed', '2026-01-01')").run();
  database.query("INSERT INTO goal_notes (id, goal_id, topic_id, text) VALUES ('new', 'goal', 'git', 'Builds through an AI assistant')").run();
  const sent: { conversationId: string; text: string; display?: string | null }[] = [];

  expect(discussGoalNotes("goal", database, (turn) => sent.push(turn))).toEqual({ conversationId: "cv" });
  expect(sent).toHaveLength(1);
  expect(sent[0]!.text).toContain("- Git basics: Builds through an AI assistant");
  expect(sent[0]!.text).not.toContain("Already discussed");
  expect(database.query("SELECT count(*) AS n FROM goal_notes WHERE seen_at IS NULL").get()).toEqual({ n: 0 });
  expect(() => discussGoalNotes("goal", database, (turn) => sent.push(turn))).toThrow("no new notes");
});

test("startSourceRefresh opens a sources conversation with the focus, once a graph exists and no search runs", () => {
  const database = openDb(":memory:");
  database.query("INSERT INTO topics (id, slug, title, request) VALUES ('tp', 'tp', 'Meshes', 'r')").run();
  database.query("INSERT INTO topics (id, slug, title, request, kind) VALUES ('goal', 'goal', 'Game', 'r', 'goal')").run();
  const sent: { conversationId: string; text: string; display?: string | null }[] = [];
  const run = (turn: (typeof sent)[number]) => void sent.push(turn);
  const running = new Set<string>();

  expect(() => startSourceRefresh("tp", undefined, database, run, (id) => running.has(id))).toThrow();
  expect(() => startSourceRefresh("goal", undefined, database, run)).toThrow("no sources");
  database.query("INSERT INTO nodes (topic_id, id, title, kind, summary, prereqs) VALUES ('tp', 'uv', 'UV', 'skill', 'Unwrap a mesh', '[]')").run();

  const first = startSourceRefresh("tp", "more on UV unwrapping", database, run, (id) => running.has(id));
  expect(sent).toEqual([{ conversationId: first.conversationId, text: "/clayfold:source-refresh more on UV unwrapping", display: "more on UV unwrapping" }]);
  expect(database.query("SELECT kind FROM conversations WHERE id = ?").get(first.conversationId)).toEqual({ kind: "sources" });

  running.add(first.conversationId);
  expect(() => startSourceRefresh("tp", undefined, database, run, (id) => running.has(id))).toThrow();
  running.clear();
  const second = startSourceRefresh("tp", undefined, database, run, (id) => running.has(id));
  expect(sent[1]).toEqual({ conversationId: second.conversationId, text: "/clayfold:source-refresh", display: null });
});
