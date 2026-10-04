---
name: practice-set
description: Write a short practice set of fresh items on nodes the learner asked to practise, item by item through the platform's quality gates.
argument-hint: "<lessonId>"
disable-model-invocation: true
---

Write practice set `$ARGUMENTS`: fresh practice items on graph nodes the learner has already met. The learner has the set open and sees each item once the server's gates publish it, starting while you write the next. Write all learner-facing text in the learner's language; quotes in `cites` stay verbatim in the source's language.

## 1. Load the brief

Call `practice_brief` with the lessonId. It fixes the set: `size` items (outline indices 0..size-1), the `focus`, the learner's `level`, the `nodes`, the `seed` item the learner asked for more of (or null), the misconceptions they chose (`targets`), the items they missed (`missed`), and `existingPrompts`. Then call `get_learner_state` with the brief's node ids: its `sources` are what you cite and its `glossary` the terms you use. Read `MISSION.md` for the learner's interests and `RESOURCES.md` for what each source covers.

## 2. Plan every item

Read [items.md](${CLAUDE_SKILL_DIR}/../lesson-author/items.md) and the item formats in [step-format.md](${CLAUDE_SKILL_DIR}/../lesson-author/step-format.md). Plan all `size` items before writing the first, so the set as a whole meets these:

- **Fresh** (Q7): each item tests a scenario of its own, absent from `existingPrompts` and from the `seed`: another situation, not new numbers or names in an old one. With a `seed`, every item exercises the seed's skill on its node.
- **Mixed** (L13): recall (`cloze`, `number`, `short`, `order`) and choice (`single`, `multi`) items, at least one of each. The gate checks the mix at the last index.
- **The learner's world** (L16): scenarios from the interests in `MISSION.md`, realistic, the logic unchanged. With several nodes, spread the items across them.
- **Focus**:

| `focus` | The items |
|---|---|
| `same` | The difficulty of the learner's lessons on these nodes; at least 30% `apply` or higher across the set (Q5, checked at the last index). |
| `harder` | Every item `apply` or higher (the gate checks each): multi-step cases, transfer to an unfamiliar setting, diagnosing a faulty result. |
| `mistakes` | Each item aims at one entry of `targets`, the most frequent first, no target taking more than half the set. A choice item carries that misconception as a distractor, its `misconception` field naming it; a recall item is a case where that error leads to a wrong answer, and its solution names the error. `missed` shows where each error arose: test the same idea in a new scenario. |

## 3. Gather evidence

Call `source_search` for every key, solution step and factual feedback line, and copy the returned `quote` exactly into `cites` (Q6). Search the sources `RESOURCES.md` lists for these nodes; WebFetch output and your own memory are paraphrase and never become a quote.

## 4. Submit the items

Call `step_submit` for each index in order, one item per call: `{ "kind": "practice", "title": "...", "item": { ... } }`, the item's `nodeId` one of the brief's nodes. The title names the scenario in 3–8 words and leaves the answer out.

Mark each glossary term at its first use in an item as `[[surface|Term]]` in `prompt`, `solution`, `hints`, `feedback` and option `text`, using terms from `glossary` only; titles, keys, cloze text and blanks, order entries and quotes stay unmarked.

The result decides the next move:

- `published` → next index.
- `rejected` → fix exactly the listed violations (rule ID, message, `path`), keep the rest of the item, and resubmit the same index.
- `dropped` (third rejection) → next index.
- `MCP error -32602` → the step broke the schema; fix the field it names and resubmit.

Done when every index has a `published` or `dropped` result.

## 5. Finish

1. `lesson_finish` with the lessonId and a summary of 1–3 sentences in the learner's language: what the set practised, and for `mistakes` the error it worked on.
2. End with a short message: items published and dropped.
