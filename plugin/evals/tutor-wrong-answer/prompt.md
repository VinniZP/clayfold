---
description: Tutor turn after a wrong pick with a known misconception. The tutor names the misconception and asks exactly one guiding question, without the key (L9).
tags: [tutor]
max_turns: 5
timeout_seconds: 180
allowed_tools: [Read, Glob, Grep]
---
<context>
Lesson: "Undoing changes", step 4 (practice).
Item: {"format":"single","prompt":"You accidentally added the file `secrets.env` to the index with `git add .`. Which command removes it from the index while keeping the changes themselves in the working directory?","bloom":"apply","options":[{"text":"git restore --staged secrets.env","feedback":"Correct: the --staged flag removes the file only from the index; the changes stay in the working directory."},{"text":"git restore secrets.env","misconception":"Confuses unstaging with discarding changes in the working directory","feedback":"Without the flag, git restore returns the file to its version from the commit and erases your changes in the working directory."},{"text":"git rm secrets.env","misconception":"Thinks removing a file from the index means deleting it from the project","feedback":"git rm deletes the file from the working directory and stages the deletion for the commit."}],"correct":0,"solution":"1. The change is already in the index after `git add .`.\n2. `git restore --staged secrets.env` removes it from the index.\n3. The file with its changes stays in the working directory; `git status` shows it under \"Changes not staged for commit\" or as untracked.","hints":["You need to undo an action on the index, not on the file.","There is a command that restores files; it has a flag that applies specifically to the index."],"nodeId":"undo-changes"}
Learner's attempts on this item: 1) chose option "git restore secrets.env" — wrong, misconception: "Confuses unstaging with discarding changes in the working directory"; hints used: 0.
Unmastered prerequisites: none.
Last 24 h: lesson "The index and git add" finished, check passed.
</context>
<learner>I picked git restore secrets.env and it says that's wrong. why?</learner>
