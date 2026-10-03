import { describe, expect, test } from "bun:test";
import type { Card, GraphNode, Item, LessonPlan, Step } from "../../shared/schemas";
import { checkBlanks, checkBloomShare, checkCaption, checkCard, checkDuplicates, checkGraph, checkItem, checkLessonPlan, checkStep, Report } from "./deterministic";
import { activateStep, card, clozeItem, explainStep, orderItem, singleItem } from "./test-fixtures";

const rules = (r: Report) => r.violations.map((v) => v.rule);
const item = (i: Item, role: "activate" | "practice" = "practice") => {
  const r = new Report();
  checkItem(i, "item", role, r);
  return r;
};
const ctx = { existingSurfaces: [], lessonBlooms: [] };

describe("L2 closed prequestions", () => {
  const short: Item = { ...orderItem(), format: "short", referenceAnswer: "Edit, add, commit.", rubric: ["Names all three steps"] } as Item;
  test("short item in activate step is a violation", () => expect(rules(item(short, "activate"))).toEqual(["L2"]));
  test("short item in practice step is fine", () => expect(item(short, "practice").violations).toEqual([]));
  test("closed formats pass", () => expect(item(singleItem(), "activate").violations).toEqual([]));
});

describe("L4 explain length", () => {
  test("400 words pass", async () => {
    const r = await checkStep(explainStep(undefined, Array(400).fill("word").join(" ")), ctx);
    expect(rules(r)).not.toContain("L4");
    expect(r.checked.has("L4")).toBe(true);
  });
  test("401 words fail", async () => {
    const r = await checkStep(explainStep(undefined, Array(401).fill("word").join(" ")), ctx);
    expect(r.violations).toContainEqual(expect.objectContaining({ rule: "L4", path: "body" }));
  });
});

describe("L8 misconceptions and keys", () => {
  test("good single item", () => expect(item(singleItem()).violations).toEqual([]));
  test("distractor without misconception", () => {
    const i = singleItem();
    delete i.options[1]!.misconception;
    expect(item(i).violations).toEqual([expect.objectContaining({ rule: "L8", path: "item.options.1.misconception" })]);
  });
  test("key with misconception", () => {
    const i = singleItem();
    i.options[0]!.misconception = "this should not be here";
    expect(item(i).violations).toEqual([expect.objectContaining({ rule: "L8", path: "item.options.0.misconception" })]);
  });
  test("single correct index out of range", () => expect(rules(item(singleItem(undefined, { correct: 3 })))).toContain("S1"));
  const multi = (correct: number[]): Item => {
    const s = singleItem();
    return {
      ...s,
      format: "multi",
      correct,
      options: s.options.map((o, i) => (correct.includes(i) ? { text: o.text, feedback: o.feedback } : { ...o, misconception: o.misconception ?? "Believes a wrong thing here" })),
    } as Item;
  };
  test("multi good", () => expect(item(multi([0, 1])).violations).toEqual([]));
  test("multi duplicate index", () => expect(rules(item(multi([0, 0])))).toContain("L8"));
  test("multi index out of range", () => expect(rules(item(multi([0, 5])))).toContain("L8"));
  test("multi without distractor", () => expect(item(multi([0, 1, 2])).violations.map((v) => v.message).join()).toContain("at least one distractor"));
});

describe("Q4 cues", () => {
  test("long key fails", () => {
    const i = singleItem();
    i.options[0]!.text = "Run git add on the file so the edit lands in the index and is recorded by the next step";
    expect(item(i).violations).toEqual([expect.objectContaining({ rule: "Q4", path: "item.options.0.text" })]);
  });
  test("slightly longer key under 12 characters difference passes", () => {
    const i = singleItem();
    i.options = [
      { text: "abcdefghijklmn", feedback: "right answer" },
      { text: "abcdefgh", misconception: "wrong idea one", feedback: "wrong answer" },
      { text: "abcdefgh", misconception: "wrong idea two", feedback: "wrong answer" },
    ];
    expect(item(i).violations).toEqual([]);
  });
  test("all of the above", () => {
    const i = singleItem();
    i.options[2]!.text = "All of the above";
    expect(item(i).violations).toEqual([expect.objectContaining({ rule: "Q4", path: "item.options.2.text" })]);
  });
  test("Russian catch-all options", () => {
    for (const text of ["Все вышеперечисленное", "Ничего из перечисленного", "Ни один из вариантов"]) {
      const i = singleItem();
      i.options[1]!.text = text;
      expect(rules(item(i))).toEqual(["Q4"]);
    }
  });
  test("'ни один из' inside an ordinary option is not flagged", () => {
    const i = singleItem();
    i.options[1]!.text = "Коммит, в котором ни один из файлов не меняется";
    expect(item(i).violations).toEqual([]);
  });
  test("stem cue: key repeats a long stem word no distractor has", () => {
    const i = singleItem(undefined, {
      prompt: "Which command transfers changes into the index?",
      options: [
        { text: "git add transfers edits", feedback: "Right." },
        { text: "git push sends commits", misconception: "Confuses push and add", feedback: "No." },
        { text: "git fetch downloads commits", misconception: "Confuses fetch and add", feedback: "No." },
      ],
    });
    expect(item(i).violations.map((v) => v.message).join()).toContain('"transfers"');
  });
  test("stem word shared by key and a distractor is no cue", () => {
    const i = singleItem(undefined, {
      prompt: "Which command records the staging area as a snapshot?",
      options: [
        { text: "git commit records it", feedback: "Yes." },
        { text: "git stash records it elsewhere", misconception: "Confuses stash and commit", feedback: "No." },
        { text: "git tag names it", misconception: "Confuses tagging with committing", feedback: "No." },
      ],
    });
    expect(item(i).violations).toEqual([]);
  });
  test("absolute words only in distractors", () => {
    const i = singleItem(undefined, {
      options: [
        { text: "Usually run git add", feedback: "Right." },
        { text: "Always run git push", misconception: "Thinks push is always needed", feedback: "No." },
        { text: "Никогда ничего", misconception: "Thinks git does everything by itself", feedback: "No." },
      ],
    });
    expect(item(i).violations).toEqual([expect.objectContaining({ rule: "Q4", path: "item.options" })]);
  });
  test("absolute word in key too passes", () => {
    const i = singleItem(undefined, {
      options: [
        { text: "Always run git add first", feedback: "Yes." },
        { text: "Always run git push", misconception: "Thinks push stages", feedback: "No." },
        { text: "Never run anything", misconception: "Thinks git tracks automatically", feedback: "No." },
      ],
    });
    expect(item(i).violations).toEqual([]);
  });
});

describe("format structure", () => {
  test("order entries unique", () => {
    const i = orderItem() as Extract<Item, { format: "order" }>;
    expect(item(i).violations).toEqual([]);
    i.sequence = ["Edit the file", "Run git add", "run git add "];
    expect(item(i).violations).toEqual([expect.objectContaining({ rule: "Q1", path: "item.sequence.2" })]);
  });
  test("cloze placeholders", () => {
    const i = clozeItem() as Extract<Item, { format: "cloze" }>;
    expect(item(i).violations).toEqual([]);
    expect(rules(item({ ...i, text: "First {{1}}, then {{1}} again." }))).toEqual(["S1", "S1"]);
    expect(rules(item({ ...i, text: "First {{1}}, then {{2}}, then {{3}}." }))).toEqual(["S1"]);
  });
  test("number tolerance", () => {
    const base = { ...orderItem(), format: "number", answer: 50, unit: "%" } as unknown as Extract<Item, { format: "number" }>;
    expect(item({ ...base, tolerance: 5 }).violations).toEqual([]);
    expect(rules(item({ ...base, tolerance: 6 }))).toEqual(["Q1"]);
    expect(item({ ...base, answer: 0, tolerance: 1 }).violations).toEqual([]);
  });
});

describe("Q5 bloom share", () => {
  const share = (blooms: Parameters<typeof checkBloomShare>[0]) => {
    const r = new Report();
    checkBloomShare(blooms, r);
    return rules(r);
  };
  test("30% passes", () => expect(share(["apply", "remember", "understand", "remember", "analyze", "remember", "remember", "remember", "evaluate", "remember"])).toEqual([]));
  test("below 30% fails", () => expect(share(["apply", "remember", "remember", "remember"])).toEqual(["Q5"]));
  test("check step counts published items of the lesson", async () => {
    const check: Step = { kind: "check", title: "Summary", items: [singleItem(), { ...singleItem(), bloom: "analyze", prompt: "Why are the changes not in the history yet after git add?" }] };
    expect(rules(await checkStep(check, { existingSurfaces: [], lessonBlooms: ["remember", "remember", "remember", "remember"] }))).toEqual([]);
    expect(rules(await checkStep(check, { existingSurfaces: [], lessonBlooms: Array(6).fill("remember") }))).toEqual(["Q5"]);
  });
});

describe("Q7 near duplicates", () => {
  test("same item reworded slightly is a duplicate", () => {
    const r = new Report();
    const a = singleItem();
    const b = singleItem(undefined, { prompt: `${a.prompt} ` });
    checkDuplicates([{ item: b, path: "item" }], [[a.prompt, ...a.options.map((o) => o.text)].join("\n")], r);
    expect(rules(r)).toEqual(["Q7"]);
  });
  test("different items pass", () => {
    const r = new Report();
    checkDuplicates([{ item: orderItem(), path: "item" }], [[singleItem().prompt, ...singleItem().options.map((o) => o.text)].join("\n")], r);
    expect(r.violations).toEqual([]);
  });
  test("duplicates inside one step", async () => {
    const step = activateStep();
    if (step.kind !== "activate") throw new Error();
    step.items[1] = step.items[0]!;
    expect(rules(await checkStep(step, ctx))).toEqual(["Q7"]);
  });
});

describe("V3 caption", () => {
  const withCaption = (caption: string): Step => ({
    ...(explainStep() as Extract<Step, { kind: "explain" }>),
    body: "The index holds the snapshot of the next commit. The git add command puts changes there from the working tree.",
    figure: { kind: "mermaid", code: "flowchart LR\n  A[Working tree] --> B[Index]", teaches: "Path of a change into the index", alt: "Working copy to index arrow" },
  });
  test("caption repeating a body sentence fails", () => {
    const r = new Report();
    const s = withCaption("") as Extract<Step, { kind: "explain" }>;
    s.figure!.caption = "The git add command puts changes there from the working tree";
    checkCaption(s, r);
    expect(rules(r)).toEqual(["V3"]);
  });
  test("caption pointing at the figure passes", () => {
    const r = new Report();
    const s = withCaption("") as Extract<Step, { kind: "explain" }>;
    s.figure!.caption = "Follow the arrow: it only goes one way";
    checkCaption(s, r);
    expect(r.violations).toEqual([]);
  });
});

describe("C1 cards", () => {
  const c = (overrides: Partial<Card>) => {
    const r = new Report();
    checkCard(card(undefined, overrides), "card", r);
    return r.violations;
  };
  test("good basic card", () => expect(c({})).toEqual([]));
  test("good cloze card", () => expect(c({ kind: "cloze", front: "The ____ command adds changes to the index." })).toEqual([]));
  test("long back", () => expect(c({ back: "x".repeat(121) })).toEqual([expect.objectContaining({ rule: "C1", path: "card.back" })]));
  test("bulleted list", () => expect(c({ back: "Commands:\n- git add\n- git commit" }).length).toBe(1));
  test("numbered list", () => expect(c({ back: "Steps\n1. add\n2. commit" }).length).toBe(1));
  test("semicolon list", () => expect(c({ back: "add; commit; push" }).length).toBe(1));
  test("one semicolon is fine", () => expect(c({ back: "git add; then commit" })).toEqual([]));
  test("leading dash in a Russian definition is fine", () => expect(c({ back: "— промежуточная область" })).toEqual([]));
  test("yes/no front", () => {
    expect(c({ front: "Is the index the same as the working tree?" }).length).toBe(1);
    expect(c({ front: "Does git add create a commit?" }).length).toBe(1);
    expect(c({ front: "Верно ли, что git add создаёт коммит?" }).length).toBe(1);
    expect(c({ front: "Является ли индекс частью репозитория?" }).length).toBe(1);
  });
  test("yes/no back", () => {
    expect(c({ back: "Yes." }).length).toBe(1);
    expect(c({ back: "Да." }).length).toBe(1);
  });
  test("cloze with two blanks", () => expect(c({ kind: "cloze", front: "____ and ____ are two commands" }).length).toBe(1));
  test("cloze without blank", () => expect(c({ kind: "cloze", front: "The git add command" }).length).toBe(1));
});

describe("lesson plan and graph", () => {
  const plan = (kinds: string[]): LessonPlan =>
    ({ title: "The index", objective: "Understand what the index is", nodeIds: ["git-index"], level: "novice", outline: kinds.map((kind) => ({ kind, title: `Step ${kind}` })) }) as LessonPlan;
  test("good plan", () => expect(checkLessonPlan(plan(["activate", "explain", "practice", "check"]), new Set(["git-index"]))).toEqual([]));
  test("missing activate and check", () =>
    expect(checkLessonPlan(plan(["explain", "practice", "reflect", "explain"]), new Set(["git-index"])).map((v) => v.rule)).toEqual(["L2", "L11"]));
  test("unknown node", () => expect(checkLessonPlan(plan(["activate", "explain", "practice", "check"]), new Set()).map((v) => v.rule)).toEqual(["S1"]));

  const node = (id: string, prereqs: string[] = []): GraphNode => ({ id, title: id, kind: "knowledge", summary: "A node used in tests", prereqs });
  test("valid DAG", () => expect(checkGraph([node("a"), node("b", ["a"]), node("c", ["a", "b"])], new Map())).toEqual([]));
  test("cycle", () => expect(checkGraph([node("a", ["c"]), node("b", ["a"]), node("c", ["b"])], new Map()).map((v) => v.message).join()).toContain("cycle"));
  test("self prerequisite", () => expect(checkGraph([node("a", ["a"])], new Map()).length).toBe(1));
  test("unknown prerequisite", () => expect(checkGraph([node("b", ["zzz"])], new Map())).toEqual([expect.objectContaining({ path: "nodes.0.prereqs.0" })]));
  test("prerequisite from the stored graph", () => expect(checkGraph([node("b", ["a"])], new Map([["a", []]]))).toEqual([]));
  test("cycle through the stored graph", () => expect(checkGraph([node("a", ["b"])], new Map([["b", ["a"]]])).length).toBe(1));
  test("duplicate id", () => expect(checkGraph([node("a"), node("a")], new Map()).map((v) => v.path)).toEqual(["nodes.1.id"]));
});

test("Q1: a closed blank with a plain-words phrase fails; values, commands and open blanks pass", () => {
  const r = new Report();
  checkBlanks(
    [
      { blank: { prompt: "Which id?", answers: ["call_7"] } },
      { blank: { prompt: "Command?", answers: ['git commit -m "Update the readme"'] } },
      { blank: { prompt: "What next?", answers: ["calls the model again"] } },
      { blank: { prompt: "What next?", criteria: ["names the next call"] } },
    ],
    r,
  );
  expect(r.violations.map((v) => v.path)).toEqual(["lines.2.blank"]);
});
