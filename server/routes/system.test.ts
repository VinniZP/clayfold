import { beforeEach, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { config } from "../config";
import { openDb } from "../db";
import { claudeInstances, finishedView, parsePs } from "./system";
import { seed } from "./test-fixtures";

let database: Database;
beforeEach(() => {
  database = openDb(":memory:");
  seed(database);
  database.query("INSERT INTO conversations (id, topic_id, kind, lesson_id) VALUES ('cv1', 'tp1', 'lesson', 'ls1')").run();
});

test("parsePs reads pid, rss in KiB and cpu, skipping blank lines", () => {
  const stats = parsePs("  101  2048  12.5\n\n 202 512 0.0\n");
  expect([...stats]).toEqual([
    [101, { rssMb: 2, cpuPercent: 12.5 }],
    [202, { rssMb: 0.5, cpuPercent: 0 }],
  ]);
});

test("claudeInstances joins runs with their conversation and lists calls, oldest first", () => {
  const runs = [
    { conversationId: "cv1", pid: 101, startedAt: "2026-01-10T10:00:00.000Z", activities: ["Searching for sources", "Planning the lesson"], queued: 1 },
    { conversationId: "gone", pid: 303, startedAt: "2026-01-10T08:00:00.000Z", activities: [], queued: 0 },
  ];
  const calls = [{ pid: 202, purpose: "critic" as const, model: "sonnet", startedAt: "2026-01-10T09:00:00.000Z" }];
  const instances = claudeInstances(runs, calls, parsePs("101 2048 12.5"), database);
  expect(instances.map((i) => i.pid)).toEqual([202, 101]);
  expect(instances[0]).toMatchObject({ kind: "critic", model: "sonnet", conversationId: null, topicTitle: null, rssMb: null, cpuPercent: null });
  expect(instances[1]).toEqual({
    pid: 101,
    kind: "lesson",
    model: config.model,
    startedAt: "2026-01-10T10:00:00.000Z",
    conversationId: "cv1",
    topicId: "tp1",
    topicTitle: "Topic",
    lessonId: "ls1",
    activities: ["Searching for sources", "Planning the lesson"],
    queued: 1,
    rssMb: 2,
    cpuPercent: 12.5,
  });
});

test("finishedView names each finished turn's conversation and drops deleted ones", () => {
  const turn = { startedAt: "2026-01-10T10:00:00.000Z", finishedAt: "2026-01-10T10:03:00.000Z", costUsd: 0.42, error: null, cancelled: false };
  const view = finishedView([{ conversationId: "cv1", ...turn }, { conversationId: "gone", ...turn }], database);
  expect(view).toEqual([{ conversationId: "cv1", kind: "lesson", topicId: "tp1", topicTitle: "Topic", lessonId: "ls1", ...turn }]);
});
