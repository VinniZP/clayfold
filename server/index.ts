import { existsSync, statSync } from "node:fs";
import { join, normalize } from "node:path";
import { Hono } from "hono";
import { cancelAll, failOrphanedLessons, resumeInterruptedTurns } from "./claude/runner";
import { config } from "./config";
import { db } from "./db";
import { loadLanguage } from "./i18n";
import { RESTART_EXIT_CODE } from "./launcher";
import { handleMcp } from "./mcp/index";
import { api } from "./routes";
import { initUpdates } from "./update";
import { closeAllWatchers, syncAllTopicTitles } from "./workspace";

const webDist = join(config.root, "web", "dist");

const app = new Hono();
app.route("/api", api);
app.all("/api/*", (c) => c.json({ error: "not found" }, 404));
app.all("/mcp", (c) => handleMcp(c.req.raw, c.req.header("x-clayfold-topic") ?? ""));

app.get("*", (c) => {
  const path = normalize(join(webDist, decodeURIComponent(c.req.path)));
  if (path.startsWith(webDist) && existsSync(path) && statSync(path).isFile()) return new Response(Bun.file(path));
  const index = join(webDist, "index.html");
  if (existsSync(index)) return new Response(Bun.file(index), { headers: { "content-type": "text/html; charset=utf-8" } });
  return c.text("web/dist is not built; run `bun run build`.", 404);
});

db();
loadLanguage();
syncAllTopicTitles();

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: config.port,
  // SSE streams and MCP calls that wait on the critic stay open for minutes; 255 s is Bun's maximum.
  idleTimeout: 255,
  fetch: app.fetch,
});
console.log(`Clayfold on http://${server.hostname}:${server.port}`);
const resumed = resumeInterruptedTurns();
if (resumed) console.log(`Resumed ${resumed} turn(s) cut off by the last shutdown`);
failOrphanedLessons();

let stopping = false;
async function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  closeAllWatchers();
  await cancelAll();
  await server.stop(true);
  process.exit(code);
}
process.on("SIGINT", () => shutdown());
process.on("SIGTERM", () => shutdown());
initUpdates(() => shutdown(RESTART_EXIT_CODE));
