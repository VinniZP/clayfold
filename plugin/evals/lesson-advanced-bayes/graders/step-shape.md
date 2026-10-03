---
arm: both
type: regex
target: mock_calls
match: not_contains
pattern: '"step":"|"(?:items|checks)":\["|"item":"'
---
Steps, items and checks are submitted as objects, not strings or ids (S1); the real server rejects these with -32602.
