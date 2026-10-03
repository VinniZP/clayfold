# MISSION.md format

`MISSION.md` lives in the workspace root and grounds every lesson: what to teach next, which contexts problems use, what is out of scope. Write it in the learner's language.

```md
# Mission: {Topic}

## Why
{1–3 sentences: the concrete real-world outcome. "Keep a version history of my study projects and roll back to a working version", not "understand git".}

## Success means
- {An observable thing the learner will be able to do, with a condition: "in 5 minutes I create a repository, make a commit and roll a file back to its previous version"}
- {…at least two}

## Constraints
- {Time per week, deadline, equipment, health limits, format preferences}

## Already know
- {Prior knowledge as the learner stated it, with depth: "used GitHub Desktop, never touched the command line"}

## Interests and context
- {Domains for problem contexts (L16): work, hobbies, projects}

## Out of scope
- {Adjacent topics the learner does not want now}
```

- Write the headings in the learner's language too and keep their order. The first heading keeps the form `# <the word "Mission" in the learner's language>: <topic name>`: the server reads the topic name from the text after its colon, and the success criterion from the first bullet of the second `##` section.
- One mission per workspace; concrete over abstract; keep it under one screen.
- When the goal shifts, update the file after confirming with the learner, and add a learning record about the shift.
