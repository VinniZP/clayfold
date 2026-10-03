# Clayfold

A local, single-learner learning platform. You type what you want to learn; Claude Code, running headless, interviews you, collects sources, builds a knowledge map and generates interactive lessons. Every lesson step passes quality gates before you see it. Lessons come with a tutor, flashcards with spaced repetition, notes and a memory of your progress.

How lessons are built and why: [docs/learning-design.md](docs/learning-design.md). System layout and contracts: [docs/architecture.md](docs/architecture.md).

## Requirements

- [Bun](https://bun.sh) 1.3 or later
- [Claude Code](https://code.claude.com) 2.1.288 or later, signed in (`claude auth status`). Lessons run on your subscription or API key.

## Run

```sh
bun install
bun run build     # builds the UI into web/dist
bun run start     # http://127.0.0.1:4317
```

When `origin/main` has new commits, the top bar shows "New version". The update pulls them, rebuilds the UI and restarts the server, either at once or after Claude finishes its current work. Claude turns that a restart cuts off run again after it. The update needs a clean checkout of `main` and a server started with `bun run start`.

The app speaks English by default; switch to Russian with the language button in the sidebar. The language also sets what Claude writes from the next run on: interviews, missions, lessons, cards and the tutor. Content written earlier keeps its language.

Data lives in `data/` (SQLite database and one workspace folder per topic with `MISSION.md`, `RESOURCES.md`, `GLOSSARY.md`, `NOTES.md`, `learning-records/`). Back it up to keep your progress; it is not in git.

### Settings

| Variable | Default | Meaning |
|---|---|---|
| `CLAYFOLD_PORT` | `4317` | Server port |
| `CLAYFOLD_DATA_DIR` | `./data` | Database and workspaces |
| `CLAYFOLD_MODEL` | `opus` | Default model for onboarding, lessons, the tutor and review; the Settings page overrides it per role |
| `CLAYFOLD_CRITIC_MODEL` | `sonnet` | Default model for the critic, answer grading and narration scripts; the Settings page overrides it per role |
| `CLAYFOLD_MAX_BUDGET_USD` | `5` | Spend ceiling per Claude run |
| `CLAYFOLD_CLAUDE_BIN` | `claude` | Claude Code executable |

## Set up with an AI agent

Clone the repository, open your coding agent (Claude Code, Codex, Cursor or another) in its folder, and paste this prompt:

```text
Set up Clayfold from this repository and start it. Work from the repository root, run the steps in order, and check each result before the next step. If a check fails and you cannot fix it, stop and tell me what failed.

1. `bun --version` prints 1.3 or later. Otherwise install Bun: `curl -fsSL https://bun.com/install | bash` (Windows: `powershell -c "irm bun.sh/install.ps1|iex"`), then use a new shell.
2. `claude --version` prints 2.1.288 or later. Otherwise install or update Claude Code: `curl -fsSL https://claude.ai/install.sh | bash` (Windows: `irm https://claude.ai/install.ps1 | iex`).
3. `claude auth status` reports `"loggedIn": true`. Otherwise ask me to run `claude` once and finish the browser login, then check again.
4. `bun install` exits 0.
5. `bun run build` exits 0 and `web/dist/index.html` exists.
6. Start `bun run start` in the background. It prints `Clayfold on http://127.0.0.1:4317`. If the port is taken, set `CLAYFOLD_PORT` to a free port.
7. `curl -s http://127.0.0.1:4317/api/settings` (with your port) returns JSON with a `language` field.
8. Give me the address to open. Tell me that lessons run Claude Code on my account, each run capped at CLAYFOLD_MAX_BUDGET_USD (default 5 USD), and that the app language, English or Russian, is switched with the button in the sidebar.
```

## Contribute

Development setup, project layout, translations and the pull request process: [CONTRIBUTING.md](CONTRIBUTING.md). Coding agents read [AGENTS.md](AGENTS.md). Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## License

[GNU Affero General Public License v3.0 or later](LICENSE).
