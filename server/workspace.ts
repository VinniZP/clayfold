import type { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, watch, type FSWatcher } from "node:fs";
import { join } from "node:path";
import type { MemoryFile } from "../shared/api";
import { CONTENT_RULES } from "../shared/i18n";
import { paths } from "./config";
import { db } from "./db";
import { publish } from "./hub";

const TRANSLIT = new Map(Object.values(CONTENT_RULES).flatMap((r) => Object.entries(r.translit)));

export function slugify(text: string, maxLength = 40): string {
  const latin = [...text.toLowerCase()].map((ch) => TRANSLIT.get(ch) ?? ch).join("");
  const words = latin
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  let slug = "";
  for (const word of words) {
    const next = slug ? `${slug}-${word}` : word;
    if (next.length > maxLength) break;
    slug = next;
  }
  return slug || (words[0]?.slice(0, maxLength) ?? "") || "topic";
}

/** A slug not used by any topic row or workspace directory. */
export function uniqueSlug(text: string, database: Database = db()): string {
  const base = slugify(text);
  const taken = (slug: string) =>
    database.query("SELECT 1 FROM topics WHERE slug = ?").get(slug) !== null || existsSync(paths.workspace(slug));
  let slug = base;
  for (let n = 2; taken(slug); n++) slug = `${base}-${n}`;
  return slug;
}

export function createWorkspace(slug: string): string {
  const dir = paths.workspace(slug);
  mkdirSync(join(dir, "learning-records"), { recursive: true });
  return dir;
}

const MEMORY_FILES = ["MISSION.md", "RESOURCES.md", "GLOSSARY.md", "NOTES.md"];

export async function listMemory(slug: string): Promise<MemoryFile[]> {
  const dir = paths.workspace(slug);
  const records = existsSync(join(dir, "learning-records"))
    ? readdirSync(join(dir, "learning-records"))
        .filter((f) => f.endsWith(".md"))
        .sort()
        .map((f) => `learning-records/${f}`)
    : [];
  const out: MemoryFile[] = [];
  for (const path of [...MEMORY_FILES, ...records]) {
    const file = join(dir, path);
    if (!existsSync(file)) continue;
    out.push({ path, content: await Bun.file(file).text(), updatedAt: statSync(file).mtime.toISOString() });
  }
  return out;
}

type Watch = { watcher: FSWatcher; refs: number; timer: Timer | null; missionChanged: boolean };

const TITLE_MAX = 120;

/** The topic name from MISSION.md's first heading, "# Mission: <name>" in the learner's language, or null. */
export function missionTitle(mission: string): string | null {
  const heading = mission.split("\n").find((l) => l.trim().startsWith("#"));
  const name = heading?.trim().match(/^#\s*[^:#]+:\s*(.+)$/)?.[1]?.trim();
  return name ? name.slice(0, TITLE_MAX) : null;
}

/** Sets the topic's title from its MISSION.md when that names the topic. Returns true when the title changed. */
export function syncTopicTitle(
  topicId: string,
  slug: string,
  database: Database = db(),
  workspaceOf: (slug: string) => string = paths.workspace,
): boolean {
  const file = join(workspaceOf(slug), "MISSION.md");
  if (!existsSync(file)) return false;
  const title = missionTitle(readFileSync(file, "utf8"));
  if (!title) return false;
  return database.query("UPDATE topics SET title = ? WHERE id = ? AND title != ?").run(title, topicId, title).changes > 0;
}

/** Startup backfill for topics whose MISSION.md changed while no watcher ran. */
export function syncAllTopicTitles(database: Database = db(), workspaceOf: (slug: string) => string = paths.workspace): number {
  const topics = database.query<{ id: string; slug: string }, []>("SELECT id, slug FROM topics").all();
  return topics.filter((t) => syncTopicTitle(t.id, t.slug, database, workspaceOf)).length;
}

const watchers = new Map<string, Watch>();

/**
 * Publishes `memory.updated` for the topic, debounced, while at least one caller holds the watch, and
 * `onboarding.updated` when MISSION.md changed.
 */
export function watchWorkspace(topicId: string, slug: string, debounceMs = 400): () => void {
  let entry = watchers.get(topicId);
  if (!entry) {
    const dir = createWorkspace(slug);
    const created: Watch = {
      refs: 0,
      timer: null,
      missionChanged: false,
      watcher: watch(dir, { recursive: true }, (_event, filename) => {
        if (filename === "MISSION.md") created.missionChanged = true;
        if (created.timer) clearTimeout(created.timer);
        created.timer = setTimeout(() => {
          created.timer = null;
          publish(topicId, { type: "memory.updated" });
          if (created.missionChanged) {
            syncTopicTitle(topicId, slug);
            publish(topicId, { type: "onboarding.updated" });
          }
          created.missionChanged = false;
        }, debounceMs);
      }),
    };
    entry = created;
    watchers.set(topicId, entry);
  }
  entry.refs++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const current = watchers.get(topicId);
    if (!current || --current.refs > 0) return;
    if (current.timer) clearTimeout(current.timer);
    current.watcher.close();
    watchers.delete(topicId);
  };
}

export function closeAllWatchers(): void {
  for (const entry of watchers.values()) {
    if (entry.timer) clearTimeout(entry.timer);
    entry.watcher.close();
  }
  watchers.clear();
}
