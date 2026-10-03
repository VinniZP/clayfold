---
type: llm
---
The learner chose "git restore secrets.env"; the known misconception is confusing unstaging with discarding changes in the working tree. The correct answer is "git restore --staged secrets.env".
PASS if all hold: the reply names this misconception (that plain git restore discards or rewrites the working-tree changes rather than only removing the file from the index); it does not state the correct command or which option is correct (saying that a flag or a different action is needed is a hint, not the answer); it asks the learner exactly one question, and that question ends the reply (one question offering alternatives, "A or B?", counts as one); it is in English.
FAIL if the misconception is not named, the correct command is stated, the reply asks no question or two or more separate questions, or it is not in English.
