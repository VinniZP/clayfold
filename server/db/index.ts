import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { paths } from "../config";

const schema = await Bun.file(new URL("./schema.sql", import.meta.url)).text();

// Columns added to existing tables after release; CREATE TABLE IF NOT EXISTS leaves older databases without them.
const ADDED_COLUMNS = [
  ["reviews", "duration_ms", "INTEGER"],
  ["lessons", "planned_sources", "TEXT"],
  ["lessons", "sources_at_plan", "INTEGER"],
  ["lessons", "announced_sources", "TEXT"],
  ["topics", "kind", "TEXT NOT NULL DEFAULT 'topic' CHECK (kind IN ('topic','goal'))"],
  ["topics", "goal_id", "TEXT REFERENCES topics(id) ON DELETE SET NULL"],
  ["videos", "timeline", "TEXT"],
  ["lessons", "challenge_idx", "INTEGER"],
  ["attempts", "confidence", "TEXT CHECK (confidence IN ('guess','unsure','sure'))"],
] as const;

export function openDb(file: string = paths.db): Database {
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
  const db = new Database(file, { create: true, strict: true });
  db.exec(schema);
  for (const [table, column, type] of ADDED_COLUMNS) {
    if (!db.query(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`).get(column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    }
  }
  return db;
}

let shared: Database | null = null;

/** Process-wide connection. Tests call openDb(":memory:") and pass it explicitly instead. */
export function db(): Database {
  shared ??= openDb();
  return shared;
}

export const newId = (prefix: string) => `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
export const now = () => new Date().toISOString();
