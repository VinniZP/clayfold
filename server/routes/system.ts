import type { Database } from "bun:sqlite";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { Hono } from "hono";
import type { ClaudeInstance, ConversationKind, FinishedRun, SystemView } from "../../shared/api";
import { activeJsonPrompts } from "../claude/oneshot";
import { activeRuns, finishedRuns } from "../claude/runner";
import { config, paths } from "../config";
import { db } from "../db";
import { streamCount } from "../hub";

const MB = 1024 * 1024;
const startedAt = new Date(Date.now() - process.uptime() * 1000).toISOString();

type ProcessStats = { rssMb: number; cpuPercent: number };
type Run = ReturnType<typeof activeRuns>[number];
type Call = ReturnType<typeof activeJsonPrompts>[number];
type Finished = ReturnType<typeof finishedRuns>[number];

let lastCpu = { at: performance.now(), usage: process.cpuUsage() };

/** Server CPU since the previous call, in percent of one core. */
function serverCpuPercent(): number {
  const at = performance.now();
  const usage = process.cpuUsage();
  const usedUs = usage.user - lastCpu.usage.user + usage.system - lastCpu.usage.system;
  const elapsedUs = (at - lastCpu.at) * 1000;
  lastCpu = { at, usage };
  return elapsedUs > 0 ? (usedUs / elapsedUs) * 100 : 0;
}

const fileMb = (path: string) => (existsSync(path) ? statSync(path).size / MB : 0);

/** Parses `ps -o pid=,rss=,%cpu=` output; rss is in KiB. */
export function parsePs(stdout: string): Map<number, ProcessStats> {
  const stats = new Map<number, ProcessStats>();
  for (const line of stdout.split("\n")) {
    const [pid, rss, cpu] = line.trim().split(/\s+/).map(Number);
    if (pid && rss !== undefined && cpu !== undefined && !Number.isNaN(rss) && !Number.isNaN(cpu)) {
      stats.set(pid, { rssMb: rss / 1024, cpuPercent: cpu });
    }
  }
  return stats;
}

async function processStats(pids: number[]): Promise<Map<number, ProcessStats>> {
  if (!pids.length) return new Map();
  // ps exits 1 when a process has already exited; the others are still printed.
  const proc = Bun.spawn(["ps", "-o", "pid=,rss=,%cpu=", "-p", pids.join(",")], { stdout: "pipe", stderr: "ignore" });
  const stdout = await new Response(proc.stdout).text();
  await proc.exited;
  return parsePs(stdout);
}

type ConversationRow = { id: string; kind: ConversationKind; lesson_id: string | null; topic_id: string; title: string };

function conversations(ids: string[], database: Database): Map<string, ConversationRow> {
  const rows = database
    .query<ConversationRow, [string]>(
      `SELECT c.id, c.kind, c.lesson_id, c.topic_id, t.title
       FROM conversations c JOIN topics t ON t.id = c.topic_id
       WHERE c.id IN (SELECT value FROM json_each(?))`,
    )
    .all(JSON.stringify(ids));
  return new Map(rows.map((r) => [r.id, r]));
}

/** Finished turns of conversations that still exist. */
export function finishedView(runs: Finished[], database: Database = db()): FinishedRun[] {
  const byId = conversations(runs.map((r) => r.conversationId), database);
  return runs.flatMap((run): FinishedRun[] => {
    const conv = byId.get(run.conversationId);
    return conv ? [{ ...run, kind: conv.kind, topicId: conv.topic_id, topicTitle: conv.title, lessonId: conv.lesson_id }] : [];
  });
}

export function claudeInstances(runs: Run[], calls: Call[], stats: Map<number, ProcessStats>, database: Database = db()): ClaudeInstance[] {
  const byId = conversations(runs.map((r) => r.conversationId), database);
  const fromRuns = runs.flatMap((run): ClaudeInstance[] => {
    const conv = byId.get(run.conversationId);
    if (!conv) return [];
    return [
      {
        pid: run.pid,
        kind: conv.kind,
        model: config.model,
        startedAt: run.startedAt,
        conversationId: conv.id,
        topicId: conv.topic_id,
        topicTitle: conv.title,
        lessonId: conv.lesson_id,
        activities: run.activities,
        queued: run.queued,
        rssMb: stats.get(run.pid)?.rssMb ?? null,
        cpuPercent: stats.get(run.pid)?.cpuPercent ?? null,
      },
    ];
  });
  const fromCalls = calls.map(
    (call): ClaudeInstance => ({
      pid: call.pid,
      kind: call.purpose,
      model: call.model,
      startedAt: call.startedAt,
      conversationId: null,
      topicId: null,
      topicTitle: null,
      lessonId: null,
      activities: [],
      queued: 0,
      rssMb: stats.get(call.pid)?.rssMb ?? null,
      cpuPercent: stats.get(call.pid)?.cpuPercent ?? null,
    }),
  );
  return [...fromRuns, ...fromCalls].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

export const system = new Hono();

system.get("/system", async (c) => {
  const runs = activeRuns();
  const calls = activeJsonPrompts();
  const stats = await processStats([...runs.map((r) => r.pid), ...calls.map((call) => call.pid)]);
  const memory = process.memoryUsage();
  const index = join(config.root, "web", "dist", "index.html");
  const view: SystemView = {
    backend: {
      pid: process.pid,
      startedAt,
      bun: Bun.version,
      port: config.port,
      rssMb: memory.rss / MB,
      heapMb: memory.heapUsed / MB,
      cpuPercent: serverCpuPercent(),
      dbMb: fileMb(paths.db) + fileMb(`${paths.db}-wal`),
      model: config.model,
      criticModel: config.criticModel,
      maxBudgetUsd: config.maxBudgetUsd,
    },
    frontend: {
      builtAt: existsSync(index) ? statSync(index).mtime.toISOString() : null,
      streams: streamCount(),
    },
    instances: claudeInstances(runs, calls, stats),
    finished: finishedView(finishedRuns()),
  };
  return c.json(view);
});
