import { describe, expect, test } from "bun:test";
import type { ExaClient, ExaSearch } from "../exa";
import { searchPapers, searchWeb, searchWikipedia, WEB_EXCLUDED } from "./discover";
import { USER_AGENT } from "./sources";

function serve(body: unknown, status = 200, seen: string[] = []): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    expect(new Headers(init?.headers).get("user-agent")).toBe(USER_AGENT);
    seen.push(String(url));
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

describe("searchWikipedia", () => {
  test("asks the given edition and returns article addresses with plain-text snippets", async () => {
    const seen: string[] = [];
    const found = await searchWikipedia("топология сетки", "ru", 3, serve({
      pages: [{ key: "Полигональная_сетка", title: "Полигональная сетка", description: "структура в 3D-графике", excerpt: '<span class="searchmatch">Сетка</span> &amp; грани' }],
    }, 200, seen));
    expect(seen[0]).toStartWith("https://ru.wikipedia.org/w/rest.php/v1/search/page?q=");
    expect(seen[0]).toEndWith("&limit=3");
    expect(found).toEqual([{
      title: "Полигональная сетка",
      urls: [`https://ru.wikipedia.org/wiki/${encodeURIComponent("Полигональная_сетка")}`],
      snippet: "структура в 3D-графике. Сетка & грани",
    }]);
  });
  test("an HTTP error names the host and the rate limit", async () => {
    await expect(searchWikipedia("mesh", "en", 3, serve({}, 429))).rejects.toThrow("en.wikipedia.org answered HTTP 429 (rate limit");
  });
});

describe("searchPapers", () => {
  const work = {
    display_name: "Polygon Mesh Processing: a survey",
    publication_year: 2021,
    cited_by_count: 412,
    abstract_inverted_index: { mesh: [1], A: [0], survey: [2] },
    primary_location: { landing_page_url: "https://arxiv.org/abs/2101.00001v2", source: { display_name: "arXiv" } },
    best_oa_location: { landing_page_url: "https://arxiv.org/abs/2101.00001v2", pdf_url: "https://arxiv.org/pdf/2101.00001v2" },
  };

  test("filters open-access works, rebuilds the abstract and puts the arXiv HTML version first", async () => {
    const seen: string[] = [];
    const [paper] = await searchPapers("mesh survey", 5, serve({ results: [work] }, 200, seen), "");
    const url = new URL(seen[0]!);
    expect(url.searchParams.get("filter")).toBe("is_oa:true,is_retracted:false");
    expect(url.searchParams.get("per-page")).toBe("5");
    expect(url.searchParams.has("api_key")).toBe(false);
    expect(paper).toEqual({
      title: "Polygon Mesh Processing: a survey",
      urls: ["https://arxiv.org/html/2101.00001v2", "https://arxiv.org/pdf/2101.00001v2", "https://arxiv.org/abs/2101.00001v2"],
      snippet: "A mesh survey",
      year: 2021,
      citations: 412,
      venue: "arXiv",
    });
  });
  test("passes the API key and drops works without a title or an address", async () => {
    const seen: string[] = [];
    const bare = { display_name: "No address", best_oa_location: null, primary_location: null };
    const journal = { ...work, primary_location: { landing_page_url: "https://doi.org/10.1/x", source: null }, best_oa_location: { landing_page_url: "https://journal.example/x", pdf_url: null } };
    const found = await searchPapers("mesh", 5, serve({ results: [bare, journal] }, 200, seen), "key123");
    expect(new URL(seen[0]!).searchParams.get("api_key")).toBe("key123");
    expect(found.map((c) => c.urls)).toEqual([["https://journal.example/x", "https://doi.org/10.1/x"]]);
    expect(found[0]!.venue).toBeUndefined();
  });
});

describe("searchWeb", () => {
  test("leaves out video, social and forum sites and returns dated candidates", async () => {
    let asked: ExaSearch | undefined;
    const client: ExaClient = {
      async search(key, req) {
        expect(key).toBe("key");
        asked = req;
        return [
          { title: "Why quads", url: "https://example.org/quads", publishedDate: "2024-02-03T10:00:00Z", author: "Kim", highlights: ["Quads deform", "cleanly."] },
          { title: "", url: "https://example.org/untitled", publishedDate: null, author: null, highlights: [] },
        ];
      },
    };
    const found = await searchWeb(client, "key", { query: "why animated meshes use quads", limit: 4, since: "2023-01-01" });
    expect(asked).toMatchObject({ query: "why animated meshes use quads", numResults: 4, startPublishedDate: "2023-01-01", highlightChars: 300 });
    expect(asked!.excludeDomains).toEqual(WEB_EXCLUDED);
    expect(found).toEqual([
      { title: "Why quads", urls: ["https://example.org/quads"], snippet: "Quads deform … cleanly.", published: "2024-02-03", author: "Kim" },
      { title: "https://example.org/untitled", urls: ["https://example.org/untitled"], snippet: "" },
    ]);
  });
});
