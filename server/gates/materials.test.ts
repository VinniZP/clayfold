import { describe, expect, test } from "bun:test";
import { MATERIAL_LIMITS } from "../../shared/api";
import { openDb } from "../db";
import { checkPlanSources, okSources } from "./diversity";
import { extractFile, extractPasted, fetchMaterial, materialViews, removeMaterial, storeMaterials, type Material } from "./materials";
import { checkCites } from "./quotes";
import { card, pdfFile, QUOTE_ADD, seedTopic, SOURCE_TEXT } from "./test-fixtures";

const bytes = (s: string) => new TextEncoder().encode(s);

const LECTURE = `# Lecture 3: The index\n\n${SOURCE_TEXT}\n\n## Undoing\n\nTo unstage a file, run git restore --staged. The working tree keeps your edits.`;

const PDF_LINES = ["Photosynthesis turns light into chemical energy in the chloroplast.", "Chlorophyll absorbs red and blue light and reflects green light."];

describe("extracting materials", () => {
  test("a markdown file keeps its text and places its headings", async () => {
    const m = await extractFile("lecture-3.md", bytes(LECTURE));
    expect(m).toMatchObject({ kind: "markdown", title: "lecture-3", url: null, bytes: bytes(LECTURE).byteLength });
    expect(m.text).toContain(QUOTE_ADD);
    expect(m.headings.map((h) => h.text)).toEqual(["Lecture 3: The index", "Undoing"]);
    for (const h of m.headings) expect(m.text.slice(h.offset, h.offset + h.text.length)).toBe(h.text);
  });

  test("an HTML file is reduced to its readable text; scripts and markup are dropped", async () => {
    const html = `<html><head><title>Notes</title><script>alert(1)</script></head><body><h1>Index</h1><p onclick="x()">${SOURCE_TEXT}</p><img src=x onerror="steal()"></body></html>`;
    const m = await extractFile("notes.html", bytes(html));
    expect(m).toMatchObject({ kind: "html", title: "Notes" });
    expect(m.text).toContain(QUOTE_ADD);
    expect(m.text).not.toMatch(/alert|onclick|onerror|steal|</);
  });

  test("a PDF gives its text, outline and the file name as title", async () => {
    const m = await extractFile("biology.pdf", pdfFile(PDF_LINES, ["Photosynthesis"]));
    expect(m).toMatchObject({ kind: "pdf", title: "biology" });
    expect(m.text).toBe(PDF_LINES.join(" "));
    expect(m.headings).toEqual([{ text: "Photosynthesis", offset: 0 }]);
  });

  test("a client path is cut to the file name", async () => {
    expect((await extractFile("../../etc/notes.txt", bytes(SOURCE_TEXT))).title).toBe("notes");
  });

  test("unreadable input fails with a message naming the file", async () => {
    const fails = (name: string, data: Uint8Array) => expect(extractFile(name, data)).rejects.toThrow(name);
    await fails("slides.pptx", bytes(SOURCE_TEXT));
    await fails("binary.txt", new Uint8Array([72, 0, 105]));
    await fails("fake.pdf", bytes(SOURCE_TEXT));
    await fails("scan.pdf", pdfFile([]));
    await fails("short.txt", bytes("Too short."));
    await fails("big.txt", new Uint8Array(MATERIAL_LIMITS.bytes + 1).fill(97));
  });

  test("pasted text needs a title and text", () => {
    expect(extractPasted("Lecture 3", LECTURE)).toMatchObject({ kind: "text", title: "Lecture 3", url: null });
    expect(() => extractPasted(" ", LECTURE)).toThrow();
    expect(() => extractPasted("Lecture 3", "   ")).toThrow();
  });

  test("links: HTML and PDF by content type; other types, errors and non-web addresses fail", async () => {
    const serve = (body: BodyInit, type: string, status = 200) => (async () => new Response(body, { status, headers: { "content-type": type } })) as unknown as typeof fetch;
    const page = await fetchMaterial("https://example.org/notes", serve(`<h1>Index</h1><p>${SOURCE_TEXT}</p>`, "text/html; charset=utf-8"));
    expect(page).toMatchObject({ kind: "link", title: "notes", url: "https://example.org/notes", bytes: null, headings: [{ text: "Index", offset: 0 }] });
    const pdf = await fetchMaterial("https://example.org/files/biology.pdf", serve(pdfFile(PDF_LINES), "application/pdf"));
    expect(pdf).toMatchObject({ kind: "link", title: "biology.pdf" });
    expect(pdf.text).toContain("Chlorophyll absorbs red and blue light");
    await expect(fetchMaterial("https://example.org/a.zip", serve("PK", "application/zip"))).rejects.toThrow("a.zip");
    await expect(fetchMaterial("https://example.org/gone", serve("", "text/html", 404))).rejects.toThrow("404");
    await expect(fetchMaterial("file:///etc/passwd", serve("", "text/plain"))).rejects.toThrow("file:///etc/passwd");
  });
});

describe("stored materials", () => {
  const material = (overrides: Partial<Material> = {}): Material => ({ kind: "text", title: "Lecture 3", url: null, bytes: 100, text: SOURCE_TEXT, headings: [], ...overrides });

  test("are ok learner sources whose quotes pass Q6 like fetched ones", () => {
    const db = openDb(":memory:");
    const { topicId } = seedTopic(db);
    const [id] = storeMaterials(db, topicId, [material()]);
    expect(db.query("SELECT url, origin, status FROM sources WHERE id = ?").get(id!)).toEqual({ url: `material:${id}`, origin: "learner", status: "ok" });
    expect(checkCites(db, topicId, [{ cite: { sourceId: id!, quote: QUOTE_ADD }, path: "c" }])).toEqual([]);
    expect(checkCites(db, topicId, [{ cite: { sourceId: id!, quote: "The git add command records a commit." }, path: "c" }])).toEqual([
      expect.objectContaining({ rule: "Q6", path: "c.quote" }),
    ]);
    expect(materialViews(db, topicId)).toEqual([
      { id: id!, title: "Lecture 3", kind: "text", url: null, bytes: 100, chars: SOURCE_TEXT.length, addedAt: expect.any(String), cited: false },
    ]);
  });

  test("a link the topic already has becomes a learner material under the same id", () => {
    const db = openDb(":memory:");
    const { topicId, sourceId } = seedTopic(db);
    const [id] = storeMaterials(db, topicId, [material({ kind: "link", url: "https://example.org/git", bytes: null })]);
    expect(id).toBe(sourceId);
    expect(materialViews(db, topicId)[0]).toMatchObject({ id: sourceId, kind: "link", url: "https://example.org/git" });
  });

  test("a cited material cannot be removed; an uncited one can", () => {
    const db = openDb(":memory:");
    const { topicId } = seedTopic(db);
    const [cited, free] = storeMaterials(db, topicId, [material(), material({ title: "Syllabus" })]);
    db.query("INSERT INTO cards (id, topic_id, node_id, content) VALUES ('c1', ?, 'git-index', ?)").run(topicId, JSON.stringify(card(cited)));
    expect(materialViews(db, topicId).map((m) => m.cited)).toEqual([true, false]);
    expect(removeMaterial(db, topicId, cited!)).toBe("cited");
    expect(removeMaterial(db, topicId, free!)).toBe("removed");
    expect(removeMaterial(db, topicId, free!)).toBe("missing");
    expect(removeMaterial(db, "other", cited!)).toBe("missing");
  });

  test("Q8: learner materials are one publisher, so a topic built only from them is not held back", () => {
    const db = openDb(":memory:");
    db.query("INSERT INTO topics (id, slug, title, request) VALUES ('t', 't', 'Biology', 'r')").run();
    const [a, b] = storeMaterials(db, "t", [material(), material({ title: "Chapter 2" })]);
    expect(checkPlanSources([a!], okSources(db, "t"))).toEqual([]);
    db.query("INSERT INTO sources (id, topic_id, url, title, kind, note, text, status) VALUES ('web', 't', 'https://example.org/x', 'x', 'docs', 'n', 'text', 'ok')").run();
    expect(checkPlanSources([a!, b!], okSources(db, "t"))).toEqual([expect.objectContaining({ rule: "Q8" })]);
    expect(checkPlanSources([a!, "web"], okSources(db, "t"))).toEqual([]);
  });
});
