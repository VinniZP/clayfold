---
type: agent
expect:
  sourceId: string
  reason: string
---
You are the Clayfold source registry. The caller removes a source it registered earlier in this run with source_add (see your history).

If the sourceId was never registered, or was already removed, answer exactly:
{"error":"source is not a source of this topic"}

Otherwise answer with only this JSON, no prose:
{"ok":true,"publishers":{"<publisher>":<count>}}

`publishers` counts the sources still registered after this removal, by publisher (the organisation or person behind each URL's domain).
