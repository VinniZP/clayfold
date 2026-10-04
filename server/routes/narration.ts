import type { Database } from "bun:sqlite";
import { Hono } from "hono";
import { marked } from "marked";
import type { NarrationSegment, NarrationView } from "../../shared/api";
import type { Step } from "../../shared/schemas";
import type { OneShotResult } from "../claude/oneshot";
import { runJsonPrompt } from "../claude/oneshot";
import { db } from "../db";
import { elevenLabs, type Alignment, type TtsClient } from "../elevenlabs";
import { t } from "../i18n";
import { elevenLabsKey, type SecretStore } from "../secrets";
import { fail } from "./http";
import { elevenLabsFailure, narrationSettings } from "./settings";

/** Script length cap; Eleven v4 takes up to 10,000 characters per request. */
export const SCRIPT_MAX = 5000;

export type ScriptPart = { block: number; text: string };

export type NarrationRunner = <T>(opts: { prompt: string; schema: object; purpose: "narration" }) => Promise<OneShotResult<T>>;

export type NarrationDeps = { database: Database; key: SecretStore; tts: TtsClient; run: NarrationRunner };

/** Top-level markdown blocks in the order the web app renders them as children of the body element. */
export function bodyBlocks(body: string): string[] {
  return marked
    .lexer(body)
    .filter((tok) => tok.type !== "space" && tok.type !== "def")
    .map((tok) => tok.raw.trim());
}

const SCRIPT_SCHEMA = {
  type: "object",
  properties: {
    parts: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        properties: { block: { type: "integer", minimum: 0 }, text: { type: "string", minLength: 1 } },
        required: ["block", "text"],
        additionalProperties: false,
      },
    },
  },
  required: ["parts"],
  additionalProperties: false,
};

export function scriptPrompt(title: string, blocks: string[]): string {
  return [
    "Turn this lesson segment into a script for a text-to-speech voice. The learner hears the script while the written segment stays on screen, and the block being read is highlighted.",
    [
      "Rules:",
      "- Write in the language of the segment.",
      "- Say what the segment says and nothing more: no new facts, examples, greetings or closing summary.",
      "- Give script parts in block order; each part names the block it reads. Leave out a block with nothing to say aloud.",
      "- Say code, formulas, symbols and abbreviations the way a teacher reads them aloud. For a table or a code block, say what it shows instead of reading it cell by cell or character by character.",
      "- Plain spoken sentences only: no markdown, lists, emoji, URLs or stage directions.",
      `- At most ${SCRIPT_MAX} characters in total.`,
    ].join("\n"),
    `<title>${title}</title>`,
    blocks.map((b, i) => `<block index="${i}">\n${b}\n</block>`).join("\n"),
  ].join("\n\n");
}

export const MARKUP = /[`*#|]|\]\(|https?:\/\//;

export function scriptProblem(parts: ScriptPart[], blockCount: number): string | null {
  let last = 0;
  for (const p of parts) {
    if (p.block < last || p.block >= blockCount) return `block ${p.block} is out of order or range`;
    if (!p.text.trim()) return "empty part";
    if (MARKUP.test(p.text)) return `markup in part for block ${p.block}`;
    last = p.block;
  }
  return scriptText(parts).length > SCRIPT_MAX ? "script is too long" : null;
}

export const scriptText = (parts: ScriptPart[]) => parts.map((p) => p.text.trim()).join(" ");

/** Start and end of each block's speech, from the per-character timing of the text `scriptText` built. */
export function segmentTimes(parts: ScriptPart[], alignment: Alignment): NarrationSegment[] {
  const starts = alignment.character_start_times_seconds;
  const ends = alignment.character_end_times_seconds;
  const last = starts.length - 1;
  const segments: NarrationSegment[] = [];
  let offset = 0;
  for (const p of parts) {
    const length = p.text.trim().length;
    const start = starts[Math.min(offset, last)] ?? 0;
    const end = ends[Math.min(offset + length - 1, last)] ?? start;
    const prev = segments.at(-1);
    if (prev?.block === p.block) prev.end = end;
    else segments.push({ block: p.block, start, end });
    offset += length + 1;
  }
  return segments;
}

async function writeScript(title: string, blocks: string[], run: NarrationRunner): Promise<ScriptPart[]> {
  const prompt = scriptPrompt(title, blocks);
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await run<{ parts: ScriptPart[] }>({ prompt, schema: SCRIPT_SCHEMA, purpose: "narration" });
    if (res.ok && !scriptProblem(res.value.parts, blocks.length)) return res.value.parts;
  }
  fail(502, t("narration.scriptFailed"));
}

const view = (stepId: string, segments: NarrationSegment[], createdAt: string): NarrationView => ({
  audioUrl: `/api/steps/${encodeURIComponent(stepId)}/narration/audio?v=${encodeURIComponent(createdAt)}`,
  segments,
});

async function build(stepId: string, deps: NarrationDeps): Promise<NarrationView> {
  const { database } = deps;
  const row = database.query<{ kind: string; content: string }, [string]>("SELECT kind, content FROM steps WHERE id = ? AND status = 'published'").get(stepId);
  if (!row) fail(404, "step not found");
  if (row.kind !== "explain") fail(400, "only explain steps are narrated");
  const key = await deps.key.get();
  if (!key) fail(409, t("narration.noKey"));
  const { voiceId, model } = narrationSettings(database);
  if (!voiceId) fail(409, t("narration.noVoice"));

  const stored = database
    .query<{ segments: string; created_at: string }, [string, string, string]>(
      "SELECT segments, created_at FROM narrations WHERE step_id = ? AND voice_id = ? AND model = ?",
    )
    .get(stepId, voiceId, model);
  if (stored) return view(stepId, JSON.parse(stored.segments) as NarrationSegment[], stored.created_at);

  const step = JSON.parse(row.content) as Extract<Step, { kind: "explain" }>;
  const parts = await writeScript(step.title, bodyBlocks(step.body), deps.run);
  const speech = await deps.tts.speak(key, { text: scriptText(parts), voiceId, model }).catch(elevenLabsFailure);
  const segments = segmentTimes(parts, speech.alignment);
  const createdAt = new Date().toISOString();
  database
    .query(
      `INSERT INTO narrations (step_id, voice_id, model, segments, audio, created_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (step_id) DO UPDATE SET voice_id = excluded.voice_id, model = excluded.model, segments = excluded.segments,
         audio = excluded.audio, created_at = excluded.created_at`,
    )
    .run(stepId, voiceId, model, JSON.stringify(segments), speech.audio, createdAt);
  return view(stepId, segments, createdAt);
}

const pending = new Map<string, Promise<NarrationView>>();

/** Stored narration of an explain step, or a new one; concurrent calls for a step share one run. */
export function narrate(stepId: string, deps?: Partial<NarrationDeps>): Promise<NarrationView> {
  const full: NarrationDeps = { key: elevenLabsKey, tts: elevenLabs, run: runJsonPrompt, ...deps, database: deps?.database ?? db() };
  let run = pending.get(stepId);
  if (!run) {
    run = build(stepId, full).finally(() => pending.delete(stepId));
    pending.set(stepId, run);
  }
  return run;
}

export const narration = new Hono();

narration.post("/steps/:stepId/narration", async (c) => c.json(await narrate(c.req.param("stepId"))));
narration.get("/steps/:stepId/narration/audio", (c) => {
  const row = db().query<{ audio: Uint8Array<ArrayBuffer> }, [string]>("SELECT audio FROM narrations WHERE step_id = ?").get(c.req.param("stepId"));
  if (!row) fail(404, "narration not found");
  return c.body(row.audio, 200, { "content-type": "audio/mpeg", "cache-control": "private, max-age=31536000, immutable" });
});
