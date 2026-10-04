# Architecture

Clayfold is a local, single-user learning platform. A Bun server runs Claude Code in headless mode to build courses and lessons, checks every generated step against the rules in `docs/learning-design.md`, and serves a React UI.

## Processes

```
bun run start ──▶ server/launcher.ts ── restarts on exit code 75 ──▶ server/index.ts
Browser (React, web/) ──HTTP + SSE──▶ Bun + Hono (server/), 127.0.0.1:4317
                                        ├─ /api/*                 REST, contract in shared/api.ts
                                        ├─ /api/topics/:id/stream SSE, events in shared/events.ts
                                        ├─ /mcp                   MCP Streamable HTTP, tools in shared/tools.ts
                                        └─ SQLite data/clayfold.sqlite schema in server/db/schema.sql
          spawn per turn ──▶ claude -p … --plugin-dir plugin   (cwd data/workspaces/<slug>)
          spawn per check ─▶ claude -p … --json-schema (critic, grading, narration and video scripts, alternative explanations; no plugin, no tools)
          HTTPS ───────────▶ api.elevenlabs.io (narration and video audio, key from the OS credential store)
```

## Contracts

| File | What it fixes |
|---|---|
| `shared/schemas.ts` | Authoring schemas (with keys) and public browser views (without keys) |
| `shared/tools.ts` | MCP tool names, input shapes, result shapes |
| `shared/events.ts` | SSE event union |
| `shared/api.ts` | REST routes and DTOs |
| `shared/rules.ts` | Rule IDs used in gate results, skills and eval graders |
| `server/db/schema.sql` | Tables and which module writes each one |

A change to a contract file changes every module that uses it; make it there first.

## Modules

| Path | Responsibility |
|---|---|
| `server/index.ts` | Hono app: mounts `/api`, `/mcp`, serves `web/dist` |
| `server/launcher.ts` | Runs `server/index.ts` and starts it again when it exits with code 75 |
| `server/update.ts` | Compares the checkout with `origin/main`, installs a new version, asks the launcher for a restart |
| `server/claude/env.ts` | Allowlisted environment for child `claude` processes |
| `server/claude/runner.ts` | One `claude -p` process per conversation turn; queue; cancel; `session_id` for `--resume` |
| `server/claude/stream.ts` | stream-json lines to `TopicEvent`s and stored chat messages |
| `server/routes/*` | REST handlers; server-side grading; review; notes; reports; audit |
| `server/review/*` | FSRS scheduling (ts-fsrs, retention 0.90), mastery (L12), learner signals to `regen_queue`, practice-test assembly (L20) |
| `server/review/*` | FSRS scheduling (ts-fsrs, retention 0.90), mastery (L12), learner signals to `regen_queue` |
| `server/search.ts` | Search index and `GET /api/search` |
| `server/mcp/index.ts` | `handleMcp(req: Request, topicId: string): Promise<Response>`; one stateless MCP server per request |
| `server/gates/*` | Deterministic checks, source fetching, learner materials and quote verification, critic |
| `server/gates/*` | Deterministic checks, source fetching and quote verification, critic |
| `server/export/*` | Anki deck (`.apkg` and text import) and the course book in Markdown |
| `plugin/` | Tutor output style, skills, eval suite |
| `web/` | React UI |

## Running Claude

The runner starts every turn as:

```
claude -p "<text>" --output-format stream-json --verbose --include-partial-messages
  [--resume <session_id>] --plugin-dir <root>/plugin --setting-sources ""
  --tools "Read,Write,Edit,Glob,Grep,WebSearch,WebFetch"
  --allowedTools "Read,Write,Edit,Glob,Grep,WebSearch,WebFetch,mcp__plugin_clayfold_clayfold__*"
  --permission-mode dontAsk --permission-prompts none --model <model> [--effort <level>] --max-budget-usd <n>
  --append-system-prompt "<language instruction>[, meerkat tasks]" --system-prompt-snapshot off
cwd: data/workspaces/<slug>     stdin: /dev/null     env: childEnv({ CLAYFOLD_MCP_URL, CLAYFOLD_TOPIC_ID })
```

- The first turn of a conversation starts with the skill command: `/clayfold:onboard <request>`, `/clayfold:goal-plan <request>` for a goal, `/clayfold:lesson-author <nodeId|next>`, `/clayfold:practice-set <lessonId>`, `/clayfold:review-session`.
- A goal (`topics.kind = 'goal'`) holds no lessons: its onboarding conversation runs with the `goal` tool scope and stores a plan of topics with `goal_plan_set`. Opening a plan entry creates a topic with `goal_id` set and starts its onboarding with the entry's brief. Conversations of such a topic record facts for the goal with `goal_note`; the goal page sends the unseen ones to the goal conversation when the learner asks.
- Term marks `[[surface|Term]]` in model-written text resolve against `glossary_terms`, filled with `glossary_set`; the step gate rejects a mark whose term the topic glossary lacks (L19), the web Markdown renderer turns marks into terms, and one popover (`web/src/components/TermPopover.tsx`) shows their definitions.
- A worked-example blank whose answer is in plain words (an open blank with `criteria`, or an older blank with a phrase among its `answers`) is answered through the tutor: the tutor turn carries the line and its criteria, and the tutor records the verdict with `worked_line_record`, which publishes `worked.answered`. Closed blanks keep exact checking in `server/routes/grading.ts`. Tutor turns carry no skill command; the server prepends the tutor context (L17).
- Text the learner selects in a lesson step or a tutor reply gets a toolbar (`web/src/components/SelectionActions.tsx`): ask the tutor, save as a note, define, copy. A tutor turn asked from it carries `quote`; the tutor context ends with the passage, and the stored learner message keeps it in `messages.meta`. Define opens the glossary entry whose term or original matches the selection and otherwise asks the tutor what the words mean, with their paragraph as the quote. The tutor actions are off during the exit check (L11). A note saved from the toolbar holds only the quote; a comment added after it goes through `PATCH /api/notes/:noteId`.
- The appended system prompt names the app language (`settings.language`, English by default); Claude writes everything the learner sees in it. `--system-prompt-snapshot off` lets a resumed conversation pick up a language change.
- The model and effort come from the conversation kind's entry in `settings.claude_roles` (`server/claude/roles.ts`), set on the Settings page. Without an entry the model is `CLAYFOLD_MODEL` and the effort is the role default in `DEFAULT_EFFORT`. Haiku models get no `--effort`: they do not support it. The critic, grading and narration calls (`runJsonPrompt`) read the same setting by their purpose, with `CLAYFOLD_CRITIC_MODEL` as the default model; an alternative explanation reads the tutor's entry.
- `--strict-mcp-config` is not used: it also drops the plugin's MCP server.
- Plugin skills are namespaced: `/clayfold:<skill>`.
- The plugin's `.mcp.json` takes `url` and the `X-Clayfold-Topic` header from `CLAYFOLD_MCP_URL` and `CLAYFOLD_TOPIC_ID`, with `timeout: 180000` because `step_submit` waits for the critic.

## Updates

`GET /api/update` runs `git fetch origin main` when the last fetch started 30 minutes ago or earlier. The UI asks on page load and whenever the tab regains focus, so an unused app does not fetch. A new version is any commit on `origin/main` that `HEAD` does not contain; `GET /api/update` lists them and the UI shows them in the top bar.

An update needs a checkout on `main` with no changes to tracked files and no commits that `origin/main` lacks, and a server started by `bun run start`: the launcher sets `CLAYFOLD_LAUNCHER=1`. Under `dev:server` updates are listed but blocked.

`POST /api/update` installs the commit the last check found: `git merge --ff-only`, `bun install --frozen-lockfile` when `package.json` or `bun.lock` changed, and `bun run build`. A failed step resets the checkout to the previous commit, repeats the steps there and keeps the server running. After a successful install the server shuts down as on SIGINT and exits with code 75, and the launcher starts the new code.

- `mode: "now"` installs at once. The shutdown interrupts the running Claude turns, and the new server re-runs each of them once (`resumeInterruptedTurns`). A critic, grading or narration call in progress is lost.
- `mode: "idle"` waits until no `claude` process runs, then installs. New turns can start while it waits.

While an update runs, the UI polls `/api/update` every 2 seconds and reloads the page once the server reports another `version`.

## Lesson generation flow

1. `lesson_plan` stores the outline and emits `lesson.planned`; the UI shows the outline at once.
2. For each step, `step_submit` runs schema → deterministic checks → quote verification → critic. A pass publishes the step (`step.published`); a fail returns violations to Claude. The third failed attempt drops the step.
3. `lesson_finish` closes the lesson; `cards_propose` sends cards through the same gates and on to the learner for acceptance.

Published items are copied to `items` with a shuffled `display_order`; a match item's holds the permutation of its left entries followed by that of its right entries. The browser receives only `PublicStep`/`PublicItem`; grading runs in `server/routes`. A match or sort answer is correct only when every entry is placed right, which is what mastery and first-try statistics count; the response marks each entry (`AttemptResponse.marks`) and its feedback counts the right ones and adds the feedback of each wrong placement the author anticipated.

## Search

- `GET /api/search?q=` (`server/search.ts`) reads an SQLite FTS5 table with the trigram tokenizer, so a word matches inside longer words in any language.
- Triggers in `schema.sql` add every insert, update and delete of topics, lessons, steps, glossary terms, notes and cards to `search_queue`, cascaded deletes included. A search first indexes the queued rows (`syncSearch`), so no write path calls the index. `openDb` queues every row once when it creates the search tables in an older database.
- An entry holds only text the browser may show (L7): a topic's title and request, a lesson's title and objective, the title and body of a published explain step, the title, problem and unfaded lines of a published worked example, a term with its original and definition, a note's text and quote, the front of an active or suspended card. Items, keys, hints, feedback, faded lines and card backs are not indexed.
- `search_index` holds the text folded by `foldForSearch` (`shared/search.ts`): lowercase, with the letter folding of every language's content rules. Folding keeps the length, so a match found in the folded text marks the same range of the text in `search_entries`, which a hit shows.
- Ranking is bm25 with the title weighted ten times the body, at most five hits of a kind; a lesson that a newer version supersedes and its steps are left out. Words under three characters make no trigram: a query that has a longer word ignores them, and a query of short words matches titles that contain it.
- The web app opens the command palette (`web/src/components/CommandPalette.tsx`) from the top bar or with Cmd+K / Ctrl+K: hits, quick actions, and the lessons and topics opened last, which `web/src/lib/recent.ts` keeps in `localStorage`.

## Meerkat

Optional gamification, off by default (`settings.gamification`). Catalogs and conditions: `shared/game.ts`; rules G1–G2: `docs/learning-design.md`.

- Claude designs the rewards in the runs that build content; there are no extra runs. While the meerkat is on, `appendedPrompt` in `server/claude/runner.ts` adds `gameInstruction` (`server/game/prompt.ts`) for lesson, course onboarding and goal runs, and the MCP server lists the `GAME_FIELDS` of `shared/tools.ts`: `lesson_plan` takes a `challenge` step index and a lesson `reward`, `graph_set` takes course `rewards` and a `resident`, `goal_plan_set` takes stage `trophies`. While it is off, the schemas leave these fields out.
- Content built before the meerkat was on gets its rewards from `POST /api/game/backfill` (`server/game/backfill.ts`): one `runJsonPrompt` call (purpose `game`) per course, goal and lesson that lacks them; a lesson's challenge becomes its last practice step with an apply-or-higher item.
- Rewards go to `rewards`, residents to `residents`. `GET /api/game` (`server/game/view.ts`) works out every condition from learning data, stamps first unlocks, and records habit and rank unlocks in `unlocks`; turning the meerkat on rewards earlier learning at once.
- The web app keeps the state in `web/src/lib/game.ts` and fetches it only while the meerkat is on. Unlocks show one at a time in `Celebrations`, held back while a lesson page is open until its end.

## Learner materials

- The learner adds files (`.txt`, `.md`, `.html`, `.pdf`), pasted text and links when creating a topic (`POST /api/topics` as multipart) or on the topic page (`POST /api/topics/:id/materials`). Limits are `MATERIAL_LIMITS` in `shared/api.ts`; one part that fails fails the request with a translated message naming it.
- `server/gates/materials.ts` extracts the text: HTML through the same Readability path as fetched pages, PDF through `unpdf` (a serverless build of Mozilla's pdf.js, no native dependencies), text and Markdown as written. Only the text is stored, in `sources` with `origin = 'learner'`; the uploaded file is not written to disk, and the browser receives title, kind and sizes, never the stored text or HTML.
- A material is an ok source: `source_search`, Q6 and the critic treat it like a fetched page. A link the topic already has as a source becomes a material under the same id, so its cites stay valid, and `source_add` leaves a learner's link as added.
- `material_list` and `material_read` give Claude the materials and their headings with offsets. The onboard and lesson-author skills build on them first; a lesson planned after a material is added sees it in `get_learner_state`, and a lesson being written hears of it through the new-source note of `step_submit`.
- A material that a step, item or card cites cannot be removed (409).

## Confidence ratings

- With `settings.confidence_enabled` (on unless set to false), the first answer to a graded item (practice, explain check, exit check, review item) is checked through one of three buttons, Guessing, Unsure or Sure, instead of a single Check button; retries, prequestions and cards are not rated. `attempts.confidence` stores the rating. Grading, mastery and learner signals do not read it (L12, L20).
- An item with a wrong answer rated `sure` and no correct review answer since comes back in `GET /api/review` once a day has passed since its latest attempt, whatever its node's mastery: `ReviewSession.retests` lists it, and it comes before the delayed-retrieval items (`retestItems` in `server/review/session.ts`). The tutor context gives the rating of each attempt and marks such an item.
- `GET /api/stats/calibration` counts rated answers and correct ones per level, overall and per topic; Home shows the shares and one sentence comparing the levels that have at least five answers.

## Mistakes notebook

- `server/routes/mistakes.ts` derives the notebook from stored attempts; it keeps no entry table. An entry is an item of role `practice`, `explain_check`, `check` or `review`, not retired, whose first attempt was wrong or that has a give-up. It shows the first wrong answer in the item's own words (choices are mapped back through `display_order`) and that attempt's misconception.
- `GET /api/mistakes/:itemId/solution` and `POST /api/mistakes/:itemId/retry` answer 404 for an item outside the notebook, so neither opens a solution before an attempt (L7, L9).
- Retries go to the `retries` table, never to `attempts`: first-try states, the exit check, mastery, learner signals, the tutor offer and the tutor context read only `attempts`. Activity days (`/api/stats/activity`, streak, daily goal) count retries too.
- An entry's `readyAt` is a day after its latest wrong attempt, give-up or wrong retry; the first correct retry at or after it resolves the entry (L20). A later wrong attempt moves `readyAt` past that retry and reopens the entry. `TodayView.mistakes` counts open entries and those past `readyAt` for the home page.
- Patterns are distractors of open single-choice entries chosen at least twice (`CONFIRMED_MISCONCEPTION_TIMES` of `server/review/signals.ts`), counting attempts and retries.
- The page (`web/src/pages/Mistakes.tsx`) lists entries by topic and node with topic and open/resolved filters. A retry and the "Retry all open" session use `ItemView` in `retry` mode: one answer, no hints, give-up or tutor. The session goes round-robin across nodes.

## Practice tests

- A practice test (L20) belongs to a topic, or to a goal and then spans the topics its plan opened. `assembleTest` (`server/review/practice-test.ts`) picks graded items of the lessons whose exit check is fully answered and interleaves them across nodes; one test per topic or goal is open at a time.
- `practice_test_items` copies each item's content and display order, so `item_replace` leaves a test as the learner took it. The browser gets `PublicItem`s while the test is open, and results with solutions only after submission.
- Answers are saved one question at a time and the test resumes from them. A timed test ends at `created_at` plus the limit; a later save is refused, and the next read of the test submits it.
- Submission grades closed answers at once with `gradeClosedItem`; short answers go to `gradeShort`, three at a time, in the background, and the test stays `grading` until each one is graded or failed. A failed one is graded again on request; a `grading` test with no grading running in this process restarts it when read.
- Test answers are not written to `attempts`, so first-try results, exit checks, lesson progress and learner signals do not see them. A correct answer at least a day after the node's exit check masters the node (L12). Answers of submitted tests count as activity for the day and the streak. An item whose latest test answer was wrong joins the Review session a day after that test, until a review attempt answers it.
- A final exam (L21) is a practice test with `kind = 'final'` on a topic whose nodes all passed the exit check. `GET /api/topics/:topicId/final` (`finalView`) reports the node progress, the best and latest finals and the weak nodes of the latest one; `POST` starts a final only when `canStart` holds. One test of either kind is open per topic at a time. `TopicSummary.final` carries the best result for the course cards and the goal page.

## Practice sets

A practice set is a lesson whose outline holds only practice steps; `lessons.practice` holds its focus and the item it started from, and is NULL for a lesson.

1. `POST /api/practice` (`server/routes/practice.ts`) takes where the learner asked from (a graph node, a lesson's nodes, the node of an item they missed, which becomes the seed, or a whole course: its nodes past the exit check), a size of 3, 5 or 8, or 10, 15 or 20 for a course, and a focus: `same`, `harder` or `mistakes`. It writes the lesson with a placeholder outline and a `lesson` conversation linked to it, and starts `/clayfold:practice-set <lessonId>`. The page opens the set at once and follows it through the lesson events (`step.status`, `step.published`, `lesson.finished`).
2. `practice_brief` gives the run the nodes, size, focus, level, seed, the nodes a course set weights double (`weakNodeIds`: under 80% in the course's latest final exam, L21), the misconceptions the learner chose on these nodes (`targets`), the items they missed and the prompts of the topic's items on these nodes. Prequestion attempts are left out: they come before the teaching (L2).
3. `step_submit` gates each item as a lesson step. A set has no check step, so its last index checks Q5 across the set and the L13 mix of recall and choice; a `harder` set needs `apply` or higher on every item. `lesson_finish` closes the set; it proposes no cards.

Set items have the `practice` role: attempts feed learner signals and move a node from `new` to `learning`, but never pass the exit check (L12 counts `check` items). A set neither supersedes a lesson nor is superseded, is never stale, has no video, and is completed once every item is solved or given up. `GET /api/lessons/:lessonId/practice` returns first-try results per node. Stopping the run fails the set like a cancelled lesson run, and Retry resumes it in its session. The run uses the `lesson` role's model and effort.

## Narration

- `POST /api/steps/:stepId/narration` voices an `explain` step when the lesson player first plays it. A `runJsonPrompt` call (purpose `narration`) rewrites the body for speech as parts, each tied to a top-level markdown block. ElevenLabs `/v1/text-to-speech/{voice}/with-timestamps` speaks the joined parts, and its per-character timing gives each block a start and an end. The web app highlights the block being read.
- `narrations` stores the audio and segments per step, for one voice and model; a change of either voices the step again the next time it plays.
- The lesson page plays narrations in one lesson player (`web/src/components/LessonPlayer.tsx`), opened by Listen on an explain step or Listen to the lesson on another step. It plays the explain step on screen and goes on through the lesson's explanations (`afterNarration` in `web/src/lib/listen.ts`): at the end of a body whose retrieval checks are unanswered it stops and scrolls to them (L4, L7); once they are answered it opens the next explanation after a pause to read the feedback, if no other step comes first; otherwise it plays the next explanation when the learner reaches it. Nothing is voiced before the learner opens the player.
- `narration_prefetch` in `settings` (off by default, Settings → Narration) voices the next explanation while one plays, so the player goes on without waiting; ElevenLabs bills that explanation even if the learner stops before it.
- The player keeps its speed (0.75× to 2×, pitch preserved) in the browser's `localStorage`, follows the block being read until the learner scrolls, and takes hardware media keys and the OS lock screen through the Media Session API.
- The ElevenLabs key is kept with `Bun.secrets` (`server/secrets.ts`), not in `data/`. The browser only learns whether a key is set, and the key never enters a prompt or the environment of a `claude` process.

## Explain differently

- An explain or worked_example step offers lenses for another explanation: simpler, an analogy, step by step, example first (explain steps only, since a worked example is an example already) and more precise. `POST /api/steps/:stepId/alternatives` writes one with a `runJsonPrompt` call under the tutor role and stores it in `alternatives`; `LessonView.alternatives` returns them, and the step shows each as a dismissible card under its text. A lens already written opens its latest version without a call.
- The prompt holds the step as the learner has seen it, the glossary terms marked in it, the workspace's `MISSION.md` (interests for analogies and examples, L16) and `NOTES.md`, earlier alternatives in the same lens, and `languageInstruction()`. A worked example stops at the first faded line the learner has not answered: its question goes in, its text and the lines after it do not. The step's items never enter the prompt, so the call cannot reveal a key (L7).
- A one-shot call rather than a tutor turn: the context is the step alone, and the answer is checked before the learner sees it: at most 400 words (L4) and no headings; a term mark outside the topic glossary keeps only its surface. A failed check gets a second attempt that names the problem.
- While the lesson's exit check is under way (some of its items answered, others not), the route answers 409 (L11).
- The tutor context of a step names the lenses the learner asked for and carries the latest alternative (L17).

## Video lessons

- Off by default; `settings.video_enabled` turns on the lesson's Video tab. A video uses the narration key, voice and model.
- The Video tab is a way through the lesson: the warm-up, the video in place of the explain and worked_example steps, then every question of the lesson (explain checks, practice, reflect, the exit check). The tutor panel is not on this tab.
- `POST /api/lessons/:lessonId/video` builds in the background (`server/routes/video.ts`). Each published explain or worked_example step becomes a chapter; its source blocks are the top-level markdown blocks of the body, or the problem and every solution line.
- Scripts are `runJsonPrompt` calls with the `video` role: one per chapter, up to four at a time, and one for the opening and the closing. Deterministic checks reject a chapter that leaves a source block uncovered, drops or invents a figure, puts markup in the narration, repeats narration word for word on screen (V3), runs a scene past 550 characters or the chapter past 5,000; the second attempt gets the list of problems.
- Each script part is voiced by one ElevenLabs `with-timestamps` call, three at a time; clips are stored in `video_clips`. Per-character timing places each scene, each cued point at the moment its cue is spoken (the first one within 2.5 s of the scene start), and the subtitle lines. `videos.timeline` holds the result (`VideoTimeline` in `shared/api.ts`).
- The browser plays the timeline with Remotion Player (`web/src/video/LessonVideo.tsx`, 1920×1080 at 30 fps): intro, a card per chapter, the scenes, takeaways and an end card. The composition pins the light palette and shows only text from the timeline, so the same composition can be rendered to a file. A `building` row with no build running in this process reads as failed after a restart.
- `POST /api/lessons/:lessonId/video/export` renders the ready video to MP4 in the background (`server/video-export.ts`), one lesson at a time. Webpack bundles `web/src/video/render.tsx` once per process (StyleX with runtime injection, since Remotion inlines CSS), Remotion's headless Chrome draws the frames and fetches the narration clips from this server, and ffmpeg encodes H.264 with AAC. Remotion downloads its Chrome Headless Shell on the first render. The file goes to `data/exports/<lesson>-<video version>.mp4`; making the video again deletes it. Figure scenes hold the frame (`delayRender`) until mermaid, Vega or a widget has drawn.

## Take-away files

- `GET /api/export/anki` exports the accepted (`active`) cards of a topic, or of every topic, from the Memory page. Each topic is one deck named by its title; nodes and lenses become tags (`node::<id>`, `lens::<lens>`), not subdecks. Card Markdown becomes HTML with raw HTML escaped, term marks become their surface, and a cloze card's `____` becomes `{{c1::<back>}}` with braces and colons written as entities so the text cannot open another deletion. The note GUID is the card id, so importing a newer export updates the notes. Cards arrive as new cards: FSRS state stays in Clayfold.
- `format=apkg` writes a legacy package (`collection.anki2` at schema 11 built with `bun:sqlite` and serialized, plus an empty `media` map, in a stored zip) with its own note types, "Clayfold Basic" and "Clayfold Cloze", under fixed ids. It is the default because Anki names its stock note types in the profile's language, and a text import whose note type name is missing skips those notes. `format=txt` is Anki's text import (2.1.54+) with `#separator`, `#html`, `#guid column`, `#notetype column`, `#deck column` and `#tags column` headers and the stock names Basic and Cloze.
- `GET /api/topics/:topicId/book` builds the course book (`server/export/book.ts`): MISSION.md, the node graph as mermaid and as a list, every finished lesson that no newer version supersedes, the glossary, the learner's notes, and the sources the lessons cite, numbered. Steps go through `publicStep`, `lessonItemStates` and `lessonRevealedLines`, so the book holds exactly what the lesson page shows (L7): an item's answer and solution once it is solved, given up or an answered prequestion, a faded worked-example line once answered; other items keep their question and options. Mermaid stays a code block, SVG is inlined, a chart or widget becomes a note with its alt text. Headings follow `settings.language`.
- Downloads carry `Content-Disposition` with an ASCII `filename` from the topic slug and the title as RFC 5987 `filename*`. The web app fetches them (`api.ankiExport`, `api.courseBook`) and saves the blob, so mock mode serves them too.
- The course book page (`/topics/:topicId/book`) renders the same Markdown with mermaid blocks drawn as figures. Printing a lesson or the book (`lib/print.ts`) switches the app to the light palette, waits for diagrams and charts to redraw, and opens collapsed `<details>`; the `@media print` rules in `web/src/styles/global.css` hide elements marked `data-print="hide"` and start each lesson step on a new page.
