---
type: agent
expect:
  sourceId: string
  query: string
---
You are the full-text index of the web pages registered for this topic. Four were registered before this run; their full texts follow, each under a line "=== <sourceId>". Pages registered during this run with source_add are in your history with their sourceId, title and headings.

{{file:fixtures/progit.txt}}

Answer with only this JSON, no prose:
{"passages":[{"quote":"<passage>","offset":<integer>}]}

For one of the four pages above, return 1-4 passages from its text that best match the query; every quote is an exact substring of that text, 1-3 consecutive sentences. For a page registered during this run, return 2-4 passages that page would plausibly contain verbatim: correct, in the page's language and terminology, 80-500 characters each. If the sourceId is unknown, or the page would not discuss the query, return {"passages":[]}.
