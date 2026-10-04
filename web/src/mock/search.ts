import { SEARCH_KINDS, SEARCH_PER_KIND, type SearchHit, type SearchResults } from "@shared/api";
import type { PublicStep } from "@shared/schemas";
import { foldForSearch, hitSnippet, markText, markWords, plainText, queryWords } from "@shared/search";
import { stripTermMarks, termKey } from "@shared/terms";
import * as fx from "./fixtures";

// Stand-in for GET /api/search over the fixtures: the entries, folding and marks of server/search.ts, ranked by
// title matches first instead of bm25.

type Doc = Omit<SearchHit, "title" | "snippet"> & { title: string; body: string };

const LESSON_STEPS: Record<string, (PublicStep | null)[]> = { "l-bayes": fx.bayesSteps, "l-cond": fx.condSteps };

function stepText(step: PublicStep): string | null {
  if (step.kind === "explain") return plainText(step.body);
  if (step.kind === "worked_example") return [step.problem, ...step.lines.flatMap((l) => (l.text === undefined ? [] : [l.text]))].map(plainText).join(" ");
  return null;
}

function docs(): Doc[] {
  const out: Doc[] = [];
  const lessons = Object.values(fx.topicDetails).flatMap((d) => d.lessons.map((l) => ({ ...l, topic: d.topic })));
  const topicOf = (id: string) => fx.topicDetails[id]!.topic;
  const base = (topicId: string, lessonId: string | null = null) => {
    const topic = topicOf(topicId);
    return { topicId, topicTitle: topic.title, topicKind: topic.kind, lessonId, lessonTitle: lessons.find((l) => l.id === lessonId)?.title ?? null, stepIdx: null };
  };
  for (const { topic } of Object.values(fx.topicDetails)) out.push({ ...base(topic.id), kind: "topic", id: topic.id, title: topic.title, body: "" });
  for (const l of lessons) if (l.supersededBy === null) out.push({ ...base(l.topicId, l.id), kind: "lesson", id: l.id, title: l.title, body: l.objective });
  for (const [lessonId, steps] of Object.entries(LESSON_STEPS)) {
    const lesson = lessons.find((l) => l.id === lessonId)!;
    if (lesson.supersededBy !== null) continue;
    const topicId = lesson.topicId;
    for (const step of steps) {
      const body = step && stepText(step);
      if (step && body !== null) out.push({ ...base(topicId, lessonId), kind: "step", id: step.id, stepIdx: step.idx, title: step.title, body });
    }
  }
  for (const g of fx.glossary) out.push({ ...base(g.topicId), kind: "term", id: termKey(g.term), title: g.original ? `${g.term} (${g.original})` : g.term, body: g.definition });
  for (const n of fx.notes) {
    const stepIdx = LESSON_STEPS[n.lessonId ?? ""]?.find((st) => st?.id === n.stepId)?.idx ?? null;
    out.push({ ...base(n.topicId, n.lessonId ?? null), kind: "note", id: n.id, stepIdx, title: n.text, body: n.quote ?? "" });
  }
  for (const c of fx.cards) {
    if (c.status === "active" || c.status === "suspended") out.push({ ...base(c.topicId), kind: "card", id: c.id, title: stripTermMarks(c.front), body: "" });
  }
  return out;
}

export function mockSearch(query: string): SearchResults {
  const { all, long } = queryWords(query);
  if (!all.length) return { query, hits: [] };
  const words = markWords(query);
  const scored = docs().flatMap((d) => {
    const title = foldForSearch(d.title);
    const text = `${title} ${foldForSearch(d.body)}`;
    if (long.length) return long.every((w) => text.includes(w)) ? [{ d, score: long.filter((w) => title.includes(w)).length }] : [];
    const at = title.indexOf(all.join(" "));
    return at === -1 ? [] : [{ d, score: -at }];
  });
  scored.sort((a, b) => b.score - a.score);
  const hits = SEARCH_KINDS.flatMap((kind) =>
    scored
      .filter(({ d }) => d.kind === kind)
      .slice(0, SEARCH_PER_KIND)
      .map(({ d: { title, body, ...rest } }): SearchHit => ({ ...rest, title: markText(title, words), snippet: hitSnippet(rest.kind, body, words) })),
  );
  return { query, hits };
}
