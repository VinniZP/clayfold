# Learning design rules

Every rule the platform enforces, with the evidence behind it and the place that enforces it. Rule IDs match `shared/rules.ts`, the gate results in the database, the skills in `plugin/` and the eval graders.

Evidence tags: **[P]** confirmed at the primary source; **[S]** number seen in a search snippet quoting the source, not in the paper itself; **[D]** a design default of this project, not a research finding.

## Why the platform is built this way

- Unguarded AI help raises practice scores and lowers learning. GPT Base raised practice grades 48% and lowered the unassisted exam 17%; a tutor prompt with teacher solutions, common mistakes and hints instead of answers removed the harm without a measurable gain. [P] Bastani et al., *Generative AI without guardrails can harm learning*, PNAS 2025, https://www.pnas.org/doi/10.1073/pnas.2422633122
- A structured AI tutor with pre-written step-by-step solutions, one sub-question at a time and self-pacing beat an in-class active-learning lesson by 0.63 SD (quantile regression 0.73–1.3), median 49 min. [P] Kestin et al., Scientific Reports 2025, https://pmc.ncbi.nlm.nih.gov/articles/PMC12179260/
- Access is not use: students messaged Khanmigo in 17% of sessions in which they made a mistake; effect 0.06–0.08 SD per year. [P] Oreopoulos & Low, EdWorkingPaper 26-1551 (2026), https://edworkingpapers.com/ai26-1551
- Tutor context helped in production A/B tests: recent problem history +3.4%, unmastered prerequisites +2.7%, last 24 h of conversation +5.09% engagement; example problems and follow-up links had no effect. [P] Khan Academy, https://blog.khanacademy.org/how-khan-academy-is-building-a-better-ai-tutor-our-most-recent-learnings/
- LLM self-correction without external feedback is unreliable. [S] Huang et al., ICLR 2024, https://arxiv.org/abs/2310.01798
- Untuned LLM judges correlate mostly negatively with humans on pedagogical dimensions; GPT-4 as a tutor revealed the answer in ~47% of responses. [P] Maurya et al., MRBench, NAACL 2025, https://arxiv.org/abs/2412.09416
- Binary checklist questions make LLM judging more consistent than holistic scores. [S] CheckEval, EMNLP 2025, https://arxiv.org/abs/2403.18771
- Rule-based detectors found 91% of item-writing flaws, GPT-4 79%. [S] Moore et al., EC-TEL 2023, https://arxiv.org/abs/2307.08161
- LLM judges prefer their own outputs. [S] Panickssery et al., NeurIPS 2024, https://arxiv.org/abs/2404.13076
- Learner preference is a poor quality signal: educators role-playing students rated two models equally where experts did not. [S] Gemini arena for learning, https://arxiv.org/abs/2505.24477

Hence: lessons are structured sequences; every item carries a verified solution; the browser never sees keys; deterministic checks run before a critic; the critic asks yes/no questions with a different model; learner data, not learner ratings, triggers regeneration.

## Lesson (L)

| ID | Rule | Evidence | Enforced by |
|---|---|---|---|
| L1 | A lesson is a fixed sequence of small steps shown one at a time; the learner sets the pace, the system the order. | Kestin 2025 [P]; learner control over sequence g = 0.05 (Karich et al., RER 2014) [S] | schema, UI |
| L2 | A lesson opens with 2–3 ungraded prequestions on its core targets; answers follow. | Failed retrieval helps when the answer follows (Kornell, Hays & Bjork 2009, https://pubmed.ncbi.nlm.nih.gov/19586265/) [P]; prequestions help mostly the questioned content (Toftness et al. 2018) [S]; review: Pan & Carpenter 2023, https://doi.org/10.1007/s10648-023-09814-5 [P] | `lesson_plan`, schema |
| L3 | Terms and parts come before the mechanism. | Mayer pretraining principle, median d = 0.75 [P] | skill, critic |
| L4 | An explanation segment is ≤ 400 words and ends with 1–3 retrieval checks with feedback. | Segmenting d = 0.79 [P]; feedback doubles the testing effect, g = 0.73 vs 0.39 (Rowland 2014, https://doi.org/10.1037/a0037559) [P]; 400 words [D] | deterministic gate, schema |
| L5 | Novices: worked example → faded example → problem; experienced learners: problems first. Level from "first step" placement questions. | Fading (Renkl & Atkinson 2003) [P]; expertise reversal (Kalyuga et al. 2003, Kalyuga 2007) [P]; rapid first-step assessment (Kalyuga & Sweller 2004) [S] | skill, learner state |
| L6 | No self-explanation prompts on worked examples for novices; "why" questions follow key ideas in text. | Worked examples g = 0.48, self-explanation prompts lowered it (Barbieri et al. 2023, https://doi.org/10.1007/s10648-023-09745-1) [S]; self-explanation g = 0.55 (Bisra et al. 2018) [S] | skill, critic |
| L7 | The learner answers before any explanation; keys stay on the server. | Attempt-first gives the largest benefit (Kumar et al. 2023, https://papers.ssrn.com/abstract=4641653) [S]; Bastani 2025 [P] | API, UI |
| L8 | Every practice item has a worked solution, a named misconception per distractor and 2–3 hints; a match or sort item names the misconception behind at least one likely wrong placement. | Kestin 2025 [P]; Bastani GPT Tutor [P]; 32% of generated hints failed quality checks (Pardos & Bhandari 2024, https://pmc.ncbi.nlm.nih.gov/articles/PMC11125466/) [S] | schema, deterministic gate, critic |
| L9 | On error: the option's feedback, then the tutor names the likely misconception and asks one guiding question; full solution only after an attempt or give-up. | Tutor CoPilot +4 pp mastery (Wang et al. 2024, https://arxiv.org/abs/2410.03017) [S]; LearnLM rubric (https://arxiv.org/abs/2407.12687) [S] | API, tutor style |
| L10 | After 2 wrong attempts or 90 s idle, the tutor offers help. | Oreopoulos & Low 2026 [P]; thresholds [D] | API (`offerTutor`), UI |
| L11 | A lesson ends with an unaided check. | Practice performance overstates learning (Soderstrom & Bjork 2015, https://pubmed.ncbi.nlm.nih.gov/25910388/) [P]; Bastani 2025 [P] | `lesson_plan`, UI |
| L12 | A node is mastered after the exit check (≥ 80% first-try correct) and a delayed retrieval ≥ 1 day later. Self-ratings unlock nothing. | Roediger & Karpicke 2006 (testing beats restudy at 2 days, not at 5 min; restudy inflates confidence), https://pubmed.ncbi.nlm.nih.gov/16507066/ [P]; 80% and 1 day [D] | review module |
| L13 | Formats mix recall and choice; choice items have 3 options, at most 4. Match items (3–6 pairs, at most 2 extra right entries) and sort items (4–8 entries in 2–4 categories) count as choice. | Cued-recall initial tests g = 0.61 vs recognition 0.29 (Rowland 2014) [P]; three options are optimal (Rodriguez 2005) [S]; match and sort sizes [D] | schema, skill |
| L14 | Review interleaves only confusable categories. | Interleaving g = 0.42 overall, helps discrimination, hurts word lists g = −0.39 (Brunmair & Richter 2019) [S]; classroom RCT d = 0.83 (Rohrer et al. 2020) [S] | review module |
| L15 | Sessions open with a warm-up on earlier lessons; FSRS target retention 0.90. | Optimal gap grows with retention interval (Cepeda et al. 2008) [P]; FSRS default retention 0.9 (https://github.com/open-spaced-repetition/fsrs4anki/wiki/The-optimal-retention) [P] | review module |
| L16 | Problem contexts come from the learner's interests; the logic stays the same and realistic. | Context personalisation raised interest and learning (Walkington 2013; Bernacki & Walkington 2018) [S]; LLM personalisation produced unrealistic contexts (arXiv 2602.15876) [S] | skill, critic |
| L17 | Tutor context: the item with its solution and misconceptions, recent attempts, unmastered prerequisites, the conversation. | Khan Academy tests [P] | tutor route |
| L18 | The tutor steers "do it for me" toward explanation and asks for confidence at the end of a step. | Explanation use kept gains, text generation lost them (Contractor & Reyes 2026, https://arxiv.org/abs/2607.08849) [S]; metacognitive laziness (Fan et al. 2024, https://arxiv.org/abs/2412.09315) [S] | tutor style, evals |
| L19 | Concepts carry the terms practitioners of the field use in the learner's language (the English term where they use it), with the original beside a translated term; every term is defined once in the topic glossary and marked where it is used, so the learner can read its definition anywhere. | [D] | `glossary_set`, deterministic gate (marks), critic, skill |

## Figures (V)

| ID | Rule | Evidence | Enforced by |
|---|---|---|---|
| V1 | No decorative visuals or "fun facts"; each figure states what it teaches. | Coherence principle 23/23 tests, median d = 0.86 [P]; seductive details g = −0.33, 58 studies (Sundararajan & Adesope 2020) [P] | schema (`teaches`), critic |
| V2 | Labels inside the figure next to their parts; no legend; text beside the figure. | Spatial contiguity 22/22 tests, median d = 1.10 [P] | skill, critic |
| V3 | A caption does not repeat the body text. | Redundancy principle 16/16, d = 0.86 [P] (stated for narration; applied here to text) | deterministic gate |
| V4 | Static stepwise figures by default; widgets only for motion, procedure or parameter play, controlled by the learner. | Animation d = 0.37 overall, decorative animation no gain, procedural-motor d = 1.06 (Höffler & Leutner 2007) [P]; congruence and apprehension (Tversky et al. 2002) [S] | schema (`purpose`), critic |
| V5 | Kind by content: process → mermaid, quantities → chart, structure/space → svg, manipulation → widget. | [D] | skill |
| V6 | A figure parses and renders; its labels match terms in the text. | No evaluation of LLM teaching diagrams exists; MermaidSeqBench reports syntax/logic failure modes [S] | deterministic gate, critic |

Mayer numbers: Cambridge Handbook of Multimedia Learning, 2nd ed., chapters on extraneous and essential processing (median d across Mayer's experiments; an outside meta-analysis of the same body of work found g = 0.37 [S], so treat them as upper bounds).

## Items and cards (Q, C)

| ID | Rule | Evidence | Enforced by |
|---|---|---|---|
| Q1 | Exactly one correct answer, confirmed by a blind solve. | LLM items: 11% multiple/no correct answer vs 1% human, 6% factual errors, 14% wrong difficulty (Law et al. 2025, https://pmc.ncbi.nlm.nih.gov/articles/PMC11806894/) [P] | critic |
| Q2 | The key cannot be found from the options alone. | Choices-only models beat chance in 11/12 settings (Balepur et al., ACL 2024) [S] | critic |
| Q3 | Key position is shuffled by code; a match item shuffles both sides and never shows a pair's two entries at the same position. | LLMs place keys in biased positions (preprint, 2026) [S] | MCP `step_submit` |
| Q4 | Options of similar length; no stem cues; no all/none of the above; a match or sort entry shares no distinctive word with its own partner or category alone. | Haladyna, Downing & Rodriguez 2002 item-writing guidelines [S]; 1.3× threshold [D] | deterministic gate |
| Q5 | Every item has a Bloom level; ≥ 30% of a lesson's items are apply or higher. | LLM items: 16% apply+ vs 44% human (Law 2025) [P]; 30% [D] | deterministic gate (on the check step), critic |
| Q6 | Every key, explanation and card answer cites a verbatim quote from a source the server fetched or the learner provided; the quote supports the claim. | Grounding preferred unless over-literal (Levonian et al. 2024, https://arxiv.org/abs/2310.03184) [P]; error rates above | quote gate, critic |
| Q7 | No near-duplicate items in a topic. | 14% duplicates in LLM items (Law 2025) [P] | deterministic gate |
| Q8 | A lesson cites at least two publishers when the topic has sources from two or more. All of the learner's own materials count as one publisher, so a topic built only from them is not held back, and a lesson built on them also cites one outside publisher when the topic has outside sources. | A lesson built on one article presents one vendor's framing as the field's; perspective diversity [D]; learner materials as one publisher [D] | `lesson_plan` (planned sources), check-step gate |
| C1 | One fact per card; no lists or yes/no; the front stands alone; one answer. | Minimum information principle (Wozniak, https://supermemo.guru/wiki/20_rules_of_knowledge_formulation) [P, practitioner]; Matuschak's prompt properties (https://andymatuschak.org/prompts/) [P, practitioner] | deterministic gate, critic |
| C2 | A concept gets several cards from different lenses. | Matuschak [P, practitioner] | skill |
| C3 | The learner accepts, edits or suspends every card and can report errors. | Learners want editable AI cards (SmartFlash preprint 2026) [S] | UI |
| C4 | A card with ≥ 8 lapses goes to the rewrite queue. | Anki's default leech threshold [D] | review module |

No controlled studies of LLM-written flashcards or LLM-drawn teaching diagrams were found; C- and V-rules are defaults that learner data (regeneration queue, reports, audit) has to confirm.

## Motivation (G)

The meerkat is optional and off by default (Settings). While it is on:

| ID | Rule | Evidence | Enforced by |
|---|---|---|---|
| G1 | A lesson's challenge is one practice step before the exit check whose item is apply or higher; the gold crown needs it right on the first try without hints. | [D] | `lesson_plan`, step gate |
| G2 | A reward, trophy or resident Claude draws is a self-contained SVG on a 100 × 100 canvas without text; the browser shows it as an image. | [D] | `lesson_plan`, `graph_set`, `goal_plan_set` |

- Rewards follow learning actions only: answered items, exit checks, mastery (L12), reviews, days with the daily goal met, a question to the tutor, a lesson finished without leaving it for more than two minutes. Nothing rewards speed, clicks or time spent in the app. [D]
- A lesson crown needs 80% of the exit check right on the first attempt, the L12 threshold. [D]
- Lesson steps carry no game elements (V1): the app frames the challenge step, and rewards appear outside the steps.
- Unlocks wait for the end of a lesson, and the companion says nothing about exit-check answers before their results show (L11). [D]

## Learner signals

| Signal | Action |
|---|---|
| Apply+ item answered right on first sight in < 8 s, twice | `possible_leak` → regenerate harder |
| A distractor never chosen after ≥ 6 attempts | `dead_distractor` → regenerate distractors |
| The same distractor chosen ≥ 2 times | misconception confirmed → keep the item |
| Learner report | re-run blind solve and quote check, fix or retire |
| Card with ≥ 8 lapses | `leech` → split or rewrite |
| Explain differently on a step | stored with its lens; the tutor context of the step names the lenses and carries the latest alternative (L17). No regeneration entry: `regen_queue` and `item_replace` replace items and cards, not steps |

Classical item discrimination needs many learners; these single-learner proxies follow Tarrant et al. 2009 (non-functional distractor < 5% choice) [S] and are thresholds of this project [D].
