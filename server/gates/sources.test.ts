import { describe, expect, test } from "bun:test";
import { extractReadable, fetchSource, latestDate, PASSAGE_MAX_CHARS, searchText, USER_AGENT } from "./sources";
import { pdfFile } from "./test-fixtures";
import { normalizeForQuote } from "./text";

const ARTICLE = `<!doctype html><html><head><title>Git index — Docs</title><script>var tracking = 1;</script></head><body>
<nav><a href="/">Home</a> <a href="/docs">Docs</a></nav>
<article>
<h1>The Git index</h1>
<p>The index is an intermediate area between the working tree and the repository. The <code>git add</code> command adds changes to the index.</p>
<p>The git commit command saves the contents of the index as a new commit. After a commit, the index matches the last commit. This lets you build a commit piece by piece.</p>
<h2>Staging in English</h2>
<p>The staging area holds the snapshot of your next commit. You can stage part of a file with git add -p. Unstaged changes stay in the working tree.</p>
<h3>Undoing</h3>
<p>To unstage a file, run git restore --staged. The working tree keeps your edits. Nothing is lost when you unstage a change.</p>
</article>
<footer>© 2026</footer>
</body></html>`;

const RU_TEXT = `Индекс — это промежуточная область между рабочей копией и репозиторием. Команда git add добавляет изменения в индекс.
Команда git commit сохраняет содержимое индекса как новый коммит. После коммита индекс совпадает с последним коммитом. Это позволяет собирать коммит по частям.`;

describe("dates", () => {
  test("a page's latest publication or update date comes from its meta tags", () => {
    const html = ARTICLE.replace(
      "<title>",
      '<meta property="article:published_time" content="2021-04-01T09:00:00Z"><meta property="article:modified_time" content="2024-11-20T12:00:00+02:00"><meta name="description" content="2099-01-01"><title>',
    );
    expect(extractReadable(html).published).toBe("2024-11-20");
    expect(extractReadable(ARTICLE).published).toBeUndefined();
  });
  test("latestDate ignores invalid and future dates", () => {
    expect(latestDate(["2020-02-30", "2020-13-45", "not a date", "2999-01-01", "2019-05-06", null])).toBe("2019-05-06");
    expect(latestDate([])).toBeUndefined();
  });
});

describe("extractReadable", () => {
  test("extracts article text, title and headings", () => {
    const r = extractReadable(ARTICLE);
    expect(r.title).toContain("Git");
    expect(r.headings).toEqual(expect.arrayContaining(["Staging in English", "Undoing"]));
    expect(r.text).toContain("The git add command adds changes to the index.");
    expect(r.text).not.toContain("tracking");
    expect(r.text).not.toMatch(/ {2}/);
  });
});

function fakeFetch(body: string | Uint8Array<ArrayBuffer>, contentType: string, status = 200): typeof fetch {
  return (async (_url: string | URL | Request, init?: RequestInit) => {
    expect(new Headers(init?.headers).get("user-agent")).toBe(USER_AGENT);
    return new Response(body, { status, headers: { "content-type": contentType } });
  }) as typeof fetch;
}

describe("fetchSource", () => {
  test("HTML page", async () => {
    const r = await fetchSource("https://example.org/git", fakeFetch(ARTICLE, "text/html; charset=utf-8"));
    expect(r.ok).toBe(true);
  });
  const PDF_LINES = [
    "Photosynthesis turns light into chemical energy in the chloroplast of a plant cell.",
    "Chlorophyll absorbs red and blue light and reflects green light, which is why leaves look green.",
    "The light reactions split water and release oxygen as a by-product of the process.",
  ];
  test("PDF gives its text and outline", async () => {
    const r = await fetchSource("https://example.org/bio.pdf", fakeFetch(pdfFile(PDF_LINES, ["Photosynthesis"]), "application/pdf"));
    expect(r).toMatchObject({ ok: true, text: PDF_LINES.join(" "), headings: ["Photosynthesis"] });
  });
  test("PDF served as octet-stream is recognised by its signature", async () => {
    const r = await fetchSource("https://example.org/download?id=7", fakeFetch(pdfFile(PDF_LINES), "application/octet-stream"));
    expect(r.ok).toBe(true);
  });
  test("a PDF without a text layer or a broken one fails with a reason", async () => {
    const scan = await fetchSource("https://example.org/scan.pdf", fakeFetch(pdfFile([]), "application/pdf"));
    expect(scan.ok === false && scan.error).toContain("scanned");
    const broken = await fetchSource("https://example.org/a.pdf", fakeFetch("%PDF-1.7 garbage", "application/pdf"));
    expect(broken).toEqual({ ok: false, error: "the PDF cannot be read; pick another source" });
  });
  test("Markdown and plain text", async () => {
    const md = `# Staging\n\n${"The staging area holds the snapshot of your next commit. ".repeat(5)}\n\n## Undoing\n\nRun git restore --staged to unstage.`;
    const r = await fetchSource("https://example.org/notes.txt", fakeFetch(md, "text/plain; charset=utf-8"));
    expect(r).toMatchObject({ ok: true, title: "", headings: [] });
    const m = await fetchSource("https://example.org/notes", fakeFetch(md, "text/markdown"));
    expect(m).toMatchObject({ ok: true, title: "Staging", headings: ["Staging", "Undoing"] });
    const raw = await fetchSource("https://raw.example.org/repo/README.md", fakeFetch(md, "text/plain; charset=utf-8"));
    expect(raw).toMatchObject({ ok: true, headings: ["Staging", "Undoing"] });
  });
  test("other content types are refused", async () => {
    const r = await fetchSource("https://example.org/a.png", fakeFetch("PNG", "image/png"));
    expect(r).toEqual({ ok: false, error: 'unsupported content type "image/png"; pick an HTML page, a PDF or a text file' });
  });
  test("HTTP error", async () => {
    const r = await fetchSource("https://example.org/404", fakeFetch("nope", "text/html", 404));
    expect(r.ok).toBe(false);
  });
  test("page without readable text", async () => {
    const r = await fetchSource("https://example.org/app", fakeFetch('<html><body><div id="root"></div><script>app()</script></body></html>', "text/html"));
    expect(r.ok === false && r.error).toContain("readable text");
  });
  test("network failure", async () => {
    const r = await fetchSource("https://example.org", (async () => {
      throw new TypeError("connection refused");
    }) as unknown as typeof fetch);
    expect(r.ok === false && r.error).toContain("connection refused");
  });
});

describe("searchText", () => {
  const { text } = extractReadable(ARTICLE);
  test("finds the Russian passage across inflections", () => {
    const [top] = searchText(RU_TEXT, "коммиты индекса", 3);
    expect(top!.quote).toContain("Команда git commit сохраняет содержимое индекса");
  });
  test("finds the English passage", () => {
    const [top] = searchText(text, "unstage working tree", 2);
    expect(top!.quote).toContain("git restore --staged");
  });
  test("passages are verbatim slices at their offsets", () => {
    for (const p of searchText(text, "index commit staging", 8)) {
      expect(text.slice(p.offset, p.offset + p.quote.length)).toBe(p.quote);
      expect(p.quote.length).toBeLessThanOrEqual(PASSAGE_MAX_CHARS);
      expect(normalizeForQuote(text)).toContain(normalizeForQuote(p.quote));
    }
  });
  test("passages do not overlap and respect maxPassages", () => {
    const ps = searchText(text, "git", 2);
    expect(ps.length).toBe(2);
    const [a, b] = ps.sort((x, y) => x.offset - y.offset);
    expect(a!.offset + a!.quote.length).toBeLessThanOrEqual(b!.offset);
  });
  test("no match returns nothing", () => expect(searchText(text, "kubernetes", 4)).toEqual([]));
  const FILLER = ["Colours are chosen later.", "Lights come next.", "Cameras come last.", "Then the scene is saved."];
  test("a rare query term outweighs a common one", () => {
    const doc = [
      ...Array.from({ length: 8 }, (_, i) => `The mesh number ${i} is stored in a buffer. It has vertices and faces.`),
      ...FILLER,
      "A surface is manifold when every edge belongs to exactly two faces.",
      ...FILLER,
    ].join("\n");
    const [top] = searchText(doc, "manifold mesh", 1);
    expect(top!.quote).toContain("exactly two faces");
  });
  test("query words standing together rank first", () => {
    const doc = [
      "The working directory is on disk. A tree object lists files.",
      ...FILLER,
      "Your edits stay in the working tree until you add them.",
    ].join("\n");
    expect(searchText(doc, "working tree", 2)[0]!.quote).toContain("stay in the working tree");
  });
  test("a very long sentence is cut at a word boundary", () => {
    const long = `${"word ".repeat(200)}end.`;
    const [p] = searchText(long, "word", 1);
    expect(p!.quote.length).toBeLessThanOrEqual(PASSAGE_MAX_CHARS);
    expect(p!.quote.endsWith("word")).toBe(true);
  });
});
