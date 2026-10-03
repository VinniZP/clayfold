# Clayfold

Bun + Hono server in `server/`, React + StyleX UI in `web/`, types and translation catalogs shared by both in `shared/`, and the Claude Code plugin the server runs headless in `plugin/`. Contracts and run flags: `docs/architecture.md`. Rule ids in code and skills (L7, Q6, C1…) are defined in `docs/learning-design.md`.

## Done

A change is done when `bun run typecheck`, `bun test` and `bun run build` pass. A UI change is also looked at in `bun run dev:mock` (mock data, no server, no Claude calls) in English and Russian.

## Text and languages

- Every string a user sees comes from the catalog: add the key to `shared/i18n/en.ts`, its translation to `shared/i18n/ru.ts`, and read it with `t()`. Server code uses `t` from `server/i18n.ts`, web code from `web/src/lib/i18n.ts`.
- A web component that renders translated text, directly or through a helper such as `formatDate`, calls `useLang()` so a language switch re-renders it.
- Cyrillic lives only in `shared/i18n/ru.ts` and in tests of Russian-language support. Code, comments, docs, skills and commit messages are English.
- Language-specific checks on lesson content (catch-all options, yes/no cards, letter folding, transliteration) go into `ContentRules` (`enContent`, `ruContent`), not into gate code.
- Prompts Claude reads at runtime (skills, tutor context, critic) are English; the learner's language reaches Claude through `languageInstruction()` in `server/i18n.ts`.

## Guardrails

- Keep `--setting-sources ""` in `server/claude/runner.ts`: lesson and tutor runs work in `data/workspaces/<slug>` inside this repository, and the flag keeps this file and `CLAUDE.md` out of their context.
- `data/` holds the user's database and workspaces. Read it to debug; tests use `openDb(":memory:")` and a temp directory instead of writing there.
- The eval suite in `plugin/evals` runs real Claude sessions and costs money: run it only when the human asks.
- `bun run start` serves the code it started with. After a server change, restart it or use `bun run dev:server`, which reloads.

## Tests

`bun:test` files sit next to the code as `*.test.ts`; shared builders live in `test-fixtures.ts` of the same directory.

## Pull requests

Follow [CONTRIBUTING.md](CONTRIBUTING.md) and fill in the pull request template, including the AI-use disclosure.
