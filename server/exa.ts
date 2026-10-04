// Exa web search (https://exa.ai/docs/reference/search): finds pages by meaning, not only by words.
// Used only by the server, with the key from the OS credential store; Claude never sees the key.

const API = "https://api.exa.ai";

export class ExaError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export type ExaResult = { title: string; url: string; publishedDate: string | null; author: string | null; highlights: string[] };

export type ExaSearch = {
  query: string;
  numResults: number;
  /** ISO date: only pages published on or after it. */
  startPublishedDate?: string;
  excludeDomains?: string[];
  /** Up to this many characters of the passages most relevant to the query. */
  highlightChars?: number;
};

export type ExaClient = {
  search(key: string, req: ExaSearch, fetchImpl?: typeof fetch): Promise<ExaResult[]>;
};

type SearchResponse = { results?: { title?: string | null; url: string; publishedDate?: string | null; author?: string | null; highlights?: string[] | null }[] };

async function call<T>(key: string, path: string, body: unknown, fetchImpl: typeof fetch): Promise<T> {
  let res: Response;
  try {
    res = await fetchImpl(`${API}${path}`, {
      method: "POST",
      signal: AbortSignal.timeout(30_000),
      headers: { "x-api-key": key, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new ExaError(e instanceof Error ? e.message : String(e), 502);
  }
  if (!res.ok) {
    const text = await res.text();
    let message = `HTTP ${res.status}`;
    try {
      const error = (JSON.parse(text) as { error?: unknown }).error;
      if (typeof error === "string" && error) message = error;
    } catch {}
    throw new ExaError(message, res.status);
  }
  return (await res.json()) as T;
}

export const exa: ExaClient = {
  async search(key, req, fetchImpl = fetch) {
    const body = {
      query: req.query,
      type: "auto",
      numResults: req.numResults,
      ...(req.startPublishedDate ? { startPublishedDate: req.startPublishedDate } : {}),
      ...(req.excludeDomains?.length ? { excludeDomains: req.excludeDomains } : {}),
      ...(req.highlightChars ? { contents: { highlights: { maxCharacters: req.highlightChars } } } : {}),
    };
    const res = await call<SearchResponse>(key, "/search", body, fetchImpl);
    return (res.results ?? []).map((r) => ({
      title: r.title ?? "",
      url: r.url,
      publishedDate: r.publishedDate ?? null,
      author: r.author ?? null,
      highlights: r.highlights ?? [],
    }));
  },
};
