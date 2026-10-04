import { beforeEach, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import type { TopicEvent } from "../../shared/events";
import type { Step } from "../../shared/schemas";
import type { LearnerState } from "../../shared/tools";
import { openDb } from "../db";
import { learnerState } from "../mcp/tools/learner";
import type { OneShotResult } from "../claude/oneshot";
import { submitAttempt } from "./grading";
import {
  buildTeachbackContext,
  checkDebrief,
  finishTeachback,
  keyIdeas,
  startTeachback,
  teachbackGaps,
  teachbackOpen,
  teachbackView,
  type RawDebrief,
} from "./teachback";
import { insertStep, items, seed } from "./test-fixtures";

const cites = [{ sourceId: "src1", quote: "A verbatim quote from the source." }];
const explain = (title: string, body: string, nodeId: string): Step => ({ kind: "explain", title, body, cites, checks: [items.single(title, nodeId)] });

let database: Database;
let ideaA: string;
let ideaWorked: string;
let practiceA: string;
let checkItems: string[];
let sent: { conversationId: string; text: string; display?: string | null }[];
let events: TopicEvent[];

beforeEach(() => {
  database = openDb(":memory:");
  seed(database);
  database.query("UPDATE lessons SET status = 'finished' WHERE id = 'ls1'").run();
  database.query("INSERT INTO settings (key, value) VALUES ('teachback_enabled', 'true')").run();
  database
    .query("INSERT INTO glossary_terms (topic_id, key, term, definition) VALUES ('tp1', 'commit', 'Commit', 'A saved snapshot of the project.')")
    .run();
  database
    .query("INSERT INTO glossary_terms (topic_id, key, term, definition) VALUES ('tp1', 'unused', 'Unused', 'A term no step of this lesson marks.')")
    .run();
  ideaA = insertStep(database, 1, explain("What a commit is", "A [[commit|Commit]] stores the staged changes.", "a")).stepId;
  insertStep(database, 2, explain("Other node", "Text about node D.", "d"));
  ideaWorked = insertStep(database, 3, {
    kind: "worked_example",
    title: "Making a commit",
    problem: "Save the edit.",
    cites,
    lines: [{ text: "git add file" }, { text: "git commit -m 'msg'" }],
  }).stepId;
  practiceA = insertStep(database, 4, { kind: "practice", title: "Commit an edit", item: items.single("p1", "a") }).stepId;
  checkItems = insertStep(database, 5, { kind: "check", title: "Final check", items: [items.single("c1", "a"), items.single("c2", "a")] }).itemIds;
  sent = [];
  events = [];
});

const complete = async () => {
  for (const id of checkItems) await submitAttempt(id, { answer: { format: "single", choice: 2 }, hintsUsed: 0, durationMs: 4000, context: "check" }, { database });
};
const start = () => startTeachback("tp1", { nodeId: "a" }, database, (turn) => sent.push(turn));
const say = (conversationId: string, role: "user" | "assistant", text: string) =>
  database.query("INSERT INTO messages (id, conversation_id, role, text) VALUES (?, ?, ?, ?)").run(crypto.randomUUID(), conversationId, role, text);

function runner(...answers: OneShotResult<RawDebrief>[]) {
  const prompts: string[] = [];
  const run = async <T>(opts: { prompt: string }) => {
    prompts.push(opts.prompt);
    return answers.shift() as OneShotResult<T>;
  };
  return { prompts, deps: { database, runPrompt: run, publish: (_: string, e: TopicEvent) => events.push(e) } };
}

const valid = (): RawDebrief => ({
  ideas: [
    { stepId: ideaA, mentioned: true, correct: true, evidence: "“it stores the STAGED   changes”", correction: "" },
    { stepId: ideaWorked, mentioned: false, correct: false, evidence: "", correction: "Stage the file with git add, then record it with git commit." },
  ],
  summary: "You explained what a commit stores. Revisit how to make one.",
});

test("key ideas are the explain steps that check the node and every worked example", () => {
  expect(keyIdeas("ls1", "a", database).map((k) => k.title)).toEqual(["What a commit is", "Making a commit"]);
  expect(keyIdeas("ls1", "a", database)[0]!.text).toBe("A commit stores the staged changes.");
  expect(keyIdeas("ls1", "c", database).map((k) => k.title)).toEqual(["What a commit is", "Other node", "Making a commit"]);
});

test("a teach-back starts only after a completed lesson on the node, with the lesson as context and no learner message", async () => {
  expect(start).toThrow("Complete a lesson on this node");
  await complete();
  const view = start();
  expect(view).toMatchObject({ nodeId: "a", nodeTitle: "Node A", lessonId: "ls1", status: "talking", debrief: null });
  expect(database.query("SELECT kind, lesson_id FROM conversations WHERE id = ?").get(view.conversationId)).toEqual({ kind: "teachback", lesson_id: "ls1" });
  expect(sent).toHaveLength(1);
  expect(sent[0]!.display).toBeNull();
  expect(sent[0]!.text.startsWith("/clayfold:teach-back <context>")).toBe(true);
  const context = buildTeachbackContext(view.id, database);
  for (const part of [`Teach-back id: ${view.id}`, "Your name: Sam", '"Node A". Summary of node A', "1. What a commit is\nA commit stores the staged changes.", "2. Making a commit", "- SECRET-MISC1-What a commit is", "- Commit: A saved snapshot"]) {
    expect(context).toContain(part);
  }
  for (const absent of ["Other node", "Unused", "[["]) expect(context).not.toContain(absent);
  expect(() => startTeachback("tp1", { nodeId: "a", lessonId: "ls_other" }, database, () => {})).toThrow("does not cover");
});

test("a teach-back does not start while it is off in Settings", () => {
  database.query("DELETE FROM settings WHERE key = 'teachback_enabled'").run();
  expect(start).toThrow("Explain it back is off");
});

test("checkDebrief rejects unknown, repeated and missing steps, invented evidence and a gap without its correction", () => {
  const ideas = keyIdeas("ls1", "a", database);
  const said = "I think it stores the staged changes.";
  expect(checkDebrief(valid(), ideas, said)).toEqual([]);
  const bad: RawDebrief = {
    ideas: [
      { stepId: "st_invented", mentioned: false, correct: false, evidence: "", correction: "x" },
      { stepId: ideaA, mentioned: true, correct: false, evidence: "a commit is a branch", correction: "" },
      { stepId: ideaA, mentioned: true, correct: true, evidence: "stores the staged changes", correction: "" },
    ],
    summary: " ",
  };
  const problems = checkDebrief(bad, ideas, said);
  expect(problems).toHaveLength(6);
  expect(problems.join("\n")).toContain('stepId "st_invented" is not one of the key ideas');
  expect(problems.join("\n")).toContain("not copied verbatim");
  expect(problems.join("\n")).toContain("its correction is empty");
  expect(problems.join("\n")).toContain("more than one entry");
  expect(problems.join("\n")).toContain('Key idea "Making a commit"');
  expect(problems.join("\n")).toContain("summary is empty");
});

test("the debrief retries with the problems, is stored with verdicts and next steps, and feeds learner state without touching mastery", async () => {
  await complete();
  const view = start();
  expect(() => finishTeachback(view.id, "learner", runner().deps)).toThrow("Explain something first");
  say(view.conversationId, "assistant", "Hi! What is a commit?");
  say(view.conversationId, "user", "I think it stores the staged changes.");

  const invented = { ...valid(), ideas: [...valid().ideas, { stepId: "st_invented", mentioned: false, correct: false, evidence: "", correction: "x" }] };
  const { prompts, deps } = runner({ ok: true, value: invented, costUsd: null }, { ok: true, value: valid(), costUsd: null });
  const masteryBefore = database.query("SELECT id, mastery FROM nodes ORDER BY id").all();
  const { view: debriefing, done } = finishTeachback(view.id, "learner", deps);
  expect(debriefing.status).toBe("debriefing");
  expect(teachbackOpen(view.conversationId, database)).toBe(false);
  await done;

  expect(prompts).toHaveLength(2);
  expect(prompts[0]).toContain("Learner: I think it stores the staged changes.");
  expect(prompts[0]).toContain(`<idea stepId="${ideaA}">`);
  expect(prompts[1]).toContain('stepId "st_invented" is not one of the key ideas');
  const done1 = teachbackView(view.id, database);
  expect(done1.status).toBe("done");
  expect(done1.score).toEqual({ covered: 1, total: 2 });
  expect(done1.debrief!.ideas).toEqual([
    { stepId: ideaA, stepIdx: 1, title: "What a commit is", verdict: "covered", evidence: "it stores the STAGED   changes", correction: null },
    { stepId: ideaWorked, stepIdx: 3, title: "Making a commit", verdict: "missing", evidence: null, correction: "Stage the file with git add, then record it with git commit." },
  ]);
  expect(done1.debrief!.next).toEqual([
    { kind: "reread", stepId: ideaWorked, stepIdx: 3, title: "Making a commit" },
    { kind: "practice", stepId: practiceA, stepIdx: 4, title: "Commit an edit" },
  ]);
  expect(events.map((e) => e.type === "teachback.updated" && e.status)).toEqual(["debriefing", "done"]);
  expect(() => finishTeachback(view.id, "learner", deps)).toThrow("already finished");

  const gaps: LearnerState["teachbackGaps"] = [
    { nodeId: "a", idea: "Making a commit", verdict: "missing", correction: "Stage the file with git add, then record it with git commit.", at: done1.finishedAt! },
  ];
  expect(teachbackGaps("tp1", database)).toEqual(gaps);
  expect(learnerState(database, "tp1", ["a"]).teachbackGaps).toEqual(gaps);
  expect(learnerState(database, "tp1", ["d"]).teachbackGaps).toEqual([]);
  expect(database.query("SELECT id, mastery FROM nodes ORDER BY id").all()).toEqual(masteryBefore);
});

test("a debrief that fails twice is stored as failed and can be retried", async () => {
  await complete();
  const view = start();
  say(view.conversationId, "user", "It saves things.");
  const { deps } = runner({ ok: false, error: "claude exited 1" }, { ok: true, value: valid(), costUsd: null }); // the second cites words never said
  await finishTeachback(view.id, "learner", deps).done;
  expect(teachbackView(view.id, database)).toMatchObject({ status: "failed", error: "Could not check your explanation. Try again.", debrief: null });

  const retry = runner({ ok: true, value: { ...valid(), ideas: valid().ideas.map((i) => ({ ...i, mentioned: false, correct: false, evidence: "", correction: "From the lesson." })) }, costUsd: null });
  await finishTeachback(view.id, "learner", retry.deps).done;
  expect(teachbackView(view.id, database).score).toEqual({ covered: 0, total: 2 });
});
