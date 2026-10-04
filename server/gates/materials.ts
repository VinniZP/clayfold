import type { Database } from "bun:sqlite";
import { extname } from "node:path";
import { extractText, getDocumentProxy } from "unpdf";
import { MATERIAL_EXTENSIONS, MATERIAL_LIMITS, type MaterialKind, type MaterialView } from "../../shared/api";
import type { MessageKey, Params } from "../../shared/i18n";
import { newId } from "../db";
import { language, t } from "../i18n";
import { extractReadable, FETCH_TIMEOUT_MS, normalizeWhitespace, USER_AGENT } from "./sources";

/**
 * Learner materials: the readable text of a file, a pasted text or a link, stored as a source of the topic with
 * origin 'learner'. Only the text is kept; the original file is not written anywhere.
 */

export const MIN_MATERIAL_CHARS = 50;
const MAX_HEADINGS = 200;
const MB = 1024 * 1024;

export type Heading = { text: string; offset: number };

export type Material = { kind: MaterialKind; title: string; url: string | null; bytes: number | null; text: string; headings: Heading[] };

/** A failure the learner reads; the message is translated. */
export class MaterialError extends Error {}

function fail(key: MessageKey, params: Params): never {
  throw new MaterialError(t(key, params));
}

const number = (n: number) => new Intl.NumberFormat(language()).format(n);

/** The last segment of a client-supplied file name, without control characters. */
export function cleanName(name: string): string {
  return (name.split(/[\\/]/).pop() ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 200);
}

export const kindOfFile = (name: string): Exclude<MaterialKind, "link"> | null => MATERIAL_EXTENSIONS[extname(name).toLowerCase()] ?? null;

type Document = { text: string; title: string | null; headings: string[] };

function decodeText(bytes: Uint8Array, name: string): string {
  if (bytes.includes(0)) fail("material.error.notText", { name });
  return new TextDecoder("utf-8").decode(bytes);
}

/** ATX headings of levels 1-3, the ones a reader navigates by. */
function markdownHeadings(text: string): string[] {
  return [...text.matchAll(/^#{1,3}[ \t]+(.+?)[ \t#]*$/gm)].map((m) => m[1]!.trim()).filter(Boolean);
}

function pdfOutline(items: { title: string; items: unknown[] }[] | null, depth = 0): string[] {
  if (!items || depth > 1) return [];
  return items.flatMap((i) => [i.title.trim(), ...pdfOutline(i.items as typeof items, depth + 1)]).filter(Boolean);
}

async function readPdf(bytes: Uint8Array, name: string): Promise<Document> {
  if (!new TextDecoder("latin1").decode(bytes.subarray(0, 1024)).includes("%PDF-")) fail("material.error.pdfUnreadable", { name });
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    pdf = await getDocumentProxy(new Uint8Array(bytes), { verbosity: 0 });
  } catch (e) {
    fail(e instanceof Error && e.name === "PasswordException" ? "material.error.pdfLocked" : "material.error.pdfUnreadable", { name });
  }
  try {
    const { text: pages } = await extractText(pdf, { mergePages: false });
    const outline = await pdf.getOutline().catch(() => null);
    const { info } = await pdf.getMetadata().catch(() => ({ info: {} as Record<string, unknown> }));
    const metaTitle: unknown = (info as Record<string, unknown>).Title;
    const title = typeof metaTitle === "string" ? metaTitle.trim() : "";
    // pdf.js ends every visual line with a break; joining them lets sentences, not lines, become search passages.
    const text = pages.map((p) => p.replace(/\s*\n\s*/g, " ")).join("\n\n");
    return { text, title: title || null, headings: pdfOutline(outline) };
  } catch {
    fail("material.error.pdfUnreadable", { name });
  } finally {
    await pdf.loadingTask.destroy();
  }
}

async function readDocument(kind: Exclude<MaterialKind, "link">, bytes: Uint8Array, name: string): Promise<Document> {
  if (kind === "pdf") return readPdf(bytes, name);
  const raw = decodeText(bytes, name);
  if (kind === "html") {
    // linkedom builds no body for a bare fragment, which a saved snippet often is.
    const page = extractReadable(/<html[\s>]/i.test(raw) ? raw : `<!doctype html><html><body>${raw}</body></html>`);
    return { text: page.text, title: page.title || null, headings: page.headings };
  }
  return { text: raw, title: null, headings: [] };
}

/** Normalises the text, checks its length and places each heading in it; a heading the text lacks is dropped. */
function finish(base: Omit<Material, "text" | "headings">, doc: Document, name: string): Material {
  const text = normalizeWhitespace(doc.text);
  if (text.length < MIN_MATERIAL_CHARS) fail("material.error.noText", { name });
  if (text.length > MATERIAL_LIMITS.chars) fail("material.error.tooLong", { name, limit: number(MATERIAL_LIMITS.chars) });
  const titles = doc.headings.length > 0 ? doc.headings : markdownHeadings(text);
  const headings: Heading[] = [];
  let from = 0;
  for (const heading of titles) {
    const offset = text.indexOf(heading, from);
    if (offset < 0) continue;
    headings.push({ text: heading, offset });
    from = offset + heading.length;
    if (headings.length === MAX_HEADINGS) break;
  }
  return { ...base, text, headings };
}

function tooLarge(name: string): never {
  fail("material.error.tooLarge", { name, limit: MATERIAL_LIMITS.bytes / MB });
}

export async function extractFile(fileName: string, bytes: Uint8Array): Promise<Material> {
  const name = cleanName(fileName) || "file";
  if (bytes.byteLength > MATERIAL_LIMITS.bytes) tooLarge(name);
  const kind = kindOfFile(name);
  if (!kind) fail("material.error.unsupported", { name });
  const doc = await readDocument(kind, bytes, name);
  return finish({ kind, title: doc.title || name.replace(/\.[^.]+$/, "") || name, url: null, bytes: bytes.byteLength }, doc, name);
}

export function extractPasted(title: string, text: string): Material {
  const name = title.trim().slice(0, 200);
  if (!name || !text.trim()) fail("material.error.emptyText", {});
  const bytes = new TextEncoder().encode(text).byteLength;
  if (bytes > MATERIAL_LIMITS.bytes) tooLarge(name);
  return finish({ kind: "text", title: name, url: null, bytes }, { text, title: null, headings: [] }, name);
}

const LINK_TYPES: Record<string, Exclude<MaterialKind, "link">> = {
  "text/html": "html",
  "application/xhtml+xml": "html",
  "text/plain": "text",
  "text/markdown": "markdown",
  "text/x-markdown": "markdown",
  "application/pdf": "pdf",
};

/** The body, or null once it grows past `limit` bytes. */
async function readCapped(res: Response, limit: number): Promise<Uint8Array | null> {
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

export async function fetchMaterial(url: string, fetchImpl: typeof fetch = fetch): Promise<Material> {
  const name = url.trim().slice(0, 200);
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    fail("material.error.badLink", { name });
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") fail("material.error.badLink", { name });
  let res: Response;
  try {
    res = await fetchImpl(parsed.href, {
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml,application/pdf,text/plain;q=0.9,*/*;q=0.1" },
    });
  } catch (e) {
    const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    fail(timeout ? "material.error.linkTimeout" : "material.error.linkNetwork", { name, seconds: FETCH_TIMEOUT_MS / 1000 });
  }
  if (!res.ok) {
    await res.body?.cancel();
    fail("material.error.linkStatus", { name, status: res.status });
  }
  const type = (res.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  const kind = LINK_TYPES[type] ?? (type === "application/octet-stream" ? kindOfFile(parsed.pathname) : null);
  if (!kind) {
    await res.body?.cancel();
    fail("material.error.linkType", { name });
  }
  const bytes = await readCapped(res, MATERIAL_LIMITS.bytes);
  if (!bytes) tooLarge(name);
  const doc = await readDocument(kind, bytes, name);
  const fileName = decodeURIComponent(parsed.pathname.split("/").filter(Boolean).pop() ?? "");
  return finish({ kind: "link", title: (doc.title || fileName || parsed.hostname).slice(0, 200), url: parsed.href, bytes: null }, doc, name);
}

/**
 * Stores extracted materials as ok sources of the topic and returns their ids. A link the topic already has as a
 * source becomes a learner material under the same id, so its existing cites stay valid.
 */
export function storeMaterials(database: Database, topicId: string, materials: Material[]): string[] {
  const upsert = database.query<{ id: string }, [string, string, string, string, string, string, number | null, string]>(
    `INSERT INTO sources (id, topic_id, url, title, kind, note, text, status, origin, bytes, headings)
     VALUES (?, ?, ?, ?, ?, '', ?, 'ok', 'learner', ?, ?)
     ON CONFLICT (topic_id, url) DO UPDATE SET title = excluded.title, kind = excluded.kind, text = excluded.text, status = 'ok',
       error = NULL, origin = 'learner', bytes = excluded.bytes, headings = excluded.headings,
       fetched_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     RETURNING id`,
  );
  return database.transaction(() =>
    materials.map((m) => {
      const id = newId("src");
      return upsert.get(id, topicId, m.url ?? `material:${id}`, m.title, m.kind, m.text, m.bytes, JSON.stringify(m.headings))!.id;
    }),
  )();
}

type MaterialRow = { id: string; title: string; kind: MaterialKind; url: string; bytes: number | null; chars: number; fetched_at: string; cited: number };

/** Steps, items and cards store cites as JSON, so a cite of a source contains this exact fragment. */
const CITED = `EXISTS (SELECT 1 FROM steps st JOIN lessons l ON l.id = st.lesson_id WHERE l.topic_id = s.topic_id AND instr(st.content, '"sourceId":"' || s.id || '"') > 0)
  OR EXISTS (SELECT 1 FROM items i WHERE i.topic_id = s.topic_id AND instr(i.content, '"sourceId":"' || s.id || '"') > 0)
  OR EXISTS (SELECT 1 FROM cards c WHERE c.topic_id = s.topic_id AND instr(c.content, '"sourceId":"' || s.id || '"') > 0)`;

export function materialViews(database: Database, topicId: string, ids?: string[]): MaterialView[] {
  return database
    .query<MaterialRow, [string]>(
      `SELECT s.id, s.title, s.kind, s.url, s.bytes, length(s.text) AS chars, s.fetched_at, ${CITED} AS cited
       FROM sources s WHERE s.topic_id = ? AND s.origin = 'learner' ORDER BY s.fetched_at, s.rowid`,
    )
    .all(topicId)
    .filter((r) => !ids || ids.includes(r.id))
    .map((r) => ({
      id: r.id,
      title: r.title,
      kind: r.kind,
      url: r.kind === "link" ? r.url : null,
      bytes: r.bytes,
      chars: r.chars,
      addedAt: r.fetched_at,
      cited: r.cited === 1,
    }));
}

/** Deletes a learner material unless lesson content cites it. */
export function removeMaterial(database: Database, topicId: string, id: string): "removed" | "cited" | "missing" {
  const row = database
    .query<{ cited: number }, [string, string]>(`SELECT ${CITED} AS cited FROM sources s WHERE s.id = ? AND s.topic_id = ? AND s.origin = 'learner'`)
    .get(id, topicId);
  if (!row) return "missing";
  if (row.cited === 1) return "cited";
  database.query("DELETE FROM sources WHERE id = ?").run(id);
  return "removed";
}
