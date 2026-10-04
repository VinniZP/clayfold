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
          spawn per check ─▶ claude -p … --json-schema (critic, grading, narration and video scripts; no plugin, no tools)
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
| `server/review/*` | FSRS scheduling (ts-fsrs, retention 0.90), mastery (L12), learner signals to `regen_queue` |
| `server/mcp/index.ts` | `handleMcp(req: Request, topicId: string): Promise<Response>`; one stateless MCP server per request |
| `server/gates/*` | Deterministic checks, source fetching, learner materials and quote verification, critic |
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

- The first turn of a conversation starts with the skill command: `/clayfold:onboard <request>`, `/clayfold:goal-plan <request>` for a goal, `/clayfold:lesson-author <nodeId|next>`, `/clayfold:review-session`.
- A goal (`topics.kind = 'goal'`) holds no lessons: its onboarding conversation runs with the `goal` tool scope and stores a plan of topics with `goal_plan_set`. Opening a plan entry creates a topic with `goal_id` set and starts its onboarding with the entry's brief. Conversations of such a topic record facts for the goal with `goal_note`; the goal page sends the unseen ones to the goal conversation when the learner asks.
- Term marks `[[surface|Term]]` in model-written text resolve against `glossary_terms`, filled with `glossary_set`; the step gate rejects a mark whose term the topic glossary lacks (L19), the web Markdown renderer turns marks into terms, and one popover (`web/src/components/TermPopover.tsx`) shows their definitions.
- A worked-example blank whose answer is in plain words (an open blank with `criteria`, or an older blank with a phrase among its `answers`) is answered through the tutor: the tutor turn carries the line and its criteria, and the tutor records the verdict with `worked_line_record`, which publishes `worked.answered`. Closed blanks keep exact checking in `server/routes/grading.ts`. Tutor turns carry no skill command; the server prepends the tutor context (L17).
- The appended system prompt names the app language (`settings.language`, English by default); Claude writes everything the learner sees in it. `--system-prompt-snapshot off` lets a resumed conversation pick up a language change.
- The model and effort come from the conversation kind's entry in `settings.claude_roles` (`server/claude/roles.ts`), set on the Settings page. Without an entry the model is `CLAYFOLD_MODEL` and the effort is the role default in `DEFAULT_EFFORT`. Haiku models get no `--effort`: they do not support it. The critic, grading and narration calls (`runJsonPrompt`) read the same setting by their purpose, with `CLAYFOLD_CRITIC_MODEL` as the default model.
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

## Narration

- `POST /api/steps/:stepId/narration` voices an `explain` step when the learner presses Listen. A `runJsonPrompt` call (purpose `narration`) rewrites the body for speech as parts, each tied to a top-level markdown block. ElevenLabs `/v1/text-to-speech/{voice}/with-timestamps` speaks the joined parts, and its per-character timing gives each block a start and an end. The web app highlights the block being read.
- `narrations` stores the audio and segments per step, for one voice and model; a change of either voices the step again on the next Listen.
- The ElevenLabs key is kept with `Bun.secrets` (`server/secrets.ts`), not in `data/`. The browser only learns whether a key is set, and the key never enters a prompt or the environment of a `claude` process.

## Video lessons

- Off by default; `settings.video_enabled` turns on the lesson's Video tab. A video uses the narration key, voice and model.
- The Video tab is a way through the lesson: the warm-up, the video in place of the explain and worked_example steps, then every question of the lesson (explain checks, practice, reflect, the exit check). The tutor panel is not on this tab.
- `POST /api/lessons/:lessonId/video` builds in the background (`server/routes/video.ts`). Each published explain or worked_example step becomes a chapter; its source blocks are the top-level markdown blocks of the body, or the problem and every solution line.
- Scripts are `runJsonPrompt` calls with the `video` role: one per chapter, up to four at a time, and one for the opening and the closing. Deterministic checks reject a chapter that leaves a source block uncovered, drops or invents a figure, puts markup in the narration, repeats narration word for word on screen (V3), runs a scene past 550 characters or the chapter past 5,000; the second attempt gets the list of problems.
- Each script part is voiced by one ElevenLabs `with-timestamps` call, three at a time; clips are stored in `video_clips`. Per-character timing places each scene, each cued point at the moment its cue is spoken (the first one within 2.5 s of the scene start), and the subtitle lines. `videos.timeline` holds the result (`VideoTimeline` in `shared/api.ts`).
- The browser plays the timeline with Remotion Player (`web/src/video/LessonVideo.tsx`, 1920×1080 at 30 fps): intro, a card per chapter, the scenes, takeaways and an end card. The composition pins the light palette and shows only text from the timeline, so the same composition can be rendered to a file. A `building` row with no build running in this process reads as failed after a restart.
- `POST /api/lessons/:lessonId/video/export` renders the ready video to MP4 in the background (`server/video-export.ts`), one lesson at a time. Webpack bundles `web/src/video/render.tsx` once per process (StyleX with runtime injection, since Remotion inlines CSS), Remotion's headless Chrome draws the frames and fetches the narration clips from this server, and ffmpeg encodes H.264 with AAC. Remotion downloads its Chrome Headless Shell on the first render. The file goes to `data/exports/<lesson>-<video version>.mp4`; making the video again deletes it. Figure scenes hold the frame (`delayRender`) until mermaid, Vega or a widget has drawn.
