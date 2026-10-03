# Security policy

## Report a vulnerability

Report vulnerabilities privately through GitHub: open the repository's **Security** tab and choose **Report a vulnerability**. Please do not open a public issue, discussion or pull request for one.

Include what an attacker can do, the steps or a proof of concept that reproduce it, and the commit you tested. The maintainer will acknowledge the report, keep you updated in the advisory, and credit you when the fix is published unless you prefer otherwise.

Only the latest commit on `main` receives security fixes.

## Scope

Clayfold runs on the learner's own machine: the server listens on `127.0.0.1`, starts Claude Code with the learner's account, and lets it read web pages and write files in the topic workspace. Examples of what we treat as vulnerabilities:

- a web page, source or other content Claude reads that makes it act outside the topic workspace or beyond the tools the runner grants (prompt injection that escapes its limits);
- another website or local process that can call the server's API or MCP endpoint, read the learner's data or start Claude runs;
- lesson content that runs script in the UI (cross-site scripting through Markdown, SVG, Mermaid or Vega figures);
- the server reading or serving files outside `web/dist` and the data directory.

Out of scope: attacks that already need control of the learner's machine or account, inaccurate or low-quality lesson content (open a regular issue), and model usage cost within the `CLAYFOLD_MAX_BUDGET_USD` ceiling.
