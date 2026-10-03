# Cards

Flashcards for spaced review (FSRS). The learner accepts, edits or suspends each one, so a card that fails these rules costs their trust as well as their time.

## One card (C1)

A card holds one fact, its front makes sense months later without the lesson, and it has one answer. Andy Matuschak's five properties make that concrete:

- **Focused**: one detail per card. The back is a single term, value, command or short clause; a second clause after ";" is a second card. A front whose answer has several items ("which three…") becomes one cloze card per item ("working directory, ____, repository"), and a front about two things ("how do X and Y change") becomes two cards.
- **Precise**: the front says exactly what kind of answer it wants ("which command…", "how many times…").
- **Consistent**: the same answer every time. Fronts are open questions ("what", "which", "why") or a cloze; a front answerable with yes/no is rewritten into one, as is "what do you think about…".
- **Tractable**: answerable correctly almost every time once learned; add a cue to the front if the answer is a coin flip.
- **Effortful**: the answer is retrieved, not read off or guessed from the front.

- `kind: "basic"`: question on the front, answer on the back in a few words.
- `kind: "cloze"`: the front contains exactly one `____`; the back is the missing text.
- `cites`: 1–2 verbatim quotes from `source_search` that support the back (Q6). `nodeId` is the node the card reinforces.

## A concept from several sides (C2)

Cover each key concept of the lesson with cards from at least two `lens` values, so it is retrieved from several directions:

| `lens` | Front asks for |
|---|---|
| `fact` | a stated fact, name or value |
| `attribute` | a property that defines it |
| `difference` | what separates it from a confusable neighbour |
| `part` | a component and its role |
| `cause` | why it happens or why it is designed so |
| `significance` | what it lets you do, when it matters |
| `procedure` | one step of a procedure, or the step that follows a given one |

For body practice, cards carry cues, order and safety signals ("what to do when…"), never sensations.

Propose 3–8 cards per lesson.

## Examples

```json
{
  "kind": "basic",
  "front": "How does the staged state differ from the modified state in Git?",
  "back": "A staged change is marked for the next commit, a modified one is changed but not marked",
  "nodeId": "staging-area",
  "lens": "difference",
  "cites": [{ "sourceId": "src_progit_basics", "quote": "Staged means that you have marked a modified file in its current version to go into your next commit snapshot." }]
}
```

```json
{
  "kind": "cloze",
  "front": "In Git, a file marked in its current version to go into the next commit is in the ____ state.",
  "back": "staged",
  "nodeId": "staging-area",
  "lens": "fact",
  "cites": [{ "sourceId": "src_progit_basics", "quote": "Staged means that you have marked a modified file in its current version to go into your next commit snapshot." }]
}
```

```json
{
  "kind": "basic",
  "front": "You changed a file after git add. What do you need to do so the new edit goes into the commit?",
  "back": "Run git add on that file again",
  "nodeId": "staging-area",
  "lens": "procedure",
  "cites": [{ "sourceId": "src_progit_recording", "quote": "It turns out that Git stages a file exactly as it is when you run the git add command." }]
}
```
