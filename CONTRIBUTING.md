# Contributing to Clayfold

Thanks for helping. Bug reports, translations, fixes and features are all welcome. For a larger change, open an issue first so we can agree on the approach before you write the code.

## Set up

Install the [requirements](README.md#requirements), then:

```sh
bun install
bun run dev:server   # API, MCP and runner with reload, http://127.0.0.1:4317
bun run dev:web      # Vite on http://localhost:5173, proxies /api and /mcp to the server
bun run dev:mock     # UI with mock data, no server or Claude calls
```

`dev:mock` is the fastest way to work on the UI: it needs no Claude Code account and spends nothing.

A Claude Code session opened in this repository loads the `clayfold-monitor` mod from `.claude/skills/clayfold-monitor`. Its pane (`/clayfold` opens it) shows the server's statistics and the Claude Code instances the server runs, with buttons to stop a run or start the server. Test it with `claude plugin test .claude/skills/clayfold-monitor`.

## Project layout

| Path | What lives there |
|---|---|
| `server/` | Bun + Hono API, MCP server for Claude, the runner that starts Claude Code, quality gates, spaced repetition |
| `web/` | React + StyleX UI; `web/src/mock/` serves the mock mode |
| `shared/` | API and event types, schemas, rule ids, translation catalogs (`shared/i18n/`) |
| `plugin/` | The Claude Code plugin the server runs: tutor output style, skills, eval suite |
| `docs/` | [Architecture](docs/architecture.md) and the [learning design](docs/learning-design.md) behind the rule ids |

## Checks

Run before you open a pull request:

```sh
bun run typecheck
bun test
bun run build
```

For a UI change, also look at it in `bun run dev:mock` in English and in Russian.

Tests use `bun:test` and sit next to the code as `*.test.ts`. Add a test with a fix or a feature where a neighbouring test file covers the same kind of code.

## Translations

The UI ships in English (default) and Russian.

- Every user-facing string is a key in `shared/i18n/en.ts` with its translation in `shared/i18n/ru.ts`. `bun run typecheck` fails when a translation is missing, and `bun test` fails when a translation drops a `{placeholder}`.
- Plural strings are objects of plural forms picked by the `count` param: `{ one, other }` in English, `{ one, few, many, other }` in Russian.
- Web components that render translated text call `useLang()`, so the text follows a language switch without a reload.
- Code, comments, docs, skills and commit messages are English; Cyrillic appears only in `ru.ts` and in tests of Russian-language support.

To add a language: create a catalog that translates every key of `en.ts`, register it in `shared/i18n/index.ts`, and give it content rules (see `ruContent` in `shared/i18n/ru.ts`). The quality gates use those rules to check lessons Claude writes in that language. The sidebar language button (`LangToggle` in `web/src/components/Layout.tsx`) toggles between two languages, so a third one needs a menu there.

## Skills and evals

The tutor style and the skills Claude follows live in `plugin/`. Their eval suite runs real Claude sessions and costs model usage, so run it when you change a skill and mention the result in your pull request:

```sh
cd plugin
env -i PATH="$PATH" HOME="$HOME" USER="$USER" LANG=en_US.UTF-8 TERM=dumb \
  ENABLE_CLAUDEAI_MCP_SERVERS=false CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1 CLAUDE_CODE_DISABLE_AUTO_MEMORY=1 \
  claude plugin eval . --model opus --judge-model sonnet --trust-plugin --scaffold \
  --allow-tools Write Edit WebSearch WebFetch
```

`env -i` keeps variables of an enclosing Claude Code session out of the runs.

## AI-assisted contributions

You may use AI tools, including coding agents, to write code, tests and docs. Coding agents find the project's rules in [AGENTS.md](AGENTS.md).

- Say in the pull request which tools you used and for what. The template has a field for it.
- You are responsible for every line you submit: you have read it, run the checks, and can explain why it is there and why it is correct.
- A person opens the pull request and answers review comments. Fully automated pull requests and issues with no human involvement are closed.

## Pull requests

- One change per pull request; keep refactoring separate from behaviour changes.
- The title and commit messages say what changed, in the imperative ("Add Spanish catalog"); the description says why.
- Link the issue the pull request resolves.
- Screenshots or a short recording for UI changes.

## Security

Do not open a public issue for a vulnerability. Follow [SECURITY.md](SECURITY.md).

## License

By contributing, you agree that your contributions are licensed under the [GNU Affero General Public License v3.0 or later](LICENSE), the license of this project.
