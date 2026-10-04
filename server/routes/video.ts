import type { Database } from "bun:sqlite";
import { Hono } from "hono";
import type { CuedText, VideoScene, VideoScreen, VideoStatus, VideoTimeline, VideoView } from "../../shared/api";
import type { Figure, Step } from "../../shared/schemas";
import type { OneShotResult } from "../claude/oneshot";
import { runJsonPrompt } from "../claude/oneshot";
import { db } from "../db";
import { ElevenLabsError, elevenLabs, type Alignment, type TtsClient } from "../elevenlabs";
import { t } from "../i18n";
import { elevenLabsKey, type SecretStore } from "../secrets";
import { config } from "../config";
import { ExportBusyError, exportFile, exportView, removeExports, startExport } from "../video-export";
import { fail } from "./http";
import { bodyBlocks, MARKUP } from "./narration";
import { narrationSettings, videoEnabled } from "./settings";

/** Narration cap per chapter; Eleven v4 takes up to 10,000 characters per request. */
export const CHAPTER_SCRIPT_MAX = 5000;
const SCENES_MAX = 12;
/** About 30 seconds of speech: the picture changes at least that often. */
const SCENE_NARRATION_MAX = 550;
const POINTS = { min: 1, max: 5 };
const LINES_MAX = 10;
const HEADING_MAX = 90;
const SCREEN_TEXT_MAX = 180;
const SUMMARY_POINTS = { min: 3, max: 5 };
const CAPTION_MAX = 64;

// Timeline pacing, in seconds.
const CHAPTER_CARD = 2.5;
const GAP = 0.6;
const TAIL = 3;
/** The first cued text of a scene shows by then, so a slow lead-in does not leave the screen empty. */
const FIRST_CUE_MAX = 2.5;
/** mp3_44100_128 is constant bitrate: 16,000 bytes per second. */
const MP3_BYTES_PER_SECOND = 16_000;

const PARALLEL_SCRIPTS = 4;
const PARALLEL_VOICES = 3;

/** An expected build failure: its message is shown to the learner. */
class VideoBuildError extends Error {}

export type VideoRunner = <T>(opts: { prompt: string; schema: object; purpose: "video" }) => Promise<OneShotResult<T>>;

export type VideoDeps = { database: Database; key: SecretStore; tts: TtsClient; run: VideoRunner };

// ---------- Source ----------

/**
 * One chapter per published explain or worked_example step. An explain step's blocks are the top-level markdown
 * blocks of its body; a worked example's are the problem and every solution line, faded ones included: the video
 * shows the whole solution.
 */
export type SourceChapter = { idx: number; kind: "explain" | "worked_example"; title: string; blocks: string[]; figure: Figure | null };

export function videoSource(lessonId: string, database: Database): SourceChapter[] {
  return database
    .query<{ idx: number; content: string }, [string]>(
      "SELECT idx, content FROM steps WHERE lesson_id = ? AND status = 'published' AND kind IN ('explain', 'worked_example') ORDER BY idx",
    )
    .all(lessonId)
    .map(({ idx, content }) => {
      const step = JSON.parse(content) as Extract<Step, { kind: "explain" | "worked_example" }>;
      const blocks = step.kind === "explain" ? bodyBlocks(step.body) : [step.problem, ...step.lines.map((l) => l.text)];
      return { idx, kind: step.kind, title: step.title, blocks, figure: step.figure ?? null };
    });
}

// ---------- Scripts ----------

type DraftCue = { text: string; cue: string };
type DraftScreen = {
  kind: "points" | "statement" | "block" | "figure" | "example";
  heading?: string;
  points?: DraftCue[];
  text?: string;
  note?: string;
  block?: number;
  caption?: string;
  problem?: string;
  lines?: DraftCue[];
};
export type DraftScene = { narration: string; covers: number[]; screen: DraftScreen };
export type DraftFrame = {
  intro: { narration: string; subheading: string };
  outro: { narration: string; heading: string; points: DraftCue[] };
};

const str = { type: "string", minLength: 1 };
const cued = { type: "array", items: { type: "object", properties: { text: str, cue: str }, required: ["text", "cue"], additionalProperties: false } };

const CHAPTER_SCHEMA = {
  type: "object",
  properties: {
    scenes: {
      type: "array",
      minItems: 1,
      maxItems: SCENES_MAX,
      items: {
        type: "object",
        properties: {
          narration: str,
          covers: { type: "array", items: { type: "integer", minimum: 0 } },
          screen: {
            type: "object",
            properties: {
              kind: { type: "string", enum: ["points", "statement", "block", "figure", "example"] },
              heading: str,
              points: cued,
              text: str,
              note: str,
              block: { type: "integer", minimum: 0 },
              caption: str,
              problem: str,
              lines: cued,
            },
            required: ["kind"],
            additionalProperties: false,
          },
        },
        required: ["narration", "covers", "screen"],
        additionalProperties: false,
      },
    },
  },
  required: ["scenes"],
  additionalProperties: false,
};

const FRAME_SCHEMA = {
  type: "object",
  properties: {
    intro: { type: "object", properties: { narration: str, subheading: str }, required: ["narration", "subheading"], additionalProperties: false },
    outro: {
      type: "object",
      properties: { narration: str, heading: str, points: cued },
      required: ["narration", "heading", "points"],
      additionalProperties: false,
    },
  },
  required: ["intro", "outro"],
  additionalProperties: false,
};

const NARRATION_RULES = [
  "Narration:",
  "- Plain spoken sentences in the language of the lesson, the way a gifted teacher explains at a whiteboard: concrete, warm, with a clear thread from one idea to the next.",
  "- Say formulas, symbols, code and abbreviations the way a teacher reads them aloud.",
  "- No markdown, lists, URLs, emoji or stage directions.",
].join("\n");

const SCREEN_RULES = [
  "Screen text:",
  "- It supports the narration and does not repeat it word for word: key terms, a formula, a short phrase.",
  "- Inline markdown such as `code` or **bold** is allowed; bold marks the one or two words that matter most.",
  `- Headings at most ${HEADING_MAX} characters, points and lines at most 160.`,
].join("\n");

const CUE_RULE =
  "- Every point and every line has a `cue`: two to six consecutive words copied exactly from the same scene's narration, at the moment the narration reaches that point. The point appears on screen then.";

function chapterXml(c: SourceChapter): string {
  const label = (i: number) => (c.kind === "worked_example" ? (i === 0 ? "Problem: " : `Solution line ${i}: `) : "");
  const blocks = c.blocks.map((b, i) => `<block index="${i}">${label(i)}${b}</block>`).join("\n");
  const figure = c.figure
    ? `\n<figure>\nShows: ${c.figure.teaches}\nDescription: ${c.figure.alt}${c.figure.caption ? `\nCaption: ${c.figure.caption}` : ""}\n</figure>`
    : "";
  return `<step kind="${c.kind}" title="${c.title}">\n${blocks}${figure}\n</step>`;
}

export function chapterPrompt(lesson: { title: string; objective: string }, chapters: SourceChapter[], n: number, problems: string[] = []): string {
  const c = chapters[n]!;
  return [
    `You write chapter ${n + 1} of ${chapters.length} of a narrated explainer video made from the lesson "${lesson.title}" (objective: ${lesson.objective}). The video replaces reading the lesson: a viewer who only watches it must learn everything the chapter's source says. It is also published on its own, so it must make sense without the app. A chapter card with the chapter title is shown before the chapter.`,
    [
      "Coverage:",
      "- Every fact, definition, step, number and example in the source appears in the chapter, in the narration or on screen.",
      "- `covers` lists the source blocks each scene presents; together the scenes cover every block.",
      "- Use only the source: no facts, examples, numbers or names of your own. You may reorder, regroup and explain differently.",
    ].join("\n"),
    [
      `Scenes, 1 to ${SCENES_MAX}, in teaching order. The picture changes with every idea: one scene per idea, 15 to 30 seconds of speech each (at most ${SCENE_NARRATION_MAX} characters of narration). Vary the kinds:`,
      `- \`points\`: a heading and ${POINTS.min} to ${POINTS.max} short points.`,
      "- `statement`: one key sentence, definition or rule as `text`, with an optional short `note`.",
      "- `block`: the index of one source block shown as written. Use it for code, tables and formulas; the narration says what the block shows.",
      c.figure
        ? "- `figure`: the step's figure, with a heading and a short `caption`; the narration walks through it. Use it exactly once."
        : "- This step has no figure: do not use `figure`.",
      `- \`example\`: a heading, the \`problem\` and up to ${LINES_MAX} solution \`lines\`.${c.kind === "worked_example" ? " Show every line of the worked solution." : ""}`,
      CUE_RULE,
    ].join("\n"),
    `${NARRATION_RULES}\n- Start with the subject itself: no greeting, and do not announce the chapter number.\n- At most ${CHAPTER_SCRIPT_MAX} characters for the chapter.`,
    SCREEN_RULES,
    chapterXml(c),
    ...(problems.length ? [`Your previous chapter broke these rules; fix them:\n${problems.map((p) => `- ${p}`).join("\n")}`] : []),
  ].join("\n\n");
}

export function framePrompt(lesson: { title: string; objective: string }, chapters: SourceChapter[], problems: string[] = []): string {
  return [
    `You write the opening and the closing of a narrated explainer video made from the lesson "${lesson.title}". The chapters in between, one per lesson step, are written separately. The video is also published on its own.`,
    [
      "Opening:",
      "- `subheading`: the objective as one short line of at most 120 characters.",
      "- `narration`: two to four sentences: a hook that makes the topic matter, then what the viewer will understand by the end. Do not list the chapters.",
    ].join("\n"),
    [
      "Closing:",
      "- `heading`: a short heading meaning \"key takeaways\".",
      `- \`points\`: ${SUMMARY_POINTS.min} to ${SUMMARY_POINTS.max} takeaways, the central ideas of the whole lesson.`,
      "- `narration`: three to six sentences recapping the takeaways, then one sentence inviting the viewer to test themselves on what they saw.",
      CUE_RULE,
    ].join("\n"),
    `${NARRATION_RULES}\n- Use only the lesson: no facts of your own.`,
    SCREEN_RULES,
    `<lesson title="${lesson.title}">\n<objective>${lesson.objective}</objective>\n${chapters.map(chapterXml).join("\n")}\n</lesson>`,
    ...(problems.length ? [`Your previous answer broke these rules; fix them:\n${problems.map((p) => `- ${p}`).join("\n")}`] : []),
  ].join("\n\n");
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/**
 * A rule a script broke; `text` goes back to Claude. A `repeat` alone does not reject a script: when no attempt avoids
 * it, the last such script is used.
 */
export type Problem = { kind: "coverage" | "format" | "length" | "narration" | "repeat"; text: string };

const problem = (kind: Problem["kind"], text: string): Problem => ({ kind, text });

function narrationProblems(where: string, narration: string, shown: string[]): Problem[] {
  const problems: Problem[] = [];
  if (!narration.trim()) problems.push(problem("narration", `${where}: empty narration`));
  if (MARKUP.test(narration)) problems.push(problem("narration", `${where}: markup in narration`));
  const spoken = norm(narration);
  if (shown.some((s) => norm(s).length >= 30 && spoken.includes(norm(s)))) problems.push(problem("repeat", `${where}: screen text repeats the narration word for word`));
  if (shown.some((s) => s.length > SCREEN_TEXT_MAX)) problems.push(problem("length", `${where}: a point or line over ${SCREEN_TEXT_MAX} characters`));
  return problems;
}

export function chapterProblems(scenes: DraftScene[], chapter: SourceChapter): Problem[] {
  const problems: Problem[] = [];
  const n = chapter.blocks.length;
  if (scenes.length < 1 || scenes.length > SCENES_MAX) problems.push(problem("format", `${scenes.length} scenes; write 1 to ${SCENES_MAX}`));
  const covered = new Set<number>();
  scenes.forEach(({ narration, covers, screen }, i) => {
    const where = `scene ${i + 1} (${screen.kind})`;
    for (const b of covers) {
      if (b >= 0 && b < n) covered.add(b);
      else problems.push(problem("coverage", `${where}: covers block ${b}, which does not exist`));
    }
    const need = (field: keyof DraftScreen) => screen[field] === undefined && problems.push(problem("format", `${where} has no ${field}`));
    if (screen.kind !== "statement") need("heading");
    if (screen.kind === "points" && !(screen.points && screen.points.length >= POINTS.min && screen.points.length <= POINTS.max)) {
      problems.push(problem("format", `${where}: ${POINTS.min} to ${POINTS.max} points`));
    }
    if (screen.kind === "statement") need("text");
    if (screen.kind === "block" && !(screen.block !== undefined && screen.block < n)) problems.push(problem("format", `${where}: block ${screen.block ?? "(none)"} does not exist`));
    if (screen.kind === "figure" && !chapter.figure) problems.push(problem("format", `${where}: this step has no figure`));
    if (screen.kind === "example") {
      need("problem");
      if (!(screen.lines?.length && screen.lines.length <= LINES_MAX)) problems.push(problem("format", `${where}: 1 to ${LINES_MAX} lines`));
    }
    if ((screen.heading?.length ?? 0) > HEADING_MAX) problems.push(problem("length", `${where}: heading over ${HEADING_MAX} characters`));
    const spoken = narration.trim().length;
    if (spoken > SCENE_NARRATION_MAX) problems.push(problem("length", `${where}: narration is ${spoken} characters; split the scene (at most ${SCENE_NARRATION_MAX})`));
    // A statement is the one sentence the narration is meant to say aloud; lists are what must not be read out.
    const shown = [...(screen.points ?? []), ...(screen.lines ?? [])].map((p) => p.text);
    problems.push(...narrationProblems(where, narration, shown));
  });
  const missing = chapter.blocks.map((_, i) => i).filter((i) => !covered.has(i));
  if (missing.length) problems.push(problem("coverage", `blocks ${missing.join(", ")} are not covered by any scene`));
  if (chapter.figure && !scenes.some((s) => s.screen.kind === "figure")) problems.push(problem("coverage", "the step's figure is not shown"));
  const total = clipText(scenes).length;
  if (total > CHAPTER_SCRIPT_MAX) problems.push(problem("length", `narration is ${total} characters; at most ${CHAPTER_SCRIPT_MAX}`));
  return problems;
}

export function frameProblems(frame: DraftFrame): Problem[] {
  const problems: Problem[] = [];
  const { points } = frame.outro;
  if (points.length < SUMMARY_POINTS.min || points.length > SUMMARY_POINTS.max) problems.push(problem("format", `closing: ${SUMMARY_POINTS.min} to ${SUMMARY_POINTS.max} points`));
  if (frame.intro.subheading.length > 160) problems.push(problem("length", "opening: subheading over 160 characters"));
  problems.push(...narrationProblems("opening", frame.intro.narration, []));
  problems.push(...narrationProblems("closing", frame.outro.narration, points.map((p) => p.text)));
  return problems;
}

const ATTEMPTS = 3;
const brief = (s: string) => (s.length > 200 ? `${s.slice(0, 200)}…` : s);

/**
 * One script, retried with the problems the checks found. `part` names it in errors, e.g. "Chapter 2 «Commits»".
 * Each rejected attempt is logged with its problems.
 */
async function draft<T>(part: string, prompt: (problems: string[]) => string, schema: object, check: (v: T) => Problem[], run: VideoRunner): Promise<T> {
  let problems: Problem[] = [];
  let usable: T | null = null;
  let callError: string | null = null;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const res = await run<T>({ prompt: prompt(problems.map((p) => p.text)), schema, purpose: "video" });
    if (!res.ok) {
      callError = res.error;
      console.warn(`[video] ${part}, attempt ${attempt}: ${res.error}`);
      continue;
    }
    callError = null;
    problems = check(res.value);
    if (!problems.length) return res.value;
    if (problems.every((p) => p.kind === "repeat")) usable = res.value;
    console.warn(`[video] ${part}, attempt ${attempt}:\n  ${problems.map((p) => p.text).join("\n  ")}`);
  }
  if (usable) return usable;
  if (callError) throw new VideoBuildError(t("video.claudeFailed", { part, error: brief(callError) }));
  const reasons = [...new Set(problems.filter((p) => p.kind !== "repeat").map((p) => p.kind))];
  throw new VideoBuildError(t("video.scriptRejected", { part, attempts: ATTEMPTS, reasons: reasons.map((k) => t(`video.reason.${k as Exclude<Problem["kind"], "repeat">}`)).join("; ") }));
}

// ---------- Timeline ----------

type Cue = (c: DraftCue, i: number, of: number) => CuedText;

/** The narration of one clip, split into scenes, with what each scene shows. */
export type ClipPlan = { narration: string; screen: (cue: Cue) => VideoScreen }[];

export const clipText = (parts: { narration: string }[]) => parts.map((p) => p.narration.trim()).join(" ");

/** Where `cue` starts in `narration`, ignoring case; null when it is not there. */
export function cueOffset(narration: string, cue: string): number | null {
  const at = narration.toLowerCase().indexOf(cue.trim().toLowerCase());
  return at >= 0 ? at : null;
}

/**
 * Places one clip at `start`: each scene begins at its first spoken character, and each cued text appears when its
 * cue is spoken, in list order. A cue the narration does not contain falls back to an even spread over the scene.
 */
export function placeClip(plan: ClipPlan, alignment: Alignment, start: number, duration: number): VideoScene[] {
  const starts = alignment.character_start_times_seconds;
  const last = starts.length - 1;
  const timeAt = (offset: number) => start + (starts[Math.min(Math.max(offset, 0), last)] ?? 0);
  let offset = 0;
  return plan.map((part, i) => {
    const text = part.narration.trim();
    const sceneOffset = offset;
    offset += text.length + 1;
    const sceneStart = i === 0 ? start : timeAt(sceneOffset);
    const sceneEnd = i + 1 < plan.length ? timeAt(offset) : start + duration;
    let previous = sceneStart;
    const screen = part.screen((c, k, of) => {
      const found = cueOffset(text, c.cue);
      const spoken = found === null ? sceneStart + ((sceneEnd - sceneStart) * 0.7 * (k + 1)) / (of + 1) : timeAt(sceneOffset + found);
      const at = Math.max(previous, k === 0 ? Math.min(spoken, sceneStart + FIRST_CUE_MAX) : spoken);
      previous = at;
      return { text: c.text, at };
    });
    return { screen, start: sceneStart };
  });
}

/** Subtitle lines: words grouped up to CAPTION_MAX characters, broken after sentence and clause ends. */
export function captionLines(text: string, alignment: Alignment, start: number): VideoTimeline["captions"] {
  const starts = alignment.character_start_times_seconds;
  const ends = alignment.character_end_times_seconds;
  const last = starts.length - 1;
  const lines: VideoTimeline["captions"] = [];
  let lineStart = -1;
  let lineEnd = -1;
  const flush = () => {
    if (lineStart < 0) return;
    lines.push({ text: text.slice(lineStart, lineEnd + 1).trim(), start: start + starts[Math.min(lineStart, last)]!, end: start + ends[Math.min(lineEnd, last)]! });
    lineStart = -1;
  };
  for (const m of text.matchAll(/\S+/g)) {
    const from = m.index;
    const to = from + m[0].length - 1;
    if (lineStart >= 0 && to - lineStart + 1 > CAPTION_MAX) flush();
    if (lineStart < 0) lineStart = from;
    lineEnd = to;
    if (/[.!?…;:]["»”)]?$/.test(m[0]) || (/,$/.test(m[0]) && to - lineStart > CAPTION_MAX / 2)) flush();
  }
  flush();
  return lines;
}

function chapterPlan(scenes: DraftScene[], chapter: SourceChapter): ClipPlan {
  return scenes.map(({ narration, screen: s }) => ({
    narration,
    screen: (cue): VideoScreen => {
      const all = (list: DraftCue[] = []) => list.map((c, k) => cue(c, k, list.length));
      switch (s.kind) {
        case "points":
          return { kind: "points", heading: s.heading!, points: all(s.points) };
        case "statement":
          return { kind: "statement", text: s.text!, note: s.note ?? null };
        case "block":
          return { kind: "block", heading: s.heading!, markdown: chapter.blocks[s.block!]! };
        case "figure":
          return { kind: "figure", heading: s.heading!, figure: chapter.figure!, caption: s.caption ?? null };
        case "example":
          return { kind: "example", heading: s.heading!, problem: s.problem!, lines: all(s.lines) };
      }
    },
  }));
}

export type Voiced = { audio: Uint8Array; alignment: Alignment; duration: number };

/** Lays the intro, a card and a clip per chapter, and the summary end to end. `voiced` follows the same order. */
export function assembleTimeline(chapters: SourceChapter[], plans: ClipPlan[], voiced: Voiced[]): VideoTimeline {
  const timeline: VideoTimeline = { duration: 0, scenes: [], clips: [], chapters: [], captions: [] };
  let at = 0;
  plans.forEach((plan, i) => {
    const chapter = i >= 1 && i <= chapters.length ? chapters[i - 1]! : null;
    if (i > 0) at += GAP;
    if (chapter) {
      timeline.chapters.push({ title: chapter.title, start: at });
      timeline.scenes.push({ screen: { kind: "chapter", number: i, heading: chapter.title }, start: at });
      at += CHAPTER_CARD;
    }
    const v = voiced[i]!;
    timeline.clips.push({ start: at, duration: v.duration });
    timeline.scenes.push(...placeClip(plan, v.alignment, at, v.duration));
    timeline.captions.push(...captionLines(clipText(plan), v.alignment, at));
    at += v.duration;
  });
  timeline.duration = at + TAIL;
  return timeline;
}

// ---------- Build ----------

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!, i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

const partName = (i: number, chapters: SourceChapter[]) => t("video.partChapter", { n: i + 1, title: chapters[i]!.title });

// Builds in this process. A `building` row without an entry here was cut off by a restart.
const running = new Map<string, { done: number; total: number }>();

async function build(lessonId: string, lesson: { title: string; objective: string }, chapters: SourceChapter[], key: string, deps: VideoDeps): Promise<void> {
  const progress = running.get(lessonId)!;
  const tick = <T>(v: T): T => {
    progress.done++;
    return v;
  };
  const { voiceId, model } = narrationSettings(deps.database);

  const [frame, drafts] = await Promise.all([
    draft<DraftFrame>(t("video.partFrame"), (p) => framePrompt(lesson, chapters, p), FRAME_SCHEMA, frameProblems, deps.run).then(tick),
    mapLimit(chapters, PARALLEL_SCRIPTS, (c, i) =>
      draft<{ scenes: DraftScene[] }>(
        partName(i, chapters),
        (p) => chapterPrompt(lesson, chapters, i, p),
        CHAPTER_SCHEMA,
        (v) => chapterProblems(v.scenes, c),
        deps.run,
      ).then(tick),
    ),
  ]);

  const intro: ClipPlan = [
    {
      narration: frame.intro.narration,
      screen: () => ({ kind: "intro", heading: lesson.title, subheading: frame.intro.subheading, chapters: chapters.map((c, i) => ({ text: c.title, at: 1.2 + i * 0.25 })) }),
    },
  ];
  const outro: ClipPlan = [
    {
      narration: frame.outro.narration,
      screen: (cue) => ({ kind: "summary", heading: frame.outro.heading, points: frame.outro.points.map((c, k) => cue(c, k, frame.outro.points.length)) }),
    },
  ];
  const plans = [intro, ...drafts.map((d, i) => chapterPlan(d.scenes, chapters[i]!)), outro];
  const voiced = await mapLimit(plans, PARALLEL_VOICES, async (plan, i) => {
    const part = i === 0 || i === plans.length - 1 ? t("video.partFrame") : partName(i - 1, chapters);
    const speech = await deps.tts.speak(key, { text: clipText(plan), voiceId: voiceId!, model }).catch((e: unknown) => {
      if (e instanceof ElevenLabsError) throw new VideoBuildError(t("video.voiceFailed", { part, error: brief(e.message) }));
      throw e;
    });
    const spoken = speech.alignment.character_end_times_seconds.at(-1) ?? 0;
    return tick({ ...speech, duration: Math.max(spoken, speech.audio.length / MP3_BYTES_PER_SECOND) });
  });

  const timeline = assembleTimeline(chapters, plans, voiced);
  deps.database.transaction(() => {
    deps.database.query("DELETE FROM video_clips WHERE lesson_id = ?").run(lessonId);
    const insert = deps.database.query("INSERT INTO video_clips (lesson_id, idx, audio) VALUES (?, ?, ?)");
    voiced.forEach((v, i) => insert.run(lessonId, i, v.audio));
    deps.database.query("UPDATE videos SET status = 'ready', timeline = ?, error = NULL WHERE lesson_id = ?").run(JSON.stringify(timeline), lessonId);
  })();
}

type VideoRow = { status: VideoStatus; timeline: string | null; error: string | null; created_at: string };

export function videoView(lessonId: string, database: Database = db()): VideoView | null {
  const row = database.query<VideoRow, [string]>("SELECT status, timeline, error, created_at FROM videos WHERE lesson_id = ?").get(lessonId);
  if (!row) return null;
  if (row.status === "building") {
    const progress = running.get(lessonId);
    return progress ? { status: "building", ...progress } : { status: "failed", error: t("video.interrupted") };
  }
  if (row.status === "failed") return { status: "failed", error: row.error ?? t("video.scriptFailed") };
  if (!row.timeline) return { status: "failed", error: t("video.outdated") };
  const timeline = JSON.parse(row.timeline) as VideoTimeline;
  const version = encodeURIComponent(row.created_at);
  const clipUrls = timeline.clips.map((_, i) => `/api/lessons/${encodeURIComponent(lessonId)}/video/clips/${i}?v=${version}`);
  return { status: "ready", clipUrls, ...timeline };
}

export const videoStatus = (lessonId: string, database: Database = db()): VideoStatus | null => videoView(lessonId, database)?.status ?? null;

const failure = (e: unknown): string =>
  e instanceof VideoBuildError ? e.message : t("video.unexpected", { error: brief(e instanceof Error ? e.message : String(e)) });

/** Starts a build in the background; `done` settles when the row is ready or failed. */
export async function requestVideo(lessonId: string, deps?: Partial<VideoDeps>): Promise<{ view: VideoView; done: Promise<void> }> {
  const full: VideoDeps = { key: elevenLabsKey, tts: elevenLabs, run: runJsonPrompt, ...deps, database: deps?.database ?? db() };
  const { database } = full;
  if (!videoEnabled(database)) fail(409, t("video.disabled"));
  const lesson = database.query<{ title: string; objective: string; status: string }, [string]>("SELECT title, objective, status FROM lessons WHERE id = ?").get(lessonId);
  if (!lesson) fail(404, "lesson not found");
  const progress = running.get(lessonId);
  if (progress) return { view: { status: "building", ...progress }, done: Promise.resolve() };
  if (lesson.status !== "ready" && lesson.status !== "finished") fail(409, t("video.lessonNotReady"));
  const chapters = videoSource(lessonId, database);
  if (!chapters.length) fail(409, t("video.noSource"));
  const key = await full.key.get();
  if (!key) fail(409, t("video.noKey"));
  if (!narrationSettings(database).voiceId) fail(409, t("narration.noVoice"));

  database.transaction(() => {
    database
      .query(
        `INSERT INTO videos (lesson_id, status, created_at) VALUES (?1, 'building', ?2)
         ON CONFLICT (lesson_id) DO UPDATE SET status = 'building', timeline = NULL, error = NULL, created_at = ?2`,
      )
      .run(lessonId, new Date().toISOString());
    database.query("DELETE FROM video_clips WHERE lesson_id = ?").run(lessonId);
  })();
  removeExports(lessonId);
  // Scripts: the frame and one per chapter. Clips: the intro, one per chapter and the summary.
  const started = { done: 0, total: 2 * chapters.length + 3 };
  running.set(lessonId, started);
  const done = build(lessonId, lesson, chapters, key, full)
    .catch((e: unknown) => {
      if (!(e instanceof VideoBuildError)) console.error(e);
      database.query("UPDATE videos SET status = 'failed', error = ? WHERE lesson_id = ?").run(failure(e), lessonId);
    })
    .finally(() => running.delete(lessonId));
  return { view: { status: "building", ...started }, done };
}

export const video = new Hono();

video.get("/lessons/:lessonId/video", (c) => {
  const view = videoView(c.req.param("lessonId"));
  if (!view) fail(404, "no video for this lesson");
  return c.json(view);
});
video.post("/lessons/:lessonId/video", async (c) => c.json((await requestVideo(c.req.param("lessonId"))).view));
video.get("/lessons/:lessonId/video/clips/:idx", (c) => {
  const row = db()
    .query<{ audio: Uint8Array<ArrayBuffer> }, [string, number]>("SELECT audio FROM video_clips WHERE lesson_id = ? AND idx = ?")
    .get(c.req.param("lessonId"), Number(c.req.param("idx")));
  if (!row) fail(404, "no such narration clip");
  return c.body(row.audio, 200, { "content-type": "audio/mpeg", "cache-control": "private, max-age=31536000, immutable" });
});

// ---------- Export ----------

/** The version of the lesson's ready video, or null. */
function readyVideo(lessonId: string, database: Database = db()): { version: string; title: string } | null {
  const row = database
    .query<{ created_at: string; title: string }, [string]>(
      "SELECT v.created_at, l.title FROM videos v JOIN lessons l ON l.id = v.lesson_id WHERE v.lesson_id = ? AND v.status = 'ready' AND v.timeline IS NOT NULL",
    )
    .get(lessonId);
  return row ? { version: row.created_at, title: row.title } : null;
}

const attachment = (title: string, ext: string) => `attachment; filename*=UTF-8''${encodeURIComponent(`${title.replace(/[\\/:*?"<>|]+/g, " ").trim() || "video"}.${ext}`)}`;

video.get("/lessons/:lessonId/video/export", (c) => {
  const lessonId = c.req.param("lessonId");
  return c.json(exportView(lessonId, readyVideo(lessonId)?.version ?? null));
});
video.post("/lessons/:lessonId/video/export", (c) => {
  const lessonId = c.req.param("lessonId");
  const ready = readyVideo(lessonId);
  const view = videoView(lessonId);
  if (!ready || view?.status !== "ready") fail(409, t("video.exportNotReady"));
  // Headless Chrome fetches the narration clips from this server.
  const clipSrcs = view.clipUrls.map((url) => `http://127.0.0.1:${config.port}${url}`);
  try {
    return c.json(startExport(lessonId, ready.version, { title: ready.title, timeline: view, clipSrcs, captions: false }));
  } catch (e) {
    if (e instanceof ExportBusyError) fail(409, t("video.exportBusy"));
    throw e;
  }
});
video.get("/lessons/:lessonId/video/export/file", (c) => {
  const lessonId = c.req.param("lessonId");
  const ready = readyVideo(lessonId);
  const file = ready && exportFile(lessonId, ready.version);
  if (!ready || !file) fail(404, "no rendered video for this lesson");
  return new Response(Bun.file(file), { headers: { "content-type": "video/mp4", "content-disposition": attachment(ready.title, "mp4") } });
});
