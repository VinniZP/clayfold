#!/bin/bash
set -e
cat > MISSION.md <<'MD'
# Mission: Git basics

## Why
Keep a version history of my study projects and coursework, so I can roll back to a working version instead of keeping "final_v3" copies.

## Success means
- In 5 minutes I create a repository, make a meaningful commit and view the history.
- I choose which changes go into a commit and undo an accidental add to the index.
- I roll a file back to its version from a previous commit.

## Constraints
- 2–3 hours a week, in the evenings.
- I work in the macOS terminal; no GUI clients needed.

## Already know
- Used Google Docs with version history; command line at the level of cd and ls.

## Interests and context
- A biology term paper in Markdown, Python scripts for processing experiment data.

## Out of scope
- Branches and collaboration through GitHub — later.
MD
cat > NOTES.md <<'MD'
# Notes
- Prefers an informal tone.
- Likes short examples with terminal commands.
MD
cat > RESOURCES.md <<'MD'
# Sources: Git basics

## Knowledge

- [Pro Git, 1.3 What is Git?](https://git-scm.com/book/en/v2/Getting-Started-What-is-Git%3F) — `sourceId: src_progit_basics`, book · vendor-official · git-scm.com
  The three file states and the three areas of a project. For nodes: what-is-vcs, staging-area.
- [Pro Git, 2.2 Recording Changes to the Repository](https://git-scm.com/book/en/v2/Git-Basics-Recording-Changes-to-the-Repository) — `sourceId: src_progit_recording`, book · vendor-official · git-scm.com
  git status, git add, git commit, tracked files. For nodes: staging-area, first-commit.
- [Pro Git, 2.4 Undoing Things](https://git-scm.com/book/en/v2/Git-Basics-Undoing-Things) — `sourceId: src_progit_undo`, book · vendor-official · git-scm.com
  git restore, git commit --amend. For nodes: undo-changes.
- [Version control for researchers: the staging area](https://vc-course.example.edu/lessons/staging-area) — `sourceId: src_course_staging`, course · course · vc-course.example.edu
  The index as a draft of the commit, a common beginner mistake. For nodes: staging-area.
MD
cat > GLOSSARY.md <<'MD'
# Glossary: Git basics

Terms of the Git basics course.

**Repository**:
The project directory together with the commit history that Git stores.
_Avoid_: repo, storage
MD
