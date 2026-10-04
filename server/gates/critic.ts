import type { Card, Item, Level, Step } from "../../shared/schemas";
import type { RuleId } from "../../shared/rules";
import { runJsonPrompt, type OneShotResult } from "../claude/oneshot";
import { cardCites, displayLength, itemCites, matchOrders, matchTargets, stepCites, stepFigure, stepItems, type PathCite } from "./content";
import { normalizeForQuote } from "./text";

// Model-based checks, each a narrow yes/no question with a rule ID. No holistic scores.
// Three independent calls run in parallel: blind solve (Q1), options-only (Q2), rubric (Q6, L8, Q5, V1, V2, L3, L6, L16, L19, C1).

export type CriticRunner = <T>(opts: { prompt: string; schema: object; purpose: "critic"; timeoutMs?: number }) => Promise<OneShotResult<T>>;
export type CriticCheck = { rule: RuleId; pass: boolean; message: string; path?: string };
export type CriticVerdict = { ok: true; checks: CriticCheck[] } | { ok: false; error: string };

export const criticEnabled = () => process.env.CRITIC_ENABLED !== "false";

export const CRITIC_BUDGET_MS = 120_000;
const FIRST_TRY_MS = 90_000;
const MIN_RETRY_MS = 15_000;

const PREAMBLE = `You review generated learning material for a single learner. The material may be written in any language; reason about it in its own language, write your reasons in English.
Answer only the narrow questions asked. Do not rate overall quality. Reply with JSON that matches the provided JSON Schema.`;

export type CriticItem = { id: string; item: Item; path: string; displayOrder: number[] | null };

const LETTERS = "ABCDEFGHIJ";
const letter = (i: number) => LETTERS[i]!;
const fromLetter = (s: string | undefined) => {
  const i = LETTERS.indexOf((s ?? "").trim().toUpperCase().replace(/[^A-J]/g, "").slice(0, 1));
  return i >= 0 ? i : null;
};
const identity = (n: number) => Array.from({ length: n }, (_, i) => i);
const display = <T>(arr: T[], order: number[] | null) => (order ?? identity(arr.length)).map((i) => arr[i]!);
const norm = (s: string) => normalizeForQuote(s).replace(/[.,;:!?]+$/u, "");

type Call<T> = { prompt: string; schema: object; validate: (v: T) => string | null };

async function callWithRetry<T>(run: CriticRunner, call: Call<T>, deadline: number): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  let error = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const remaining = deadline - Date.now();
    if (attempt > 0 && remaining < MIN_RETRY_MS) break;
    const res = await run<T>({ prompt: call.prompt, schema: call.schema, purpose: "critic", timeoutMs: Math.min(attempt === 0 ? FIRST_TRY_MS : remaining, remaining) });
    if (res.ok) {
      const problem = call.validate(res.value);
      if (!problem) return { ok: true, value: res.value };
      error = `incomplete critic answer: ${problem}`;
    } else {
      error = res.error;
    }
  }
  return { ok: false, error };
}

// ---------- (a) blind solve, Q1 ----------

type SolveAnswer = {
  id: string;
  choice?: string;
  choices?: string[];
  order?: string[];
  /** match: per numbered entry, the letter of its target; sort: per numbered entry, the letter of its category. */
  placements?: string[];
  blanks?: string[];
  /** cloze: per blank, every other answer a knowledgeable person could defend. */
  alternatives?: string[][];
  value?: number;
  referenceCorrect?: boolean;
  unambiguous: boolean;
  reason: string;
};

function blindView(c: CriticItem): Record<string, unknown> {
  const { item } = c;
  const base = { id: c.id, format: item.format, prompt: item.prompt };
  switch (item.format) {
    case "single":
    case "multi":
      return { ...base, options: display(item.options, c.displayOrder).map((o, i) => `${letter(i)}. ${o.text}`) };
    case "order":
      return { ...base, entries: display(item.sequence, c.displayOrder).map((e, i) => `${letter(i)}. ${e}`) };
    case "match": {
      const { left, right } = matchOrders(item, c.displayOrder ?? identity(displayLength(item)));
      const targets = matchTargets(item);
      return {
        ...base,
        entries: left.map((i, d) => `${d + 1}. ${item.pairs[i]!.left}`),
        targets: right.map((i, d) => `${letter(d)}. ${targets[i]}`),
      };
    }
    case "sort":
      return {
        ...base,
        entries: display(item.entries, c.displayOrder).map((e, d) => `${d + 1}. ${e.text}`),
        categories: item.categories.map((cat, k) => `${letter(k)}. ${cat}`),
      };
    case "cloze":
      return { ...base, text: item.text, blankCount: item.blanks.length };
    case "number":
      return item.unit ? { ...base, unit: item.unit } : base;
    case "short":
      return { ...base, referenceAnswer: item.referenceAnswer };
  }
}

const SOLVE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "unambiguous", "reason"],
        properties: {
          id: { type: "string" },
          choice: { type: "string", description: "single: the letter of your answer" },
          choices: { type: "array", items: { type: "string" }, description: "multi: letters of all correct options" },
          order: { type: "array", items: { type: "string" }, description: "order: entry letters in the correct order" },
          placements: {
            type: "array",
            items: { type: "string" },
            description: "match: for entries 1, 2, ... in order, the letter of each one's target; sort: for entries 1, 2, ... in order, the letter of each one's category",
          },
          blanks: { type: "array", items: { type: "string" }, description: "cloze: one answer per blank, in blank order" },
          alternatives: {
            type: "array",
            items: { type: "array", items: { type: "string" } },
            description: "cloze: per blank, every other answer a knowledgeable person could defend (synonyms, equivalent terms); empty arrays when none",
          },
          value: { type: "number", description: "number: your numeric answer" },
          referenceCorrect: { type: "boolean", description: "short: the reference answer is correct and complete" },
          unambiguous: { type: "boolean", description: "exactly one answer is defensible" },
          reason: { type: "string", description: "one sentence" },
        },
      },
    },
  },
};

function solvePrompt(items: CriticItem[]): string {
  return `${PREAMBLE}

Solve each item below yourself, as an expert would. The items are shown without answer keys.
- single: give the letter of the one correct option in "choice".
- multi: give the letters of every correct option in "choices".
- order: give the entry letters in the correct order in "order".
- match: pair every numbered entry with one lettered target; in "placements" give, for entries 1, 2, ... in order, the letter of its target. A target may be left over.
- sort: put every numbered entry into one lettered category; in "placements" give, for entries 1, 2, ... in order, the letter of its category.
- cloze: give one answer per blank {{1}}, {{2}}, ... in "blanks", and in "alternatives" list for each blank every other answer a knowledgeable person could defend (synonyms, equivalent terms, other word forms that fit the sentence).
- number: give the numeric answer in "value" (in the stated unit, if any).
- short: a reference answer is shown; set "referenceCorrect" to true only if it is correct and complete for the prompt.
Set "unambiguous" to true only if exactly one answer is defensible (for multi: exactly one defensible set of options; for order: exactly one defensible order; for match: exactly one defensible target per entry; for sort: exactly one defensible category per entry; for number: the prompt determines the value). For cloze and short items set it to true; their ambiguity is judged from "alternatives" and "referenceCorrect". If two options could be defended by a knowledgeable person, set it to false and name them in "reason".

Items:
${JSON.stringify(items.map(blindView), null, 2)}`;
}

function judgeSolve(c: CriticItem, a: SolveAnswer): CriticCheck {
  const { item } = c;
  const path = c.path;
  const fail = (why: string): CriticCheck => ({ rule: "Q1", pass: false, path, message: `blind solve: ${why}. Critic: ${a.reason}` });
  // A cloze blank may accept several answers; it is ambiguous only if a defensible answer is not accepted.
  if (!a.unambiguous && item.format !== "cloze" && item.format !== "short") return fail("more than one answer is defensible");
  const toAuthoring = (i: number | null) => (i === null ? null : (c.displayOrder ?? [])[i] ?? i);
  switch (item.format) {
    case "single": {
      const got = toAuthoring(fromLetter(a.choice));
      if (got !== item.correct) return fail(`the solver chose ${a.choice ?? "nothing"}, which is not the key`);
      break;
    }
    case "multi": {
      const got = new Set((a.choices ?? []).map((s) => toAuthoring(fromLetter(s))));
      const want = new Set(item.correct);
      if (got.size !== want.size || [...want].some((x) => !got.has(x))) return fail(`the solver chose ${(a.choices ?? []).join(", ") || "nothing"}, which differs from the key`);
      break;
    }
    case "order": {
      const got = (a.order ?? []).map((s) => toAuthoring(fromLetter(s)));
      if (got.length !== item.sequence.length || got.some((x, i) => x !== i)) return fail(`the solver's order ${(a.order ?? []).join(" ")} differs from the key`);
      break;
    }
    case "match": {
      const { left, right } = matchOrders(item, c.displayOrder ?? identity(displayLength(item)));
      const got = a.placements ?? [];
      const wrong = left.findIndex((pair, d) => {
        const pick = fromLetter(got[d]);
        return pick === null || right[pick] !== pair;
      });
      if (got.length !== left.length || wrong >= 0) return fail(`the solver's pairing ${got.map((g, d) => `${d + 1}${g}`).join(" ")} differs from the key`);
      break;
    }
    case "sort": {
      const order = c.displayOrder ?? identity(item.entries.length);
      const got = a.placements ?? [];
      if (got.length !== order.length) return fail(`the solver placed ${got.length} of ${order.length} entries`);
      const wrong = order.findIndex((i, d) => fromLetter(got[d]) !== item.entries[i]!.category);
      if (wrong >= 0) return fail(`the solver put entry ${wrong + 1} into ${got[wrong]}, which differs from the key`);
      break;
    }
    case "cloze": {
      const got = a.blanks ?? [];
      const wrong = item.blanks.findIndex((accepted, i) => !accepted.some((ans) => norm(ans) === norm(got[i] ?? "")));
      if (wrong >= 0) return fail(`blank {{${wrong + 1}}}: the solver wrote "${got[wrong] ?? ""}", which is not among the accepted answers`);
      for (const [i, accepted] of item.blanks.entries()) {
        const missing = (a.alternatives?.[i] ?? []).filter((alt) => !accepted.some((ans) => norm(ans) === norm(alt)));
        if (missing.length > 0) return fail(`blank {{${i + 1}}}: defensible answers ${missing.map((m) => `"${m}"`).join(", ")} are not accepted; accept them or rephrase so the blank has one answer`);
      }
      break;
    }
    case "number": {
      const tol = Math.max(item.tolerance, Math.abs(item.answer) * 1e-9);
      if (typeof a.value !== "number" || Math.abs(a.value - item.answer) > tol) return fail(`the solver got ${a.value ?? "nothing"}, the key is ${item.answer}`);
      break;
    }
    case "short":
      if (a.referenceCorrect !== true) return fail("the reference answer is not correct and complete");
      break;
  }
  return { rule: "Q1", pass: true, path, message: `blind solve agrees with the key. Critic: ${a.reason}` };
}

function solveCall(items: CriticItem[]): Call<{ items: SolveAnswer[] }> & { judge: (v: { items: SolveAnswer[] }) => CriticCheck[] } {
  return {
    prompt: solvePrompt(items),
    schema: SOLVE_SCHEMA,
    validate: (v) => {
      const missing = items.filter((c) => !v.items?.some((a) => a.id === c.id)).map((c) => c.id);
      return missing.length > 0 ? `no answer for ${missing.join(", ")}` : null;
    },
    judge: (v) => items.map((c) => judgeSolve(c, v.items.find((a) => a.id === c.id)!)),
  };
}

// ---------- (b) options only, Q2 ----------

type GuessAnswer = { id: string; likelyKey: string; cueFound: boolean; cue: string };

const GUESS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "likelyKey", "cueFound", "cue"],
        properties: {
          id: { type: "string" },
          likelyKey: { type: "string", description: "letter of the option most likely to be the key" },
          cueFound: { type: "boolean", description: "a concrete surface feature of the options gives the key away" },
          cue: { type: "string", description: "that feature in one sentence, or empty" },
        },
      },
    },
  },
};

function guessCall(items: CriticItem[]): Call<{ items: GuessAnswer[] }> & { judge: (v: { items: GuessAnswer[] }) => CriticCheck[] } {
  const view = items.map((c) => {
    const opts = c.item.format === "single" ? display(c.item.options, c.displayOrder) : [];
    return { id: c.id, options: opts.map((o, i) => `${letter(i)}. ${o.text}`) };
  });
  return {
    prompt: `${PREAMBLE}

Each multiple-choice item below shows only its options; the question is hidden. For each item, pick the option most likely to be the correct answer judging only by surface features of the options: length, specificity, hedging, grammar, wording that stands out from the others, or one option that differs in kind.
Set "cueFound" to true only if you can name a concrete surface feature that singles out your pick; if your pick is a guess or rests on subject knowledge, set it to false and leave "cue" empty.

Items:
${JSON.stringify(view, null, 2)}`,
    schema: GUESS_SCHEMA,
    validate: (v) => {
      const missing = items.filter((c) => !v.items?.some((a) => a.id === c.id)).map((c) => c.id);
      return missing.length > 0 ? `no answer for ${missing.join(", ")}` : null;
    },
    judge: (v) =>
      items.map((c) => {
        const a = v.items.find((x) => x.id === c.id)!;
        const pick = fromLetter(a.likelyKey);
        const authoring = pick === null ? null : (c.displayOrder ?? [])[pick] ?? pick;
        const isKey = c.item.format === "single" && authoring === c.item.correct;
        const pass = !(isKey && a.cueFound && a.cue.trim() !== "");
        return {
          rule: "Q2" as const,
          pass,
          path: c.path,
          message: pass ? "options alone do not give the key away" : `the key can be found from the options alone: ${a.cue}`,
        };
      }),
  };
}

// ---------- (c) rubric ----------

type RubricQuestion = { id: string; rule: RuleId; path?: string; question: string };
type RubricAnswer = { id: string; pass: boolean; reason: string };

const RUBRIC_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["checks"],
  properties: {
    checks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "pass", "reason"],
        properties: { id: { type: "string" }, pass: { type: "boolean" }, reason: { type: "string", description: "one sentence" } },
      },
    },
  },
};

function citeQuestion(pc: PathCite): string {
  return `Cite at "${pc.path}": does its quote support the statement it is attached to (for an item: its correct answer and solution; for a step or card: the claims in the text it accompanies)? true if the quote states or directly entails it.`;
}

function itemQuestions(item: Item, path: string, ids: () => string): RubricQuestion[] {
  const qs: RubricQuestion[] = itemCites(item, path).map((pc) => ({ id: ids(), rule: "Q6", path: pc.path, question: citeQuestion(pc) }));
  if (item.format === "single" || item.format === "multi") {
    const keys = new Set(item.format === "single" ? [item.correct] : item.correct);
    item.options.forEach((_, i) => {
      if (keys.has(i)) return;
      qs.push({
        id: ids(),
        rule: "L8",
        path: `${path}.options.${i}`,
        question: `Option "${path}.options.${i}": is this option actually wrong for the prompt, AND is its "misconception" a plausible error that a learner could really make? true only if both hold.`,
      });
    });
  }
  if (item.format === "match") {
    item.distractors?.forEach((_, i) => {
      qs.push({
        id: ids(),
        rule: "L8",
        path: `${path}.distractors.${i}`,
        question: `Distractor "${path}.distractors.${i}": does it fit none of the left entries, AND is its "misconception" a plausible error that a learner could really make? true only if both hold.`,
      });
    });
  }
  if ((item.format === "match" && item.pairs.some((p) => p.mistake)) || (item.format === "sort" && item.entries.some((e) => e.mistake))) {
    qs.push({
      id: ids(),
      rule: "L8",
      path,
      question: `Item "${path}": is every "mistake" a plausible error a learner could really make with that entry, and does its feedback explain the error without naming the entry's correct ${item.format === "match" ? "right entry" : "category"}? true only if both hold for every mistake.`,
    });
  }
  qs.push({
    id: ids(),
    rule: "Q5",
    path: `${path}.bloom`,
    question: `Item "${path}" is labelled bloom="${item.bloom}". Does the label match what the item demands? Apply or higher requires using knowledge in a new situation or reasoning about it, not recalling a stated fact. true unless the label is clearly wrong.`,
  });
  qs.push({
    id: ids(),
    rule: "L16",
    path,
    question: `Item "${path}": if it wraps the problem in a real-world scenario, is the scenario realistic and does the underlying logic stay intact? true if there is no scenario.`,
  });
  return qs;
}

function counter(prefix: string) {
  let n = 0;
  return () => `${prefix}${++n}`;
}

export function stepRubric(step: Step, level: Level): RubricQuestion[] {
  const ids = counter("r");
  const qs: RubricQuestion[] = [];
  for (const pc of stepCites(step).filter((c) => c.path.startsWith("cites."))) {
    qs.push({ id: ids(), rule: "Q6", path: pc.path, question: citeQuestion(pc) });
  }
  for (const { item, path } of stepItems(step)) qs.push(...itemQuestions(item, path, ids));
  const figure = stepFigure(step);
  if (figure) {
    qs.push({ id: ids(), rule: "V1", path: "figure", question: `Does the figure actually show what its "teaches" field states (a structure, process or relationship from the step), rather than decoration?` });
    qs.push({ id: ids(), rule: "V2", path: "figure", question: `Are the figure's labels placed inside it, next to the parts they name, with no separate legend or key?` });
  }
  if (step.kind === "explain") {
    qs.push({ id: ids(), rule: "L3", path: "body", question: `In the body, are the terms and parts introduced before the mechanism that uses them is explained?` });
  }
  if (step.kind === "explain" || step.kind === "worked_example") {
    const field = step.kind === "explain" ? "body" : "problem";
    qs.push({
      id: ids(),
      rule: "L19",
      path: field,
      question: `Does the ${field} name each concept with the term practitioners of the field use in the text's language (the English term where they say it in English), rather than an invented or word-for-word translation?`,
    });
  }
  if (step.kind === "worked_example") {
    if (level === "novice") {
      qs.push({ id: ids(), rule: "L6", path: "lines", question: `Is the worked example free of prompts asking the learner to explain why a line holds (self-explanation prompts)? Fill-in blanks are allowed.` });
    }
    qs.push({ id: ids(), rule: "L16", path: "problem", question: `If the problem uses a real-world scenario, is it realistic and does the underlying logic stay intact? true if there is no scenario.` });
  }
  return qs;
}

export function itemRubric(item: Item, path: string): RubricQuestion[] {
  return itemQuestions(item, path, counter("r"));
}

export function cardRubric(cards: { card: Card; path: string }[]): RubricQuestion[] {
  const ids = counter("r");
  return cards.flatMap(({ card, path }) => [
    {
      id: ids(),
      rule: "C1" as const,
      path,
      question: `Card "${path}": is the front understandable without the lesson, does it ask for exactly one fact, and is the back the single unambiguous answer? true only if all hold.`,
    },
    ...cardCites(card, path).map((pc) => ({ id: ids(), rule: "Q6" as const, path: pc.path, question: citeQuestion(pc) })),
  ]);
}

function rubricCall(content: unknown, qs: RubricQuestion[]): Call<{ checks: RubricAnswer[] }> & { judge: (v: { checks: RubricAnswer[] }) => CriticCheck[] } {
  return {
    prompt: `${PREAMBLE}

Below is authoring content (JSON, including answer keys, misconceptions and source quotes), followed by questions. Paths like "items.0.options.2" point into the content. Answer every question with "pass" (true or false) and a one-sentence reason.

Content:
${JSON.stringify(content, null, 2)}

Questions:
${qs.map((q) => `${q.id}: ${q.question}`).join("\n")}`,
    schema: RUBRIC_SCHEMA,
    validate: (v) => {
      const missing = qs.filter((q) => !v.checks?.some((a) => a.id === q.id)).map((q) => q.id);
      return missing.length > 0 ? `no answer for ${missing.join(", ")}` : null;
    },
    judge: (v) =>
      qs.map((q) => {
        const a = v.checks.find((x) => x.id === q.id)!;
        const check: CriticCheck = { rule: q.rule, pass: a.pass, message: a.reason };
        if (q.path !== undefined) check.path = q.path;
        return check;
      }),
  };
}

// ---------- entry points ----------

type Judged = Call<any> & { judge: (v: any) => CriticCheck[] };

async function runAll(calls: Judged[], run: CriticRunner): Promise<CriticVerdict> {
  const deadline = Date.now() + CRITIC_BUDGET_MS;
  const results = await Promise.all(calls.map((c) => callWithRetry(run, c, deadline)));
  const failed = results.find((r) => !r.ok);
  if (failed && !failed.ok) return { ok: false, error: failed.error };
  return { ok: true, checks: results.flatMap((r, i) => (r.ok ? calls[i]!.judge(r.value) : [])) };
}

export async function critiqueStep(
  step: Step,
  opts: { level: Level; displayOrders: (number[] | null)[] },
  run: CriticRunner = runJsonPrompt,
): Promise<CriticVerdict> {
  const items: CriticItem[] = stepItems(step).map(({ item, path }, i) => ({ id: `q${i + 1}`, item, path, displayOrder: opts.displayOrders[i] ?? null }));
  return critiqueContent(step, items, stepRubric(step, opts.level), run);
}

export async function critiqueItem(item: Item, displayOrder: number[] | null, run: CriticRunner = runJsonPrompt): Promise<CriticVerdict> {
  return critiqueContent({ item }, [{ id: "q1", item, path: "item", displayOrder }], itemRubric(item, "item"), run);
}

export async function critiqueCards(cards: Card[], run: CriticRunner = runJsonPrompt): Promise<CriticVerdict> {
  const qs = cardRubric(cards.map((card, i) => ({ card, path: `cards.${i}` })));
  return runAll([rubricCall({ cards }, qs)], run);
}

async function critiqueContent(content: unknown, items: CriticItem[], qs: RubricQuestion[], run: CriticRunner): Promise<CriticVerdict> {
  const calls: Judged[] = [];
  if (items.length > 0) calls.push(solveCall(items));
  const singles = items.filter((c) => c.item.format === "single");
  if (singles.length > 0) calls.push(guessCall(singles));
  if (qs.length > 0) calls.push(rubricCall(content, qs));
  if (calls.length === 0) return { ok: true, checks: [] };
  return runAll(calls, run);
}
