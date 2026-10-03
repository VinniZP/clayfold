import { expect, test } from "bun:test";
import { openDb } from "../db";
import { discussGoalNotes } from "./topics";

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
