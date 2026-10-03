---
name: review-session
description: Prepare a review session. Rewrite items and cards the learner's data flagged, record learning evidence, and suggest what to review next.
disable-model-invocation: true
---

Prepare the learner's next review session. Write learner-facing text in their language.

## 1. Load

Call `get_learner_state`. Read `MISSION.md`, `GLOSSARY.md`, `RESOURCES.md` and `learning-records/`.

## 2. Work the regeneration queue

Every `regenQueue` entry holds the flagged item or card in `content` and the learner signal in `reason`. Read [items.md](${CLAUDE_SKILL_DIR}/../lesson-author/items.md) before rewriting an item and [cards.md](${CLAUDE_SKILL_DIR}/../lesson-author/cards.md) before rewriting a card; both rewrites follow [step-format.md](${CLAUDE_SKILL_DIR}/../lesson-author/step-format.md) shapes and cite quotes from `source_search`.

| `reason` | Rewrite |
|---|---|
| `possible_leak` (apply+ item solved instantly) | A harder item on the same node at `apply` or `analyze`, in a new scenario, whose key cannot be read from the stem or options (Q2). |
| `dead_distractor` (an option nobody picks) | Keep stem and key; replace the dead distractors with ones built from `misconceptionsSeen` for that node or errors the sources warn about (L8). |
| `learner_report` (the learner reported an error) | `source_search` the claim behind the key. Supported: rewrite the stem or options so the misreading disappears. Contradicted: fix key, solution and feedback to match the source. |
| `leech` (card with 8+ lapses, C4) | Split it into atomic cards (C1): the most important one through `item_replace`, the others through `cards_propose`. Give each a sharper cue, or a different lens on the same fact (C2). |
| anything else | Read `content`, find which rule it breaks, and fix that. |

Submit each rewrite with `item_replace` (`queueId` plus `item` or `card`). A result with violations means fix exactly those and resubmit once. Done when every entry has a replacement submitted.

## 3. Learning records

Write a learning record per [learning-record-format.md](${CLAUDE_SKILL_DIR}/learning-record-format.md) only for evidence in `recentAttempts`, `misconceptionsSeen` and `nodes`:

- a node reached `exit_passed` or `mastered`;
- a misconception was corrected: wrong with it earlier, correct on the same idea later;
- a misconception keeps recurring (count 2 or more), as a predicted stumbling block.

Skip anything an existing record already states.

## 4. Suggest the session

End with a short message: the warm-up topics (nodes with recent errors, then the oldest finished lessons) (L15), which confusable nodes to mix in practice and which to keep in blocks (L14), and the next lesson node from the graph.
