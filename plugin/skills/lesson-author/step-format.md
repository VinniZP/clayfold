# Step format

The exact shapes `lesson_plan` and `step_submit` accept, with one example of every step kind and every item format. The examples are a novice lesson on the Git staging area; quotes illustrate the shape — yours come from `source_search`. Item-writing rules are in [items.md](items.md).

## Shared fields

- `cites`: `[{ "sourceId", "quote" }]`, quote 8–600 characters, verbatim from `source_search` (Q6).
- Every item: `prompt` (markdown laid out as scenario, labelled parts, then one question; see [items.md](items.md)), `bloom` (`remember | understand | apply | analyze | evaluate | create`), `solution` (full worked solution, markdown), `hints` (2–3, nudge → near-complete step), `cites` (1–4), `nodeId`, plus its format's fields.
- Choice options: `{ "text", "misconception"?, "feedback" }`. Every distractor names its `misconception`; the key has none. `correct` is the index as authored; the server shuffles display order (Q3).
- Markdown fields take up to 6000 characters; titles 3–120.

## lesson_plan

`outline` opens with `activate`, ends with `check`, 4–16 entries (6–12 for a lesson); `nodeIds` 1–4; `sourceIds` 1–12, the sources the lesson will cite, from at least two publishers when the topic has them (Q8). The result carries the `lessonId` for every later call.

```json
{
  "plan": {
    "title": "The index: what goes into a commit",
    "objective": "Choose which changes go into the next commit using git add and git status.",
    "nodeIds": ["staging-area"],
    "level": "novice",
    "sourceIds": ["src_progit_basics", "src_progit_recording", "src_github_docs_commit"],
    "outline": [
      { "kind": "activate", "title": "What you already expect" },
      { "kind": "explain", "title": "Git's three areas" },
      { "kind": "explain", "title": "How a change gets into a commit" },
      { "kind": "worked_example", "title": "Committing one file out of two" },
      { "kind": "worked_example", "title": "Your turn: committing part of your changes" },
      { "kind": "practice", "title": "What goes into the commit" },
      { "kind": "practice", "title": "How many changes are left" },
      { "kind": "reflect", "title": "The index in your work" },
      { "kind": "check", "title": "Check without hints" }
    ]
  }
}
```

## activate (L2)

2–3 ungraded prequestions on the lesson's core targets, in any format except `short`. Each is answered by a later explain step; its feedback is what the learner reads after that segment.

```json
{
  "kind": "activate",
  "title": "What you already expect",
  "items": [
    {
      "format": "single",
      "prompt": "You edited `notes.md` and immediately ran `git commit -m \"fix\"`, with no other commands.\n\nWhat happens to your changes?",
      "bloom": "understand",
      "options": [
        { "text": "They stay out of the commit because they are not in the index", "feedback": "Correct: a commit takes only what git add has put in the index." },
        { "text": "They go into the commit because the file is already tracked", "misconception": "Thinks a commit picks up every change to tracked files on its own", "feedback": "A tracked file still has to be added to the index: a commit takes only the index." },
        { "text": "Only the version last saved in the editor goes in", "misconception": "Confuses a commit with the editor's autosave", "feedback": "The editor saves the file to disk; a change reaches a commit only through the index." }
      ],
      "correct": 0,
      "solution": "`git commit` records the contents of the index in history. The change to `notes.md` was not added with `git add`, so Git reports that there is nothing to commit.",
      "hints": ["Think about where a commit takes its contents from.", "There is an intermediate area between the working directory and the commit; what puts changes there?"],
      "cites": [{ "sourceId": "src_progit_basics", "quote": "Staged means that you have marked a modified file in its current version to go into your next commit snapshot." }],
      "nodeId": "staging-area"
    },
    {
      "format": "order",
      "prompt": "In what order does a change to a file reach the history?",
      "bloom": "remember",
      "sequence": ["Edit the file in the working directory", "Add the change to the index: git add", "Record the index: git commit"],
      "solution": "First the change appears in the working directory, then `git add` puts it in the index, then `git commit` saves the index to the repository.",
      "hints": ["Where does every change begin?", "The commit comes last; what do you need to do right before it?"],
      "cites": [{ "sourceId": "src_progit_basics", "quote": "This leads us to the three main sections of a Git project: the working tree, the staging area, and the Git directory." }],
      "nodeId": "staging-area"
    }
  ]
}
```

## explain (L3, L4)

One segment: at most 400 words of `body`, terms before the mechanism, 1–6 `cites` for its claims, then 1–3 `checks`: retrieval questions on this segment, recall formats (`cloze`, `number`, `short`) preferred. `figure` is optional; see [figures.md](figures.md).

```json
{
  "kind": "explain",
  "title": "Git's three areas",
  "body": "A project under Git has three areas.\n\n- **Working directory** — the files you see and edit.\n- **Index** (staging area) — the list of changes that will go into the next commit.\n- **Repository** — the history of saved commits.\n\nA change passes through them in order. You edit a file in the working directory, put the change in the index with `git add`, and save the contents of the index to the repository with `git commit`. So a commit holds not everything you changed, only what you put in the index.",
  "figure": {
    "kind": "mermaid",
    "code": "flowchart LR\n  W[Working directory] -->|git add| I[Index]\n  I -->|git commit| R[Repository]",
    "teaches": "The path of a change through Git's three areas and the commands that move it between them.",
    "alt": "Diagram: working directory, an arrow labelled git add to the index, an arrow labelled git commit to the repository."
  },
  "cites": [
    { "sourceId": "src_progit_basics", "quote": "Git has three main states that your files can reside in: modified, staged, and committed" },
    { "sourceId": "src_progit_basics", "quote": "The staging area is a file, generally contained in your Git directory, that stores information about what will go into your next commit." }
  ],
  "checks": [
    {
      "format": "cloze",
      "prompt": "Which command is missing?",
      "bloom": "remember",
      "text": "The {{1}} command moves a change from the working directory to the index.",
      "blanks": [["git add", "add"]],
      "solution": "`git add` puts the current version of a change in the index; `git commit` then saves the index.",
      "hints": ["It is the first of the two commands in the diagram.", "The command is git followed by a verb meaning \"include\"."],
      "cites": [{ "sourceId": "src_progit_basics", "quote": "Staged means that you have marked a modified file in its current version to go into your next commit snapshot." }],
      "nodeId": "staging-area"
    }
  ]
}
```

## worked_example (L5, L6)

A problem and 2–12 solution `lines`. A full example has no blanks. A faded example gives some lines a `blank` with 1–6 accepted `answers`: the learner answers it before the line's `text` appears; fade the last steps first. Novice examples carry no "explain why" prompts (L6).

```json
{
  "kind": "worked_example",
  "title": "Your turn: committing part of your changes",
  "problem": "You edited two files: `README.md` and `app.js`. Only `README.md` should go into the commit.",
  "lines": [
    { "text": "Check the state: `git status` lists both files under \"Changes not staged for commit\"." },
    { "text": "Put only the file you need in the index: `git add README.md`.", "blank": { "prompt": "Which command puts only README.md in the index?", "answers": ["git add README.md", "git add ./README.md"] } },
    { "text": "Record the index: `git commit -m \"Update README\"`. The file `app.js` stays modified and does not go into the commit.", "blank": { "prompt": "Which command saves the index to history with the message \"Update README\"?", "answers": ["git commit -m \"Update README\"", "git commit -m 'Update README'"] } }
  ],
  "cites": [{ "sourceId": "src_progit_basics", "quote": "Staged means that you have marked a modified file in its current version to go into your next commit snapshot." }]
}
```

## practice

Exactly one `item`. The six item formats follow, each as a practice step.

`single`: 3 options, at most 4 (L13); one key.

```json
{
  "kind": "practice",
  "title": "What goes into the commit",
  "item": {
    "format": "single",
    "prompt": "You are writing your thesis: you edit `chapter2.md` and `bibliography.bib` but want to commit only the chapter. You ran `git add chapter2.md`.\n\nWhat ends up in the commit after `git commit`?",
    "bloom": "apply",
    "options": [
      { "text": "Only the changes in chapter2.md", "feedback": "Correct: only chapter2.md is in the index, and that is what the commit saves." },
      { "text": "The changes in both edited files", "misconception": "Thinks a commit takes all changes in the working directory rather than the index", "feedback": "bibliography.bib was not added to the index, so it does not go into the commit." },
      { "text": "Nothing until git push is run", "misconception": "Confuses a local commit with sending it to a server", "feedback": "A commit is saved locally at once; git push only sends it to the server." }
    ],
    "correct": 0,
    "solution": "1. `git add chapter2.md` puts only the chapter in the index.\n2. `git commit` saves the contents of the index.\n3. The changes in `bibliography.bib` stay in the working directory.",
    "hints": ["What is in the index right now?", "A commit saves exactly the contents of the index; which file was added there?"],
    "cites": [{ "sourceId": "src_progit_basics", "quote": "The staging area is a file, generally contained in your Git directory, that stores information about what will go into your next commit." }],
    "nodeId": "staging-area"
  }
}
```

`multi`: 3–5 options, 1–4 keys in `correct`.

```json
{
  "kind": "practice",
  "title": "Which files are in the index",
  "item": {
    "format": "multi",
    "prompt": "`git status` prints:\n\n```\nChanges to be committed:\n  modified: index.html\n  new file: style.css\nChanges not staged for commit:\n  modified: scripts/app.js\n```\n\nSelect all that apply: which files will go into the next commit?",
    "bloom": "analyze",
    "options": [
      { "text": "index.html", "feedback": "Yes: it is under \"Changes to be committed\", that is, in the index." },
      { "text": "style.css", "feedback": "Yes: the new file is already added to the index." },
      { "text": "scripts/app.js", "misconception": "Thinks any modified file will go into the commit", "feedback": "scripts/app.js is under \"not staged\": it has changes, but they were not added to the index." }
    ],
    "correct": [0, 1],
    "solution": "The commit takes the \"Changes to be committed\" section: `index.html` and `style.css`. The \"Changes not staged for commit\" section shows changes outside the index: `scripts/app.js` will not go in.",
    "hints": ["Which section of the output describes the index?", "\"to be committed\" means it is already in the index."],
    "cites": [{ "sourceId": "src_progit_recording", "quote": "You can tell that it’s staged because it’s under the “Changes to be committed” heading." }],
    "nodeId": "staging-area"
  }
}
```

`order`: 3–7 entries in the correct `sequence`; the server shuffles them. See the activate example above.

`cloze`: blanks `{{1}}`, `{{2}}`… (at most 4) in `text`; `blanks` lists 1–6 accepted answers per blank in order. See the explain check above.

`number`: `answer`, `tolerance` (0 for exact), optional `unit`.

```json
{
  "kind": "practice",
  "title": "How many changes are left",
  "item": {
    "format": "number",
    "prompt": "Four files are modified in the working directory. You ran `git add a.txt b.txt`, then `git commit -m \"wip\"`.\n\nHow many modified files will remain under \"Changes not staged for commit\"?",
    "bloom": "apply",
    "answer": 2,
    "tolerance": 0,
    "unit": "files",
    "solution": "2 of the 4 files went into the index, and the commit saved them. The other 2 modified files are still outside the index.",
    "hints": ["How many files went into the index?", "A commit takes only files from the index: 4 minus the ones you added."],
    "cites": [{ "sourceId": "src_progit_basics", "quote": "Staged means that you have marked a modified file in its current version to go into your next commit snapshot." }],
    "nodeId": "staging-area"
  }
}
```

`short`: free text graded by a model against `referenceAnswer` and `rubric` (1–5 criteria a correct answer meets).

```json
{
  "kind": "practice",
  "title": "Why the index matters",
  "item": {
    "format": "short",
    "prompt": "A colleague has two unrelated edits in one folder:\n\n- **A.** a typo fixed in `README.md`, the edit is ready;\n- **B.** a script `analysis.py` started, it does not work yet.\n\nHe says: \"The index is an extra step; it is simpler to commit everything at once.\" Answer in 1–2 sentences: how does the index help him in this situation?",
    "bloom": "evaluate",
    "referenceAnswer": "The index lets him put only the finished edit A in the commit and leave the unfinished script B in the working directory, so the commit describes one edit.",
    "rubric": ["Says that a commit takes the contents of the index, not the whole working directory", "Applies this to the situation: commit A without B"],
    "solution": "The index separates \"what has changed\" from \"what we save now\". The colleague puts only `README.md` (A) in the index and commits it; `analysis.py` (B) stays modified and goes into a separate commit once it works.",
    "hints": ["What would happen if a commit always took every change in the folder?", "Which of the two edits can be saved to history right now?"],
    "cites": [{ "sourceId": "src_progit_basics", "quote": "The staging area is a file, generally contained in your Git directory, that stores information about what will go into your next commit." }],
    "nodeId": "staging-area"
  }
}
```

## reflect

`prompt` 10–500 characters; `purpose` is `why` (explain a key idea from the text), `connect` (link to the learner's goal or prior knowledge) or `confidence` (rate and justify certainty). Not graded.

```json
{
  "kind": "reflect",
  "title": "The index in your work",
  "prompt": "Think back to your last working day on a project. Which changes would you put in one commit and which in a separate one, and why?",
  "purpose": "connect"
}
```

Body practice: the learner does the movement and reports.

```json
{
  "kind": "reflect",
  "title": "Try it and describe it",
  "prompt": "Do the knees-to-chest stretch twice for 20–30 seconds. Where did you feel the stretch, and was anything uncomfortable? If sharp pain appears, stop.",
  "purpose": "confidence"
}
```

## check (L11)

2–6 items, answered unaided: the UI hides hints and the tutor during the check, yet every item still carries its 2–3 `hints` for later review. Cover the objective, mix recall and choice formats, include at least one `apply`+ item, and keep them distinct from the practice items (Q7).

```json
{
  "kind": "check",
  "title": "Check without hints",
  "items": [
    {
      "format": "single",
      "prompt": "After `git add report.md` you edited `report.md` again and ran `git commit`.\n\nWhich version of the file is saved in the commit?",
      "bloom": "apply",
      "options": [
        { "text": "The version from when git add was run", "feedback": "Correct: git add puts the current version in the index; later edits stay outside the index." },
        { "text": "The version after the last edit to the file", "misconception": "Thinks the index stores a reference to the file rather than its version", "feedback": "The index stores the version from the moment of git add; a new edit has to be added again." },
        { "text": "Both versions in one combined commit", "misconception": "Thinks a commit merges all versions of a file", "feedback": "A commit stores one version of the file: the one in the index." }
      ],
      "correct": 0,
      "solution": "`git add` puts the version of the file at the time of the call into the index. A later edit stays in the working directory until it is added again.",
      "hints": ["What exactly does git add put in the index: the file or its current version?", "What happens to an edit made after git add?"],
      "cites": [{ "sourceId": "src_progit_recording", "quote": "It turns out that Git stages a file exactly as it is when you run the git add command." }],
      "nodeId": "staging-area"
    },
    {
      "format": "cloze",
      "prompt": "Which two areas are missing?",
      "bloom": "remember",
      "text": "Git's three areas: working directory, {{1}} and {{2}}.",
      "blanks": [["index", "staging area"], ["repository", "git directory"]],
      "solution": "Working directory, index (staging area) and repository (Git directory).",
      "hints": ["Recall the diagram from the lesson.", "The middle area assembles the next commit; the last one stores the history."],
      "cites": [{ "sourceId": "src_progit_basics", "quote": "This leads us to the three main sections of a Git project: the working tree, the staging area, and the Git directory." }],
      "nodeId": "staging-area"
    }
  ]
}
```
