import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { extractText, getDocumentProxy } from "unpdf";
import { MATERIAL_LIMITS } from "../../shared/api";
import { sentenceSpans, words } from "./text";

export const FETCH_TIMEOUT_MS = 20_000;
export const USER_AGENT = "clayfold/0.1 (local learning platform; fetches sources to verify quotes; +https://github.com/VinniZP/clayfold)";
const MIN_TEXT_CHARS = 200;
/** Headings a source_add result lists; a book's outline is longer than a page's. */
const MAX_SOURCE_HEADINGS = 60;

/** `published`: the latest publication or update date the document states (YYYY-MM-DD). */
export type Extracted = { title: string; text: string; headings: string[]; published?: string };
export type FetchOutcome = ({ ok: true } & Extracted) | { ok: false; error: string; title?: string };

type SourceFormat = "html" | "pdf" | "text" | "markdown";

const FORMATS: Record<string, SourceFormat> = {
  "text/html": "html",
  "application/xhtml+xml": "html",
  "application/pdf": "pdf",
  "text/plain": "text",
  "text/markdown": "markdown",
  "text/x-markdown": "markdown",
};

/**
 * The format of a response: its content type, or for a generic type the file extension or the PDF signature.
 * A Markdown file served as plain text (raw GitHub files are) counts as Markdown.
 */
function formatOf(type: string, url: string, head: Uint8Array): SourceFormat | null {
  const path = (() => {
    try {
      return new URL(url).pathname.toLowerCase();
    } catch {
      return "";
    }
  })();
  const markdownPath = path.endsWith(".md") || path.endsWith(".markdown");
  if (type === "text/plain" && markdownPath) return "markdown";
  if (FORMATS[type]) return FORMATS[type];
  if (type !== "" && type !== "application/octet-stream" && type !== "binary/octet-stream") return null;
  if (new TextDecoder("latin1").decode(head.subarray(0, 1024)).includes("%PDF-")) return "pdf";
  if (markdownPath) return "markdown";
  if (path.endsWith(".txt")) return "text";
  return null;
}

export async function fetchSource(url: string, fetchImpl: typeof fetch = fetch): Promise<FetchOutcome> {
  let res: Response;
  try {
    res = await fetchImpl(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml,application/pdf;q=0.9,text/markdown;q=0.8,text/plain;q=0.8,*/*;q=0.1" },
    });
  } catch (e) {
    const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    return { ok: false, error: timeout ? `fetch timed out after ${FETCH_TIMEOUT_MS / 1000} s` : `fetch failed: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!res.ok) {
    await res.body?.cancel();
    return { ok: false, error: `HTTP ${res.status} ${res.statusText}`.trim() };
  }
  const type = (res.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  let bytes: Uint8Array | null;
  try {
    bytes = await readCapped(res, MATERIAL_LIMITS.bytes);
  } catch (e) {
    const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    return { ok: false, error: timeout ? `download timed out after ${FETCH_TIMEOUT_MS / 1000} s` : `download failed: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!bytes) return { ok: false, error: `the file is larger than ${MATERIAL_LIMITS.bytes / (1024 * 1024)} MB; pick a smaller page or a chapter` };
  const format = formatOf(type, res.url || url, bytes);
  if (!format) return { ok: false, error: `unsupported content type "${type || "unknown"}"; pick an HTML page, a PDF or a text file` };

  let extracted: Extracted;
  if (format === "pdf") {
    try {
      extracted = await readPdf(bytes);
    } catch (e) {
      return { ok: false, error: e instanceof PdfError && e.reason === "locked" ? "the PDF is password-protected; pick another source" : "the PDF cannot be read; pick another source" };
    }
  } else {
    const raw = new TextDecoder("utf-8").decode(bytes);
    extracted = format === "html" ? extractReadable(raw) : plainDocument(raw, format);
  }
  if (extracted.text.length < MIN_TEXT_CHARS) {
    const why = format === "pdf" ? "likely scanned pages without a text layer" : format === "html" ? "likely rendered by JavaScript" : "nearly empty";
    return { ok: false, title: extracted.title, error: `the ${format === "html" ? "page" : "file"} has only ${extracted.text.length} characters of readable text (${why}); pick another source` };
  }
  if (extracted.text.length > MATERIAL_LIMITS.chars) {
    return { ok: false, title: extracted.title, error: `the text is longer than ${MATERIAL_LIMITS.chars} characters; register the chapter you need instead` };
  }
  return { ok: true, ...extracted, headings: extracted.headings.slice(0, MAX_SOURCE_HEADINGS) };
}

/** The body, or null once it grows past `limit` bytes. */
export async function readCapped(res: Response, limit: number): Promise<Uint8Array | null> {
  if (Number(res.headers.get("content-length") ?? 0) > limit) {
    await res.body?.cancel();
    return null;
  }
  if (!res.body) return new Uint8Array();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (let part = await reader.read(); !part.done; part = await reader.read()) {
    size += part.value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(part.value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

/** ATX headings of levels 1-3, the ones a reader navigates by. */
export function markdownHeadings(text: string): string[] {
  return [...text.matchAll(/^#{1,3}[ \t]+(.+?)[ \t#]*$/gm)].map((m) => m[1]!.trim()).filter(Boolean);
}

function plainDocument(raw: string, format: "text" | "markdown"): Extracted {
  const text = normalizeWhitespace(raw);
  const headings = format === "markdown" ? markdownHeadings(text) : [];
  return { title: headings[0] ?? "", text, headings };
}

export class PdfError extends Error {
  constructor(readonly reason: "locked" | "unreadable") {
    super(reason === "locked" ? "the PDF is password-protected" : "the PDF cannot be read");
  }
}

function pdfOutline(items: { title: string; items: unknown[] }[] | null, depth = 0): string[] {
  if (!items || depth > 1) return [];
  return items.flatMap((i) => [i.title.trim(), ...pdfOutline(i.items as typeof items, depth + 1)]).filter(Boolean);
}

/** Text, metadata title and outline (two levels) of a PDF, through unpdf (pdf.js). Throws PdfError. */
export async function readPdf(bytes: Uint8Array): Promise<Extracted> {
  if (!new TextDecoder("latin1").decode(bytes.subarray(0, 1024)).includes("%PDF-")) throw new PdfError("unreadable");
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    pdf = await getDocumentProxy(new Uint8Array(bytes), { verbosity: 0 });
  } catch (e) {
    throw new PdfError(e instanceof Error && e.name === "PasswordException" ? "locked" : "unreadable");
  }
  try {
    const { text: pages } = await extractText(pdf, { mergePages: false });
    const outline = await pdf.getOutline().catch(() => null);
    const { info } = await pdf.getMetadata().catch(() => ({ info: {} as Record<string, unknown> }));
    const meta = info as Record<string, unknown>;
    const metaTitle: unknown = meta.Title;
    const published = latestDate([meta.ModDate, meta.CreationDate].map((d) => (typeof d === "string" ? d.replace(/^D:(\d{4})(\d{2})(\d{2}).*$/, "$1-$2-$3") : null)));
    // pdf.js ends every visual line with a break; joining them lets sentences, not lines, become search passages.
    const text = normalizeWhitespace(pages.map((p) => p.replace(/\s*\n\s*/g, " ")).join("\n\n"));
    return { title: typeof metaTitle === "string" ? metaTitle.trim() : "", text, headings: pdfOutline(outline), ...(published ? { published } : {}) };
  } catch {
    throw new PdfError("unreadable");
  } finally {
    await pdf.loadingTask.destroy();
  }
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

/** Meta tags (property, name or itemprop, lowercased) that date a page. */
const DATE_META = new Set(["article:modified_time", "article:published_time", "og:updated_time", "datemodified", "datepublished", "date", "dc.date", "last-modified"]);

/** Dates in the page's meta tags that say when it was published or updated. */
function metaDates(document: { querySelectorAll(s: string): ArrayLike<{ getAttribute(n: string): string | null }> }): (string | null)[] {
  return Array.from(document.querySelectorAll("meta"))
    .filter((m) => DATE_META.has((m.getAttribute("property") ?? m.getAttribute("name") ?? m.getAttribute("itemprop") ?? "").toLowerCase()))
    .map((m) => m.getAttribute("content"));
}

/** The latest valid date among the candidates as YYYY-MM-DD, ignoring dates in the future. */
export function latestDate(candidates: (string | null | undefined)[]): string | undefined {
  const today = new Date().toISOString().slice(0, 10);
  const dates = candidates
    .map((c) => (c ? /^(\d{4}-\d{2}-\d{2})/.exec(c.trim())?.[1] : undefined))
    .filter((d): d is string => {
      const time = d ? Date.parse(`${d}T00:00:00Z`) : NaN;
      // Date.parse rolls 2020-02-30 over to March; the round trip rejects it.
      return !Number.isNaN(time) && d! >= "1990-01-01" && d! <= today && new Date(time).toISOString().startsWith(d!);
    });
  return dates.sort().at(-1);
}

export function extractReadable(html: string): Extracted {
  const { document } = parseHTML(html);
  const docTitle = document.title?.trim() ?? "";
  const headingsOf = (root: { querySelectorAll(s: string): ArrayLike<{ textContent: string | null }> }) =>
    Array.from(root.querySelectorAll("h1, h2, h3"))
      .map((h) => (h.textContent ?? "").replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .slice(0, 30);

  let article: { title?: string | null; content?: string | null; publishedTime?: string | null } | null = null;
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
      const published = latestDate([article.publishedTime, ...metaDates(document)]);
      return { title: article.title?.trim() || docTitle, text, headings: headings.length > 0 ? headings : headingsOf(document), ...(published ? { published } : {}) };
    }
  }
  const parts: string[] = [];
  if (document.body) blockText(document.body as unknown as DomNode, parts);
  const published = latestDate(metaDates(document));
  return { title: docTitle, text: normalizeWhitespace(parts.join("")), headings: headingsOf(document), ...(published ? { published } : {}) };
}

export type Passage = { quote: string; offset: number };

export const PASSAGE_MAX_CHARS = 600;

const stem = (w: string) => (w.length > 5 ? w.slice(0, w.length - 2) : w);

/**
 * Passages of 2-4 sentences ranked by the query terms they contain, each weighted by how rare it is in the text
 * (inverse sentence frequency), with a bonus where two query terms stand next to each other in query order. A term
 * matches a word that starts with its stem, so Russian inflections match. Quotes are verbatim slices of `text`.
 */
export function searchText(text: string, query: string, maxPassages: number): Passage[] {
  const terms = [...new Set(words(query))];
  const meaningful = terms.filter((t) => t.length >= 3);
  const stems = [...new Set((meaningful.length > 0 ? meaningful : terms).map(stem))];
  if (stems.length === 0) return [];
  const order = words(query).map(stem).filter((s) => stems.includes(s));

  const sentences = sentenceSpans(text).map((s) => ({ ...s, words: words(text.slice(s.start, s.end)) }));
  const matches = (w: string, st: string) => w.startsWith(st);
  const weight = new Map(
    stems.map((st) => {
      const df = sentences.filter((s) => s.words.some((w) => matches(w, st))).length;
      return [st, Math.log(1 + sentences.length / Math.max(df, 1))];
    }),
  );
  /** Adjacent word pairs that match consecutive query terms, counted once per pair of terms. */
  const phraseHits = (ws: string[]) => {
    let n = 0;
    for (let q = 0; q + 1 < order.length; q++) {
      const [a, b] = [order[q]!, order[q + 1]!];
      if (a !== b && ws.some((w, i) => i + 1 < ws.length && matches(w, a) && matches(ws[i + 1]!, b))) n++;
    }
    return n;
  };
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
    const hits = stems.filter((st) => ws.some((w) => matches(w, st)));
    if (hits.length === 0) continue;
    const freq = ws.filter((w) => stems.some((st) => matches(w, st))).length;
    const score = hits.reduce((sum, st) => sum + weight.get(st)!, 0) + 0.5 * phraseHits(ws) + Math.min(freq, 10) / 100;
    candidates.push({ start: sentences[i]!.start, end: sentences[end]!.end, score, first: i, last: end });
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
