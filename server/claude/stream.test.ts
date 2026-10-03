import { describe, expect, test } from "bun:test";
import { activityLabels, shuffleOptions, StreamParser, type Effect } from "./stream";

// read-and-answer.jsonl: a real `claude -p` haiku run (Read a file, answer in one sentence), signatures shortened.
const fixture = await Bun.file(new URL("./fixtures/read-and-answer.jsonl", import.meta.url)).text();

function parse(lines: string[]): Effect[] {
  let n = 0;
  const parser = new StreamParser("cv1", () => `m${++n}`);
  return lines.flatMap((l) => parser.feed(l));
}

const line = (o: unknown) => JSON.stringify(o);
const assistant = (content: unknown[]) => line({ type: "assistant", message: { content }, parent_tool_use_id: null });
const toolResult = (id: string, content: unknown, isError = false) =>
  line({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, is_error: isError, content }] }, parent_tool_use_id: null });

describe("StreamParser on a recorded run", () => {
  const effects = parse(fixture.split("\n"));

  test("session id from init and the final result", () => {
    expect(effects[0]).toEqual({ kind: "session", sessionId: "8dbd731e-a91c-4b57-aab7-0212fea359cd" });
    const result = effects.at(-1);
    expect(result).toMatchObject({ kind: "result", sessionId: "8dbd731e-a91c-4b57-aab7-0212fea359cd", error: null, permissionDenials: [] });
    expect((result as { costUsd: number }).costUsd).toBeGreaterThan(0);
  });

  test("Read becomes an activity event and a stored activity message", () => {
    expect(effects).toContainEqual({
      kind: "event",
      event: { type: "conv.activity", conversationId: "cv1", label: "Looking through notes", doneLabel: "Looked through notes", tool: "Read" },
    });
    expect(effects).toContainEqual({
      kind: "message",
      message: { id: "m1", role: "activity", text: "Looking through notes", meta: { tool: "Read", doneText: "Looked through notes" } },
    });
  });

  test("text deltas share the stored message id and add up to its text", () => {
    const deltas = effects.flatMap((e) => (e.kind === "event" && e.event.type === "conv.text" ? [e.event] : []));
    const messages = effects.flatMap((e) => (e.kind === "message" && e.message.role === "assistant" ? [e.message] : []));
    expect(messages).toHaveLength(1);
    expect(deltas.every((d) => d.messageId === messages[0]!.id)).toBe(true);
    expect(deltas.map((d) => d.delta).join("")).toBe(messages[0]!.text);
    expect(messages[0]!.text).toContain("kiwi");
  });

  test("unknown line types and garbage are ignored", () => {
    expect(parse(['{"type":"rate_limit_event"}', "not json", "", '{"type":"system","subtype":"status"}'])).toEqual([]);
  });
});

describe("StreamParser on plugin tools", () => {
  test("ask_learner becomes conv.ask and a stored ask message", () => {
    const input = { question: "What is your experience?", options: [{ label: "None" }, { label: "Some", description: "read about it" }], multi: false, allowFree: true };
    const effects = parse([assistant([{ type: "tool_use", id: "t1", name: "mcp__plugin_clayfold_clayfold__ask_learner", input }])]);
    expect(effects).toEqual([
      { kind: "event", event: { type: "conv.ask", conversationId: "cv1", ...input } },
      { kind: "message", message: { id: "m1", role: "ask", text: input.question, meta: { options: input.options, multi: false, allowFree: true } } },
    ]);
  });

  test("lesson_plan result reaches the runner with its JSON text; other tools' results do not", () => {
    const effects = parse([
      assistant([{ type: "tool_use", id: "t1", name: "mcp__plugin_clayfold_clayfold__lesson_plan", input: {} }]),
      toolResult("t1", [{ type: "text", text: '{"lessonId":"ls_1"}' }]),
      assistant([{ type: "tool_use", id: "t2", name: "Read", input: { file_path: "/x/MISSION.md" } }]),
      toolResult("t2", "file text"),
    ]);
    expect(effects.filter((e) => e.kind === "tool_result")).toEqual([{ kind: "tool_result", tool: "lesson_plan", isError: false, text: '{"lessonId":"ls_1"}' }]);
  });

  test("source_add, graph_set and placement_record results announce onboarding.updated; errors do not", () => {
    const effects = parse([
      assistant([
        { type: "tool_use", id: "t1", name: "mcp__plugin_clayfold_clayfold__source_add", input: {} },
        { type: "tool_use", id: "t2", name: "mcp__plugin_clayfold_clayfold__graph_set", input: {} },
      ]),
      toolResult("t1", "{}", true),
      toolResult("t2", "{}"),
    ]);
    expect(effects.filter((e) => e.kind === "event" && e.event.type === "onboarding.updated")).toHaveLength(1);
  });

  test("text without partial stream events is delivered as one delta", () => {
    const effects = parse([assistant([{ type: "text", text: "Done." }])]);
    expect(effects).toEqual([
      { kind: "event", event: { type: "conv.text", conversationId: "cv1", messageId: "m1", delta: "Done." } },
      { kind: "message", message: { id: "m1", role: "assistant", text: "Done." } },
    ]);
  });

  test("api_retry and error results", () => {
    expect(parse([line({ type: "system", subtype: "api_retry", attempt: 2, retry_delay_ms: 4000 })])).toEqual([
      { kind: "event", event: { type: "conv.retry", conversationId: "cv1", attempt: 2, delayMs: 4000 } },
    ]);
    expect(parse([line({ type: "result", subtype: "error_max_budget_usd", is_error: true, session_id: "s", total_cost_usd: 5 })])).toEqual([
      { kind: "result", sessionId: "s", costUsd: 5, error: "error_max_budget_usd", permissionDenials: [] },
    ]);
  });

  test("subagent lines are ignored", () => {
    expect(parse([line({ type: "assistant", parent_tool_use_id: "t9", message: { content: [{ type: "text", text: "x" }] } })])).toEqual([]);
  });
});

describe("step_submit outcome", () => {
  const submit = (id: string, index: number) =>
    assistant([{ type: "tool_use", id, name: "mcp__plugin_clayfold_clayfold__step_submit", input: { lessonId: "ls", index } }]);
  const outcome = (status: string) => [{ type: "text", text: JSON.stringify({ status, attempt: 1, violations: [] }) }];
  const doneTexts = (effects: Effect[]) =>
    effects.flatMap((e) => (e.kind === "message" && e.message.role === "activity" ? [[e.message.id, e.message.meta?.doneText]] : []));

  test("the result's status refines the activity message's doneText under the same id", () => {
    const effects = parse([
      submit("t1", 0),
      toolResult("t1", outcome("published")),
      submit("t2", 1),
      toolResult("t2", outcome("rejected")),
      submit("t3", 1),
      toolResult("t3", outcome("dropped")),
    ]);
    expect(doneTexts(effects)).toEqual([
      ["m1", "Checked step 1"],
      ["m1", "Step 1 published"],
      ["m2", "Checked step 2"],
      ["m2", "Step 2 sent back for revision"],
      ["m3", "Checked step 2"],
      ["m3", "Step 2 dropped"],
    ]);
  });

  test("an error or unreadable result keeps the generic past tense", () => {
    const effects = parse([submit("t1", 2), toolResult("t1", "boom", true), submit("t2", 3), toolResult("t2", "not json")]);
    expect(doneTexts(effects)).toEqual([["m1", "Checked step 3"], ["m2", "Checked step 4"]]);
  });
});

test("activity labels in present and past tense", () => {
  const both = (tool: string, input: Record<string, unknown> = {}) => {
    const l = activityLabels(tool, input);
    return [l.label, l.doneLabel];
  };
  expect(both("WebSearch")).toEqual(["Searching for sources", "Found sources"]);
  expect(both("WebFetch")).toEqual(["Reading a page", "Read a page"]);
  expect(both("Grep")).toEqual(["Looking through notes", "Looked through notes"]);
  expect(both("mcp__plugin_clayfold_clayfold__source_search")).toEqual(["Searching a source for a quote", "Found a quote in a source"]);
  expect(both("mcp__plugin_clayfold_clayfold__graph_set")).toEqual(["Building the knowledge map", "Built the knowledge map"]);
  expect(both("mcp__plugin_clayfold_clayfold__cards_propose")).toEqual(["Preparing cards", "Proposed cards"]);
  expect(both("mcp__plugin_clayfold_clayfold__step_submit", { index: 2 })).toEqual(["Checking step 3", "Checked step 3"]);
  expect(both("mcp__plugin_clayfold_clayfold__mystery")).toEqual(["Working: mystery", "Done: mystery"]);
});

test("memory file edits use human names, never file names", () => {
  const both = (tool: string, file_path: string) => {
    const l = activityLabels(tool, { file_path });
    return [l.label, l.doneLabel];
  };
  expect(both("Write", "/ws/MISSION.md")).toEqual(["Updating the mission", "Updated the mission"]);
  expect(both("Edit", "/ws/RESOURCES.md")).toEqual(["Updating the source list", "Updated the source list"]);
  expect(both("Edit", "/ws/GLOSSARY.md")).toEqual(["Updating the glossary", "Updated the glossary"]);
  expect(both("Edit", "/ws/NOTES.md")).toEqual(["Updating notes about you", "Updated notes about you"]);
  expect(both("Write", "/ws/learning-records/0002-augmented-llm.md")).toEqual([
    "Writing a progress note",
    "Wrote a progress note",
  ]);
  expect(both("Edit", "/ws/learning-records/0002-augmented-llm.md")).toEqual(["Updating a progress note", "Updated a progress note"]);
  expect(both("Write", "/ws/scratch/plan.txt")).toEqual(["Updating topic files", "Updated topic files"]);
});

test("shuffleOptions keeps every option and puts 'don't know' last", () => {
  const options = ["git add Header.jsx", "git add .", "git commit -a", "I don't know where to start"].map((label) => ({ label }));
  const firsts = new Set<string>();
  for (let i = 0; i < 200; i++) {
    const out = shuffleOptions(options);
    expect(out.map((o) => o.label).sort()).toEqual(options.map((o) => o.label).sort());
    expect(out[3]!.label).toBe("I don't know where to start");
    firsts.add(out[0]!.label);
  }
  expect(firsts.size).toBe(3);
});
