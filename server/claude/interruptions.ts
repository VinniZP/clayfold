import type { Database } from "bun:sqlite";
import type { MessageKey } from "../../shared/i18n";
import { db, newId } from "../db";
import { t } from "../i18n";
import type { StoredMessage } from "./stream";

export type InterruptReason = "user" | "shutdown";

/** Meta of the error message stored when a run is interrupted. */
export type Interruption = {
  interrupted: InterruptReason;
  /** The text the interrupted turn sent to Claude, for re-running it. */
  turnText: string;
  /** The learner's own words in that turn, when it had any. */
  learnerText: string | null;
  /** The interrupted turn was itself an automatic re-run. */
  rerun: boolean;
};

export type TurnInfo = { text: string; learnerText: string | null; rerun?: boolean };

const ERROR_TEXT: Record<InterruptReason, MessageKey> = {
  user: "run.stopped",
  shutdown: "run.shutdown",
};

const CAUSE: Record<InterruptReason, string> = {
  user: "the learner stopped it",
  shutdown: "the server restarted",
};

const QUOTE_CHARS = 500;

export function interruptionMessage(reason: InterruptReason, turn: TurnInfo): StoredMessage {
  const meta: Interruption = { interrupted: reason, turnText: turn.text, learnerText: turn.learnerText, rerun: turn.rerun ?? false };
  return { id: newId("m"), role: "error", text: t(ERROR_TEXT[reason]), meta };
}

type Row = { id: string; role: string; meta: string | null };

function asInterruption(row: Row | null): Interruption | null {
  if (!row || row.role !== "error" || !row.meta) return null;
  const meta = JSON.parse(row.meta) as Partial<Interruption>;
  return meta.interrupted === "user" || meta.interrupted === "shutdown" ? (meta as Interruption) : null;
}

/** The interruption Claude has not heard about yet: the latest message other than the learner's is one. */
export function pendingInterruption(conversationId: string, database: Database = db()): Interruption | null {
  const row = database
    .query<Row, [string]>("SELECT id, role, meta FROM messages WHERE conversation_id = ? AND role != 'user' ORDER BY rowid DESC LIMIT 1")
    .get(conversationId);
  return asInterruption(row);
}

export function interruptionNote(i: Interruption): string {
  const said =
    i.learnerText === null
      ? ""
      : ` The learner's last message: "${i.learnerText.length > QUOTE_CHARS ? `${i.learnerText.slice(0, QUOTE_CHARS)}…` : i.learnerText}". Answer it.`;
  return `[Platform: the previous turn was interrupted because ${CAUSE[i.interrupted]}.${said}]`;
}

/** Adds the note to the turn text. A skill command must stay first, so the note follows it. */
export function withNote(text: string, note: string): string {
  return text.startsWith("/") ? `${text}\n\n${note}` : `${note}\n\n${text}`;
}

/** Records the turn a conversation runs; a shutdown or the end of the run clears it. */
export function markRunning(conversationId: string, turn: TurnInfo, database: Database = db()): void {
  database
    .query("INSERT OR REPLACE INTO running_turns (conversation_id, turn_text, learner_text, rerun) VALUES (?, ?, ?, ?)")
    .run(conversationId, turn.text, turn.learnerText, turn.rerun ? 1 : 0);
}

export function clearRunning(conversationId: string, database: Database = db()): void {
  database.query("DELETE FROM running_turns WHERE conversation_id = ?").run(conversationId);
}

/**
 * Turns that an earlier server process left running: it died without a shutdown, so no interruption was stored.
 * Takes them out of running_turns; the caller stores each as a shutdown interruption.
 */
export function takeLostTurns(database: Database = db()): { conversationId: string; turn: TurnInfo }[] {
  return database.transaction(() => {
    const rows = database
      .query<{ conversation_id: string; turn_text: string; learner_text: string | null; rerun: number }, []>("SELECT * FROM running_turns ORDER BY started_at, rowid")
      .all();
    database.query("DELETE FROM running_turns").run();
    return rows.map((r) => ({ conversationId: r.conversation_id, turn: { text: r.turn_text, learnerText: r.learner_text, rerun: r.rerun === 1 } }));
  })();
}

/**
 * Turns cut by a server shutdown that get one automatic re-run: the interruption is the conversation's
 * latest message (no newer learner message), and the interrupted turn was not itself a re-run.
 */
export function turnsToResume(database: Database = db()): { conversationId: string; interruption: Interruption }[] {
  const rows = database
    .query<Row & { conversation_id: string }, []>(
      `SELECT m.id, m.role, m.meta, m.conversation_id FROM messages m
       WHERE m.rowid = (SELECT max(rowid) FROM messages WHERE conversation_id = m.conversation_id)`,
    )
    .all();
  return rows.flatMap((row) => {
    const i = asInterruption(row);
    return i && i.interrupted === "shutdown" && !i.rerun ? [{ conversationId: row.conversation_id, interruption: i }] : [];
  });
}
