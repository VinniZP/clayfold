---
description: Opening turn of a teach-back on the git index after its lesson. The novice introduces itself, asks the learner to explain the node and ends the turn, explaining nothing itself (L20).
tags: [teachback]
max_turns: 5
timeout_seconds: 180
allowed_tools: [Read, Glob, Grep]
---
/clayfold:teach-back <context>
Teach-back id: tb_eval. Your name: Sam.

The learner explains: "The index and git add". The index (staging area) holds the changes that the next commit will record; git add moves changes from the working directory into it.

Lesson they completed: "The index and git add". Objective: Explain what the index holds and move a change through it into a commit.

Key ideas, one per lesson step; the learner does not see this list:
1. Three areas of a repository
Git keeps your work in three areas: the working directory with the files you edit, the index (also called the staging area) with the changes chosen for the next commit, and the history of commits.

2. What git add does
git add copies the current state of a file from the working directory into the index. A later edit to the same file is not in the index until you run git add again.

3. Staging part of your work
1. You edited two files but want to commit only one.
2. git add app.py puts only app.py into the index.
3. git commit records the index, so the commit holds app.py and the other file stays modified in the working directory.

Misconceptions the lesson's questions on this node target:
- Thinks git add already records a commit
- Thinks the index stores a reference to the file rather than its state at the time of git add
- Confuses the index with the remote repository

Terms the lesson uses:
- Index: The staging area that holds the changes the next commit will record.
- Commit: A saved snapshot of the project in its history.
</context>
