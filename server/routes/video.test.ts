import type { Database } from "bun:sqlite";
import { beforeEach, describe, expect, test } from "bun:test";
import type { Figure, Step } from "../../shared/schemas";
import { openDb } from "../db";
import type { Alignment, TtsClient } from "../elevenlabs";
import type { SecretStore } from "../secrets";
import {
  captionLines,
  chapterProblems,
  placeClip,
  requestVideo,
  videoSource,
  videoView,
  type DraftFrame,
  type DraftScene,
  type SourceChapter,
  type VideoRunner,
} from "./video";
import { insertStep, items, seed } from "./test-fixtures";

const cites = [{ sourceId: "src1", quote: "A verbatim quote from the source." }];
const figure: Figure = { kind: "mermaid", code: "flowchart LR; A-->B", teaches: "How A leads to B", alt: "An arrow from A to B" };

const explain: Step = { kind: "explain", title: "Commits", body: "A commit records a snapshot.\n\nIt has a parent.", figure, cites, checks: [items.single()] };
const worked: Step = {
  kind: "worked_example",
  title: "Making a commit",
  problem: "Save the change.",
  lines: [{ text: "Stage the file." }, { text: "Commit it.", blank: { prompt: "What comes next?", answers: ["commit"] } }],
  cites,
};
const practice: Step = { kind: "practice", title: "Try it", item: items.single("p") };

const chapter: SourceChapter = { idx: 0, kind: "explain", title: "Commits", blocks: ["A commit records a snapshot.", "It has a parent."], figure };

const scenes: DraftScene[] = [
  {
    narration: "A commit saves a snapshot of the project. Each commit points back to its parent.",
    covers: [0, 1],
    screen: { kind: "points", heading: "What a commit is", points: [{ text: "snapshot", cue: "saves a snapshot" }, { text: "parent", cue: "points back" }] },
  },
  { narration: "The arrow shows how A leads to B.", covers: [], screen: { kind: "figure", heading: "From A to B", caption: "A then B" } },
];

const frame: DraftFrame = {
  intro: { narration: "Commits are how history is kept.", subheading: "Snapshots and parents" },
  outro: { narration: "A commit is a snapshot with a parent. Test yourself now.", heading: "Takeaways", points: [1, 2, 3].map((n) => ({ text: `idea ${n}`, cue: "snapshot" })) },
};

/** One character per 0.1 s. */
const align = (text: string): Alignment => ({
  characters: [...text],
  character_start_times_seconds: [...text].map((_, i) => i / 10),
  character_end_times_seconds: [...text].map((_, i) => (i + 1) / 10),
});

describe("script", () => {
  test("a chapter per explain and worked step; a worked example keeps every line, faded ones too", () => {
    const database = openDb(":memory:");
    seed(database);
    insertStep(database, 0, explain);
    insertStep(database, 1, worked);
    insertStep(database, 2, practice);
    const source = videoSource("ls1", database);
    expect(source.map((c) => [c.kind, c.blocks])).toEqual([
      ["explain", ["A commit records a snapshot.", "It has a parent."]],
      ["worked_example", ["Save the change.", "Stage the file.", "Commit it."]],
    ]);
  });

  test("every block and the figure must be covered; markup, long scenes and repeated lists are caught", () => {
    const texts = (s: DraftScene[], c = chapter) => chapterProblems(s, c).map((p) => `${p.kind}: ${p.text}`);
    expect(texts(scenes)).toEqual([]);
    const problems = texts([
      { narration: "Run `git commit` to save a snapshot.", covers: [0, 7], screen: { kind: "points", heading: "h", points: [{ text: "a commit saves a snapshot of the project", cue: "x" }] } },
      { narration: "So a commit saves a snapshot of the project.", covers: [], screen: { kind: "points", heading: "h", points: [{ text: "a commit saves a snapshot of the project", cue: "x" }] } },
    ]).join("\n");
    expect(problems).toContain("coverage: scene 1 (points): covers block 7");
    expect(problems).toContain("coverage: blocks 1 are not covered");
    expect(problems).toContain("coverage: the step's figure is not shown");
    expect(problems).toContain("narration: scene 1 (points): markup in narration");
    expect(problems).toContain("repeat: scene 2 (points): screen text repeats the narration");
    expect(texts(scenes, { ...chapter, figure: null })).toContain("format: scene 2 (figure): this step has no figure");
    const long = { ...scenes[0]!, narration: "A commit saves a snapshot. ".repeat(25) };
    expect(texts([long, scenes[1]!]).join("\n")).toContain("length: scene 1 (points): narration is 674 characters; split the scene");
    // A statement is meant to be said aloud.
    const said: DraftScene = { narration: "A commit is a saved snapshot of the whole project.", covers: [], screen: { kind: "statement", text: "A commit is a saved snapshot of the whole project." } };
    expect(texts([...scenes, said])).toEqual([]);
  });
});

describe("timeline", () => {
  test("scenes start at their first word; cued points follow their cue, the first by 2.5 s; a missing cue spreads evenly", () => {
    const narration = scenes.map((s) => s.narration).join(" ");
    const placed = placeClip(
      scenes.map((s) => ({ narration: s.narration, screen: (cue) => ({ kind: "points", heading: "h", points: (s.screen.points ?? []).map((c, i, all) => cue(c, i, all.length)) }) })),
      align(narration),
      10,
      12,
    );
    expect(placed.map((s) => s.start)).toEqual([10, 18.1]);
    const points = placed[0]!.screen.kind === "points" ? placed[0]!.screen.points : [];
    expect(points.map((p) => p.at)).toEqual([10.9, 15.4]);

    const summaryAt = (narration: string, cues: string[]) => {
      const [scene] = placeClip(
        [{ narration, screen: (cue) => ({ kind: "summary", heading: "h", points: cues.map((c, i) => cue({ text: c, cue: c }, i, cues.length)) }) }],
        align(narration),
        0,
        10,
      );
      return scene!.screen.kind === "summary" ? scene!.screen.points.map((p) => Math.round(p.at * 100) / 100) : [];
    };
    expect(summaryAt("abcdefghij", ["zzz", "yyy"])).toEqual([2.33, 4.67]);
    // A late first cue is pulled forward so the screen is not left empty.
    expect(summaryAt("a slow lead-in before the first point appears", ["first point", "appears"])).toEqual([2.5, 3.8]);
  });

  test("subtitles break after a sentence and stay within the line length", () => {
    const text = "First sentence here. A second one that goes on for quite a while, longer than one subtitle line can hold at once.";
    const lines = captionLines(text, align(text), 5);
    expect(lines[0]).toEqual({ text: "First sentence here.", start: 5, end: 7 });
    expect(lines.every((l) => l.text.length <= 64)).toBe(true);
    expect(lines.map((l) => l.text).join(" ")).toBe(text);
  });
});

describe("requestVideo", () => {
  let database: Database;
  let prompts: string[];
  let chapterReplies: DraftScene[][];
  let spoken: string[];

  const key: SecretStore = { get: async () => "sk_test", set: async () => {}, delete: async () => {} };
  const run: VideoRunner = async <T>(opts: { prompt: string }) => {
    prompts.push(opts.prompt);
    const value = opts.prompt.includes("opening and the closing") ? frame : { scenes: chapterReplies.shift() ?? scenes };
    return { ok: true, value: value as T, costUsd: 0 };
  };
  const tts: TtsClient = {
    voices: async () => [],
    speak: async (_key, req) => {
      spoken.push(req.text);
      return { audio: new Uint8Array(16_000), alignment: align(req.text) };
    },
  };

  beforeEach(() => {
    database = openDb(":memory:");
    seed(database);
    insertStep(database, 0, explain);
    database.query("UPDATE lessons SET status = 'finished' WHERE id = 'ls1'").run();
    database.query("INSERT INTO settings (key, value) VALUES ('narration_voice', '\"v1\"'), ('video_enabled', 'true')").run();
    prompts = [];
    chapterReplies = [];
    spoken = [];
  });

  test("intro, a chapter card and clip per step, and the summary, end to end", async () => {
    const { view, done } = await requestVideo("ls1", { database, key, tts, run });
    expect(view).toEqual({ status: "building", done: 0, total: 5 });
    await done;
    const ready = videoView("ls1", database);
    if (ready?.status !== "ready") throw new Error(`not ready: ${JSON.stringify(ready)}`);
    expect(ready.scenes.map((s) => s.screen.kind)).toEqual(["intro", "chapter", "points", "figure", "summary"]);
    expect(spoken).toHaveLength(3);
    // Intro 3.2 s, gap 0.6, card 2.5, chapter 11.4 s, gap 0.6, summary 5.6 s, tail 3.
    const round = (n: number) => Math.round(n * 10) / 10;
    expect(ready.clips.map((c) => round(c.start))).toEqual([0, 6.3, 18.3]);
    expect(ready.chapters.map((c) => [c.title, round(c.start)])).toEqual([["Commits", 3.8]]);
    expect(ready.duration).toBeCloseTo(26.9);
    expect(ready.clipUrls).toHaveLength(3);
    expect(database.query("SELECT count(*) AS n FROM video_clips").get()).toEqual({ n: 3 });
  });

  test("a rejected chapter is retried with its problems; the third rejection fails the video and names the chapter", async () => {
    const uncovered: DraftScene[] = [{ ...scenes[0]!, covers: [0] }, scenes[1]!];
    chapterReplies = [uncovered, uncovered, uncovered];
    await (await requestVideo("ls1", { database, key, tts, run })).done;
    expect(prompts.find((p) => p.includes("previous chapter"))).toContain("blocks 1 are not covered");
    expect(videoView("ls1", database)).toEqual({
      status: "failed",
      error: "Chapter 1 “Commits”: after 3 tries the script still broke the rules (part of the step was left out). Try again: the script is written anew each time.",
    });
    expect(spoken).toEqual([]);
  });

  test("a script whose only problem is a repeated list is used when no retry avoids it", async () => {
    const repeated: DraftScene[] = [
      { ...scenes[0]!, narration: "A commit saves a snapshot of the whole project, with its parent.", screen: { kind: "points", heading: "h", points: [{ text: "saves a snapshot of the whole project", cue: "x" }] } },
      scenes[1]!,
    ];
    chapterReplies = [repeated, repeated, repeated];
    await (await requestVideo("ls1", { database, key, tts, run })).done;
    expect(videoView("ls1", database)?.status).toBe("ready");
  });

  test("off in settings or without a key, nothing runs", async () => {
    const none: SecretStore = { ...key, get: async () => null };
    await expect(requestVideo("ls1", { database, key: none, tts, run })).rejects.toThrow();
    database.query("UPDATE settings SET value = 'false' WHERE key = 'video_enabled'").run();
    await expect(requestVideo("ls1", { database, key, tts, run })).rejects.toThrow();
    expect(prompts).toEqual([]);
    expect(videoView("ls1", database)).toBeNull();
  });
});
