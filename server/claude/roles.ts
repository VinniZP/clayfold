import type { Database } from "bun:sqlite";
import { CLAUDE_MODELS, CLAUDE_ROLES, EFFORTS, supportsEffort, type ClaudeInstanceKind, type ClaudeRoleSetting, type Effort, type Settings } from "../../shared/api";
import { config } from "../config";
import { db } from "../db";

const KEY = "claude_roles";
const ONE_SHOT: readonly ClaudeInstanceKind[] = ["critic", "grading", "narration", "video", "game"];

// Lesson authoring is the long agentic run and the critic is the quality check; the learner waits on tutor, review and grading turns.
const DEFAULT_EFFORT: Record<ClaudeInstanceKind, Effort> = {
  onboard: "medium",
  lesson: "high",
  tutor: "low",
  review: "low",
  critic: "high",
  grading: "low",
  narration: "low",
  video: "medium",
  game: "medium",
};

const defaultModel = (role: ClaudeInstanceKind): string => (ONE_SHOT.includes(role) ? config.criticModel : config.model);

function stored(database: Database): Partial<Record<ClaudeInstanceKind, Partial<ClaudeRoleSetting>>> {
  const row = database.query<{ value: string }, [string]>("SELECT value FROM settings WHERE key = ?").get(KEY);
  return row ? JSON.parse(row.value) : {};
}

export function roleSetting(role: ClaudeInstanceKind, database: Database = db()): ClaudeRoleSetting {
  const value = stored(database)[role];
  return {
    model: CLAUDE_MODELS.find((m) => m === value?.model) ?? null,
    effort: EFFORTS.find((e) => e === value?.effort) ?? null,
  };
}

/** The model and effort a `claude` process of the role starts with; a null effort passes no --effort. */
export function roleRun(role: ClaudeInstanceKind, database: Database = db()): { model: string; effort: Effort | null } {
  const setting = roleSetting(role, database);
  const model = setting.model ?? defaultModel(role);
  return { model, effort: supportsEffort(model) ? (setting.effort ?? DEFAULT_EFFORT[role]) : null };
}

export const effortArgs = (effort: Effort | null): string[] => (effort ? ["--effort", effort] : []);

export function setRoleSetting(role: ClaudeInstanceKind, setting: ClaudeRoleSetting, database: Database = db()): void {
  const all = { ...stored(database), [role]: setting };
  database.query("INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT (key) DO UPDATE SET value = ?2").run(KEY, JSON.stringify(all));
}

export function roleSettingsView(database: Database = db()): Settings["claude"] {
  return Object.fromEntries(CLAUDE_ROLES.map((role) => [role, { ...roleSetting(role, database), defaultModel: defaultModel(role), defaultEffort: DEFAULT_EFFORT[role] }])) as Settings["claude"];
}
