import type { Database } from "bun:sqlite";
import { db } from "./db";

/** Registrable domains that belong to one organisation. */
const ALIASES: Record<string, string> = {
  "anthropic.com": "Anthropic",
  "claude.com": "Anthropic",
  "openai.com": "OpenAI",
  "openai.github.io": "OpenAI",
  "google.com": "Google",
  "google.dev": "Google",
  "deepmind.google": "Google",
};

/** Second-level labels under a country code that are not registrable on their own (bbc.co.uk, gov.au). */
const SECOND_LEVEL = new Set(["co", "com", "org", "net", "ac", "gov", "edu", "gob", "nic", "or", "ne", "go"]);

/** Hosts where the first path segment or subdomain names the publisher. */
const SHARED_HOSTS = new Set(["github.io", "gitlab.io", "medium.com"]);

/** The organisation behind a URL: an alias name, a GitHub owner, or the registrable domain without its TLD. */
export function publisherOf(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (ALIASES[host]) return ALIASES[host];
  if (host === "github.com" || host === "gitlab.com") {
    const owner = parsed.pathname.split("/").filter(Boolean)[0];
    if (owner) return owner.toLowerCase();
  }
  const labels = host.split(".");
  const tldLen = labels.length >= 3 && labels.at(-1)!.length === 2 && SECOND_LEVEL.has(labels.at(-2)!) ? 2 : 1;
  const registrable = labels.slice(-(tldLen + 1)).join(".");
  if (ALIASES[registrable]) return ALIASES[registrable];
  const suffix = labels.slice(-2).join(".");
  if (SHARED_HOSTS.has(suffix) && labels.length >= 3) return ALIASES[labels.slice(-3).join(".")] ?? labels.at(-3)!;
  return labels.at(-(tldLen + 1)) ?? host;
}

/** All learner materials of a topic count as one publisher (Q8); the space keeps the name apart from domain labels. */
export const LEARNER_PUBLISHER = "learner materials";

export type SourceOrigin = { url: string; origin: "web" | "learner" };

export const sourcePublisher = (s: SourceOrigin): string => (s.origin === "learner" ? LEARNER_PUBLISHER : publisherOf(s.url));

/** Ok sources of the topic counted per publisher. */
export function publisherCounts(topicId: string, database: Database = db()): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const source of database.query<SourceOrigin, [string]>("SELECT url, origin FROM sources WHERE topic_id = ? AND status = 'ok'").all(topicId)) {
    const publisher = sourcePublisher(source);
    counts[publisher] = (counts[publisher] ?? 0) + 1;
  }
  return counts;
}
