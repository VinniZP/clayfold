import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from ".";

test("an older database gets the new conversation kinds and keeps its conversations and messages", () => {
  const dir = mkdtempSync(join(tmpdir(), "clayfold-db-"));
  try {
    const file = join(dir, "old.sqlite");
    const old = new Database(file, { create: true });
    old.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE topics (id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL, request TEXT NOT NULL);
      CREATE TABLE conversations (
        id TEXT PRIMARY KEY,
        topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('onboard','lesson','tutor','review')),
        lesson_id TEXT,
        session_id TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        last_active_at TEXT
      );
      CREATE TABLE messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        text TEXT NOT NULL,
        meta TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
      INSERT INTO topics (id, slug, title, request) VALUES ('tp1', 'tp1', 'Topic', 'request');
      INSERT INTO conversations (id, topic_id, kind, session_id) VALUES ('cv1', 'tp1', 'tutor', 'sess');
      INSERT INTO messages (id, conversation_id, role, text) VALUES ('m1', 'cv1', 'user', 'hello');
    `);
    old.close();

    const database = openDb(file);
    expect(database.query("SELECT kind, session_id FROM conversations WHERE id = 'cv1'").get()).toEqual({ kind: "tutor", session_id: "sess" });
    expect(database.query("SELECT text FROM messages WHERE conversation_id = 'cv1'").get()).toEqual({ text: "hello" });
    database.query("INSERT INTO conversations (id, topic_id, kind) VALUES ('cv2', 'tp1', 'teachback')").run();
    database.query("DELETE FROM conversations WHERE id = 'cv1'").run();
    expect(database.query("SELECT count(*) AS n FROM messages").get()).toEqual({ n: 0 });
    database.close();

    const reopened = openDb(file);
    expect(reopened.query("SELECT kind FROM conversations").all()).toEqual([{ kind: "teachback" }]);
    reopened.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
