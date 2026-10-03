import type { UpdateBlock, UpdateCommit, UpdateMode, UpdateView } from "../shared/api";
import { activeJsonPrompts } from "./claude/oneshot";
import { activeRuns } from "./claude/runner";
import { config } from "./config";

const BRANCH = "main";
const CHECK_INTERVAL_MS = 30 * 60 * 1000;
const IDLE_POLL_MS = 2000;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Runs `cmd` in `cwd` and returns its stdout; rejects with its output when it exits non-zero. */
async function exec(cmd: string[], cwd: string): Promise<string> {
  const proc = Bun.spawn(cmd, {
    cwd,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  if (code !== 0) throw new Error(`${cmd.slice(1).join(" ")} exited ${code}: ${(stderr || stdout).trim().slice(0, 500)}`);
  return stdout.trim();
}

const git = (cwd: string, ...args: string[]) => exec(["git", ...args], cwd);

export type Inspection = { version: string; target: string; commits: UpdateCommit[]; blocked: UpdateBlock | null };

/** Fetches origin/main and compares it with the checkout in `cwd`. */
export async function inspect(cwd: string): Promise<Inspection> {
  const version = await git(cwd, "rev-parse", "--short", "HEAD");
  await git(cwd, "fetch", "--quiet", "origin", BRANCH);
  const target = await git(cwd, "rev-parse", `origin/${BRANCH}`);
  const log = await git(cwd, "log", "--format=%h%x09%s", `HEAD..${target}`);
  const commits = log
    ? log.split("\n").map((line) => {
        const tab = line.indexOf("\t");
        return { sha: line.slice(0, tab), subject: line.slice(tab + 1) };
      })
    : [];
  let blocked: UpdateBlock | null = null;
  if ((await git(cwd, "rev-parse", "--abbrev-ref", "HEAD")) !== BRANCH) blocked = "branch";
  else if (await git(cwd, "status", "--porcelain", "--untracked-files=no")) blocked = "dirty";
  else if (Number(await git(cwd, "rev-list", "--count", `${target}..HEAD`)) > 0) blocked = "ahead";
  return { version, target, commits, blocked };
}

/**
 * Fast-forwards the checkout in `cwd` to `target`, installs dependencies when package.json or bun.lock
 * changed, and builds the UI. On a failure it returns the checkout to the previous commit and repeats
 * the same steps there, so the running server keeps a working UI.
 */
export async function install(cwd: string, target: string): Promise<void> {
  const from = await git(cwd, "rev-parse", "HEAD");
  const changed = (await git(cwd, "diff", "--name-only", from, target)).split("\n");
  const steps = [
    ...(changed.includes("package.json") || changed.includes("bun.lock") ? [[process.execPath, "install", "--frozen-lockfile"]] : []),
    [process.execPath, "run", "build"],
  ];
  await git(cwd, "merge", "--ff-only", "--quiet", target);
  try {
    for (const step of steps) await exec(step, cwd);
  } catch (e) {
    try {
      await git(cwd, "reset", "--keep", from);
      for (const step of steps) await exec(step, cwd);
    } catch (rollback) {
      throw new Error(`${message(e)}; rollback to ${from.slice(0, 7)} failed: ${message(rollback)}`);
    }
    throw e;
  }
}

type State = Omit<UpdateView, "running"> & { target: string | null };

let state: State = { version: null, target: null, commits: [], blocked: null, state: "idle", error: null };
let restart: (() => void) | null = null;
let waitTimer: ReturnType<typeof setInterval> | null = null;
let lastCheck = 0;
let checking: Promise<void> | null = null;

const runningClaude = () => activeRuns().length + activeJsonPrompts().length;

export function updateView(): UpdateView {
  const { target: _, ...view } = state;
  return { ...view, running: runningClaude() };
}

async function check(): Promise<void> {
  if (state.state !== "idle" && state.state !== "failed") return;
  try {
    const found = await inspect(config.root);
    state = { ...state, ...found, blocked: found.blocked ?? (restart ? null : "launcher") };
  } catch (e) {
    console.error(`Update check failed: ${message(e)}`);
  }
}

/** Checks origin/main unless a check started less than 30 minutes ago; concurrent callers share one check. */
export function checkForUpdate(): Promise<void> {
  if (checking) return checking;
  if (Date.now() - lastCheck < CHECK_INTERVAL_MS) return Promise.resolve();
  lastCheck = Date.now();
  checking = check().finally(() => {
    checking = null;
  });
  return checking;
}

/**
 * `onRestart` stops the server so the launcher starts the new code; without the launcher
 * (CLAYFOLD_LAUNCHER unset) updates are listed but blocked.
 */
export function initUpdates(onRestart: () => void): void {
  restart = process.env.CLAYFOLD_LAUNCHER === "1" ? onRestart : null;
}

async function apply(): Promise<void> {
  if (waitTimer) clearInterval(waitTimer);
  waitTimer = null;
  state = { ...state, state: "installing", error: null };
  try {
    await install(config.root, state.target!);
  } catch (e) {
    console.error(`Update failed: ${message(e)}`);
    state = { ...state, state: "failed", error: message(e) };
    return;
  }
  state = { ...state, state: "restarting" };
  restart!();
}

/**
 * Starts the update to the commit the last check found. `idle` waits until no Claude process runs; new
 * runs may start meanwhile. Returns false when no update can start.
 */
export function requestUpdate(mode: UpdateMode): boolean {
  if (!state.target || state.commits.length === 0 || state.blocked || !restart) return false;
  if (state.state === "installing" || state.state === "restarting") return false;
  if (mode === "now" || runningClaude() === 0) {
    void apply();
  } else if (state.state !== "waiting") {
    state = { ...state, state: "waiting", error: null };
    waitTimer = setInterval(() => runningClaude() === 0 && void apply(), IDLE_POLL_MS);
  }
  return true;
}
