---
arm: both
type: llm
focus: mock_calls
---
Judge the glossary_set calls. The workspace's legacy GLOSSARY.md defines "Repository"; the topic glossary in get_learner_state was empty.
PASS if all hold: a glossary_set call includes the term "Repository"; the calls, taken together, register the terms this lesson introduces about the index (for example "Staging area" or "Index"); every definition is one or two plain sentences.
FAIL if there is no glossary_set call or a condition does not hold.
