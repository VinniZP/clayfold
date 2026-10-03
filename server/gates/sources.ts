import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { sentenceSpans, words } from "./text";

export const FETCH_TIMEOUT_MS = 20_000;
export const USER_AGENT = "clayfold/0.1 (local learning platform; fetches sources to verify quotes)";
const MIN_TEXT_CHARS = 200;

export type Extracted = { title: string; text: string; headings: string[] };
export type FetchOutcome = ({ ok: true } & Extracted) | { ok: false; error: string; title?: string };

export async function fetchSource(url: string, fetchImpl: typeof fetch = fetch): Promise<FetchOutcome> {
  let res: Response;
  try {
    res = await fetchImpl(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1" },
    });
  } catch (e) {
    const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    return { ok: false, error: timeout ? `fetch timed out after ${FETCH_TIMEOUT_MS / 1000} s` : `fetch failed: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!res.ok) return { ok: false, error: `HTTP ${res.status} ${res.statusText}`.trim() };
  const type = (res.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  if (type !== "text/html" && type !== "application/xhtml+xml") {
    return { ok: false, error: `unsupported content type "${type || "unknown"}"; pick an HTML page` };
  }
  const extracted = extractReadable(await res.text());
  if (extracted.text.length < MIN_TEXT_CHARS) {
    return { ok: false, title: extracted.title, error: `the page has only ${extracted.text.length} characters of readable text (likely rendered by JavaScript); pick another page` };
  }
  return { ok: true, ...extracted };
}

const BLOCK = new Set([
  "address", "article", "aside", "blockquote", "br", "dd", "div", "dl", "dt", "figcaption", "figure", "footer",
  "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "li", "main", "nav", "ol", "p", "pre", "section", "table",
  "tbody", "td", "th", "thead", "tr", "ul",
]);

type DomNode = { nodeType: number; nodeName: string; textContent: string | null; childNodes: ArrayLike<DomNode> };

/** Text with a line break at every block boundary, so sentences and headings stay apart. */
function blockText(node: DomNode, out: string[]): void {
  if (node.nodeType === 3) {
    out.push(node.textContent ?? "");
    return;
  }
  if (node.nodeType !== 1 && node.nodeType !== 9 && node.nodeType !== 11) return;
  const name = node.nodeName.toLowerCase();
  if (name === "script" || name === "style" || name === "noscript" || name === "template") return;
  const block = BLOCK.has(name);
  if (block) out.push("\n");
  for (let i = 0; i < node.childNodes.length; i++) blockText(node.childNodes[i]!, out);
  if (block) out.push("\n");
}

export function normalizeWhitespace(s: string): string {
  return s
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function extractReadable(html: string): Extracted {
  const { document } = parseHTML(html);
  const docTitle = document.title?.trim() ?? "";
  const headingsOf = (root: { querySelectorAll(s: string): ArrayLike<{ textContent: string | null }> }) =>
    Array.from(root.querySelectorAll("h1, h2, h3"))
      .map((h) => (h.textContent ?? "").replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .slice(0, 30);

  let article: { title?: string | null; content?: string | null } | null = null;
  try {
    article = new Readability(parseHTML(html).document as unknown as Document).parse();
  } catch {
    article = null;
  }
  if (article?.content) {
    const { document: art } = parseHTML(`<!doctype html><html><body>${article.content}</body></html>`);
    const parts: string[] = [];
    blockText(art.body as unknown as DomNode, parts);
    const text = normalizeWhitespace(parts.join(""));
    if (text.length >= MIN_TEXT_CHARS) {
      const headings = headingsOf(art);
      return { title: article.title?.trim() || docTitle, text, headings: headings.length > 0 ? headings : headingsOf(document) };
    }
  }
  const parts: string[] = [];
  if (document.body) blockText(document.body as unknown as DomNode, parts);
  return { title: docTitle, text: normalizeWhitespace(parts.join("")), headings: headingsOf(document) };
}

export type Passage = { quote: string; offset: number };

export const PASSAGE_MAX_CHARS = 600;

const stem = (w: string) => (w.length > 5 ? w.slice(0, w.length - 2) : w);

/**
 * Passages of 2-4 sentences ranked by how many distinct query terms they contain. A term matches a word
 * that starts with its stem, so Russian inflections match. Quotes are verbatim slices of `text`.
 */
export function searchText(text: string, query: string, maxPassages: number): Passage[] {
  const terms = [...new Set(words(query))];
  const meaningful = terms.filter((t) => t.length >= 3);
  const stems = (meaningful.length > 0 ? meaningful : terms).map(stem);
  if (stems.length === 0) return [];

  const sentences = sentenceSpans(text).map((s) => ({ ...s, words: words(text.slice(s.start, s.end)) }));
  const candidates: { start: number; end: number; score: number; first: number; last: number }[] = [];
  for (let i = 0; i < sentences.length; i++) {
    let end = i;
    while (
      end + 1 < sentences.length &&
      end - i < 3 &&
      (end - i < 1 || sentences[end + 1]!.end - sentences[i]!.start <= PASSAGE_MAX_CHARS)
    ) {
      end++;
    }
    const ws = sentences.slice(i, end + 1).flatMap((s) => s.words);
    const hits = stems.filter((st) => ws.some((w) => w.startsWith(st)));
    if (hits.length === 0) continue;
    const freq = ws.filter((w) => stems.some((st) => w.startsWith(st))).length;
    candidates.push({ start: sentences[i]!.start, end: sentences[end]!.end, score: hits.length + Math.min(freq, 10) / 100, first: i, last: end });
  }
  candidates.sort((a, b) => b.score - a.score || a.start - b.start);

  const taken: { first: number; last: number }[] = [];
  const out: Passage[] = [];
  for (const c of candidates) {
    if (out.length >= maxPassages) break;
    if (taken.some((t) => c.first <= t.last && t.first <= c.last)) continue;
    taken.push(c);
    let end = c.end;
    if (end - c.start > PASSAGE_MAX_CHARS) {
      const cut = text.lastIndexOf(" ", c.start + PASSAGE_MAX_CHARS);
      end = cut > c.start ? cut : c.start + PASSAGE_MAX_CHARS;
    }
    out.push({ quote: text.slice(c.start, end), offset: c.start });
  }
  return out;
}
