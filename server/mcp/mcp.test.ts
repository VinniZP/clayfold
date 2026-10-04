import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import type { TopicEvent } from "../../shared/events";
import type { Item, Step } from "../../shared/schemas";
import { TOOL_INPUTS } from "../../shared/tools";
import { openDb } from "../db";
import type { CriticRunner } from "../gates/critic";
import { storeMaterials } from "../gates/materials";
import { activateStep, card, explainStep, practiceStep, QUOTE_ADD, seedTopic, singleItem, SOURCE_TEXT } from "../gates/test-fixtures";
import { prerequisiteOrder } from "./tools/learner";
import { createMcpHandler } from "./index";

const PAGE = `<!doctype html><html><head><title>Git</title></head><body><article><h1>Git</h1>${SOURCE_TEXT.split("\n").map((p) => `<p>${p}</p>`).join("")}<h2>More</h2><p>${"Filler sentence about git. ".repeat(10)}</p></article></body></html>`;

const fakeFetch = (async (url: string | URL | Request) =>
  String(url).endsWith(".pdf")
    ? new Response("%PDF", { headers: { "content-type": "application/pdf" } })
    : new Response(PAGE, { headers: { "content-type": "text/html" } })) as typeof fetch;

let db: Database;
let events: TopicEvent[];
let handler: ReturnType<typeof createMcpHandler>;
let topicId: string;
let sourceId: string;
let rpcId = 0;

async function rpc(method: string, params: unknown, topic = topicId) {
  const res = await handler(
    new Request("http://127.0.0.1/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
    }),
    topic,
  );
  expect(res.status).toBe(200);
  return (await res.json()) as { result?: any; error?: any };
}

async function call(name: string, args: unknown, topic = topicId) {
  const { result } = await rpc("tools/call", { name, arguments: args }, topic);
  const [first, ...rest] = result.content as { text: string }[];
  let body;
  try {
    body = JSON.parse(first!.text);
  } catch {
    body = { error: first!.text };
  }
  return { isError: result.isError === true, body, notes: rest.map((c) => c.text) };
}

const node = (id: string, prereqs: string[] = []) => ({ id, title: `Node ${id}`, kind: "knowledge", summary: `Summary of ${id} for tests`, prereqs });

function checkStep(): Step {
  const a: Item = { ...singleItem(sourceId), prompt: "A colleague ran git add but did not commit. Where is their edit now?", options: [
    { text: "In the index, not in the history", feedback: "Right." },
    { text: "In the history of the last commit", misconception: "Thinks add already records a commit", feedback: "No, there is no commit yet." },
    { text: "Only on the remote server", misconception: "Confuses the index with the remote repository", feedback: "No, the server has received nothing." },
  ] };
  const b: Item = { format: "order", prompt: "Put the actions in order so the edit reaches the history.", sequence: ["Edit the file", "git add", "git commit"], bloom: "apply", solution: "First the edit, then the index, then the commit.", hints: ["What does add do?", "What does commit do?"], cites: [{ sourceId, quote: QUOTE_ADD }], nodeId: "git-index" };
  return { kind: "check", title: "Final check", items: [a, b] };
}

beforeEach(() => {
  process.env.CRITIC_ENABLED = "false";
  db = openDb(":memory:");
  ({ topicId, sourceId } = seedTopic(db));
  events = [];
  handler = createMcpHandler({ db: () => db, publish: (t, e) => t === topicId && events.push(e), fetch: fakeFetch });
});
afterEach(() => {
  delete process.env.CRITIC_ENABLED;
});

describe("MCP protocol", () => {
  test("initialize and tools/list", async () => {
    const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    expect(init.result.serverInfo.name).toBe("clayfold");
    const list = await rpc("tools/list", {});
    const names = list.result.tools.map((t: { name: string }) => t.name).sort();
    expect(names).toEqual(Object.keys(TOOL_INPUTS).sort());
    for (const t of list.result.tools) expect(t.description.length).toBeGreaterThan(80);
  });
  test("unknown or empty topic makes every tool fail", async () => {
    for (const topic of ["", "top_missing"]) {
      const r = await call("ask_learner", { question: "Ready?", options: [{ label: "yes" }, { label: "no" }] }, topic);
      expect(r.isError).toBe(true);
      expect(r.body.error).toContain("unknown topic");
    }
  });
  test("invalid input is rejected by schema validation", async () => {
    const { result } = await rpc("tools/call", { name: "graph_set", arguments: { nodes: [{ id: "Not A Slug" }] } });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("validation");
  });
});

describe("tools", () => {
  test("ask_learner", async () => {
    const r = await call("ask_learner", { question: "What do you already know about git?", options: [{ label: "Nothing" }, { label: "A little" }] });
    expect(r.body).toEqual({ shown: true, instruction: "End your turn now and wait for the learner's answer." });
  });

  test("graph_set rejects a cycle, then stores a valid graph keeping placement", async () => {
    const bad = await call("graph_set", { nodes: [node("a", ["b"]), node("b", ["a"])] });
    expect(bad.isError).toBe(true);
    expect(bad.body.violations[0].message).toContain("cycle");
    expect(db.query("SELECT COUNT(*) AS n FROM nodes").get()).toEqual({ n: 0 });

    const ok = await call("graph_set", { nodes: [node("git-index"), node("git-commit", ["git-index"])] });
    expect(ok.body).toEqual({ ok: true, total: 2, added: 2, updated: 0 });
    expect((await call("placement_record", { nodeId: "git-index", outcome: "partial", evidence: "Knows add, not the index" })).body).toEqual({ ok: true });
    await call("graph_set", { nodes: [{ ...node("git-index"), title: "Index" }] });
    expect(db.query("SELECT title, placement FROM nodes WHERE id = 'git-index'").get()).toEqual({ title: "Index", placement: "partial" });
    expect((await call("placement_record", { nodeId: "nope", outcome: "known", evidence: "whatever" })).isError).toBe(true);
    expect(events.filter((e) => e.type === "graph.updated").length).toBe(3);
  });

  test("goal_plan_set replaces the plan of a goal and keeps opened entries", async () => {
    const entry = (id: string) => ({ id, stage: "First version", title: `Course ${id}`, why: `Needed for the goal: ${id}`, brief: `Learn ${id} for a workout tracking app` });
    const plan = () => db.query("SELECT id, idx, topic_id FROM goal_plan WHERE goal_id = 'goal_1' ORDER BY idx").all();
    expect((await call("goal_plan_set", { entries: [entry("a")] })).isError).toBe(true);
    db.query("INSERT INTO topics (id, slug, title, request, kind) VALUES ('goal_1', 'goal-1', 'Workout app', 'build an app', 'goal')").run();

    expect((await call("goal_plan_set", { entries: [entry("a"), entry("a")] }, "goal_1")).isError).toBe(true);
    expect((await call("goal_plan_set", { entries: [entry("a"), entry("b"), entry("c")] }, "goal_1")).body).toEqual({ ok: true, total: 3 });
    db.query("UPDATE goal_plan SET topic_id = ? WHERE id = 'b'").run(topicId);

    const dropsOpened = await call("goal_plan_set", { entries: [entry("a")] }, "goal_1");
    expect(dropsOpened.isError).toBe(true);
    expect(dropsOpened.body.error).toContain("b");
    expect((await call("goal_plan_set", { entries: [entry("b"), entry("d")] }, "goal_1")).body).toEqual({ ok: true, total: 2 });
    expect(plan()).toEqual([
      { id: "b", idx: 0, topic_id: topicId },
      { id: "d", idx: 1, topic_id: null },
    ]);
  });

  test("goal_note records a fact for the goal that opened the topic; a topic without a goal has none to tell", async () => {
    expect((await call("goal_note", { text: "Builds only through an AI assistant" })).isError).toBe(true);
    db.query("INSERT INTO topics (id, slug, title, request, kind) VALUES ('goal_1', 'goal-1', 'Workout app', 'build an app', 'goal')").run();
    db.query("UPDATE topics SET goal_id = 'goal_1' WHERE id = ?").run(topicId);
    expect((await call("goal_note", { text: "Builds only through an AI assistant" })).body).toEqual({ ok: true });
    expect(db.query("SELECT goal_id, topic_id, text, seen_at FROM goal_notes").all()).toEqual([
      { goal_id: "goal_1", topic_id: topicId, text: "Builds only through an AI assistant", seen_at: null },
    ]);
    expect((await call("get_learner_state", {})).body.topic.goal).toBe("Workout app");
  });

  test("glossary_set upserts terms by name ignoring case; get_learner_state returns them", async () => {
    const r = await call("glossary_set", { terms: [{ term: "Commit", definition: "A snapshot of the staging area." }, { term: "Staging area", definition: "Where the next commit is assembled.", avoid: ["buffer"] }] });
    expect(r.body).toEqual({ ok: true, total: 2 });
    expect((await call("glossary_set", { terms: [{ term: "commit", definition: "A saved snapshot of the staging area.", original: "commit" }] })).body).toEqual({ ok: true, total: 2 });
    expect((await call("get_learner_state", {})).body.glossary).toEqual([
      { term: "commit", definition: "A saved snapshot of the staging area.", original: "commit" },
      { term: "Staging area", definition: "Where the next commit is assembled.", original: null },
    ]);
  });

  test("worked_line_record stores the tutor's verdict on an open line and tells the lesson page", async () => {
    db.query("INSERT INTO lessons (id, topic_id, title, objective, level, node_ids, outline) VALUES ('ls_w', ?, 'L', 'Objective here', 'novice', '[]', '[]')").run(topicId);
    const worked = { kind: "worked_example", title: "W", problem: "P", cites: [], lines: [{ text: "Line one" }, { text: "Call the model again", blank: { prompt: "What next?", criteria: ["names the next call"] } }] };
    db.query("INSERT INTO steps (id, lesson_id, idx, kind, content, status) VALUES ('st_w', 'ls_w', 0, 'worked_example', ?, 'published')").run(JSON.stringify(worked));

    expect((await call("worked_line_record", { stepId: "st_w", line: 0, answer: "x", outcome: "correct" })).isError).toBe(true);
    expect((await call("worked_line_record", { stepId: "st_w", line: 1, answer: "it asks the model again", outcome: "correct" })).body).toEqual({ ok: true });
    expect(db.query("SELECT line_idx, answer, correct FROM worked_answers").all()).toEqual([{ line_idx: 1, answer: "it asks the model again", correct: 1 }]);
    expect(events).toContainEqual({ type: "worked.answered", lessonId: "ls_w", stepId: "st_w", idx: 1, correct: true, text: "Call the model again" });
  });

  test("teachback_finish accepts only a teach-back of the topic in which the learner has said something", async () => {
    db.query("INSERT INTO lessons (id, topic_id, title, objective, level, node_ids, outline) VALUES ('ls_t', ?, 'L', 'Objective here', 'novice', '[]', '[]')").run(topicId);
    db.query("INSERT INTO conversations (id, topic_id, kind, lesson_id) VALUES ('cv_t', ?, 'teachback', 'ls_t')").run(topicId);
    db.query("INSERT INTO teachbacks (id, topic_id, node_id, lesson_id, conversation_id) VALUES ('tb_t', ?, 'git-index', 'ls_t', 'cv_t')").run(topicId);

    const unknown = await call("teachback_finish", { teachbackId: "tb_other" });
    expect(unknown.isError).toBe(true);
    expect(unknown.body.error).toContain("not a teach-back of this topic");
    const silent = await call("teachback_finish", { teachbackId: "tb_t" });
    expect(silent.isError).toBe(true);
    expect(silent.body.error).toContain("Explain something first");
    expect(db.query("SELECT status FROM teachbacks WHERE id = 'tb_t'").get()).toEqual({ status: "talking" });
  });

  test("source_add and source_search", async () => {
    const added = await call("source_add", { url: "https://example.org/git-book", kind: "docs", note: "Git book chapter on the index" });
    expect(added.body).toEqual(expect.objectContaining({ ok: true, title: "Git", headings: expect.arrayContaining(["More"]) }));
    expect(added.body.publishers).toEqual({ example: 2 }); // the seeded example.org/git and this page
    const pdf = await call("source_add", { url: "https://example.org/paper.pdf", kind: "paper", note: "A paper that is a PDF file" });
    expect(pdf.body.ok).toBe(false);
    expect(pdf.body.error).toContain("pick an HTML page");
    expect(events.filter((e) => e.type === "sources.updated").length).toBe(2);

    const found = await call("source_search", { sourceId: added.body.sourceId, query: "index commit" });
    expect(found.body.passages.length).toBeGreaterThan(0);
    expect(found.body.passages[0].quote).toContain("index");
    const failedId = (db.query("SELECT id FROM sources WHERE url LIKE '%.pdf'").get() as { id: string }).id;
    expect((await call("source_search", { sourceId: failedId, query: "anything" })).isError).toBe(true);
  });

  test("material_list and material_read expose only the learner's materials; source_add keeps a learner link as added", async () => {
    const text = `# Notes\n\n${SOURCE_TEXT}`;
    const [id] = storeMaterials(db, topicId, [
      { kind: "markdown", title: "Lecture notes", url: null, bytes: 10, text, headings: [{ text: "Notes", offset: 2 }] },
      { kind: "link", title: "Course page", url: "https://course.example.org/git", bytes: null, text: SOURCE_TEXT, headings: [] },
    ]);
    const list = await call("material_list", {});
    expect(list.body.materials).toEqual([
      { sourceId: id, title: "Lecture notes", kind: "markdown", url: null, chars: text.length, headings: [{ text: "Notes", offset: 2 }], addedAt: expect.any(String) },
      expect.objectContaining({ title: "Course page", kind: "link", url: "https://course.example.org/git" }),
    ]);

    const first = await call("material_read", { sourceId: id, maxChars: 1000 });
    expect(first.body).toMatchObject({ offset: 0, total: text.length, nextOffset: null });
    expect(first.body.text).toBe(text);
    const tail = await call("material_read", { sourceId: id, offset: text.length - 20 });
    expect(tail.body.text).toBe(text.slice(-20));
    expect((await call("material_read", { sourceId: id, offset: text.length })).isError).toBe(true);
    expect((await call("material_read", { sourceId })).isError).toBe(true);

    const again = await call("source_add", { url: "https://course.example.org/git", kind: "course", note: "The course page the learner added" });
    expect(again.body).toMatchObject({ ok: true, title: "Course page", publishers: { example: 1, "learner materials": 2 } });
    expect(db.query("SELECT origin, kind FROM sources WHERE url = 'https://course.example.org/git'").get()).toEqual({ origin: "learner", kind: "link" });
  });

  test("lesson flow: plan, publish, reject to drop, finish", async () => {
    await call("graph_set", { nodes: [node("git-index")] });
    const plan = (kinds: string[]) => ({ plan: { title: "The index", objective: "Understand what the index does", nodeIds: ["git-index"], level: "novice", sourceIds: [sourceId], outline: kinds.map((kind, i) => ({ kind, title: `Step ${i + 1}` })) } });
    const badPlan = await call("lesson_plan", plan(["explain", "practice", "explain", "practice"]));
    expect(badPlan.isError).toBe(true);
    expect(badPlan.body.violations.map((v: { rule: string }) => v.rule)).toEqual(["L2", "L11"]);

    const { body } = await call("lesson_plan", plan(["activate", "explain", "practice", "check"]));
    const lessonId = body.lessonId as string;
    expect(events).toContainEqual(expect.objectContaining({ type: "lesson.planned", lessonId }));

    const s0 = await call("step_submit", { lessonId, index: 0, step: activateStep(sourceId) });
    expect(s0.body).toEqual({ status: "published", attempt: 1, violations: [] });
    const items = db.query("SELECT role, display_order FROM items WHERE lesson_id = ? ORDER BY rowid").all(lessonId) as { role: string; display_order: string }[];
    expect(items.map((i) => i.role)).toEqual(["activate", "activate"]);
    for (const i of items) expect((JSON.parse(i.display_order) as number[]).slice().sort()).toEqual([0, 1, 2]);
    const published = events.find((e) => e.type === "step.published");
    expect(published && published.type === "step.published" && published.step.kind).toBe("activate");
    expect(JSON.stringify(published)).not.toContain("misconception");

    expect((await call("step_submit", { lessonId, index: 0, step: activateStep(sourceId) })).body.error).toContain("already published");
    expect((await call("step_submit", { lessonId, index: 1, step: practiceStep(sourceId) })).body.error).toContain("'explain' step");
    expect((await call("lesson_finish", { lessonId, summary: "A lesson on the index and commits." })).body.error).toContain("1, 2, 3");

    expect((await call("step_submit", { lessonId, index: 1, step: explainStep(sourceId) })).body.status).toBe("published");

    const flawed = singleItem(sourceId, { prompt: "The edit is already in the working tree. Which command do you need so that it goes into the next commit?" });
    delete flawed.options[1]!.misconception;
    const r1 = await call("step_submit", { lessonId, index: 2, step: practiceStep(sourceId, flawed) });
    expect(r1.body).toEqual({ status: "rejected", attempt: 1, violations: [expect.objectContaining({ rule: "L8", path: "item.options.1.misconception" })] });
    expect(r1.notes[0]).toContain("resubmit index 2");
    const fakeQuote = practiceStep(sourceId, { ...flawed, options: singleItem(sourceId).options, cites: [{ sourceId, quote: "This sentence is not in the source." }] });
    expect((await call("step_submit", { lessonId, index: 2, step: fakeQuote })).body.violations[0].rule).toBe("Q6");
    const r3 = await call("step_submit", { lessonId, index: 2, step: practiceStep(sourceId, flawed) });
    expect(r3.body.status).toBe("dropped");
    expect(r3.notes[0]).toContain("Continue with index 3");
    expect(events).toContainEqual(expect.objectContaining({ type: "step.status", idx: 2, status: "dropped" }));

    expect((await call("step_submit", { lessonId, index: 3, step: checkStep() })).body.status).toBe("published");
    const roles = (db.query("SELECT role FROM items WHERE lesson_id = ? ORDER BY rowid").all(lessonId) as { role: string }[]).map((r) => r.role);
    expect(roles).toEqual(["activate", "activate", "explain_check", "check", "check"]);
    const orderRow = db.query("SELECT display_order FROM items WHERE format = 'order'").get() as { display_order: string };
    expect(JSON.parse(orderRow.display_order)).not.toEqual([0, 1, 2]);

    const gates = db.query("SELECT stage, rule, pass, attempt FROM gate_results WHERE target_type = 'step'").all() as { stage: string; rule: string; pass: number; attempt: number }[];
    expect(gates).toContainEqual({ stage: "deterministic", rule: "L8", pass: 0, attempt: 1 });
    expect(gates).toContainEqual({ stage: "quotes", rule: "Q6", pass: 0, attempt: 2 });
    expect(gates).toContainEqual({ stage: "schema", rule: "S1", pass: 1, attempt: 1 });

    const fin = await call("lesson_finish", { lessonId, summary: "A lesson on the index and commits." });
    expect(fin.body).toEqual({ ok: true, published: 3, dropped: 1 });
    expect(db.query("SELECT status FROM lessons WHERE id = ?").get(lessonId)).toEqual({ status: "finished" });
    expect(events).toContainEqual({ type: "lesson.finished", lessonId, summary: "A lesson on the index and commits." });
    expect((await call("step_submit", { lessonId, index: 2, step: practiceStep(sourceId) })).isError).toBe(true);
  });

  test("critic verdicts gate publication; an unavailable critic does not use up an attempt", async () => {
    process.env.CRITIC_ENABLED = "true";
    await call("graph_set", { nodes: [node("git-index")] });
    const { body } = await call("lesson_plan", { plan: { title: "The index", objective: "Understand what the index does", nodeIds: ["git-index"], level: "novice", sourceIds: [sourceId], outline: ["activate", "practice", "explain", "check"].map((kind) => ({ kind, title: `Step ${kind}` })) } });
    const down: CriticRunner = (async () => ({ ok: false, error: "claude exited 1" })) as CriticRunner;
    handler = createMcpHandler({ db: () => db, publish: () => {}, critic: down });
    const r = await call("step_submit", { lessonId: body.lessonId, index: 0, step: activateStep(sourceId) });
    expect(r.isError).toBe(true);
    expect(r.body.error).toContain("not counted");
    expect(db.query("SELECT COUNT(*) AS n FROM steps WHERE lesson_id = ?").get(body.lessonId)).toEqual({ n: 0 });

    const twoKeys: CriticRunner = (async (opts: { prompt: string }) => {
      if (opts.prompt.includes("Solve each item")) {
        const key = /([A-J])\. In the index \(staging area\)/.exec(opts.prompt)![1];
        return { ok: true, costUsd: 0, value: { items: [{ id: "q1", choice: "A", unambiguous: false, reason: "A and B both defensible" }, { id: "q2", choice: key, unambiguous: true, reason: "" }] } };
      }
      if (opts.prompt.includes("shows only its options")) return { ok: true, costUsd: 0, value: { items: ["q1", "q2"].map((id) => ({ id, likelyKey: "A", cueFound: false, cue: "" })) } };
      return { ok: true, costUsd: 0, value: { checks: [...opts.prompt.matchAll(/^(r\d+):/gm)].map((m) => ({ id: m[1], pass: true, reason: "ok" })) } };
    }) as CriticRunner;
    handler = createMcpHandler({ db: () => db, publish: () => {}, critic: twoKeys });
    const r2 = await call("step_submit", { lessonId: body.lessonId, index: 0, step: activateStep(sourceId) });
    expect(r2.body.violations).toEqual([expect.objectContaining({ rule: "Q1", path: "items.0" })]);
    const critic = db.query("SELECT rule, pass FROM gate_results WHERE stage = 'critic' AND attempt = 1").all() as { rule: string; pass: number }[];
    expect(critic.filter((c) => c.pass === 0)).toEqual([{ rule: "Q1", pass: 0 }]);
    expect(critic.length).toBeGreaterThan(5);
  });

  test("cards_propose stores passing cards and reports the rest", async () => {
    await call("graph_set", { nodes: [node("git-index")] });
    const r = await call("cards_propose", { cards: [card(sourceId), card(sourceId, { front: "Does git add create a commit?", back: "No" })] });
    expect(r.body.results[0]).toEqual(expect.objectContaining({ index: 0, status: "proposed", violations: [] }));
    expect(r.body.results[1].status).toBe("rejected");
    expect(r.body.results[1].violations.map((v: { path: string }) => v.path)).toEqual(["cards.1.front", "cards.1.back"]);
    expect(db.query("SELECT status FROM cards").all()).toEqual([{ status: "proposed" }]);
    expect(events).toContainEqual({ type: "cards.proposed", cardIds: [r.body.results[0].cardId] });
  });

  test("get_learner_state and item_replace", async () => {
    await call("graph_set", { nodes: [node("git-index"), node("git-commit", ["git-index"])] });
    const { body } = await call("lesson_plan", { plan: { title: "The index", objective: "Understand what the index does", nodeIds: ["git-index"], level: "novice", sourceIds: [sourceId], outline: ["activate", "explain", "practice", "check"].map((kind) => ({ kind, title: `Step ${kind}` })) } });
    await call("step_submit", { lessonId: body.lessonId, index: 0, step: activateStep(sourceId) });
    const [first, second] = db.query("SELECT id FROM items ORDER BY rowid").all() as { id: string }[];
    db.query("INSERT INTO attempts (id, item_id, answer, correct, misconception, context) VALUES ('a1', ?, '{}', 0, 'Confuses push and add', 'practice')").run(second!.id);
    db.query("INSERT INTO regen_queue (id, topic_id, target_type, target_id, reason) VALUES ('q1', ?, 'item', ?, 'distractor never chosen')").run(topicId, second!.id);

    const state = (await call("get_learner_state", {})).body;
    expect(state.topic).toEqual({ id: topicId, title: "Git basics", goal: null });
    expect(state.nodes.find((n: { id: string }) => n.id === "git-commit").unmasteredPrereqs).toEqual(["git-index"]);
    db.query("UPDATE nodes SET placement = 'known' WHERE id = 'git-index'").run();
    const placed = (await call("get_learner_state", {})).body.nodes as { id: string; mastery: string; unmasteredPrereqs: string[] }[];
    expect(placed.find((n) => n.id === "git-commit")!.unmasteredPrereqs).toEqual([]);
    expect(placed.find((n) => n.id === "git-index")!.mastery).toBe("new");
    db.query("UPDATE nodes SET placement = NULL WHERE id = 'git-index'").run();
    expect(state.recentAttempts).toEqual([expect.objectContaining({ itemId: second!.id, correct: false, nodeId: "git-index" })]);
    expect(state.misconceptionsSeen).toEqual([{ misconception: "Confuses push and add", count: 1, nodeId: "git-index" }]);
    expect(state.regenQueue).toEqual([expect.objectContaining({ queueId: "q1", targetType: "item", content: expect.objectContaining({ format: "single" }) })]);
    expect((await call("get_learner_state", { nodeIds: ["git-commit"] })).body.recentAttempts).toEqual([]);

    const replacement: Item = { ...singleItem(sourceId), bloom: "understand", prompt: "What does the git index hold after git add?", options: [
      { text: "A snapshot of the next commit", feedback: "Right." },
      { text: "A list of remote branches", misconception: "Confuses the index with branch refs", feedback: "No, branches have nothing to do with it." },
      { text: "A log of past commands", misconception: "Thinks the index is a command history", feedback: "No, the shell keeps the history." },
    ] };
    expect((await call("item_replace", { queueId: "q1", card: card(sourceId) })).isError).toBe(true);
    const dup = await call("item_replace", { queueId: "q1", item: (JSON.parse((db.query("SELECT content FROM items WHERE id = ?").get(first!.id) as { content: string }).content)) });
    expect(dup.body).toEqual({ status: "rejected", violations: [expect.objectContaining({ rule: "Q7" })] });
    const ok = await call("item_replace", { queueId: "q1", item: replacement });
    expect(ok.body).toEqual({ status: "replaced", violations: [] });
    expect(db.query("SELECT status FROM regen_queue WHERE id = 'q1'").get()).toEqual({ status: "done" });
    const stored = db.query("SELECT content FROM items WHERE id = ?").get(second!.id) as { content: string };
    expect(JSON.parse(stored.content).prompt).toBe(replacement.prompt);
    const step = JSON.parse((db.query("SELECT content FROM steps").get() as { content: string }).content);
    expect(step.items[1].prompt).toBe(replacement.prompt);
    expect((await call("item_replace", { queueId: "q1", item: replacement })).isError).toBe(true);
  });
});

describe("practice sets", () => {
  const fresh = (prompt: string, overrides: Partial<Item> = {}) =>
    practiceStep(sourceId, {
      ...singleItem(sourceId),
      prompt,
      options: [
        { text: "Put the new version in the index", feedback: "Right: add puts it into the index." },
        { text: "Send the new version with a push", misconception: "Confuses sending to the server with preparing a commit", feedback: "push sends commits that exist." },
        { text: "Fetch the new version with a pull", misconception: "Thinks pull prepares local changes", feedback: "pull brings in other commits." },
      ],
      ...overrides,
    } as Item);

  async function seedSet(focus: "same" | "harder" | "mistakes") {
    await call("graph_set", { nodes: [node("git-index")] });
    const { body } = await call("lesson_plan", { plan: { title: "The index", objective: "Understand what the index does", nodeIds: ["git-index"], level: "intermediate", sourceIds: [sourceId], outline: ["activate", "explain", "practice", "check"].map((kind) => ({ kind, title: `Step ${kind}` })) } });
    await call("step_submit", { lessonId: body.lessonId, index: 0, step: activateStep(sourceId) });
    await call("step_submit", { lessonId: body.lessonId, index: 2, step: fresh("You fixed a typo in the README of your bike-repair notes. What makes the fix part of the commit you are about to make?") });
    const ids = (db.query("SELECT id, role FROM items ORDER BY rowid").all() as { id: string; role: string }[]);
    const pre = ids.find((i) => i.role === "activate")!.id;
    const practice = ids.find((i) => i.role === "practice")!.id;
    const attempt = db.query("INSERT INTO attempts (id, item_id, answer, correct, misconception, gave_up, context, created_at) VALUES (?, ?, '{}', ?, ?, ?, 'practice', ?)");
    attempt.run("a1", pre, 0, "Guessed before the lesson", 0, "2026-10-01T10:00:00Z");
    attempt.run("a2", practice, 0, "Confuses sending to the server with preparing a commit", 0, "2026-10-01T10:01:00Z");
    attempt.run("a3", practice, 0, "Confuses sending to the server with preparing a commit", 0, "2026-10-02T10:00:00Z");
    attempt.run("a4", practice, 0, null, 1, "2026-10-02T10:01:00Z");
    db.query(
      `INSERT INTO lessons (id, topic_id, title, objective, level, node_ids, outline, practice) VALUES ('les_p', ?, 'Practice: the index', '3 items', 'intermediate', '["git-index"]', ?, ?)`,
    ).run(topicId, JSON.stringify([0, 1, 2].map((i) => ({ kind: "practice", title: `Item ${i + 1}` }))), JSON.stringify({ focus, seedItemId: practice }));
    return { lessonId: body.lessonId as string, practice };
  }

  test("practice_brief targets the misconceptions the learner chose after the lesson taught the idea", async () => {
    const { lessonId, practice } = await seedSet("mistakes");
    const brief = (await call("practice_brief", { lessonId: "les_p" })).body;
    expect(brief).toMatchObject({ lessonId: "les_p", size: 3, focus: "mistakes", level: "intermediate", nodes: [{ id: "git-index", title: "Node git-index", mastery: "new" }] });
    expect(brief.seed).toMatchObject({ itemId: practice, nodeId: "git-index", format: "single", misconceptions: ["Confuses sending to the server with preparing a commit", "Thinks pull prepares local changes"] });
    expect(brief.targets).toEqual([{ misconception: "Confuses sending to the server with preparing a commit", nodeId: "git-index", count: 2, lastAt: "2026-10-02T10:00:00Z" }]);
    expect(brief.missed).toEqual([expect.objectContaining({ itemId: practice, gaveUp: true, solvedLater: false, misconception: "Confuses sending to the server with preparing a commit", at: "2026-10-02T10:01:00Z" })]);
    expect(brief.existingPrompts).toHaveLength(3);
    expect((await call("practice_brief", { lessonId })).body.error).toContain("not a practice set");
  });

  test("step_submit gates a harder set item by item and closes it on its last index", async () => {
    await seedSet("harder");
    const easy = await call("step_submit", { lessonId: "les_p", index: 0, step: fresh("Your thesis chapter is edited. What do you run first so the chapter lands in the next snapshot?", { bloom: "remember" }) });
    expect(easy.body).toEqual({ status: "rejected", attempt: 1, violations: [expect.objectContaining({ rule: "Q5", path: "item.bloom" })] });
    expect((await call("step_submit", { lessonId: "les_p", index: 0, step: fresh("Your thesis chapter is edited. What do you run first so the chapter lands in the next snapshot?") })).body.status).toBe("published");
    expect((await call("step_submit", { lessonId: "les_p", index: 1, step: fresh("A lab script changed overnight. Which command prepares exactly that script for the commit you make next?") })).body.status).toBe("published");

    const allChoice = await call("step_submit", { lessonId: "les_p", index: 2, step: fresh("Two recipe files changed in your cooking blog. Which command picks one recipe for the coming commit?") });
    expect(allChoice.body.violations).toEqual([expect.objectContaining({ rule: "L13", path: "item.format" })]);
    const order: Item = { format: "order", prompt: "In what order does a new recipe file reach the blog's history?", sequence: ["Write the recipe file", "Stage it with git add", "Record it with git commit"], bloom: "apply", solution: "The edit comes first, then the index, then the commit.", hints: ["Where does every change start?", "What records the index?"], cites: [{ sourceId, quote: QUOTE_ADD }], nodeId: "git-index" };
    expect((await call("step_submit", { lessonId: "les_p", index: 2, step: practiceStep(sourceId, order) })).body.status).toBe("published");

    expect((db.query("SELECT role FROM items WHERE lesson_id = 'les_p'").all() as { role: string }[]).map((r) => r.role)).toEqual(["practice", "practice", "practice"]);
    expect((await call("lesson_finish", { lessonId: "les_p", summary: "Three cases of staging a change." })).body).toEqual({ ok: true, published: 3, dropped: 0 });
  });
});

describe("Q8 source diversity", () => {
  const addSource = (id: string, url: string, title = `Title ${id}`) =>
    db.query("INSERT INTO sources (id, topic_id, url, title, kind, note, text, status) VALUES (?, ?, ?, ?, 'docs', 'note', ?, 'ok')").run(id, topicId, url, title, SOURCE_TEXT);
  const plan = (sourceIds: string[]) => ({
    plan: { title: "The index", objective: "Understand what the index does", nodeIds: ["git-index"], level: "novice", sourceIds, outline: ["activate", "explain", "practice", "check"].map((kind) => ({ kind, title: `Step ${kind}` })) },
  });
  const checkCiting = (citeId: string): Step => {
    const step = checkStep() as Extract<Step, { kind: "check" }>;
    return { ...step, items: step.items.map((item) => ({ ...item, cites: [{ sourceId: citeId, quote: QUOTE_ADD }] })) };
  };

  beforeEach(async () => {
    await call("graph_set", { nodes: [node("git-index")] });
    addSource("src_scm", "https://git-scm.com/book/en/v2", "Pro Git");
  });

  test("lesson_plan needs ok sources from two publishers when the topic has two, and stores the plan's sources", async () => {
    const unknown = await call("lesson_plan", plan([sourceId, "src_nope"]));
    expect(unknown.body.violations).toEqual([expect.objectContaining({ rule: "S1", path: "plan.sourceIds.1" })]);
    const narrow = await call("lesson_plan", plan([sourceId]));
    expect(narrow.isError).toBe(true);
    expect(narrow.body.violations[0]).toMatchObject({ rule: "Q8", path: "plan.sourceIds" });
    expect(narrow.body.violations[0].message).toContain(`example: ${sourceId}; git-scm: src_scm`);

    const { body } = await call("lesson_plan", plan([sourceId, "src_scm"]));
    expect(db.query("SELECT planned_sources, sources_at_plan, announced_sources FROM lessons WHERE id = ?").get(body.lessonId)).toEqual({
      planned_sources: JSON.stringify([sourceId, "src_scm"]),
      sources_at_plan: 2,
      announced_sources: JSON.stringify([sourceId, "src_scm"]),
    });
  });

  test("the check step is rejected until the lesson's cites span two publishers", async () => {
    const lessonId = (await call("lesson_plan", plan([sourceId, "src_scm"]))).body.lessonId as string;
    const practice = practiceStep(sourceId, singleItem(sourceId, { prompt: "The edit is already in the working tree. Which command do you need so that it goes into the next commit?" }));
    for (const [index, step] of [activateStep(sourceId), explainStep(sourceId), practice].entries()) {
      expect((await call("step_submit", { lessonId, index, step })).body.status).toBe("published");
    }
    const narrow = await call("step_submit", { lessonId, index: 3, step: checkCiting(sourceId) });
    expect(narrow.body).toEqual({
      status: "rejected",
      attempt: 1,
      violations: [{ rule: "Q8", message: "the lesson cites only example; cite a second publisher from the planned sources: git-scm: src_scm" }],
    });
    expect((await call("step_submit", { lessonId, index: 3, step: checkCiting("src_scm") })).body.status).toBe("published");
  });

  test("step_submit announces sources added after the plan, once", async () => {
    const lessonId = (await call("lesson_plan", plan([sourceId, "src_scm"]))).body.lessonId as string;
    addSource("src_mdn", "https://developer.mozilla.org/en-US/docs/git", "MDN on git");
    const first = await call("step_submit", { lessonId, index: 0, step: activateStep(sourceId) });
    expect(first.notes).toEqual([
      "1 new sources were added to this topic after the lesson was planned: src_mdn — MDN on git (mozilla); consider citing them in the remaining steps.",
    ]);
    const second = await call("step_submit", { lessonId, index: 1, step: explainStep(sourceId) });
    expect(second.notes).toEqual([]);
  });
});

test("prerequisiteOrder puts every node after its prerequisites, stable otherwise", () => {
  const rows = [
    { id: "merge", prereqs: '["branch"]' },
    { id: "basics", prereqs: "[]" },
    { id: "branch", prereqs: '["basics"]' },
    { id: "log", prereqs: '["basics"]' },
  ];
  expect(prerequisiteOrder(rows).map((r) => r.id)).toEqual(["basics", "branch", "merge", "log"]);
});

describe("gamification", () => {
  const DRAWING = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect x="20" y="40" width="60" height="40" rx="10" fill="#FFC9B4"/></svg>';
  const reward = { name: "Index antlers", description: "For staging changes with care.", slot: "head", svg: DRAWING, earnedBy: "gold" };
  const lessonPlan = (extra: object) => ({
    plan: { title: "The index", objective: "Understand what the index does", nodeIds: ["git-index"], level: "novice", sourceIds: [sourceId], outline: ["activate", "explain", "practice", "check"].map((kind, i) => ({ kind, title: `Step ${i + 1}` })) },
    ...extra,
  });
  const schemaOf = async (name: string) => ((await rpc("tools/list", {})).result.tools as { name: string; inputSchema: { properties: object } }[]).find((t) => t.name === name)!;
  const turnOn = () => db.query("INSERT INTO settings (key, value) VALUES ('gamification', 'true')").run();

  test("while off, the game fields are absent from the tool schemas and ignored", async () => {
    expect(Object.keys((await schemaOf("lesson_plan")).inputSchema.properties)).toEqual(["plan"]);
    expect(Object.keys((await schemaOf("graph_set")).inputSchema.properties)).toEqual(["nodes"]);
    await call("graph_set", { nodes: [node("git-index")] });
    const { body } = await call("lesson_plan", lessonPlan({ challenge: 2, reward }));
    expect(db.query("SELECT challenge_idx FROM lessons WHERE id = ?").get(body.lessonId)).toEqual({ challenge_idx: null });
    expect(db.query("SELECT count(*) AS n FROM rewards").get()).toEqual({ n: 0 });
  });

  test("while on, lesson_plan stores the challenge and the reward, and a challenge below apply is rejected (G1)", async () => {
    turnOn();
    expect(Object.keys((await schemaOf("lesson_plan")).inputSchema.properties).sort()).toEqual(["challenge", "plan", "reward"]);
    await call("graph_set", { nodes: [node("git-index")] });

    const wrong = await call("lesson_plan", lessonPlan({ challenge: 1, reward }));
    expect(wrong.body.violations.map((v: { rule: string; path: string }) => [v.rule, v.path])).toEqual([["G1", "challenge"]]);
    const noChallenge = await call("lesson_plan", lessonPlan({ reward }));
    expect(noChallenge.body.violations.map((v: { path: string }) => v.path)).toEqual(["reward.earnedBy"]);

    const { body } = await call("lesson_plan", lessonPlan({ challenge: 2, reward }));
    expect(db.query("SELECT challenge_idx FROM lessons WHERE id = ?").get(body.lessonId)).toEqual({ challenge_idx: 2 });
    expect(db.query("SELECT source, ref, name FROM rewards").all()).toEqual([{ source: "lesson", ref: body.lessonId, name: "Index antlers" }]);

    const easy = await call("step_submit", { lessonId: body.lessonId, index: 2, step: practiceStep(sourceId, { ...singleItem(sourceId), bloom: "understand" }) });
    expect(easy.body.violations).toEqual([expect.objectContaining({ rule: "G1", path: "item.bloom" })]);
  });

  test("while on, graph_set asks for a resident until one is stored, and rejects a drawing with text (G2)", async () => {
    turnOn();
    const first = await call("graph_set", { nodes: [node("git-index")] });
    expect(first.notes[0]).toContain("resident");
    const resident = { name: "Octavia", species: "octopus", bio: "Archivist of the deep.", svg: DRAWING, lines: { greet: ["Hello there"], cheer: ["Well done", "Nice one"], support: ["Try again", "So close"], nudge: ["Come back"] } };
    const bad = await call("graph_set", { nodes: [node("git-index")], resident: { ...resident, svg: DRAWING.replace("</svg>", "<text>hi</text></svg>") } });
    expect(bad.body.violations).toEqual([expect.objectContaining({ rule: "G2", path: "resident.svg" })]);
    const ok = await call("graph_set", { nodes: [node("git-index")], resident });
    expect(ok.notes).toEqual([]);
  });
});
