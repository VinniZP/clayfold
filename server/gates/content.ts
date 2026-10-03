import type { Card, Cite, Figure, Item, Step } from "../../shared/schemas";

export type ItemRole = "activate" | "check" | "practice" | "explain_check";

export type StepItem = { item: Item; path: string; role: ItemRole };

/** Items of a step in step order; this order is also the insertion order of their `items` rows. */
export function stepItems(step: Step): StepItem[] {
  switch (step.kind) {
    case "activate":
      return step.items.map((item, i) => ({ item, path: `items.${i}`, role: "activate" as const }));
    case "check":
      return step.items.map((item, i) => ({ item, path: `items.${i}`, role: "check" as const }));
    case "explain":
      return step.checks.map((item, i) => ({ item, path: `checks.${i}`, role: "explain_check" as const }));
    case "practice":
      return [{ item: step.item, path: "item", role: "practice" }];
    default:
      return [];
  }
}

export type PathCite = { cite: Cite; path: string };

export function stepCites(step: Step): PathCite[] {
  const out: PathCite[] = [];
  if (step.kind === "explain" || step.kind === "worked_example") {
    step.cites.forEach((cite, i) => out.push({ cite, path: `cites.${i}` }));
  }
  for (const { item, path } of stepItems(step)) out.push(...itemCites(item, path));
  return out;
}

export function itemCites(item: Item, path: string): PathCite[] {
  return item.cites.map((cite, i) => ({ cite, path: `${path}.cites.${i}` }));
}

export function cardCites(card: Card, path: string): PathCite[] {
  return card.cites.map((cite, i) => ({ cite, path: `${path}.cites.${i}` }));
}

export function stepFigure(step: Step): Figure | undefined {
  return step.kind === "explain" || step.kind === "worked_example" ? step.figure : undefined;
}

/** Prose the learner reads next to a figure. */
export function stepBodyText(step: Step): string {
  if (step.kind === "explain") return step.body;
  if (step.kind === "worked_example") return [step.problem, ...step.lines.map((l) => l.text)].join("\n");
  return "";
}

/** The text that identifies an item for near-duplicate detection (Q7): prompt plus its answer surface. */
export function itemSurface(item: Item): string {
  switch (item.format) {
    case "single":
    case "multi":
      return [item.prompt, ...item.options.map((o) => o.text)].join("\n");
    case "order":
      return [item.prompt, ...item.sequence].join("\n");
    case "cloze":
      return [item.prompt, item.text].join("\n");
    default:
      return item.prompt;
  }
}

/** Uniform random permutation of 0..n-1 from crypto randomness (Q3). */
export function randomPermutation(n: number): number[] {
  const p = Array.from({ length: n }, (_, i) => i);
  const r = new Uint32Array(Math.max(n, 1));
  crypto.getRandomValues(r);
  for (let i = n - 1; i > 0; i--) {
    const j = r[i]! % (i + 1);
    [p[i], p[j]] = [p[j]!, p[i]!];
  }
  return p;
}

/**
 * display_order for an item: display_order[k] is the authoring index shown at display position k.
 * Order items never get the identity, or the learner would see the answer.
 */
export function displayOrderFor(item: Item): number[] | null {
  if (item.format === "single" || item.format === "multi") return randomPermutation(item.options.length);
  if (item.format === "order") {
    let p = randomPermutation(item.sequence.length);
    while (p.every((v, i) => v === i)) p = randomPermutation(item.sequence.length);
    return p;
  }
  return null;
}
