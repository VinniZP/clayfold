---
arm: both
type: llm
focus: mock_calls
---
Judge only the step_submit calls and the items inside them (activate, explain checks, practice, check).
PASS if all hold: no item's correct answer is a sensation or feeling the learner is supposed to have (for example "a gentle stretch in the lower back" as the key of "what do you feel", or an action whose key is "until it feels gentle"); items instead test form, order of steps, hold time or repetitions, safety signals, or what to change in a scenario; at least one reflect step asks the learner to perform the stretch and report what they noticed.
A sensation described in a scenario, or sorted into the response it calls for (carry on, stop and see a professional, get urgent help), is a safety-signal item: its key is the response, and it does not break the rule.
FAIL if any item keys on a sensation the learner should feel, or no reflect step asks them to perform and report.
