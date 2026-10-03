import type { Subprocess } from "bun";
import { config } from "../config";
import { db, newId, now } from "../db";
import { languageInstruction } from "../i18n";
import { publish } from "../hub";
import { createWorkspace, syncTopicTitle } from "../workspace";
import type { ConversationKind, TopicSummary } from "../../shared/api";
import { childEnv } from "./env";
import { interruptionMessage, interruptionNote, pendingInterruption, turnsToResume, withNote, type InterruptReason, type TurnInfo } from "./interruptions";
import { toolArgs, type Scope } from "./scope";
import { StreamParser, type Effect, type StoredMessage } from "./stream";

const CANCEL_GRACE_MS = 15_000;
const KEPT_ACTIVITIES = 5;
const KEPT_FINISHED = 20;

type Turn = TurnInfo;

type Run = {
  topicId: string;
  startedAt: string;
  /** Labels of the latest activities in this run, oldest first. */
  activities: string[];
  proc: Subprocess<"ignore", "pipe", "pipe">;
  turn: Turn;
  queue: Turn[];
  cancelled: InterruptReason | null;
  done: Promise<void>;
};

const runs = new Map<string, Run>();

export type FinishedRun = {
  conversationId: string;
  startedAt: string;
  finishedAt: string;
  costUsd: number | null;
  error: string | null;
  cancelled: boolean;
};

/** The latest finished turns, newest first; kept in memory only. */
const finished: FinishedRun[] = [];

function recordFinished(run: FinishedRun): void {
  finished.unshift(run);
  finished.length = Math.min(finished.length, KEPT_FINISHED);
}

export function finishedRuns(): FinishedRun[] {
  return [...finished];
}

type ConversationRow = {
  id: string;
  topic_id: string;
  kind: ConversationKind;
  lesson_id: string | null;
  session_id: string | null;
  slug: string;
  topic_kind: TopicSummary["kind"];
};

function loadConversation(conversationId: string): ConversationRow {
  const row = db()
    .query<ConversationRow, [string]>(
      `SELECT c.id, c.topic_id, c.kind, c.lesson_id, c.session_id, t.slug, t.kind AS topic_kind
       FROM conversations c JOIN topics t ON t.id = c.topic_id WHERE c.id = ?`,
    )
    .get(conversationId);
  if (!row) throw new Error(`conversation ${conversationId} not found`);
  return row;
}

export function storeMessage(conversationId: string, message: StoredMessage): void {
  db()
    .query(
      `INSERT INTO messages (id, conversation_id, role, text, meta) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET text = excluded.text, meta = excluded.meta`,
    )
    .run(message.id, conversationId, message.role, message.text, message.meta ? JSON.stringify(message.meta) : null);
}

export function isRunning(conversationId: string): boolean {
  return runs.has(conversationId);
}

export function runInfo(conversationId: string): { runningSince: string | null; currentActivity: string | null } {
  const run = runs.get(conversationId);
  return { runningSince: run?.startedAt ?? null, currentActivity: run?.activities.at(-1) ?? null };
}

/** Conversation runs in progress, one `claude` process each. */
export function activeRuns(): { conversationId: string; pid: number; startedAt: string; activities: string[]; queued: number }[] {
  return [...runs].map(([conversationId, run]) => ({
    conversationId,
    pid: run.proc.pid,
    startedAt: run.startedAt,
    activities: [...run.activities],
    queued: run.queue.length,
  }));
}

/** True while any conversation of the topic runs; queued turns exist only behind a running one. */
export function isTopicRunning(topicId: string): boolean {
  for (const run of runs.values()) if (run.topicId === topicId) return true;
  return false;
}

/**
 * Sends `text` to Claude in the conversation. One process runs per conversation; a turn sent while
 * one runs waits in a queue. `display` is the user message stored in the chat: the text itself by
 * default, other text (e.g. the learner's words without the tutor context), or null for none.
 */
export function runTurn(opts: { conversationId: string; text: string; display?: string | null }): void {
  const conv = loadConversation(opts.conversationId);
  const display = opts.display === undefined ? opts.text : opts.display;
  if (display !== null) storeMessage(conv.id, { id: newId("m"), role: "user", text: display });
  const turn: Turn = { text: opts.text, learnerText: display };
  const active = runs.get(conv.id);
  if (active) {
    active.queue.push(turn);
    return;
  }
  start(conv.id, turn, []);
}

export function cancel(conversationId: string, reason: InterruptReason = "user"): boolean {
  const run = runs.get(conversationId);
  if (!run) return false;
  run.queue.length = 0;
  run.cancelled = reason;
  run.proc.kill("SIGINT");
  const proc = run.proc;
  setTimeout(() => {
    if (proc.exitCode === null && proc.signalCode === null) proc.kill("SIGKILL");
  }, CANCEL_GRACE_MS).unref();
  return true;
}

/** Cancels every run for a server shutdown and waits for the processes to exit. */
export async function cancelAll(): Promise<void> {
  const pending = [...runs.entries()].map(([id, run]) => {
    cancel(id, "shutdown");
    return run.done;
  });
  await Promise.allSettled(pending);
}

function buildArgs(text: string, sessionId: string | null, scope: Scope): string[] {
  return [
    config.claudeBin,
    "-p",
    text,
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    ...(sessionId ? ["--resume", sessionId] : []),
    "--plugin-dir",
    config.pluginDir,
    "--setting-sources",
    "",
    ...toolArgs(scope),
    "--permission-mode",
    "dontAsk",
    "--permission-prompts",
    "none",
    "--model",
    config.model,
    "--max-budget-usd",
    String(config.maxBudgetUsd),
    "--append-system-prompt",
    languageInstruction(),
    // Without this, a resumed conversation keeps the system prompt of its first request, and so the old language.
    "--system-prompt-snapshot",
    "off",
  ];
}

function start(conversationId: string, turn: Turn, queue: Turn[]): void {
  const conv = loadConversation(conversationId);
  const interruption = pendingInterruption(conversationId);
  const text = interruption ? withNote(turn.text, interruptionNote(interruption)) : turn.text;
  const proc = Bun.spawn(buildArgs(text, conv.session_id, conv.topic_kind === "goal" ? "goal" : conv.kind), {
    cwd: createWorkspace(conv.slug),
    env: childEnv({ CLAYFOLD_MCP_URL: `http://127.0.0.1:${config.port}/mcp`, CLAYFOLD_TOPIC_ID: conv.topic_id }),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const startedAt = now();
  const run: Run = { topicId: conv.topic_id, startedAt, activities: [], proc, turn, queue, cancelled: null, done: Promise.resolve() };
  runs.set(conversationId, run);
  db().query("UPDATE conversations SET last_active_at = ? WHERE id = ?").run(startedAt, conversationId);
  publish(conv.topic_id, { type: "conv.status", conversationId, running: true, startedAt });
  run.done = drive(conv, run).catch((e) => {
    console.error(`run ${conversationId} failed:`, e);
    runs.delete(conversationId);
    const error = e instanceof Error ? e.message : String(e);
    recordFinished({ conversationId, startedAt, finishedAt: now(), costUsd: null, error, cancelled: false });
    publish(conv.topic_id, { type: "conv.done", conversationId, costUsd: null, error });
    publish(conv.topic_id, { type: "conv.status", conversationId, running: false, startedAt: null });
  });
}

async function* chunks(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    yield decoder.decode(value, { stream: true });
  }
}

async function drive(conv: ConversationRow, run: Run): Promise<void> {
  const parser = new StreamParser(conv.id, () => newId("m"));
  let result: Extract<Effect, { kind: "result" }> | null = null;
  let stderr = "";
  const stderrDone = (async () => {
    for await (const chunk of chunks(run.proc.stderr)) stderr = (stderr + chunk).slice(-2000);
  })();

  const apply = (effect: Effect) => {
    switch (effect.kind) {
      case "event":
        if (effect.event.type === "conv.activity") run.activities = [...run.activities, effect.event.label].slice(-KEPT_ACTIVITIES);
        publish(conv.topic_id, effect.event);
        break;
      case "message":
        storeMessage(conv.id, effect.message);
        break;
      case "session":
        db().query("UPDATE conversations SET session_id = ? WHERE id = ?").run(effect.sessionId, conv.id);
        break;
      case "tool_result":
        if (effect.tool === "lesson_plan" && !effect.isError) linkLesson(conv.id, effect.text);
        break;
      case "result":
        result = effect;
        break;
    }
  };

  let buffer = "";
  for await (const chunk of chunks(run.proc.stdout)) {
    buffer += chunk;
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      for (const effect of parser.feed(line)) apply(effect);
    }
  }
  for (const effect of parser.feed(buffer)) apply(effect);
  const code = await run.proc.exited;
  await stderrDone;

  const final = result as Extract<Effect, { kind: "result" }> | null;
  let error: string | null = null;
  if (run.cancelled) {
    const message = interruptionMessage(run.cancelled, run.turn);
    error = message.text;
    storeMessage(conv.id, message);
    // A turn cut by shutdown is re-run at the next start, so its lesson keeps generating.
    if (run.cancelled === "user") failGeneratingLesson(conv.id);
  } else {
    if (final?.error) error = final.error;
    else if (!final) error = `claude exited with code ${code}${stderr.trim() ? `: ${stderr.trim().slice(-500)}` : ""}`;
    if (error) {
      storeMessage(conv.id, { id: newId("m"), role: "error", text: error });
      failGeneratingLesson(conv.id);
    }
  }
  db().query("UPDATE conversations SET last_active_at = ? WHERE id = ?").run(now(), conv.id);
  // The workspace watcher runs only while a topic stream is open; a run can rewrite MISSION.md without one.
  syncTopicTitle(conv.topic_id, conv.slug);
  runs.delete(conv.id);
  recordFinished({ conversationId: conv.id, startedAt: run.startedAt, finishedAt: now(), costUsd: final?.costUsd ?? null, error, cancelled: run.cancelled !== null });
  publish(conv.topic_id, { type: "conv.done", conversationId: conv.id, costUsd: final?.costUsd ?? null, error });
  publish(conv.topic_id, { type: "conv.status", conversationId: conv.id, running: false, startedAt: null });

  const next = run.queue.shift();
  if (next) start(conv.id, next, run.queue);
}

function linkLesson(conversationId: string, text: string): void {
  let lessonId: unknown;
  try {
    lessonId = (JSON.parse(text) as { lessonId?: unknown }).lessonId;
  } catch {
    return;
  }
  if (typeof lessonId !== "string") return;
  db().query("UPDATE conversations SET lesson_id = ? WHERE id = ? AND kind = 'lesson'").run(lessonId, conversationId);
}

function failGeneratingLesson(conversationId: string): void {
  db()
    .query(
      `UPDATE lessons SET status = 'failed'
       WHERE status = 'generating'
         AND id = (SELECT lesson_id FROM conversations WHERE id = ? AND kind = 'lesson')`,
    )
    .run(conversationId);
}

/** Re-runs, once, every turn a server shutdown cut off. Call after the server listens: the turn needs /mcp. */
export function resumeInterruptedTurns(): number {
  const resumable = turnsToResume();
  for (const { conversationId, interruption } of resumable) {
    if (runs.has(conversationId)) continue;
    start(conversationId, { text: interruption.turnText, learnerText: interruption.learnerText, rerun: true }, []);
  }
  return resumable.length;
}

/** A lesson still generating at startup without a resumed run will never finish. */
export function failOrphanedLessons(): void {
  const resumed = [...runs.keys()];
  db()
    .query(
      `UPDATE lessons SET status = 'failed' WHERE status = 'generating'
       AND id NOT IN (SELECT lesson_id FROM conversations WHERE lesson_id IS NOT NULL AND id IN (SELECT value FROM json_each(?)))`,
    )
    .run(JSON.stringify(resumed));
}
