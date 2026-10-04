import type { ExaClient } from "../exa";
import { FETCH_TIMEOUT_MS, USER_AGENT } from "./sources";

// Candidate sources from free catalogues, for source_discover. Nothing here is stored: Claude registers the
// candidates it chooses with source_add, which fetches and checks them like any other page.

export type Candidate = {
  title: string;
  /** Addresses to try with source_add, best first. */
  urls: string[];
  snippet: string;
  year?: number;
  citations?: number;
  venue?: string;
  /** Publication date of a web page (YYYY-MM-DD), when the search engine knows it. */
  published?: string;
  author?: string;
};

const SNIPPET_CHARS = 300;

const clip = (s: string) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= SNIPPET_CHARS ? t : `${t.slice(0, t.lastIndexOf(" ", SNIPPET_CHARS))}…`;
};

const stripTags = (html: string) =>
  html.replace(/<[^>]*>/g, "").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

async function getJson(url: string, fetchImpl: typeof fetch): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchImpl(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { "User-Agent": USER_AGENT, Accept: "application/json" } });
  } catch (e) {
    throw new Error(`${new URL(url).hostname} did not answer: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!res.ok) {
    await res.body?.cancel();
    throw new Error(`${new URL(url).hostname} answered HTTP ${res.status}${res.status === 429 ? " (rate limit; wait a minute)" : ""}`);
  }
  return res.json();
}

type WikiSearch = { pages?: { key: string; title: string; excerpt?: string | null; description?: string | null }[] };

/** Articles of one Wikipedia language edition, through the MediaWiki REST search. */
export async function searchWikipedia(query: string, language: string, limit: number, fetchImpl: typeof fetch = fetch): Promise<Candidate[]> {
  const base = `https://${language}.wikipedia.org`;
  const body = (await getJson(`${base}/w/rest.php/v1/search/page?q=${encodeURIComponent(query)}&limit=${limit}`, fetchImpl)) as WikiSearch;
  return (body.pages ?? []).map((p) => ({
    title: p.title,
    urls: [`${base}/wiki/${encodeURIComponent(p.key)}`],
    snippet: clip([p.description, p.excerpt ? stripTags(p.excerpt) : ""].filter(Boolean).join(". ")),
  }));
}

type OpenAlexWork = {
  display_name?: string | null;
  publication_year?: number | null;
  cited_by_count?: number | null;
  abstract_inverted_index?: Record<string, number[]> | null;
  primary_location?: { landing_page_url?: string | null; source?: { display_name?: string | null } | null } | null;
  best_oa_location?: { landing_page_url?: string | null; pdf_url?: string | null } | null;
};

/** OpenAlex stores an abstract as word -> positions. */
function abstractOf(index: Record<string, number[]> | null | undefined): string {
  if (!index) return "";
  const slots: string[] = [];
  for (const [word, positions] of Object.entries(index)) for (const at of positions) slots[at] = word;
  return slots.filter(Boolean).join(" ");
}

const ARXIV = /arxiv\.org\/(?:abs|pdf|html)\/([^?#\s]+?)(?:\.pdf)?(?:[?#]|$)/i;

/** Addresses of a work, best first: arXiv's HTML version (some papers have none), the open-access PDF, the landing pages. */
function workUrls(w: OpenAlexWork): string[] {
  const found = [w.best_oa_location?.pdf_url, w.best_oa_location?.landing_page_url, w.primary_location?.landing_page_url].filter((u): u is string => !!u);
  const arxiv = found.map((u) => ARXIV.exec(u)?.[1]).find(Boolean);
  const urls = arxiv ? [`https://arxiv.org/html/${arxiv}`, `https://arxiv.org/pdf/${arxiv}`, ...found] : found;
  return [...new Set(urls)];
}

const OPENALEX_FIELDS = "display_name,publication_year,cited_by_count,abstract_inverted_index,primary_location,best_oa_location";

/**
 * Open-access, non-retracted works that match the query, by OpenAlex relevance. OPENALEX_API_KEY, when set, raises
 * the daily free budget from $0.10 to $1 (about a thousand searches).
 */
export async function searchPapers(query: string, limit: number, fetchImpl: typeof fetch = fetch, apiKey = process.env.OPENALEX_API_KEY): Promise<Candidate[]> {
  const params = new URLSearchParams({ search: query, filter: "is_oa:true,is_retracted:false", "per-page": String(limit), select: OPENALEX_FIELDS });
  if (apiKey) params.set("api_key", apiKey);
  const body = (await getJson(`https://api.openalex.org/works?${params}`, fetchImpl)) as { results?: OpenAlexWork[] };
  return (body.results ?? [])
    .map((w) => ({
      title: w.display_name ?? "",
      urls: workUrls(w),
      snippet: clip(abstractOf(w.abstract_inverted_index)),
      ...(w.publication_year ? { year: w.publication_year } : {}),
      citations: w.cited_by_count ?? 0,
      ...(w.primary_location?.source?.display_name ? { venue: w.primary_location.source.display_name } : {}),
    }))
    .filter((c) => c.title && c.urls.length > 0);
}

/** Sites whose pages never make a source: video, social networks and forums (see the onboard skill). */
export const WEB_EXCLUDED = ["youtube.com", "youtu.be", "tiktok.com", "instagram.com", "facebook.com", "x.com", "twitter.com", "pinterest.com", "quora.com", "reddit.com"];

/** Web pages found by meaning through Exa, with the passages most relevant to the query as the snippet. */
export async function searchWeb(
  client: ExaClient,
  key: string,
  req: { query: string; limit: number; since?: string },
  fetchImpl: typeof fetch = fetch,
): Promise<Candidate[]> {
  const results = await client.search(
    key,
    { query: req.query, numResults: req.limit, startPublishedDate: req.since, excludeDomains: WEB_EXCLUDED, highlightChars: SNIPPET_CHARS },
    fetchImpl,
  );
  return results
    .filter((r) => r.url)
    .map((r) => ({
      title: r.title || r.url,
      urls: [r.url],
      snippet: clip(r.highlights.join(" … ")),
      ...(r.publishedDate ? { published: r.publishedDate.slice(0, 10) } : {}),
      ...(r.author ? { author: r.author } : {}),
    }));
}
