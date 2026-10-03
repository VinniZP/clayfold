import type { TtsModel, VoiceView } from "../shared/api";

const API = "https://api.elevenlabs.io";

export class ElevenLabsError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Seconds per character of the request text. */
export type Alignment = {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
};

export type Speech = { audio: Uint8Array; alignment: Alignment };

export type TtsClient = {
  voices(key: string): Promise<VoiceView[]>;
  speak(key: string, req: { text: string; voiceId: string; model: TtsModel }): Promise<Speech>;
};

async function call<T>(key: string, path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, { ...init, headers: { "xi-api-key": key, "content-type": "application/json" } });
  } catch (e) {
    throw new ElevenLabsError(e instanceof Error ? e.message : String(e), 502);
  }
  if (!res.ok) throw new ElevenLabsError(await errorDetail(res), res.status);
  return (await res.json()) as T;
}

// Error bodies are { detail: string } or { detail: { status, message } }.
async function errorDetail(res: Response): Promise<string> {
  const text = await res.text();
  try {
    const detail = (JSON.parse(text) as { detail?: unknown }).detail;
    if (typeof detail === "string") return detail;
    if (detail && typeof detail === "object" && "message" in detail) return String(detail.message);
  } catch {}
  return `HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`;
}

type VoicesResponse = { voices: { voice_id: string; name: string; preview_url?: string | null }[] };

export const elevenLabs: TtsClient = {
  async voices(key) {
    const res = await call<VoicesResponse>(key, "/v2/voices?page_size=100&sort=name&sort_direction=asc");
    return res.voices.map((v) => ({ id: v.voice_id, name: v.name, previewUrl: v.preview_url ?? null }));
  },
  async speak(key, req) {
    const res = await call<{ audio_base64: string; alignment?: Alignment | null }>(
      key,
      `/v1/text-to-speech/${encodeURIComponent(req.voiceId)}/with-timestamps?output_format=mp3_44100_128`,
      { method: "POST", body: JSON.stringify({ text: req.text, model_id: req.model }) },
    );
    if (!res.alignment) throw new ElevenLabsError("response has no alignment", 502);
    return { audio: Buffer.from(res.audio_base64, "base64"), alignment: res.alignment };
  },
};
