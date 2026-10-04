#!/bin/bash
set -e
cat > MISSION.md <<'MD'
# Mission: Git basics

## Why
Keep a version history of my study projects and coursework.

## Success means
- I choose which changes go into a commit and undo an accidental add to the index.
- I roll a file back to its version from a previous commit.

## Interests and context
- A biology term paper in Markdown, Python scripts.
MD
cat > RESOURCES.md <<'MD'
# Sources: Git basics

## Knowledge

- [Pro Git, 1.3 What is Git?](https://git-scm.com/book/en/v2/Getting-Started-What-is-Git%3F) — `sourceId: src_progit_basics`, book
- [Pro Git, 2.2 Recording Changes](https://git-scm.com/book/en/v2/Git-Basics-Recording-Changes-to-the-Repository) — `sourceId: src_progit_recording`, book
- [Pro Git, 2.4 Undoing Things](https://git-scm.com/book/en/v2/Git-Basics-Undoing-Things) — `sourceId: src_progit_undo`, book
- [Version control for researchers: the staging area](https://vc-course.example.edu/lessons/staging-area) — `sourceId: src_course_staging`, course
MD
printf '# Glossary: Git basics\n\n**Index** (staging area):\nThe Git area where the contents of the next commit are assembled.\n' > GLOSSARY.md
