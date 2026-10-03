---
arm: both
type: llm
focus: mock_calls
---
Judge only the step_submit calls. Check these rules:
- L8: every single/multi option that is not the key has a "misconception" field naming a specific error in thinking.
- L6: no worked_example line or blank asks the learner to explain why a step works.
- L13: no single-choice item has more than 4 options.
- Q5: at least 30% of all items across the steps have bloom apply, analyze, evaluate or create.
PASS if every rule holds. FAIL if any rule is broken; name the rule ID.
