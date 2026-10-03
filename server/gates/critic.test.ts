import { describe, expect, test } from "bun:test";
import type { Step } from "../../shared/schemas";
import { critiqueCards, critiqueStep, stepRubric, type CriticRunner } from "./critic";
import { card, explainStep, practiceStep, singleItem } from "./test-fixtures";

type Reply = (prompt: string, schema: { properties: Record<string, unknown> }) => unknown;

/** Routes each call by its schema: blind solve, options-only or rubric. */
function fakeRunner(replies: { solve?: Reply; guess?: Reply; rubric?: Reply }, calls: string[] = []): CriticRunner {
  return (async (opts: { prompt: string; schema: { properties: Record<string, unknown> } }) => {
    const kind = opts.prompt.includes("Solve each item") ? "solve" : opts.prompt.includes("shows only its options") ? "guess" : "rubric";
    calls.push(kind);
    const reply = replies[kind];
    if (!reply) return { ok: false, error: `no ${kind} reply` };
    const value = reply(opts.prompt, opts.schema);
    return value instanceof Error ? { ok: false, error: value.message } : { ok: true, value, costUsd: 0 };
  }) as CriticRunner;
}

const allPass: Reply = (prompt) => ({ checks: [...prompt.matchAll(/^(r\d+):/gm)].map((m) => ({ id: m[1], pass: true, reason: "fine" })) });

describe("blind solve (Q1)", () => {
  const step = practiceStep();
  // Display order [2, 0, 1]: the key (authoring 0) is shown as B.
  const opts = { level: "novice" as const, displayOrders: [[2, 0, 1]] };

  test("solver agrees with the key through the display order", async () => {
    const v = await critiqueStep(step, opts, fakeRunner({
      solve: () => ({ items: [{ id: "q1", choice: "B", unambiguous: true, reason: "add stages" }] }),
      guess: () => ({ items: [{ id: "q1", likelyKey: "A", cueFound: false, cue: "" }] }),
      rubric: allPass,
    }));
    expect(v.ok && v.checks.filter((c) => !c.pass)).toEqual([]);
  });
  test("solver picks another option", async () => {
    const v = await critiqueStep(step, opts, fakeRunner({
      solve: () => ({ items: [{ id: "q1", choice: "A", unambiguous: true, reason: "fetch" }] }),
      guess: () => ({ items: [{ id: "q1", likelyKey: "A", cueFound: false, cue: "" }] }),
      rubric: allPass,
    }));
    expect(v.ok && v.checks.filter((c) => !c.pass)).toEqual([expect.objectContaining({ rule: "Q1", path: "item" })]);
  });
  test("two defensible answers", async () => {
    const v = await critiqueStep(step, opts, fakeRunner({
      solve: () => ({ items: [{ id: "q1", choice: "B", unambiguous: false, reason: "B and C both work" }] }),
      guess: () => ({ items: [{ id: "q1", likelyKey: "C", cueFound: false, cue: "" }] }),
      rubric: allPass,
    }));
    expect(v.ok && v.checks.find((c) => c.rule === "Q1")?.pass).toBe(false);
  });
  test("the prompt hides keys, misconceptions and feedback", async () => {
    let seen = "";
    await critiqueStep(step, opts, fakeRunner({
      solve: (p) => ((seen = p), { items: [{ id: "q1", choice: "B", unambiguous: true, reason: "" }] }),
      guess: () => ({ items: [{ id: "q1", likelyKey: "A", cueFound: false, cue: "" }] }),
      rubric: allPass,
    }));
    expect(seen).not.toContain("misconception");
    expect(seen).not.toContain("feedback");
    expect(seen).not.toContain('"correct"');
    expect(seen).toContain("B. Run git add on the file");
  });
  test("cloze compares normalized answers", async () => {
    const v = await critiqueStep(explainStep(), { level: "novice", displayOrders: [null] }, fakeRunner({
      solve: () => ({ items: [{ id: "q1", blanks: ["Git Add", "git commit."], unambiguous: true, reason: "" }] }),
      rubric: allPass,
    }));
    expect(v.ok && v.checks.filter((c) => !c.pass)).toEqual([]);
  });
  test("cloze with several defensible answers passes when all of them are accepted", async () => {
    const v = await critiqueStep(explainStep(), { level: "novice", displayOrders: [null] }, fakeRunner({
      solve: () => ({ items: [{ id: "q1", blanks: ["git add", "git commit"], alternatives: [["GIT ADD"], []], unambiguous: false, reason: "synonyms" }] }),
      rubric: allPass,
    }));
    expect(v.ok && v.checks.filter((c) => !c.pass)).toEqual([]);
  });
  test("cloze fails when a defensible answer is not accepted", async () => {
    const v = await critiqueStep(explainStep(), { level: "novice", displayOrders: [null] }, fakeRunner({
      solve: () => ({ items: [{ id: "q1", blanks: ["git add", "git commit"], alternatives: [["git stage"], []], unambiguous: true, reason: "" }] }),
      rubric: allPass,
    }));
    expect(v.ok && v.checks.find((c) => c.rule === "Q1")).toEqual(expect.objectContaining({ pass: false, message: expect.stringContaining('"git stage"') }));
  });
});

describe("options only (Q2)", () => {
  const step = practiceStep();
  const opts = { level: "novice" as const, displayOrders: [[0, 1, 2]] };
  const run = (guess: unknown) =>
    critiqueStep(step, opts, fakeRunner({ solve: () => ({ items: [{ id: "q1", choice: "A", unambiguous: true, reason: "" }] }), guess: () => guess, rubric: allPass }));

  test("key found with a named cue is a violation", async () => {
    const v = await run({ items: [{ id: "q1", likelyKey: "A", cueFound: true, cue: "the only option that is not about a remote" }] });
    expect(v.ok && v.checks.find((c) => c.rule === "Q2")).toEqual(expect.objectContaining({ pass: false }));
  });
  test("key found by guess is fine", async () => {
    const v = await run({ items: [{ id: "q1", likelyKey: "A", cueFound: false, cue: "" }] });
    expect(v.ok && v.checks.find((c) => c.rule === "Q2")?.pass).toBe(true);
  });
  test("cue pointing at a distractor is fine", async () => {
    const v = await run({ items: [{ id: "q1", likelyKey: "B", cueFound: true, cue: "longest" }] });
    expect(v.ok && v.checks.find((c) => c.rule === "Q2")?.pass).toBe(true);
  });
});

describe("rubric", () => {
  test("questions cover cites, distractors, bloom, scenario, figure and L3", () => {
    const step = explainStep() as Extract<Step, { kind: "explain" }>;
    step.figure = { kind: "mermaid", code: "flowchart LR\n A --> B", teaches: "Path of a change into the index", alt: "A to B arrow" };
    step.checks = [singleItem()];
    const rules = stepRubric(step, "novice").map((q) => q.rule);
    expect(rules.filter((r) => r === "Q6").length).toBe(2);
    expect(rules.filter((r) => r === "L8").length).toBe(2);
    expect(rules).toEqual(expect.arrayContaining(["Q5", "L16", "V1", "V2", "L3"]));
  });
  test("L6 only for novices", () => {
    const worked: Step = { kind: "worked_example", title: "Example", problem: "Save the edit in a commit.", lines: [{ text: "git add f" }, { text: "git commit" }], cites: [{ sourceId: "s", quote: "12345678" }] };
    expect(stepRubric(worked, "novice").map((q) => q.rule)).toContain("L6");
    expect(stepRubric(worked, "advanced").map((q) => q.rule)).not.toContain("L6");
  });
  test("a false answer becomes a violation with its rule and path", async () => {
    const v = await critiqueStep(practiceStep(), { level: "novice", displayOrders: [[0, 1, 2]] }, fakeRunner({
      solve: () => ({ items: [{ id: "q1", choice: "A", unambiguous: true, reason: "" }] }),
      guess: () => ({ items: [{ id: "q1", likelyKey: "B", cueFound: false, cue: "" }] }),
      rubric: (p) => ({
        checks: [...p.matchAll(/^(r\d+): (.*)$/gm)].map((m) => ({ id: m[1], pass: !m[2]!.includes("options.2"), reason: "fetch is not a plausible confusion here" })),
      }),
    }));
    expect(v.ok && v.checks.filter((c) => !c.pass)).toEqual([expect.objectContaining({ rule: "L8", path: "item.options.2" })]);
  });
  test("cards rubric", async () => {
    const v = await critiqueCards([card(), card()], fakeRunner({ rubric: allPass }));
    expect(v.ok && v.checks.map((c) => `${c.rule}:${c.path}`)).toEqual(["C1:cards.0", "Q6:cards.0.cites.0", "C1:cards.1", "Q6:cards.1.cites.0"]);
  });
});

describe("failures", () => {
  test("a failed call is retried once", async () => {
    let n = 0;
    const calls: string[] = [];
    const v = await critiqueCards([card()], fakeRunner({ rubric: (p) => (++n === 1 ? new Error("timeout") : allPass(p, { properties: {} })) }, calls));
    expect(v.ok).toBe(true);
    expect(calls).toEqual(["rubric", "rubric"]);
  });
  test("an incomplete answer is retried, then reported", async () => {
    const calls: string[] = [];
    const v = await critiqueCards([card()], fakeRunner({ rubric: () => ({ checks: [] }) }, calls));
    expect(v).toEqual({ ok: false, error: expect.stringContaining("no answer for r1") });
    expect(calls.length).toBe(2);
  });
  test("calls run in parallel", async () => {
    const started: number[] = [];
    const slow: CriticRunner = (async (opts: { prompt: string }) => {
      started.push(Date.now());
      await Bun.sleep(50);
      return fakeRunner({
        solve: () => ({ items: [{ id: "q1", choice: "A", unambiguous: true, reason: "" }] }),
        guess: () => ({ items: [{ id: "q1", likelyKey: "B", cueFound: false, cue: "" }] }),
        rubric: allPass,
      })(opts as never);
    }) as CriticRunner;
    await critiqueStep(practiceStep(), { level: "novice", displayOrders: [[0, 1, 2]] }, slow);
    expect(started.length).toBe(3);
    expect(Math.max(...started) - Math.min(...started)).toBeLessThan(40);
  });
});
