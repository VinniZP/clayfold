---
arm: both
type: llm
focus: mock_calls
---
Judge only the step_submit calls of practice set les_practice_1. The learner's recorded misconceptions are "Thinks the index stores a reference to the file rather than its version" (chosen twice) and "Confuses git add with git commit" (once).
PASS if all hold: at least two items aim at the first misconception, either as a distractor whose "misconception" field names it or as a recall item whose solution names that error; no item repeats the scenario of "You ran git add notes.md and then edited notes.md again" or "After git add report.md you edited report.md again" with only the file name changed (Q7); every scenario is realistic, and fits the learner's interests (a biology term paper, Python scripts) where it has a setting (L16).
FAIL if fewer than two items aim at the first misconception, or an item restates one of those two scenarios.
