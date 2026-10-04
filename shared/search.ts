import { Lexer, type Token } from "marked";
import type { SearchKind, SearchText } from "./api";
import { foldLetters } from "./i18n";
import { stripTermMarks } from "./terms";

// Text handling of GET /api/search, shared with the mock so both match and mark text the same way.

/** Queries shorter than a trigram match titles only. */
export const MIN_WORD = 3;

/**
 * Lowercase with every language's letter folding (ContentRules.fold). Keeps the length, so a range found in the
 * folded text marks the same characters of the original.
 */
export function foldForSearch(text: string): string {
  const lower = text.toLowerCase();
  const same = lower.length === text.length ? lower : Array.from(text, (c) => (c.toLowerCase().length === c.length ? c.toLowerCase() : c)).join("");
  return foldLetters(same);
}

/** The folded words of a query; `long` holds those of at least MIN_WORD characters. */
export function queryWords(query: string): { all: string[]; long: string[] } {
  const all = foldForSearch(query).split(/\s+/).filter(Boolean);
  return { all, long: all.filter((w) => w.length >= MIN_WORD) };
}

/** The words a result marks: the long ones, or the whole query when it has none. */
export function markWords(query: string): string[] {
  const { all, long } = queryWords(query);
  return long.length ? long : all.length ? [all.join(" ")] : [];
}

const BLOCKS = new Set(["paragraph", "heading", "code", "blockquote", "list_item", "table"]);

function tokensText(tokens: Token[]): string {
  let out = "";
  for (const tok of tokens) {
    if (tok.type === "space" || tok.type === "hr" || tok.type === "def") continue;
    if (tok.type === "br" || tok.type === "html") out += " ";
    else if (tok.type === "list") out += tokensText(tok.items as Token[]);
    else if (tok.type === "table") {
      const rows = [tok.header, ...tok.rows] as { tokens: Token[] }[][];
      out += rows.map((row) => row.map((cell) => tokensText(cell.tokens)).join(" ")).join(" ");
    } else if ("tokens" in tok && tok.tokens) out += tokensText(tok.tokens);
    else if ("text" in tok && typeof tok.text === "string") out += tok.text;
    if (BLOCKS.has(tok.type)) out += " ";
  }
  return out;
}

/** Markdown as the reader sees it, on one line: term marks give their surface, markup and HTML tags are dropped. */
export function plainText(markdown: string): string {
  return tokensText(Lexer.lex(stripTermMarks(markdown))).replace(/\s+/g, " ").trim();
}

function ranges(folded: string, words: string[], from = 0, to = folded.length): [number, number][] {
  const found: [number, number][] = [];
  for (const w of words) {
    for (let i = folded.indexOf(w, from); i !== -1 && i + w.length <= to; i = folded.indexOf(w, i + w.length)) found.push([i, i + w.length]);
  }
  found.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const r of found) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  return merged;
}

/** `text` with every occurrence of `words` marked. */
export function markText(text: string, words: string[]): SearchText {
  return { text, marks: ranges(foldForSearch(text), words) };
}

const BEFORE = 60;
const LENGTH = 180;

/**
 * A passage of `text` around its first match, cut at word boundaries, with ellipses where it was cut. Without a
 * match it is the start of the text when `lead` is set, otherwise null.
 */
export function excerpt(text: string, words: string[], lead = false): SearchText | null {
  if (!text) return null;
  const folded = foldForSearch(text);
  const first = ranges(folded, words)[0];
  if (!first && !lead) return null;
  let start = first ? Math.max(0, first[0] - BEFORE) : 0;
  let end = Math.min(text.length, start + LENGTH);
  if (start > 0) {
    const space = text.indexOf(" ", start);
    start = space !== -1 && space < (first?.[0] ?? start) ? space + 1 : start;
  }
  if (end < text.length) {
    const space = text.lastIndexOf(" ", end);
    end = space > (first?.[1] ?? start) ? space : end;
  }
  const head = start > 0 ? "…" : "";
  const tail = end < text.length ? "…" : "";
  const shift = head.length - start;
  return {
    text: head + text.slice(start, end) + tail,
    marks: ranges(folded, words, start, end).map(([a, b]) => [a + shift, b + shift]),
  };
}

/** What a hit shows under its title: a lesson's objective, a term's whole definition, a note's quote, the passage of a step. */
export function hitSnippet(kind: SearchKind, body: string, words: string[]): SearchText | null {
  switch (kind) {
    case "term":
      return markText(body, words);
    case "lesson":
    case "step":
    case "note":
      return excerpt(body, words, true);
    case "topic":
      return excerpt(body, words);
    case "card":
      return null;
  }
}
