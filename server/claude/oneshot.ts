import { tmpdir } from "node:os";
import type { Effort } from "../../shared/api";
import { config } from "../config";
import { childEnv } from "./env";
import { effortArgs, roleRun } from "./roles";

export type OneShotResult<T> = { ok: true; value: T; costUsd: number | null } | { ok: false; error: string };

export type JsonPromptPurpose = "critic" | "grading" | "narration" | "video";

type ActiveCall = { pid: number; purpose: JsonPromptPurpose; model: string; effort: Effort | null; startedAt: string };

const active = new Set<ActiveCall>();

/** runJsonPrompt calls whose `claude` process is still running. */
export function activeJsonPrompts(): ActiveCall[] {
  return [...active];
}

/**
 * Runs a single tool-less `claude -p` call that must answer with JSON matching `schema`
 * (--json-schema). Used by the critic, short-answer grading, narration and video scripts.
 */
export async function runJsonPrompt<T>(opts: {
  prompt: string;
  schema: object;
  purpose: JsonPromptPurpose;
  timeoutMs?: number;
}): Promise<OneShotResult<T>> {
  const { model, effort } = roleRun(opts.purpose);
  const args = [
    config.claudeBin,
    "-p",
    opts.prompt,
    "--output-format",
    "json",
    "--json-schema",
    JSON.stringify(opts.schema),
    "--model",
    model,
    ...effortArgs(effort),
    "--tools",
    "",
    "--setting-sources",
    "",
    "--permission-mode",
    "dontAsk",
    "--no-session-persistence",
  ];
  const proc = Bun.spawn(args, {
    cwd: tmpdir(),
    env: childEnv(),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const call: ActiveCall = { pid: proc.pid, purpose: opts.purpose, model, effort, startedAt: new Date().toISOString() };
  active.add(call);
  const timer = setTimeout(() => proc.kill("SIGINT"), opts.timeoutMs ?? 120_000);
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    if (code !== 0) return { ok: false, error: `claude exited ${code}: ${(stderr || stdout).slice(0, 500)}` };
    type ResultMessage = { type?: string; is_error?: boolean; result?: string; structured_output?: T; total_cost_usd?: number };
    // --output-format json prints either the result object or the whole message array.
    const parsed = JSON.parse(stdout) as ResultMessage | ResultMessage[];
    const out = (Array.isArray(parsed) ? parsed.findLast((m) => m.type === "result") : parsed) ?? {};
    if (out.is_error || out.structured_output === undefined) {
      return { ok: false, error: `no structured output: ${String(out.result).slice(0, 500)}` };
    }
    return { ok: true, value: out.structured_output, costUsd: out.total_cost_usd ?? null };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
    active.delete(call);
  }
}
