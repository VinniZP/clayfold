---
name: lesson-author
description: Author one lesson for a graph node, step by step through the platform's quality gates, then propose flashcards.
argument-hint: "<nodeId|next>"
disable-model-invocation: true
---

Author one lesson for node `$ARGUMENTS`. The learner does not watch you write; they see each step once the server's gates publish it, starting while you write the next one. Write all learner-facing text in the learner's language; quotes in `cites` stay verbatim in the source's language.

## 1. Load the learner

Read `MISSION.md`, `NOTES.md`, `GLOSSARY.md`, `RESOURCES.md` and every file in `learning-records/` (missing files are fine). Call `get_learner_state`.

## 2. Choose the node and level

- **Node**: the given nodeId; for `next`, the earliest node with mastery `new` or `learning`, placement not `known`, and no `unmasteredPrereqs` other than nodes placed `known` (zone of proximal development). A lesson covers this node, plus at most one tightly coupled neighbour. A requested node with unmastered prerequisites gets a short refresher on them in its first explain step.
- **Level** (L5), first match wins, evidence before placement: `advanced` when learning records or recent attempts show them solving this node's problems unaided (correct, no hints); `intermediate` for placement `partial` on this node, or attempts on it that succeed only with hints; `novice` otherwise, including a new node whose prerequisites are mastered. Misconceptions in `misconceptionsSeen` for this node become distractors and worked-example targets.

## 3. Gather evidence

`get_learner_state.sources` lists the topic's sources with their ids; `RESOURCES.md` says what each covers and who publishes it. Choose the sources that cover this node, from at least two publishers when the topic has more than one (Q8); they become `plan.sourceIds`. Where sources disagree or name the same idea differently, the lesson says so and cites both.

Call `source_search` for every fact, key, solution step and card answer you will write, and copy the returned `quote` text exactly into `cites` (Q6); the server checks each quote against the page. Trim a quote only at its ends, keep 8–600 characters, and change nothing inside it. When the sources lack something the lesson needs, find a page with WebSearch, register it with `source_add`, append it to `RESOURCES.md`, and search it. WebFetch output and your own memory are paraphrase; they never become a quote.

## 4. Plan

Read [step-format.md](${CLAUDE_SKILL_DIR}/step-format.md) and [items.md](${CLAUDE_SKILL_DIR}/items.md) now. Then call `lesson_plan` with 6–12 steps; the outline is fixed once planned.

Spread cites across the planned publishers over the steps: the gate rejects the check step when the whole lesson cites one publisher (Q8). Object arguments (`plan`, `step`, `cards`, `item`, `card`) go into every call as JSON objects, shaped as in step-format.md.

| Level | Outline |
|---|---|
| novice | activate → explain (terms and parts, L3) → explain (mechanism) → worked_example (full) → worked_example (faded) → practice ×2–3 → reflect → check |
| intermediate | activate → explain → worked_example (faded) → practice ×2–3 → reflect → check |
| advanced | activate → practice ×2 (problems first) → explain (only what the problems exposed) → practice → reflect → check |

Every outline opens with `activate` (L2) and ends with `check` (L11), has at least one `reflect`, and at least 30% of all its items are `apply` or higher (Q5; aim for 40%). Each explain segment stays within 400 words (L4); split a longer idea into two segments. Problem contexts come from the learner's interests in `MISSION.md`, with the logic unchanged and the scenario realistic (L16).

**Body practice** (stretching, posture, exercise, instruments): the worked example is the movement as numbered lines (start position, movement, hold, breath, form cues), with a faded line for a cue they recall. A `reflect` step is where they do the movement and report what they noticed (purpose `confidence` or `connect`). Items test what has a sourced right answer: form errors, safety signals, order of the steps, dosage, what to change in a scenario. A sensation the learner should feel is a self-report, never an item key. One explain segment covers when to stop and see a professional.

## 5. Submit the steps

Call `step_submit` for each index in outline order (0-based), one step per call. An explain or worked_example step whose content is a process, a structure or a set of quantities gets a figure; read [figures.md](${CLAUDE_SKILL_DIR}/figures.md) before writing the first one. Other steps go without.

The result decides the next move:

- `published` → next index.
- `rejected` → each violation names a rule ID, a message and a `path` into your step. Fix exactly those, keep the rest of the step, and resubmit the same index.
- `dropped` (third rejection) → move on to the next index.
- `MCP error -32602` → the step broke the schema; fix the field it names and resubmit.

A result can also announce sources added after planning; cite the relevant ones in the remaining steps.

Done when every index has a `published` or `dropped` result.

## 6. Cards

Read [cards.md](${CLAUDE_SKILL_DIR}/cards.md), then call `cards_propose` with the `lessonId` and 3–8 cards. Resubmit each rejected card once, fixed per its violations.

## 7. Finish

1. `lesson_finish` with a summary in the learner's language: what the lesson built and what comes next.
2. Add the lesson's new terms to `GLOSSARY.md` in the format of [glossary-format.md](${CLAUDE_SKILL_DIR}/glossary-format.md), so later lessons use the same words.
3. End with a short message: the lesson title, steps published and dropped, cards proposed.

Authoring a lesson is not evidence of learning: learning records come from the learner's attempts, which review sessions and the tutor handle.
