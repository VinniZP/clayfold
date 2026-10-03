import type { Database } from "bun:sqlite";
import type { Violation } from "../../shared/rules";
import type { PathCite } from "./content";
import { normalizeForQuote } from "./text";

/** Q6: every cite names an ok source of this topic and its quote occurs in that source's stored text. */
export function checkCites(db: Database, topicId: string, cites: PathCite[]): Violation[] {
  const out: Violation[] = [];
  const texts = new Map<string, { status: string; norm: string } | null>();
  const source = (id: string) => {
    if (!texts.has(id)) {
      const row = db
        .query<{ status: string; text: string | null }, [string, string]>("SELECT status, text FROM sources WHERE id = ? AND topic_id = ?")
        .get(id, topicId);
      texts.set(id, row ? { status: row.status, norm: normalizeForQuote(row.text ?? "") } : null);
    }
    return texts.get(id)!;
  };
  for (const { cite, path } of cites) {
    const s = source(cite.sourceId);
    if (!s) {
      out.push({ rule: "Q6", message: `source "${cite.sourceId}" is not a source of this topic; add it with source_add`, path: `${path}.sourceId` });
    } else if (s.status !== "ok") {
      out.push({ rule: "Q6", message: `source "${cite.sourceId}" failed to fetch; cite a source that source_add stored`, path: `${path}.sourceId` });
    } else if (!s.norm.includes(normalizeForQuote(cite.quote))) {
      out.push({ rule: "Q6", message: `quote not found in source "${cite.sourceId}"; copy a passage returned by source_search verbatim`, path: `${path}.quote` });
    }
  }
  return out;
}
