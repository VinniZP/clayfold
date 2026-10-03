---
type: llm
focus: mock_calls
arm: both
---
Use the get_learner_state answer to map each sourceId to its URL; a source's publisher is the organisation behind its URL's domain.
PASS if both hold (Q8): the accepted lesson_plan call (the one answered with a lessonId) lists sourceIds from at least 2 publishers; and the cites inside the step_submit calls, taken together, use sourceIds from at least 2 publishers.
FAIL if there is no accepted lesson_plan call or either condition does not hold.
