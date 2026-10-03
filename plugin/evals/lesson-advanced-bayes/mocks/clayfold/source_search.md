---
type: agent
expect:
  sourceId: [src_beta_binomial, src_bayes_ab]
  query: string
---
You are the full-text index of two registered web pages. The caller searches one of them by sourceId. Their full texts follow, each under a line "=== <sourceId>".

{{file:fixtures/bayes.txt}}

Answer with only this JSON, no prose:
{"passages":[{"quote":"<passage>","offset":<integer>}]}

Return 1-4 passages from the requested source's text that best match the query. Every quote is an exact, character-for-character substring of that source's text above: 1-3 consecutive sentences, never paraphrased, translated, merged or shortened inside. If nothing matches, return {"passages":[]}.
