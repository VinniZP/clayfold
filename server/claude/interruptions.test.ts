import { beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { openDb } from "../db";
import { clearRunning, interruptionMessage, interruptionNote, markRunning, pendingInterruption, takeLostTurns, turnsToResume, withNote, type Interruption } from "./interruptions";
import type { StoredMessage } from "./stream";

let database: Database;
let n = 0;
beforeEach(() => {
  database = openDb(":memory:");
  database.query("INSERT INTO topics (id, slug, title, request) VALUES ('t', 't', 't', 'r')").run();
  database.query("INSERT INTO conversations (id, topic_id, kind) VALUES ('c1', 't', 'onboard'), ('c2', 't', 'tutor')").run();
});

function store(conversationId: string, m: Omit<StoredMessage, "id"> & { id?: string }) {
  database
    .query("INSERT INTO messages (id, conversation_id, role, text, meta) VALUES (?, ?, ?, ?, ?)")
    .run(m.id ?? `m${++n}`, conversationId, m.role, m.text, m.meta ? JSON.stringify(m.meta) : null);
}
const user = (c: string, text: string) => store(c, { role: "user", text });
const interrupt = (c: string, reason: "user" | "shutdown", rerun = false) =>
  store(c, interruptionMessage(reason, { text: `<context>x</context>\n<learner>${c} answer</learner>`, learnerText: `${c} answer`, rerun }));

describe("interruption messages", () => {
  test("text and meta follow the reason", () => {
    const shutdown = interruptionMessage("shutdown", { text: "turn text", learnerText: "Work in a team" });
    expect(shutdown).toMatchObject({ role: "error", text: "The server restarted and the turn was interrupted" });
    expect(shutdown.meta).toEqual({ interrupted: "shutdown", turnText: "turn text", learnerText: "Work in a team", rerun: false });
    expect(interruptionMessage("user", { text: "t", learnerText: null }).text).toBe("Stopped");
  });
});

describe("note for the next turn", () => {
  const i = (interrupted: "user" | "shutdown", learnerText: string | null): Interruption => ({ interrupted, turnText: "t", learnerText, rerun: false });

  test("names the real cause and quotes the learner", () => {
    expect(interruptionNote(i("shutdown", "Work in a team"))).toBe(
      "[Platform: the previous turn was interrupted because the server restarted. The learner's last message: \"Work in a team\". Answer it.]",
    );
    expect(interruptionNote(i("user", null))).toBe("[Platform: the previous turn was interrupted because the learner stopped it.]");
  });

  test("goes before plain text and after a skill command", () => {
    expect(withNote("<learner>hi</learner>", "[N]")).toBe("[N]\n\n<learner>hi</learner>");
    expect(withNote("/clayfold:onboard git", "[N]")).toBe("/clayfold:onboard git\n\n[N]");
  });

  test("is pending only until Claude has produced anything after the interruption", () => {
    user("c1", "first");
    expect(pendingInterruption("c1", database)).toBeNull();
    interrupt("c1", "user");
    user("c1", "second");
    expect(pendingInterruption("c1", database)).toMatchObject({ interrupted: "user", learnerText: "c1 answer" });
    store("c1", { role: "assistant", text: "reply" });
    expect(pendingInterruption("c1", database)).toBeNull();
  });
});

describe("turns resumed after a restart", () => {
  test("only shutdown interruptions that are the latest message and not already a re-run", () => {
    user("c1", "c1 answer");
    interrupt("c1", "shutdown");
    user("c2", "c2 answer");
    interrupt("c2", "user");
    expect(turnsToResume(database).map((r) => [r.conversationId, r.interruption.turnText])).toEqual([
      ["c1", "<context>x</context>\n<learner>c1 answer</learner>"],
    ]);

    user("c1", "newer message");
    expect(turnsToResume(database)).toEqual([]);

    interrupt("c2", "shutdown", true);
    expect(turnsToResume(database)).toEqual([]);
  });
});

describe("turns lost with the server process", () => {
  test("a recorded turn outlives the process; stored as a shutdown interruption it is resumed once", () => {
    markRunning("c1", { text: "/clayfold:onboard Git", learnerText: "Git" }, database);
    markRunning("c2", { text: "tutor turn", learnerText: "why?", rerun: true }, database);
    markRunning("c2", { text: "tutor turn", learnerText: "why?", rerun: true }, database);
    clearRunning("c1", database);
    markRunning("c1", { text: "next turn", learnerText: null }, database);

    const lost = takeLostTurns(database);
    expect(lost).toEqual([
      { conversationId: "c2", turn: { text: "tutor turn", learnerText: "why?", rerun: true } },
      { conversationId: "c1", turn: { text: "next turn", learnerText: null, rerun: false } },
    ]);
    expect(takeLostTurns(database)).toEqual([]);
    for (const { conversationId, turn } of lost) store(conversationId, interruptionMessage("shutdown", turn));
    // c2's lost turn was itself a re-run, so it is not run a third time.
    expect(turnsToResume(database).map((r) => r.conversationId)).toEqual(["c1"]);
  });
});
