import { foldLetters } from "../../shared/i18n";

// Text primitives shared by the gates and source search. Unicode-aware: content may be in any supported language.

const INVISIBLE = /[­​-‍⁠﻿]/g;

/** Canonical form for verbatim-quote comparison (Q6): NFKC, lowercase, folded letters, one style of quotes, dashes and ellipsis, single spaces. */
export function normalizeForQuote(s: string): string {
  return foldLetters(s.normalize("NFKC").replace(INVISIBLE, "").toLowerCase())
    .replace(/[‘’‚‛′`´]/g, "'")
    .replace(/[“”„‟″«»]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/…/g, "...")
    .replace(/\s+/g, " ")
    .trim();
}

/** Lowercased word tokens (letters and digits, with inner apostrophes). */
export function words(s: string): string[] {
  return foldLetters(s.normalize("NFKC").toLowerCase()).match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) ?? [];
}

export function trigrams(tokens: string[]): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + 2 < tokens.length; i++) out.add(`${tokens[i]} ${tokens[i + 1]} ${tokens[i + 2]}`);
  return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

export type Span = { start: number; end: number };

/** Sentence spans over `text`: a sentence ends at . ! ? … followed by whitespace, or at a line break. */
export function sentenceSpans(text: string): Span[] {
  const spans: Span[] = [];
  const boundary = /[.!?…]+["'»”)\]]*(?=\s)|\n/g;
  let start = 0;
  for (let m = boundary.exec(text); m; m = boundary.exec(text)) {
    const end = m.index + m[0].length;
    pushTrimmed(text, start, end, spans);
    start = end;
  }
  pushTrimmed(text, start, text.length, spans);
  return spans;
}

function pushTrimmed(text: string, start: number, end: number, spans: Span[]) {
  while (start < end && /\s/.test(text[start]!)) start++;
  while (end > start && /\s/.test(text[end - 1]!)) end--;
  if (end > start) spans.push({ start, end });
}
