import type { Bloom, Card, GraphNode, Item, LessonPlan, Step } from "../../shared/schemas";
import { CONTENT_RULES, foldLetters } from "../../shared/i18n";
import type { RuleId, Violation } from "../../shared/rules";
import { itemSurface, stepBodyText, stepFigure, stepItems, type ItemRole } from "./content";
import { checkFigure } from "./figures";
import { jaccard, sentenceSpans, trigrams, words } from "./text";

// Pure rule checks. Each one aims at high precision: a false positive blocks good content, so a case
// that needs judgement is left to the critic.

export class Report {
  readonly checked = new Set<RuleId>();
  readonly violations: Violation[] = [];
  check(rule: RuleId) {
    this.checked.add(rule);
  }
  fail(rule: RuleId, message: string, path?: string) {
    this.checked.add(rule);
    this.violations.push(path === undefined ? { rule, message } : { rule, message, path });
  }
  merge(violations: Violation[], rule: RuleId) {
    this.checked.add(rule);
    this.violations.push(...violations);
  }
}

export const EXPLAIN_MAX_WORDS = 400;
export const APPLY_SHARE_MIN = 0.3;
export const DUPLICATE_JACCARD = 0.8;
export const CAPTION_OVERLAP = 0.6;
export const CARD_BACK_MAX = 120;

const HIGHER_BLOOM = new Set<Bloom>(["apply", "analyze", "evaluate", "create"]);
const RULES = Object.values(CONTENT_RULES);
const ABSOLUTES = new Set(RULES.flatMap((r) => r.absolutes));
const YES_NO = new Set(RULES.flatMap((r) => r.yesNoBack));

function catchAllOption(text: string): boolean {
  const t = foldLetters(text.toLowerCase()).replace(/\s+/g, " ").trim();
  return RULES.some((r) => r.catchAll.some((re) => re.test(t)));
}

export function checkItem(item: Item, path: string, role: ItemRole, r: Report): void {
  if (role === "activate") {
    r.check("L2");
    if (item.format === "short") r.fail("L2", "prequestions use closed formats; 'short' is not allowed in an activate step", `${path}.format`);
  }
  switch (item.format) {
    case "single":
      checkChoice(item, [item.correct], path, r);
      checkSingleCues(item, path, r);
      break;
    case "multi":
      checkChoice(item, item.correct, path, r);
      break;
    case "order": {
      r.check("Q1");
      const seen = new Set<string>();
      item.sequence.forEach((entry, i) => {
        const key = entry.trim().toLowerCase();
        if (seen.has(key)) r.fail("Q1", `order entry "${entry}" appears twice, so more than one order is correct`, `${path}.sequence.${i}`);
        seen.add(key);
      });
      break;
    }
    case "cloze": {
      r.check("S1");
      const found = [...item.text.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
      const n = item.blanks.length;
      for (let k = 1; k <= n; k++) {
        const count = found.filter((x) => x === k).length;
        if (count !== 1) r.fail("S1", `blank {{${k}}} appears ${count} times in text; each of {{1}}..{{${n}}} must appear exactly once`, `${path}.text`);
      }
      const extra = [...new Set(found.filter((x) => x < 1 || x > n))];
      if (extra.length > 0) r.fail("S1", `text has blanks ${extra.map((x) => `{{${x}}}`).join(", ")} but blanks lists ${n} answers`, `${path}.blanks`);
      break;
    }
    case "number":
      r.check("Q1");
      if (item.answer !== 0 && item.tolerance > 0.1 * Math.abs(item.answer)) {
        r.fail("Q1", `tolerance ${item.tolerance} exceeds 10% of |answer| (${0.1 * Math.abs(item.answer)})`, `${path}.tolerance`);
      }
      break;
    case "short":
      break;
  }
}

function checkChoice(item: Extract<Item, { format: "single" | "multi" }>, correct: number[], path: string, r: Report) {
  r.check("L8");
  r.check("Q4");
  const n = item.options.length;
  const bad = correct.filter((c) => c >= n);
  if (bad.length > 0) r.fail(item.format === "single" ? "S1" : "L8", `correct index ${bad.join(", ")} is out of range for ${n} options`, `${path}.correct`);
  if (new Set(correct).size !== correct.length) r.fail("L8", "correct indices repeat", `${path}.correct`);
  const keys = new Set(correct);
  if (item.format === "multi" && keys.size >= n) r.fail("L8", "every option is marked correct; a multi item needs at least one distractor", `${path}.correct`);
  item.options.forEach((o, i) => {
    if (keys.has(i) && o.misconception) r.fail("L8", "a correct option must not carry a misconception", `${path}.options.${i}.misconception`);
    if (!keys.has(i) && !o.misconception) r.fail("L8", "every distractor names the misconception that leads to it", `${path}.options.${i}.misconception`);
    if (catchAllOption(o.text)) r.fail("Q4", `"${o.text}": all/none-of-the-above options are not allowed`, `${path}.options.${i}.text`);
  });
}

function checkSingleCues(item: Extract<Item, { format: "single" }>, path: string, r: Report) {
  const key = item.options[item.correct];
  const distractors = item.options.filter((_, i) => i !== item.correct);
  if (!key || distractors.length === 0) return;

  const mean = distractors.reduce((s, o) => s + o.text.length, 0) / distractors.length;
  if (key.text.length > 1.3 * mean && key.text.length - mean >= 12) {
    r.fail("Q4", `the key (${key.text.length} chars) is much longer than the distractors (mean ${Math.round(mean)}); balance option lengths`, `${path}.options.${item.correct}.text`);
  }

  const keyWords = new Set(words(key.text));
  const distractorWords = new Set(distractors.flatMap((o) => words(o.text)));
  const cues = [...new Set(words(item.prompt))].filter(
    (w) => w.length >= 6 && /^\p{L}+$/u.test(w) && keyWords.has(w) && !distractorWords.has(w),
  );
  if (cues.length > 0) {
    r.fail("Q4", `the stem and only the key share the word(s) ${cues.map((w) => `"${w}"`).join(", ")}, which points to the key`, `${path}.options.${item.correct}.text`);
  }

  const hasAbsolute = (t: string) => words(t).some((w) => ABSOLUTES.has(w));
  if (distractors.every((o) => hasAbsolute(o.text)) && !hasAbsolute(key.text)) {
    r.fail("Q4", "every distractor contains an absolute word (always/never) and the key does not", `${path}.options`);
  }
}

export function checkCaption(step: Step, r: Report): void {
  const figure = stepFigure(step);
  if (!figure?.caption) return;
  r.check("V3");
  const cap = trigrams(words(figure.caption));
  if (cap.size === 0) return;
  const body = stepBodyText(step);
  for (const s of sentenceSpans(body)) {
    const sent = trigrams(words(body.slice(s.start, s.end)));
    let shared = 0;
    for (const t of cap) if (sent.has(t)) shared++;
    if (shared / cap.size >= CAPTION_OVERLAP) {
      r.fail("V3", "the caption repeats a sentence of the body; say what to look at in the figure instead", "figure.caption");
      return;
    }
  }
}

/** Q7: an item whose surface is a near-duplicate of an active item of the topic or of an earlier item in the same submission. */
export function checkDuplicates(items: { item: Item; path: string }[], existing: string[], r: Report): void {
  if (items.length === 0) return;
  r.check("Q7");
  const pool = existing.map((s) => trigrams(words(s))).filter((t) => t.size > 0);
  for (const { item, path } of items) {
    const t = trigrams(words(itemSurface(item)));
    if (t.size > 0 && pool.some((p) => jaccard(t, p) >= DUPLICATE_JACCARD)) {
      r.fail("Q7", "this item nearly duplicates an existing item of the topic; test the idea from a different angle", path);
    }
    pool.push(t);
  }
}

/** Q5 across a lesson: share of apply-or-higher items among its published items plus the check step. */
export function checkBloomShare(blooms: Bloom[], r: Report, path = "items"): void {
  r.check("Q5");
  if (blooms.length === 0) return;
  const share = blooms.filter((b) => HIGHER_BLOOM.has(b)).length / blooms.length;
  if (share < APPLY_SHARE_MIN) {
    r.fail("Q5", `only ${Math.round(share * 100)}% of the lesson's items are apply or higher (${blooms.length} items); at least ${APPLY_SHARE_MIN * 100}% required — raise the level of check items`, path);
  }
}

export type StepContext = {
  /** Surfaces (itemSurface) of active items of the topic. */
  existingSurfaces: string[];
  /** Bloom levels of the lesson's already published items; used when `step` is the check step. */
  lessonBlooms: Bloom[];
};

export async function checkStep(step: Step, ctx: StepContext): Promise<Report> {
  const r = new Report();
  if (step.kind === "explain") {
    r.check("L4");
    const n = words(step.body).length;
    if (n > EXPLAIN_MAX_WORDS) r.fail("L4", `body has ${n} words; split the segment so each is at most ${EXPLAIN_MAX_WORDS}`, "body");
  }
  const items = stepItems(step);
  for (const { item, path, role } of items) checkItem(item, path, role, r);
  checkCaption(step, r);
  const figure = stepFigure(step);
  if (figure) r.merge(await checkFigure(figure, "figure"), "V6");
  checkDuplicates(items, ctx.existingSurfaces, r);
  if (step.kind === "check") checkBloomShare([...ctx.lessonBlooms, ...items.map((i) => i.item.bloom)], r);
  return r;
}

export function checkCard(card: Card, path: string, r: Report): void {
  r.check("C1");
  const back = card.back.trim();
  if (back.length > CARD_BACK_MAX) r.fail("C1", `back has ${back.length} characters; keep one fact in at most ${CARD_BACK_MAX}`, `${path}.back`);
  if (/\n\s*(?:[-*•–—]|\d+[.)])\s/.test(back) || back.split(";").filter((s) => s.trim()).length >= 3) {
    r.fail("C1", "back is a list; split it into one card per fact", `${path}.back`);
  }
  const front = card.front.trim().toLowerCase();
  if (RULES.some((r) => r.yesNoFront.test(front))) {
    r.fail("C1", "the front is a yes/no question; ask for the fact itself", `${path}.front`);
  }
  if (YES_NO.has(back.replace(/[\s.!,]+$/u, "").toLowerCase())) r.fail("C1", "the back is yes/no; ask for the fact itself", `${path}.back`);
  if (card.kind === "cloze") {
    const blanks = card.front.match(/_{4,}/g)?.length ?? 0;
    if (blanks !== 1) r.fail("C1", `a cloze front has exactly one "____" blank, found ${blanks}`, `${path}.front`);
  }
}

export function checkLessonPlan(plan: LessonPlan, graphNodeIds: Set<string>): Violation[] {
  const out: Violation[] = [];
  const first = plan.outline[0];
  const last = plan.outline[plan.outline.length - 1];
  if (first?.kind !== "activate") out.push({ rule: "L2", message: "the outline must start with an 'activate' step (prequestions)", path: "plan.outline.0.kind" });
  if (last?.kind !== "check") out.push({ rule: "L11", message: "the outline must end with a 'check' step (unaided exit check)", path: `plan.outline.${plan.outline.length - 1}.kind` });
  plan.nodeIds.forEach((id, i) => {
    if (!graphNodeIds.has(id)) out.push({ rule: "S1", message: `node "${id}" is not in the knowledge graph; call graph_set first`, path: `plan.nodeIds.${i}` });
  });
  return out;
}

/** Validates `nodes` merged over the stored graph: unique ids, known prerequisites, no cycles. */
export function checkGraph(nodes: GraphNode[], stored: Map<string, string[]>): Violation[] {
  const out: Violation[] = [];
  const merged = new Map(stored);
  const seen = new Set<string>();
  nodes.forEach((n, i) => {
    if (seen.has(n.id)) out.push({ rule: "S1", message: `duplicate node id "${n.id}"`, path: `nodes.${i}.id` });
    seen.add(n.id);
    merged.set(n.id, n.prereqs);
  });
  nodes.forEach((n, i) =>
    n.prereqs.forEach((p, j) => {
      if (!merged.has(p)) out.push({ rule: "S1", message: `prerequisite "${p}" of "${n.id}" is not a node`, path: `nodes.${i}.prereqs.${j}` });
    }),
  );
  const state = new Map<string, "visiting" | "done">();
  const stack: string[] = [];
  const cycles: string[][] = [];
  const visit = (id: string) => {
    if (state.get(id) === "done") return;
    if (state.get(id) === "visiting") {
      cycles.push([...stack.slice(stack.indexOf(id)), id]);
      return;
    }
    state.set(id, "visiting");
    stack.push(id);
    for (const p of merged.get(id) ?? []) if (merged.has(p)) visit(p);
    stack.pop();
    state.set(id, "done");
  };
  for (const id of merged.keys()) visit(id);
  for (const c of cycles) out.push({ rule: "S1", message: `prerequisites form a cycle: ${c.join(" -> ")}`, path: "nodes" });
  return out;
}
