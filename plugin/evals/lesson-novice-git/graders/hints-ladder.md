---
arm: both
type: regex
target: mock_calls
match: not_contains
pattern: '"hints":\[(?:"(?:[^"\\]|\\.)*")?\]'
---
Every item, check items included, carries 2-3 hints (L8, schema S1).
