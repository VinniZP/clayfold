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
] as const;

// SQLite cannot alter a CHECK constraint: these tables are rebuilt when an older database has other CHECKs than schema.sql.
const CHECKED_TABLES = ["conversations"] as const;

const checks = (sql: string) => (sql.match(/CHECK \([^()]*\([^()]*\)\)/g) ?? []).join("\n");

function createStatement(table: string): string {
  const statement = schema.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]*?\\n\\);`))?.[0];
  if (!statement) throw new Error(`schema.sql defines no table ${table}`);
  return statement;
}

function rebuildChangedChecks(db: Database): void {
  for (const table of CHECKED_TABLES) {
    const stored = db.query<{ sql: string }, [string]>("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)!.sql;
    const wanted = createStatement(table);
    if (checks(stored) === checks(wanted)) continue;
    const columns = db
      .query<{ name: string }, []>(`SELECT name FROM pragma_table_info('${table}')`)
      .all()
      .map((c) => c.name)
      .join(", ");
    // With foreign keys on, DROP TABLE would delete the rows that reference this table.
    db.exec("PRAGMA foreign_keys = OFF");
    try {
      db.transaction(() => {
        db.exec(wanted.replace(`CREATE TABLE IF NOT EXISTS ${table} (`, `CREATE TABLE ${table}_rebuilt (`));
        db.exec(`INSERT INTO ${table}_rebuilt (${columns}) SELECT ${columns} FROM ${table}`);
        db.exec(`DROP TABLE ${table}`);
        db.exec(`ALTER TABLE ${table}_rebuilt RENAME TO ${table}`);
      })();
    } finally {
      db.exec("PRAGMA foreign_keys = ON");
    }
  }
}

export function openDb(file: string = paths.db): Database {
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
  const db = new Database(file, { create: true, strict: true });
  db.exec(schema);
  for (const [table, column, type] of ADDED_COLUMNS) {
    if (!db.query(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`).get(column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    }
  }
  rebuildChangedChecks(db);
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
