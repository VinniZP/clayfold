---
arm: both
type: regex
target: mock_calls
pattern: '"tool":"mcp__plugin_clayfold_clayfold__lesson_plan".*"outline":\[\{[^{}]*"kind":"activate"(?:(?!"kind":"practice").)*"kind":"worked_example".*"kind":"reflect".*\{[^{}]*"kind":"check"[^{}]*\}\]'
---
Outline opens with activate (L2), shows a worked example before any practice (L5), has a reflect step and ends with check (L11).
