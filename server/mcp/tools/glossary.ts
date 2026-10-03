import { termKey } from "../../../shared/terms";
import { defineTool } from "../context";

export const glossarySet = defineTool({
  name: "glossary_set",
  description: `Add or update terms of the topic glossary, the one source of the words lessons, cards and the tutor use. A term is upserted by its name, ignoring case; terms you leave out stay.
term: the word the learner's language uses for the concept, as practitioners say it (the English word when they say it in English). definition: what it is, in one or two sentences, in the learner's language. original: the field's original term when it differs from term. avoid: words not to use for this concept.
Text marks a glossary term as [[surface|Term]] (the word as it stands in the sentence, then the term) or [[Term]]; the step gate rejects a mark whose term is missing here, so register terms before the steps that mark them. Returns {ok, total}.`,
  handler(ctx, { terms }) {
    const upsert = ctx.db.query(
      `INSERT INTO glossary_terms (topic_id, key, term, definition, original, avoid, updated_at) VALUES (?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
       ON CONFLICT (topic_id, key) DO UPDATE SET term = excluded.term, definition = excluded.definition, original = excluded.original, avoid = excluded.avoid, updated_at = excluded.updated_at`,
    );
    ctx.db.transaction(() => {
      for (const t of terms) upsert.run(ctx.topicId, termKey(t.term), t.term.trim(), t.definition, t.original ?? null, JSON.stringify(t.avoid ?? []));
    })();
    const total = ctx.db.query<{ n: number }, [string]>("SELECT count(*) AS n FROM glossary_terms WHERE topic_id = ?").get(ctx.topicId)!.n;
    return { result: { ok: true, total } };
  },
});
