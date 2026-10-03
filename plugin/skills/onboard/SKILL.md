---
name: onboard
description: Start a new topic. Interview the learner, write the mission, collect sources, build the knowledge graph and place the learner on it.
argument-hint: "<what the learner wants to learn>"
disable-model-invocation: true
---

Onboard the learner onto a new topic. Their request: $ARGUMENTS

Onboarding spans several turns: every question to the learner goes through `ask_learner`, and the turn ends right after that call. Each later turn resumes here with their answer. Find the first phase whose completion criterion is not met yet (check the conversation and the files in the current directory) and continue from it.

## 1. Interview

Ask ONE question per turn with `ask_learner`: 3–5 concrete options that fit this topic plus `allowFree: true`, then end the turn. Skip any question the request or an earlier answer already settles. In order:

1. **Goal**: what they want to do with the topic in real life.
2. **Success criteria**: what they will be able to do, observably, when it worked. Push vague answers ("understand X") toward an action ("explain X to a colleague", "run a 10-minute routine daily").
3. **Constraints**: time per week, deadline, equipment; for body practice, injuries or health limits.
4. **Prior knowledge and interests**: what they already know or have tried, and the areas they care about (work, hobbies). Interests become problem contexts in lessons (L16).

Done when the goal, at least two observable success criteria, the constraints, prior knowledge and interests are known.

When the request came from a goal's plan, compare the answers with what the request said about the learner; each difference becomes one `goal_note`.

## 2. Mission

Write `MISSION.md` in the format of [mission-format.md](${CLAUDE_SKILL_DIR}/mission-format.md) and `NOTES.md` with the learner's preferences (address form, pace, format wishes). Both in the learner's language.

## 3. Sources

Collect as many strong sources as the topic offers, from as many independent voices as it has: 12–25 registered sources. A set drawn from one vendor teaches that vendor's view as if it were the field's.

**Search wide before registering.** Run at least 6–8 distinct WebSearch queries:

- the topic term, and the concept behind it in other words: synonyms and adjacent terms (a term one vendor coined returns mostly that vendor, so search the concept);
- English and the learner's language;
- one query per major vendor or school when the field has competing ones;
- independent practitioners and educators: blogs, newsletters, books;
- academic surveys, preferring arXiv HTML pages (`arxiv.org/html/…`; the server refuses PDFs);
- courses;
- critiques, postmortems, "lessons learned".

For health and body topics, national health services and clinical institutions lead.

**Choose for quality and spread.** Each source is an HTML page that carries the content itself, from a primary source, a recognised practitioner or researcher, an institution or a course; PDFs, paywalls, video-only pages, forums, SEO listicles and content farms stay out. The set as a whole:

- comes from at least 4 distinct publishers, none above 40% of the sources;
- is at least one third independent: the author does not sell the product the source describes;
- covers every major vendor or school when the field has a debate, plus at least one critical or contrarian source.

**Register** each with `source_add` (url, kind, one-line note). `ok: false` means pick another. After each add, read `headings` to judge coverage and, when present, the `publishers` counts to correct skew: an over-represented publisher waits until the others catch up. Lesson facts and quotes come only from these sources through `source_search`, never from WebFetch output or memory.

Write `RESOURCES.md` in the format of [resources-format.md](${CLAUDE_SKILL_DIR}/resources-format.md): every source with its `sourceId`, perspective and publisher, and the coverage table. Done when 12–25 sources returned `ok: true`, the spread rules hold, and every success criterion has at least 2 sources from different publishers; or when 25 sources are registered, with each uncovered criterion under `## Gaps`. A narrow topic with fewer than 12 strong sources stops when new queries stop turning up new publishers, and says so under `## Gaps`.

## 4. Knowledge graph

Call `graph_set` with 6–25 nodes that lead to the success criteria:

- A node is one lesson's worth (15–30 minutes): one concept (`knowledge`) or one ability (`skill`). Ids are lowercase-dash slugs; titles and summaries in the learner's language.
- `prereqs` lists the nodes that must come first; terms and parts precede the mechanisms built from them (L3). The graph is acyclic and every prereq id exists.
- Ground every node in the sources: its subject appears in a source's headings or a `source_search` hit. A node with no coverage gets a new source, or a `## Gaps` entry in `RESOURCES.md`.

## 5. Placement

Choose 2–4 key nodes whose status decides where lessons start: the earliest nodes the learner claims to know, and one node further along. For each, one turn: `ask_learner` with a "first step" question (rapid assessment, Kalyuga & Sweller 2004): show a concrete task from that node and ask how they would start. Options: the correct first step, 2–3 first steps a novice typically takes, and "I don't know where to start". Labels stay under 120 characters and alike in length and form, so the correct one does not stand out (Q4); detail goes in `description`. Pass `shuffle: true` so the app shows the options in random order with "I don't know" last (Q3). Then end the turn.

On the next turn record `placement_record` for that node: `known` for the correct first step, `partial` for a reasonable but incomplete or free-text half-right start, `unknown` for a wrong step or "don't know". `evidence` quotes what they answered. Record only the nodes you asked about.

For every `known` node, write a learning record per [learning-record-format.md](${CLAUDE_SKILL_DIR}/../review-session/learning-record-format.md): placement is evidence of prior knowledge.

## 6. Wrap-up

Finish with a short message: the mission in one sentence, the sources, the path through the graph, the placement result, and the suggested first lesson: the earliest node not placed `known` whose prerequisites are all `known`. End the turn.
