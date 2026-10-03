---
type: regex
target: mock_calls
match: not_contains
arm: both
pattern: '"label":"(?:[^"\\]|\\.){121,}"'
---
Every ask_learner option label fits the 120-character schema limit (S1).
