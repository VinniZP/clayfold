import type { Database } from "bun:sqlite";
import { Hono } from "hono";
import { z } from "zod";
import { CLAUDE_MODELS, CLAUDE_ROLES, EFFORTS, INTRO_FEATURES, TTS_MODELS, type IntroFeature, type Settings, type TtsModel } from "../../shared/api";
import { LANGS } from "../../shared/i18n";
import { roleSettingsView, setRoleSetting } from "../claude/roles";
import { db } from "../db";
import { ElevenLabsError, elevenLabs } from "../elevenlabs";
import { gameOn, setGameOn } from "../game/state";
import { language, setLanguage, t } from "../i18n";
import { elevenLabsKey } from "../secrets";
import { fail, readBody } from "./http";

const readSetting = (key: string, database: Database): unknown => {
  const row = database.query<{ value: string }, [string]>("SELECT value FROM settings WHERE key = ?").get(key);
  return row ? JSON.parse(row.value) : null;
};

const writeSetting = (key: string, value: unknown, database: Database) =>
  database.query("INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT (key) DO UPDATE SET value = ?2").run(key, JSON.stringify(value));

export function narrationSettings(database: Database = db()): { voiceId: string | null; model: TtsModel } {
  const voiceId = readSetting("narration_voice", database);
  const model = readSetting("narration_model", database);
  return {
    voiceId: typeof voiceId === "string" ? voiceId : null,
    model: TTS_MODELS.includes(model as TtsModel) ? (model as TtsModel) : TTS_MODELS[0],
  };
}

const introSeen = (database: Database = db()): IntroFeature[] => {
  const value = readSetting("intro_seen", database);
  return Array.isArray(value) ? INTRO_FEATURES.filter((f) => value.includes(f)) : [];
};

export const videoEnabled =(database: Database = db()): boolean => readSetting("video_enabled", database) === true;

const settingsView = async (): Promise<Settings> => ({
  language: language(),
  narration: { keySet: Boolean(await elevenLabsKey.get()), ...narrationSettings() },
  video: { enabled: videoEnabled() },
  claude: roleSettingsView(),
  gamification: gameOn(),
  introSeen: introSeen(),
});

/** An ElevenLabs failure as a client error: 401 is a bad key, anything else a failed upstream call. */
export function elevenLabsFailure(e: unknown): never {
  if (!(e instanceof ElevenLabsError)) throw e;
  fail(e.status === 401 ? 400 : 502, t("narration.elevenLabsFailed", { error: e.message }));
}

export const settings = new Hono();

settings.get("/settings", async (c) => c.json(await settingsView()));
settings.put("/settings", async (c) => {
  const body = await readBody(
    c,
    z.object({
      gamification: z.boolean().optional(),
      introSeen: z.array(z.enum(INTRO_FEATURES)).optional(),
      language: z.enum(LANGS).optional(),
      voiceId: z.string().min(1).optional(),
      ttsModel: z.enum(TTS_MODELS).optional(),
      videoEnabled: z.boolean().optional(),
      claudeRole: z.object({ role: z.enum(CLAUDE_ROLES), model: z.enum(CLAUDE_MODELS).nullable(), effort: z.enum(EFFORTS).nullable() }).optional(),
    }),
  );
  if (body.gamification !== undefined) setGameOn(body.gamification);
  if (body.introSeen) writeSetting("intro_seen", [...new Set(body.introSeen)], db());
  if (body.language) setLanguage(body.language);
  if (body.voiceId) writeSetting("narration_voice", body.voiceId, db());
  if (body.ttsModel) writeSetting("narration_model", body.ttsModel, db());
  if (body.videoEnabled !== undefined) writeSetting("video_enabled", body.videoEnabled, db());
  if (body.claudeRole) {
    const { role, ...setting } = body.claudeRole;
    setRoleSetting(role, setting);
  }
  return c.json(await settingsView());
});

// The key is checked by listing voices with it; the first voice becomes the default.
settings.put("/settings/elevenlabs-key", async (c) => {
  const { key } = await readBody(c, z.object({ key: z.string().trim().min(10).max(200) }));
  const voices = await elevenLabs.voices(key).catch(elevenLabsFailure);
  await elevenLabsKey.set(key);
  if (!narrationSettings().voiceId && voices[0]) writeSetting("narration_voice", voices[0].id, db());
  return c.json(await settingsView());
});
settings.delete("/settings/elevenlabs-key", async (c) => {
  await elevenLabsKey.delete();
  return c.json(await settingsView());
});

settings.get("/settings/voices", async (c) => {
  const key = await elevenLabsKey.get();
  if (!key) fail(409, t("narration.noKey"));
  return c.json(await elevenLabs.voices(key).catch(elevenLabsFailure));
});
