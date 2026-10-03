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
          spawn per check ─▶ claude -p … --json-schema (critic, grading, narration script; no plugin, no tools)
          HTTPS ───────────▶ api.elevenlabs.io (narration audio, key from the OS credential store)
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
| `server/gates/*` | Deterministic checks, source fetching and quote verification, critic |
| `plugin/` | Tutor output style, skills, eval suite |
| `web/` | React UI |

## Running Claude

The runner starts every turn as:

```
claude -p "<text>" --output-format stream-json --verbose --include-partial-messages
  [--resume <session_id>] --plugin-dir <root>/plugin --setting-sources ""
  --tools "Read,Write,Edit,Glob,Grep,WebSearch,WebFetch"
  --allowedTools "Read,Write,Edit,Glob,Grep,WebSearch,WebFetch,mcp__plugin_clayfold_clayfold__*"
  --permission-mode dontAsk --permission-prompts none --model <config.model> --max-budget-usd <n>
  --append-system-prompt "<language instruction>" --system-prompt-snapshot off
cwd: data/workspaces/<slug>     stdin: /dev/null     env: childEnv({ CLAYFOLD_MCP_URL, CLAYFOLD_TOPIC_ID })
```

- The first turn of a conversation starts with the skill command: `/clayfold:onboard <request>`, `/clayfold:goal-plan <request>` for a goal, `/clayfold:lesson-author <nodeId|next>`, `/clayfold:review-session`.
- A goal (`topics.kind = 'goal'`) holds no lessons: its onboarding conversation runs with the `goal` tool scope and stores a plan of topics with `goal_plan_set`. Opening a plan entry creates a topic with `goal_id` set and starts its onboarding with the entry's brief. Conversations of such a topic record facts for the goal with `goal_note`; the goal page sends the unseen ones to the goal conversation when the learner asks.
- Term marks `[[surface|Term]]` in model-written text resolve against `glossary_terms`, filled with `glossary_set`; the step gate rejects a mark whose term the topic glossary lacks (L19), the web Markdown renderer turns marks into terms, and one popover (`web/src/components/TermPopover.tsx`) shows their definitions.
- A worked-example blank whose answer is in plain words (an open blank with `criteria`, or an older blank with a phrase among its `answers`) is answered through the tutor: the tutor turn carries the line and its criteria, and the tutor records the verdict with `worked_line_record`, which publishes `worked.answered`. Closed blanks keep exact checking in `server/routes/grading.ts`. Tutor turns carry no skill command; the server prepends the tutor context (L17).
- The appended system prompt names the app language (`settings.language`, English by default); Claude writes everything the learner sees in it. `--system-prompt-snapshot off` lets a resumed conversation pick up a language change.
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

Published items are copied to `items` with a shuffled `display_order`. The browser receives only `PublicStep`/`PublicItem`; grading runs in `server/routes`.

## Narration

- `POST /api/steps/:stepId/narration` voices an `explain` step when the learner presses Listen. A `runJsonPrompt` call (purpose `narration`) rewrites the body for speech as parts, each tied to a top-level markdown block. ElevenLabs `/v1/text-to-speech/{voice}/with-timestamps` speaks the joined parts, and its per-character timing gives each block a start and an end. The web app highlights the block being read.
- `narrations` stores the audio and segments per step, for one voice and model; a change of either voices the step again on the next Listen.
- The ElevenLabs key is kept with `Bun.secrets` (`server/secrets.ts`), not in `data/`. The browser only learns whether a key is set, and the key never enters a prompt or the environment of a `claude` process.
