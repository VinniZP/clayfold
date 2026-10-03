---
arm: both
type: llm
focus: mock_calls
---
Look only at the ask_learner call.
PASS if all hold: the question is written in English; it asks about the learner's goal (what they want to do with git or why they need it), not about prior knowledge, time or schedule; it is a single question, not several bundled together; it offers at least 3 concrete options.
FAIL if there is no ask_learner call or any condition above does not hold.
