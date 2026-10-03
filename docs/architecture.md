# Architecture

Clayfold is a local, single-user learning platform. A Bun server runs Claude Code in headless mode to build courses and lessons, checks every generated step against the rules in `docs/learning-design.md`, and serves a React UI.

## Processes

```
Browser (React, web/) ──HTTP + SSE──▶ Bun + Hono (server/), 127.0.0.1:4317
                                        ├─ /api/*                 REST, contract in shared/api.ts
                                        ├─ /api/topics/:id/stream SSE, events in shared/events.ts
                                        ├─ /mcp                   MCP Streamable HTTP, tools in shared/tools.ts
                                        └─ SQLite data/clayfold.sqlite schema in server/db/schema.sql
          spawn per turn ──▶ claude -p … --plugin-dir plugin   (cwd data/workspaces/<slug>)
          spawn per check ─▶ claude -p … --json-schema (critic, no plugin, no tools)
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

- The first turn of a conversation starts with the skill command: `/clayfold:onboard <request>`, `/clayfold:lesson-author <nodeId|next>`, `/clayfold:review-session`. Tutor turns carry no skill command; the server prepends the tutor context (L17).
- The appended system prompt names the app language (`settings.language`, English by default); Claude writes everything the learner sees in it. `--system-prompt-snapshot off` lets a resumed conversation pick up a language change.
- `--strict-mcp-config` is not used: it also drops the plugin's MCP server.
- Plugin skills are namespaced: `/clayfold:<skill>`.
- The plugin's `.mcp.json` takes `url` and the `X-Clayfold-Topic` header from `CLAYFOLD_MCP_URL` and `CLAYFOLD_TOPIC_ID`, with `timeout: 180000` because `step_submit` waits for the critic.

## Lesson generation flow

1. `lesson_plan` stores the outline and emits `lesson.planned`; the UI shows the outline at once.
2. For each step, `step_submit` runs schema → deterministic checks → quote verification → critic. A pass publishes the step (`step.published`); a fail returns violations to Claude. The third failed attempt drops the step.
3. `lesson_finish` closes the lesson; `cards_propose` sends cards through the same gates and on to the learner for acceptance.

Published items are copied to `items` with a shuffled `display_order`. The browser receives only `PublicStep`/`PublicItem`; grading runs in `server/routes`.
