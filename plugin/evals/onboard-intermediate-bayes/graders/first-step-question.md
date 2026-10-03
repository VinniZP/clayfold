---
arm: both
type: llm
focus: mock_calls
---
Judge only the ask_learner call.
PASS if all hold: it is a placement question that shows a concrete task from Bayesian statistics and asks how the learner would start or what the first step is; it is not an interview question about goals, time or interests (those are already answered); the options include at least one "don't know"-style option; it is written in English.
FAIL if there is no ask_learner call or any condition above does not hold.
