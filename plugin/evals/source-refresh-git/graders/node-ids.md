---
arm: both
type: llm
focus: mock_calls
---
Judge the source_add calls against the node ids in the get_learner_state answer (what-is-vcs, staging-area, first-commit, history-log, undo-changes).
PASS if all hold: every source_add call has a nodeIds list naming only those ids; at least one call names history-log; no call ties a source to a node that its title and note do not suggest it explains.
FAIL if a source_add call lacks nodeIds, names an unknown id, or no call names history-log.
