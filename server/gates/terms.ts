import type { Database } from "bun:sqlite";
import { termKey, termMarks } from "../../shared/terms";
import type { Report } from "./deterministic";

export type MarkRoot = "step" | "item" | "card";

/** Fields the browser renders as Markdown, where a mark becomes a highlighted term. */
function markAllowed(root: MarkRoot, path: string[]): boolean {
  const key = path.at(-1)!;
  if (/^\d+$/.test(key)) return path.at(-2) === "hints";
  if (["body", "problem", "solution", "feedback", "front", "back"].includes(key)) return true;
  // A reflect step's own prompt renders as plain text; an item's prompt renders as Markdown.
  if (key === "prompt") return root !== "step" || path.length > 1;
  if (key === "text") return path.at(-3) === "options" || path.at(-3) === "lines";
  return false;
}

export function glossaryKeys(db: Database, topicId: string): Set<string> {
  return new Set(db.query<{ key: string }, [string]>("SELECT key FROM glossary_terms WHERE topic_id = ?").all(topicId).map((r) => r.key));
}

/** L19: every term mark names a term of the topic glossary and sits in a Markdown field; quotes stay unmarked. */
export function checkTermMarks(value: unknown, root: MarkRoot, glossary: Set<string>, r: Report, prefix = ""): void {
  r.check("L19");
  const walk = (v: unknown, path: string[]) => {
    if (typeof v === "string") {
      const marks = termMarks(v);
      if (marks.length === 0) return;
      const at = [prefix, ...path].filter(Boolean).join(".");
      if (!markAllowed(root, path)) {
        r.fail("L19", "term marks belong only in body, problem, prompt, solution, hints, feedback, option and line text, and card sides", at);
        return;
      }
      for (const m of marks) {
        if (!glossary.has(termKey(m.term))) r.fail("L19", `"${m.term}" is not in the topic glossary; add it with glossary_set or remove the mark`, at);
      }
      return;
    }
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, [...path, String(i)]));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) if (k !== "cites") walk(x, [...path, k]);
  };
  walk(value, []);
}
