# Item rules

Rules for every item: activate prequestions, explain checks, practice, check, and replacements from the regeneration queue. Each rule carries the ID the gates report; the one-line reason says why the gate exists.

## Every item

- **Q1 One defensible answer.** Solve the item from its prompt alone, as the learner would; if a second reading leads to another answer, sharpen the stem. *11% of LLM-written questions have no or several correct answers, against 1% of human-written ones (Law et al. 2025); the critic blind-solves every item.*
- **Q5 Honest Bloom level.** `remember` recalls a stated fact; `understand` explains, classifies or compares; `apply` uses a procedure on a case the lesson did not show; `analyze` diagnoses or breaks down an output; `evaluate` judges with criteria; `create` produces something new. A prompt that restates a lesson sentence is `remember` whatever it is labelled. At least 30% of a lesson's items are `apply`+. *Only 16% of LLM-written items reach apply or higher, against 44% of human-written ones (Law et al. 2025).*
- **L8 Solution, misconceptions, hints.** `solution` is the complete worked answer, steps numbered. `hints` climb a ladder: the first points at what to look at, the last is one step short of the answer; none states the answer. *The tutor uses these to help without giving the answer away; a tutor with prepared solutions removed the harm unrestricted AI did to exam scores (Bastani et al. 2025).*
- **Prompt layout.** Markdown without headings, in this order: the scenario in short paragraphs of at most 3 sentences; several parts or conditions as a labelled list (`- **A.** …`, `- **B.** …`); then the question alone as the last paragraph, ending with "?". One question per item: a two-part question becomes two items, or one question over the labelled parts ("Which pattern fits A and which fits B?"). An answer-length instruction leads into the question ("Answer in 1–2 sentences: …?"). Formats that are a task rather than a question (`order`, `cloze`) still end with one: "In what order…?", "Which word is missing?".
- **Q6 Sourced.** The key, the solution and every factual feedback line follow from the item's `cites`, quoted verbatim from `source_search`.
- **Q7 Distinct.** Each item in the topic tests its own case; a new scenario, not new numbers in an old one.
- **L16 Learner's context.** Scenarios come from the interests in `MISSION.md`, realistic in that domain, with the logic unchanged.
- **Feedback.** Every option's `feedback` speaks to that choice: for the key, why it holds; for a distractor, the error in its `misconception`, leaving the key unnamed so a retry still counts. *Testing with feedback roughly doubles the effect of testing without it (g = 0.73 vs 0.39, Rowland 2014).*

## Choice items: single, multi

- **L13 Three options**, four at most. *Three options measure as well as more (Rodriguez 2005); a weak fourth only adds reading.*
- **L8 Every distractor is a named error in thinking**: `misconception` reads "Thinks…" or "Confuses X with Y", taken first from `misconceptionsSeen`, then from errors the sources warn about. A distractor nobody would choose is dead weight and gets regenerated.
- **Q2 Options alone reveal nothing.** *Models find the key from the options alone in many LLM-written questions (Balepur et al. 2024); the critic tries exactly that.* The usual giveaway is a key that is the longest, the most specific, the only one with a reason, or the only one without an absolute.
- **Q4 No cues.** The key is at most 1.3× the mean distractor length (the gate's limit). "All of the above", "none of the above" and "both" stay out.
- **Q3** Put the key at any index; the server shuffles display order.
- `multi` prompts say "Select all that apply"; each option is true or false on its own.

Write the options in this order:

1. **Distractors first.** Each states its misconception as a confident, specific claim, with a concrete reason as specific as the key's ("…, because …" or the mechanism it assumes).
2. **Key last, matched to them**: length within ±20% of the distractors' mean, counted in characters; the same grammatical form; the same level of detail; the same hedging. An absolute ("always", "never", "only") appears in a distractor only when the key has one too.
3. **Cover the stem and read the options alone.** If one stands out by length, precision, explanation or tone, rewrite it until none does.

Before, the pattern the critic rejects for Q2: the key is the only explained option and the only one without an absolute:

- The model sees the tool result and decides what to do next, so it can recover from an error *(key)*
- The loop always makes the answer faster
- Tools never return errors

After, with the key written last:

- The model reads the tool output and uses it to choose the next step *(key)*
- The model plans everything up front and runs it without checking output
- The model calls every tool at once and answers from their summary

## Recall items: cloze, number, short, order

- **L13 Mix recall with choice** in every lesson. *An initial cued-recall test helps more than a recognition test (g = 0.61 vs 0.29, Rowland 2014).*
- `cloze`: blank the term or value the lesson is about, never a filler word. List the answers a knowledgeable learner might write (Q1), up to the schema's 6 per blank, most likely first: synonyms, forms in the learner's language and in English, transliterations, the noun for the role as well as for the pattern. A term with more than 6 defensible forms is a poor blank; blank another word or use a choice item. Before: `[["routing"]]`, which fails Q1 because "router" is defensible. After: `[["routing", "router", "routing pattern", "router pattern", "request routing", "LLM router"]]`.
- `number`: state the unit; `tolerance` covers legitimate rounding only.
- `short`: the prompt states the expected length; `rubric` has 1–3 criteria a grader can check against `referenceAnswer`.
- `order`: 3–7 entries with exactly one valid order; two entries that could swap make it ambiguous (Q1).

## Prequestions (activate, L2)

Ask about the lesson's core targets, so each prequestion is answered by a later segment. *Pretesting helps when the answer follows (Kornell et al. 2009; Pan & Carpenter 2023), and mostly for the questions actually asked (Toftness et al. 2018).*

## Before each submit

For every item: solved blind with one answer; Bloom honest; each distractor a named misconception; options read alone give no cue (key written last, within ±20% of the distractors' length); every defensible cloze answer listed; hints climb without stating the answer; cites verbatim.
