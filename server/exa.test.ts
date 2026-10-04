import { describe, expect, test } from "bun:test";
import { exa, ExaError } from "./exa";

function serve(status: number, body: unknown, seen: { url?: string; init?: RequestInit } = {}): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    seen.url = String(url);
    seen.init = init;
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

describe("exa.search", () => {
  test("sends the key in a header and asks for highlights only when wanted", async () => {
    const seen: { url?: string; init?: RequestInit } = {};
    const results = await exa.search(
      "exa-key-123",
      { query: "a beginner's guide to edge loops", numResults: 3, startPublishedDate: "2023-01-01", excludeDomains: ["youtube.com"], highlightChars: 300 },
      serve(200, { results: [{ title: "Edge loops", url: "https://example.org/loops", publishedDate: "2024-05-02T00:00:00.000Z", author: "A. Artist", highlights: ["An edge loop is…"] }] }, seen),
    );
    expect(seen.url).toBe("https://api.exa.ai/search");
    expect(new Headers(seen.init?.headers).get("x-api-key")).toBe("exa-key-123");
    expect(JSON.parse(String(seen.init?.body))).toEqual({
      query: "a beginner's guide to edge loops",
      type: "auto",
      numResults: 3,
      startPublishedDate: "2023-01-01",
      excludeDomains: ["youtube.com"],
      contents: { highlights: { maxCharacters: 300 } },
    });
    expect(results).toEqual([{ title: "Edge loops", url: "https://example.org/loops", publishedDate: "2024-05-02T00:00:00.000Z", author: "A. Artist", highlights: ["An edge loop is…"] }]);

    await exa.search("k", { query: "q", numResults: 1 }, serve(200, { results: [] }, seen));
    expect(JSON.parse(String(seen.init?.body))).toEqual({ query: "q", type: "auto", numResults: 1 });
  });

  test("an error carries Exa's message and the status", async () => {
    const err = await exa.search("bad", { query: "q", numResults: 1 }, serve(401, { requestId: "r", error: "Invalid API key", tag: "x" })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ExaError);
    expect(err).toMatchObject({ message: "Invalid API key", status: 401 });
    const other = await exa.search("k", { query: "q", numResults: 1 }, serve(500, "oops")).catch((e: unknown) => e);
    expect(other).toMatchObject({ message: "HTTP 500", status: 500 });
  });
});
