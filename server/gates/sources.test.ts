import { describe, expect, test } from "bun:test";
import { extractReadable, fetchSource, PASSAGE_MAX_CHARS, searchText, USER_AGENT } from "./sources";
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

function fakeFetch(body: string, contentType: string, status = 200): typeof fetch {
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
  test("PDF is refused with a clear error", async () => {
    const r = await fetchSource("https://example.org/a.pdf", fakeFetch("%PDF-1.7", "application/pdf"));
    expect(r).toEqual({ ok: false, error: 'unsupported content type "application/pdf"; pick an HTML page' });
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
  test("a very long sentence is cut at a word boundary", () => {
    const long = `${"word ".repeat(200)}end.`;
    const [p] = searchText(long, "word", 1);
    expect(p!.quote.length).toBeLessThanOrEqual(PASSAGE_MAX_CHARS);
    expect(p!.quote.endsWith("word")).toBe(true);
  });
});
