---
arm: both
type: llm
focus: mock_calls
---
PASS if every source that a source_add call registered with ok: true is searched afterwards with at least one source_search call on its sourceId, or removed with source_remove.
FAIL if a registered source is neither searched nor removed; name it.
