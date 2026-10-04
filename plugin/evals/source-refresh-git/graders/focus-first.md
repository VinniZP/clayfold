---
arm: both
type: llm
focus: mock_calls
---
The learner asked for more on viewing history (git log and git diff); the history-log node had no source.
PASS if the first source_add call, or the first source_discover call when it precedes every source_add, is about viewing history (git log, git diff or the commit history).
FAIL otherwise.
