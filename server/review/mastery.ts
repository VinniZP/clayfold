import type { Database } from "bun:sqlite";
import { db } from "../db";

const DAY_MS = 24 * 60 * 60 * 1000;
const EXIT_PASS_SHARE = 0.8;

type Mastery = "new" | "learning" | "exit_passed" | "mastered";

type NodeRow = { mastery: Mastery; exit_passed_at: string | null };

function node(database: Database, topicId: string, nodeId: string): NodeRow | null {
  return database
    .query<NodeRow, [string, string]>("SELECT mastery, exit_passed_at FROM nodes WHERE topic_id = ? AND id = ?")
    .get(topicId, nodeId);
}

function setMastery(database: Database, topicId: string, nodeId: string, mastery: Mastery, at: Date): void {
  const column = mastery === "exit_passed" ? ", exit_passed_at = ?3" : mastery === "mastered" ? ", mastered_at = ?3" : "";
  database
    .query(`UPDATE nodes SET mastery = ?4${column} WHERE topic_id = ?1 AND id = ?2`)
    .run(topicId, nodeId, at.toISOString(), mastery);
}

const delayed = (exitPassedAt: string | null, at: Date) =>
  exitPassedAt !== null && at.getTime() - Date.parse(exitPassedAt) >= DAY_MS;

/**
 * L12 transitions after an attempt: new → learning on any attempt; → exit_passed when at least 80% of
 * the node's check items in the lesson were correct on the first try without hints; exit_passed →
 * mastered on a correct, unaided review attempt at least a day after the exit check.
 * Returns the node's mastery afterwards.
 */
export function updateMasteryAfterAttempt(attemptId: string, database: Database = db()): Mastery | null {
  const a = database
    .query<
      { item_id: string; correct: number | null; hints_used: number; gave_up: number; context: string; created_at: string; topic_id: string; node_id: string; lesson_id: string | null; role: string },
      [string]
    >(
      `SELECT a.item_id, a.correct, a.hints_used, a.gave_up, a.context, a.created_at, i.topic_id, i.node_id, i.lesson_id, i.role
       FROM attempts a JOIN items i ON i.id = a.item_id WHERE a.id = ?`,
    )
    .get(attemptId);
  if (!a) return null;
  const at = new Date(a.created_at);
  let current = node(database, a.topic_id, a.node_id);
  if (!current) return null;

  if (current.mastery === "new") {
    setMastery(database, a.topic_id, a.node_id, "learning", at);
    current = { ...current, mastery: "learning" };
  }

  if (current.mastery === "learning" && a.role === "check" && a.lesson_id) {
    const firstTries = database
      .query<{ correct: number | null; hints_used: number; gave_up: number }, [string, string]>(
        `SELECT
           (SELECT correct FROM attempts WHERE item_id = i.id ORDER BY created_at, rowid LIMIT 1) AS correct,
           (SELECT hints_used FROM attempts WHERE item_id = i.id ORDER BY created_at, rowid LIMIT 1) AS hints_used,
           (SELECT gave_up FROM attempts WHERE item_id = i.id ORDER BY created_at, rowid LIMIT 1) AS gave_up
         FROM items i
         WHERE i.lesson_id = ? AND i.node_id = ? AND i.role = 'check' AND i.status != 'retired'`,
      )
      .all(a.lesson_id, a.node_id);
    const passed = firstTries.filter((t) => t.correct === 1 && t.hints_used === 0 && t.gave_up === 0).length;
    if (firstTries.length > 0 && passed / firstTries.length >= EXIT_PASS_SHARE) {
      setMastery(database, a.topic_id, a.node_id, "exit_passed", at);
      return "exit_passed";
    }
  }

  if (
    current.mastery === "exit_passed" &&
    a.context === "review" &&
    a.correct === 1 &&
    a.hints_used === 0 &&
    a.gave_up === 0 &&
    delayed(current.exit_passed_at, at)
  ) {
    setMastery(database, a.topic_id, a.node_id, "mastered", at);
    return "mastered";
  }
  return current.mastery;
}

/** L12: a delayed retrieval at `at` masters an exit-passed node when the exit check passed at least a day earlier. */
function masterIfDelayed(database: Database, topicId: string, nodeId: string, at: Date): Mastery | null {
  const current = node(database, topicId, nodeId);
  if (!current) return null;
  if (current.mastery === "exit_passed" && delayed(current.exit_passed_at, at)) {
    setMastery(database, topicId, nodeId, "mastered", at);
    return "mastered";
  }
  return current.mastery;
}

/** L12: a card of an exit-passed node rated Good or Easy at least a day after the exit check masters the node. */
export function updateMasteryAfterCardReview(cardId: string, rating: number, at: Date, database: Database = db()): Mastery | null {
  const card = database
    .query<{ topic_id: string; node_id: string }, [string]>("SELECT topic_id, node_id FROM cards WHERE id = ?")
    .get(cardId);
  if (!card) return null;
  return rating >= 3 ? masterIfDelayed(database, card.topic_id, card.node_id, at) : (node(database, card.topic_id, card.node_id)?.mastery ?? null);
}

/** L12, L20: a correct practice-test answer is unaided, so one given at least a day after the exit check masters the node. */
export function updateMasteryAfterTestAnswer(topicId: string, nodeId: string, answeredAt: Date, database: Database = db()): Mastery | null {
  return masterIfDelayed(database, topicId, nodeId, answeredAt);
}
