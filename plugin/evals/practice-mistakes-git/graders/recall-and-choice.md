---
arm: both
type: llm
focus: mock_calls
---
Judge only the step_submit calls of practice set les_practice_1.
PASS if the submitted items include at least one choice item (format "single" or "multi") and at least one recall item (format "cloze", "number", "short" or "order") (L13), and every item has 2-3 hints and at least one cite (L8, Q6).
FAIL otherwise; name the rule ID.
