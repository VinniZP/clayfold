import type { Database } from "bun:sqlite";
import { beforeEach, describe, expect, test } from "bun:test";
import type { Step } from "../../shared/schemas";
import { openDb } from "../db";
import type { Alignment, TtsClient } from "../elevenlabs";
import type { SecretStore } from "../secrets";
import { bodyBlocks, narrate, scriptProblem, scriptText, segmentTimes, type NarrationRunner, type ScriptPart } from "./narration";
import { narrationSettings } from "./settings";
import { insertStep, items, seed } from "./test-fixtures";

const BODY = "## Commits\n\nA commit records a snapshot.\n\n- one\n- two\n\n```sh\ngit commit -m x\n```\n\n[ref]: https://example.org";

/** One character per 0.1 s. */
const align = (text: string): Alignment => ({
  characters: [...text],
  character_start_times_seconds: [...text].map((_, i) => i / 10),
  character_end_times_seconds: [...text].map((_, i) => (i + 1) / 10),
});

describe("script", () => {
  test("blocks match the rendered top-level elements; link definitions render nothing", () => {
    expect(bodyBlocks(BODY)).toEqual(["## Commits", "A commit records a snapshot.", "- one\n- two", "```sh\ngit commit -m x\n```"]);
  });

  test("parts go in block order, inside the body, without markup", () => {
    expect(scriptProblem([{ block: 0, text: "Commits." }, { block: 2, text: "One, two." }], 4)).toBeNull();
    expect(scriptProblem([{ block: 2, text: "a" }, { block: 1, text: "b" }], 4)).toContain("order");
    expect(scriptProblem([{ block: 4, text: "a" }], 4)).toContain("range");
    expect(scriptProblem([{ block: 0, text: "Run `git commit`." }], 4)).toContain("markup");
  });

  test("segments time each block from the alignment; parts of one block merge", () => {
    const parts: ScriptPart[] = [{ block: 0, text: "Hello." }, { block: 1, text: "Two" }, { block: 1, text: "parts." }];
    expect(segmentTimes(parts, align(scriptText(parts)))).toEqual([
      { block: 0, start: 0, end: 0.6 },
      { block: 1, start: 0.7, end: 1.7 },
    ]);
  });
});

describe("narrate", () => {
  let database: Database;
  let stepId: string;
  let runs: number;
  let speaks: number;

  const key: SecretStore = { get: async () => "sk_test", set: async () => {}, delete: async () => {} };
  const run: NarrationRunner = async <T>() => {
    runs++;
    return { ok: true, value: { parts: [{ block: 1, text: "A commit records a snapshot." }] } as T, costUsd: 0 };
  };
  const tts: TtsClient = {
    voices: async () => [],
    speak: async (_key, req) => {
      speaks++;
      return { audio: new Uint8Array([1, 2, 3]), alignment: align(req.text) };
    },
  };

  beforeEach(() => {
    database = openDb(":memory:");
    seed(database);
    const step: Step = { kind: "explain", title: "Commits", body: BODY, cites: [{ sourceId: "src1", quote: "A verbatim quote from the source." }], checks: [items.single()] };
    stepId = insertStep(database, 0, step).stepId;
    database.query("INSERT INTO settings (key, value) VALUES ('narration_voice', '\"v1\"')").run();
    runs = 0;
    speaks = 0;
  });

  test("stores the audio once per voice and model; concurrent calls share one run", async () => {
    const deps = { database, key, tts, run };
    const [a, b] = await Promise.all([narrate(stepId, deps), narrate(stepId, deps)]);
    expect(a).toEqual(b);
    expect(a.segments).toEqual([{ block: 1, start: 0, end: 2.8 }]);
    await narrate(stepId, deps);
    expect([runs, speaks]).toEqual([1, 1]);

    database.query("UPDATE settings SET value = '\"v2\"' WHERE key = 'narration_voice'").run();
    await narrate(stepId, deps);
    expect(speaks).toBe(2);
    expect(database.query("SELECT count(*) AS n FROM narrations").get()).toEqual({ n: 1 });
  });

  test("without a key nothing is called", async () => {
    const none: SecretStore = { ...key, get: async () => null };
    await expect(narrate(stepId, { database, key: none, tts, run })).rejects.toThrow();
    expect([runs, speaks]).toEqual([0, 0]);
  });
});

test("voicing ahead is off until the learner turns it on", () => {
  const database = openDb(":memory:");
  expect(narrationSettings(database)).toEqual({ voiceId: null, model: "eleven_v4", prefetch: false });
  database.query("INSERT INTO settings (key, value) VALUES ('narration_prefetch', 'true')").run();
  expect(narrationSettings(database).prefetch).toBe(true);
});
