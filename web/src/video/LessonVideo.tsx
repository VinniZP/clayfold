import * as stylex from "@stylexjs/stylex";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { AbsoluteFill, continueRender, delayRender, Html5Audio, interpolate, Sequence, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { CuedText, VideoScene, VideoScreen, VideoTimeline } from "@shared/api";
import { FigureView } from "../components/Figure";
import { renderInline, renderMarkdown } from "../lib/markdown";
import { bridge, lightTheme } from "../theme/themes";
import { font } from "../theme/tokens.stylex";

// The video keeps one light palette whatever the app theme is: it stands on its own and is meant to be rendered to
// a file later. Every word on screen comes from the timeline, so the video speaks only the lesson's language.

export const VIDEO = { width: 1920, height: 1080, fps: 30 } as const;

export type LessonVideoProps = { title: string; timeline: VideoTimeline; clipSrcs: string[]; captions: boolean };

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const f = (seconds: number) => Math.round(seconds * VIDEO.fps);

/** Chapter accents are the lesson figure colors, so the video matches the lesson's own diagrams. */
const ACCENTS = ["var(--fig-1)", "var(--fig-2)", "var(--fig-3)", "var(--fig-4)", "var(--fig-5)"];
const accentOf = (chapter: number) => ACCENTS[(Math.max(chapter, 1) - 1) % ACCENTS.length]!;
const soft = (c: string, pct = 22) => `color-mix(in srgb, ${c} ${pct}%, var(--surface))`;
const NOT_CONTENT: VideoScreen["kind"][] = ["intro", "chapter", "summary"];

const s = stylex.create({
  root: { backgroundColor: "var(--surface)", color: "var(--text)", fontFamily: font.body, overflow: "hidden" },
  blob: { position: "absolute", borderRadius: "50%", filter: "blur(70px)" },
  grain: { position: "absolute", inset: 0, opacity: 0.07, mixBlendMode: "multiply", pointerEvents: "none" },
  sphere: { position: "absolute", borderRadius: "50%" },
  chrome: { position: "absolute", top: 52, left: 150, right: 150, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 40 },
  brand: { display: "flex", alignItems: "center", gap: 18, minWidth: 0, fontSize: 26, fontWeight: 600, color: "var(--text-muted)" },
  brandTitle: { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  mark: { display: "inline-flex", alignSelf: "flex-start", alignItems: "flex-end", gap: 5, height: 34, padding: 8, borderRadius: 12, backgroundColor: "var(--text)" },
  bar: { width: 7, borderRadius: 3 },
  chip: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    flexShrink: 0,
    maxWidth: 820,
    paddingBlock: 10,
    paddingInline: "12px 24px",
    borderRadius: 999,
    fontSize: 26,
    fontWeight: 650,
    whiteSpace: "nowrap",
  },
  chipTitle: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" },
  chipNum: { display: "grid", placeItems: "center", flexShrink: 0, width: 40, height: 40, borderRadius: "50%", color: "var(--surface)", fontFamily: font.display, fontSize: 22, fontWeight: 800 },
  progress: { position: "absolute", left: 150, right: 150, bottom: 40, display: "flex", gap: 8, height: 8 },
  segment: { position: "relative", height: "100%", borderRadius: 4, overflow: "hidden", backgroundColor: "color-mix(in srgb, var(--text) 10%, transparent)" },
  fill: { position: "absolute", insetBlock: 0, left: 0, borderRadius: 4 },
  captions: { position: "absolute", left: 0, right: 0, bottom: 66, display: "flex", justifyContent: "center", paddingInline: 240 },
  caption: {
    paddingBlock: 12,
    paddingInline: 28,
    borderRadius: 18,
    backgroundColor: "color-mix(in srgb, var(--text) 86%, transparent)",
    color: "var(--surface)",
    fontSize: 34,
    fontWeight: 550,
    lineHeight: 1.3,
    textAlign: "center",
  },
  stage: { position: "absolute", top: 150, bottom: 170, left: 150, right: 150, display: "flex", flexDirection: "column", gap: 44 },
  heading: { fontFamily: font.display, fontSize: 72, fontWeight: 800, letterSpacing: "-0.025em", lineHeight: 1.05, margin: 0, textWrap: "balance" },
  underline: { height: 8, borderRadius: 4, marginTop: 22 },
  // Intro
  introGrid: { position: "absolute", inset: "150px 150px 170px", display: "grid", gridTemplateColumns: "1.25fr 0.75fr", gap: 90, alignItems: "center" },
  introTitle: { marginBlock: "44px 0", fontFamily: font.display, fontSize: 112, fontWeight: 800, letterSpacing: "-0.035em", lineHeight: 1 },
  word: { display: "inline-block", marginRight: "0.24em" },
  introSub: { marginTop: 40, fontSize: 40, lineHeight: 1.35, color: "var(--text-muted)", maxWidth: 1000 },
  toc: {
    display: "grid",
    gap: 14,
    margin: 0,
    padding: 40,
    listStyle: "none",
    borderRadius: 40,
    backgroundColor: "color-mix(in srgb, var(--surface) 80%, transparent)",
    boxShadow: "0 40px 90px -40px rgb(50 37 63 / 0.35)",
  },
  tocRow: { display: "grid", gridTemplateColumns: "56px 1fr", gap: 18, alignItems: "baseline", fontSize: 30, fontWeight: 550, lineHeight: 1.25 },
  tocNum: { fontFamily: font.display, fontSize: 30, fontWeight: 800 },
  // Chapter card
  card: { position: "absolute", inset: 0, display: "flex", flexDirection: "column", justifyContent: "center", paddingInline: 200 },
  bigNum: { fontFamily: font.display, fontSize: 380, fontWeight: 900, lineHeight: 0.8, letterSpacing: "-0.06em", color: "transparent" },
  cardHeading: { marginTop: 50, fontFamily: font.display, fontSize: 104, fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1.02, maxWidth: 1400, textWrap: "balance" },
  cardRule: { height: 10, marginTop: 36, borderRadius: 5 },
  // Points and summary
  points: { flexGrow: 1, display: "grid", alignContent: "center", gap: 30, margin: 0, padding: 0, listStyle: "none" },
  point: { display: "grid", gridTemplateColumns: "64px 1fr", gap: 30, alignItems: "start", lineHeight: 1.3 },
  bullet: { display: "grid", placeItems: "center", width: 64, height: 64, borderRadius: "50%", fontFamily: font.display, fontSize: 30, fontWeight: 800, color: "var(--surface)" },
  summaryGrid: { flexGrow: 1, display: "grid", gridTemplateColumns: "1fr 1fr", alignContent: "center", gap: 28 },
  summaryCard: {
    display: "grid",
    gridTemplateColumns: "60px 1fr",
    gap: 22,
    alignItems: "start",
    padding: 34,
    borderRadius: 32,
    fontSize: 36,
    lineHeight: 1.3,
    backgroundColor: "var(--surface)",
    boxShadow: "0 24px 60px -30px rgb(50 37 63 / 0.35)",
  },
  check: { display: "grid", placeItems: "center", width: 60, height: 60, borderRadius: "50%", color: "var(--surface)", fontSize: 34, fontWeight: 900 },
  // Statement
  statement: { flexGrow: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: 40, paddingInline: 60 },
  quoteMark: { height: 110, fontFamily: font.display, fontSize: 260, fontWeight: 900, lineHeight: 0.6 },
  statementText: { margin: 0, fontFamily: font.display, fontSize: 76, fontWeight: 750, letterSpacing: "-0.02em", lineHeight: 1.18, textWrap: "balance" },
  note: { margin: 0, fontSize: 36, lineHeight: 1.4, color: "var(--text-muted)", maxWidth: 1300 },
  // Block
  code: { minHeight: 0, marginBlock: "auto", borderRadius: 32, backgroundColor: "var(--text)", color: "var(--surface)", overflow: "hidden", boxShadow: "0 40px 90px -40px rgb(50 37 63 / 0.6)" },
  codeBar: { display: "flex", gap: 12, paddingBlock: 22, paddingInline: 28 },
  dot: { width: 18, height: 18, borderRadius: "50%" },
  codeText: { margin: 0, paddingInline: 48, paddingBottom: 44, fontFamily: font.mono, lineHeight: 1.55, whiteSpace: "pre-wrap" },
  caret: { display: "inline-block", width: "0.55em", height: "1.1em", verticalAlign: "-0.2em", backgroundColor: "var(--surface)" },
  proseCard: { minHeight: 0, marginBlock: "auto", padding: 56, borderRadius: 32, backgroundColor: "var(--surface)", overflow: "hidden", boxShadow: "0 30px 80px -40px rgb(50 37 63 / 0.35)" },
  prose: { maxWidth: "none" },
  // Figure
  figureCard: {
    flexGrow: 1,
    minHeight: 0,
    display: "grid",
    placeItems: "center",
    padding: 40,
    borderRadius: 36,
    backgroundColor: "var(--surface)",
    overflow: "hidden",
    boxShadow: "0 30px 80px -40px rgb(50 37 63 / 0.35)",
  },
  figureInner: { width: "100%" },
  figureCaption: { alignSelf: "center", paddingBlock: 14, paddingInline: 30, borderRadius: 999, fontSize: 30, fontWeight: 550 },
  // Example
  exampleGrid: { flexGrow: 1, minHeight: 0, display: "grid", gridTemplateColumns: "0.85fr 1.15fr", gap: 56, alignItems: "center" },
  problem: { display: "grid", gap: 18, padding: 44, borderRadius: 32, fontSize: 38, lineHeight: 1.35 },
  problemLabel: { fontFamily: font.display, fontSize: 64, fontWeight: 900, lineHeight: 1 },
  lines: { display: "grid", gap: 16, margin: 0, padding: 0, listStyle: "none" },
  line: { display: "grid", gridTemplateColumns: "54px 1fr", gap: 22, alignItems: "start", paddingBlock: 14, paddingInline: 20, borderRadius: 22, lineHeight: 1.35 },
  lineNum: { display: "grid", placeItems: "center", width: 54, height: 54, borderRadius: "50%", fontFamily: font.display, fontSize: 26, fontWeight: 800 },
  // Poster
  poster: { position: "absolute", inset: "150px 520px 150px 150px", display: "flex", flexDirection: "column", justifyContent: "center" },
  play: { display: "grid", placeItems: "center", width: 150, height: 150, marginTop: 50, borderRadius: "50%", backgroundColor: "var(--text)", boxShadow: "0 30px 70px -30px rgb(50 37 63 / 0.6)" },
  playIcon: { width: 0, height: 0, marginLeft: 12, borderStyle: "solid", borderWidth: "30px 0 30px 50px", borderColor: "transparent transparent transparent var(--surface)" },
  // End card
  end: { position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 36 },
  endMark: { transform: "scale(1.6)" },
  endWord: { fontFamily: font.display, fontSize: 96, fontWeight: 800, letterSpacing: "-0.03em" },
  endTitle: { fontSize: 38, color: "var(--text-muted)", maxWidth: 1300, textAlign: "center" },
});

const Inline = ({ src }: { src: string }) => <span dangerouslySetInnerHTML={{ __html: renderInline(src) }} />;

// ---------- Motion ----------

/** 0 → 1 with a soft spring (or a bouncy one), starting `delay` frames into the current sequence. */
function useRise(delay = 0, bouncy = false) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - delay, fps, config: bouncy ? { damping: 14, mass: 0.7 } : { damping: 200 }, durationInFrames: bouncy ? undefined : 22 });
}

const rise = (p: number, dy = 36): CSSProperties => ({ opacity: Math.min(1, p * 1.4), transform: `translateY(${(1 - p) * dy}px)` });

/** Enters with a lift and unblur, drifts slowly closer while it holds, leaves with a fade over its last frames. */
function SceneShell({ duration, children }: { duration: number; children: ReactNode }) {
  const frame = useCurrentFrame();
  const enter = useRise();
  const leave = interpolate(frame, [duration - 10, duration], [1, 0], clamp);
  const drift = interpolate(frame, [0, duration], [0, 0.015], clamp);
  return (
    <AbsoluteFill
      style={{
        opacity: Math.min(enter, leave),
        transform: `translateY(${(1 - enter) * 40 - (1 - leave) * 24}px) scale(${0.98 + 0.02 * enter + drift})`,
        filter: enter < 0.99 ? `blur(${(1 - enter) * 8}px)` : undefined,
      }}
    >
      {children}
    </AbsoluteFill>
  );
}

/** Frame within the scene at which a cued text appears. */
const cueFrame = (c: CuedText, sceneStart: number) => Math.max(0, f(c.at - sceneStart));

function Heading({ text, accent }: { text: string; accent: string }) {
  const p = useRise(0);
  const line = useRise(10);
  return (
    <div style={rise(p)}>
      <h2 {...stylex.props(s.heading)}>
        <Inline src={text} />
      </h2>
      <div {...stylex.props(s.underline)} style={{ width: line * 180, backgroundColor: accent }} />
    </div>
  );
}

// ---------- Backdrop and chrome ----------

const TINTS = ["var(--lilac-soft)", "var(--peach-soft)", "var(--pistachio-soft)", soft("var(--fig-4)", 24), soft("var(--fig-5)", 22)];

/** Soft drifting light; its tint follows the chapter and crossfades at each chapter card. */
function Backdrop({ timeline }: { timeline: VideoTimeline }) {
  const frame = useCurrentFrame();
  const chapter = timeline.chapters.findLastIndex((c) => f(c.start) - 12 <= frame) + 1;
  const mark = chapter > 0 ? f(timeline.chapters[chapter - 1]!.start) : 0;
  const mix = chapter > 0 ? interpolate(frame, [mark - 12, mark + 12], [0, 1], clamp) : 1;
  const drift = (phase: number, amp: number) => Math.sin(frame / 140 + phase) * amp;
  const wash = (tint: string, opacity: number) => (
    <div {...stylex.props(s.blob)} style={{ width: 1200, height: 1200, left: -320 + drift(0, 60), top: -460 + drift(1, 40), background: `radial-gradient(circle, ${tint} 0%, transparent 65%)`, opacity }} />
  );
  return (
    <AbsoluteFill>
      {chapter > 0 && wash(TINTS[(chapter - 1) % TINTS.length]!, 0.9 * (1 - mix))}
      {wash(TINTS[chapter % TINTS.length]!, 0.9 * mix)}
      <div {...stylex.props(s.blob)} style={{ width: 900, height: 900, right: -260 + drift(2, 50), bottom: -380 + drift(3, 50), background: "radial-gradient(circle, var(--peach-soft) 0%, transparent 65%)", opacity: 0.8 }} />
      <div {...stylex.props(s.blob)} style={{ width: 700, height: 700, right: 380 + drift(4, 70), top: -300 + drift(5, 40), background: "radial-gradient(circle, var(--pistachio-soft) 0%, transparent 65%)", opacity: 0.7 }} />
      <svg {...stylex.props(s.grain)} width="100%" height="100%" aria-hidden="true">
        <filter id="video-grain">
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" stitchTiles="stitch" />
        </filter>
        <rect width="100%" height="100%" filter="url(#video-grain)" />
      </svg>
    </AbsoluteFill>
  );
}

/** A glossy clay ball, like the app's illustrations. */
const sphereLook = (size: number, color: string): CSSProperties => ({
  width: size,
  height: size,
  background: `radial-gradient(circle at 32% 26%, color-mix(in srgb, ${color} 18%, white) 0%, color-mix(in srgb, ${color} 55%, white) 34%, color-mix(in srgb, ${color} 88%, black) 100%)`,
  boxShadow: `inset -${size / 12}px -${size / 9}px ${size / 5}px rgb(0 0 0 / 0.14), 0 ${size / 6}px ${size / 3}px -${size / 8}px rgb(80 40 30 / 0.28)`,
});

function Sphere({ size, color, x, y, delay }: { size: number; color: string; x: number; y: number; delay: number }) {
  const frame = useCurrentFrame();
  const p = useRise(delay, true);
  return <div {...stylex.props(s.sphere)} style={{ ...sphereLook(size, color), left: x, top: y + Math.sin((frame + delay * 7) / 38) * 14, transform: `scale(${p})` }} />;
}

function LogoMark() {
  return (
    <span {...stylex.props(s.mark)} aria-hidden="true">
      <span {...stylex.props(s.bar)} style={{ height: 10, backgroundColor: "var(--peach-soft)" }} />
      <span {...stylex.props(s.bar)} style={{ height: 15, backgroundColor: "var(--lilac-soft)" }} />
      <span {...stylex.props(s.bar)} style={{ height: 20, backgroundColor: "var(--pistachio-soft)" }} />
    </span>
  );
}

/** Opacity of the top bar: it shows over chapter content and fades in and out at the edges of a run of it. */
function chromeOpacity(scenes: VideoScene[], t: number): number {
  const content = (k: number) => k >= 0 && !NOT_CONTENT.includes(scenes[k]!.screen.kind);
  const at = scenes.findLastIndex((sc) => sc.start <= t);
  if (!content(at)) return content(at - 1) ? 1 - interpolate(t - scenes[at]!.start, [0, 0.3], [0, 1], clamp) : 0;
  let first = at;
  while (content(first - 1)) first--;
  return interpolate(t - scenes[first]!.start, [0, 0.5], [0, 1], clamp);
}

/** Lesson title and current chapter on top, chapter progress at the bottom. */
function Chrome({ title, timeline }: { title: string; timeline: VideoTimeline }) {
  const t = useCurrentFrame() / VIDEO.fps;
  const chapter = timeline.chapters.findLastIndex((c) => c.start <= t);
  const outroStart = timeline.clips.at(-1)?.start ?? timeline.duration;
  const bounds = [0, ...timeline.chapters.map((c) => c.start), outroStart - 0.6, timeline.duration];
  return (
    <>
      <div {...stylex.props(s.chrome)} style={{ opacity: chromeOpacity(timeline.scenes, t) }}>
        <span {...stylex.props(s.brand)}>
          <LogoMark />
          <span {...stylex.props(s.brandTitle)}>{title}</span>
        </span>
        {chapter >= 0 && (
          <span {...stylex.props(s.chip)} style={{ backgroundColor: soft(accentOf(chapter + 1), 26) }}>
            <span {...stylex.props(s.chipNum)} style={{ backgroundColor: accentOf(chapter + 1) }}>
              {chapter + 1}
            </span>
            <span {...stylex.props(s.chipTitle)}>{timeline.chapters[chapter]!.title}</span>
          </span>
        )}
      </div>
      <div {...stylex.props(s.progress)}>
        {bounds.slice(0, -1).map((from, i) => {
          const to = bounds[i + 1]!;
          const edge = i === 0 || i === bounds.length - 2;
          return (
            <div key={i} {...stylex.props(s.segment)} style={{ flexGrow: Math.max(0.5, to - from) }}>
              <div {...stylex.props(s.fill)} style={{ width: `${interpolate(t, [from, to], [0, 100], clamp)}%`, backgroundColor: edge ? "var(--text)" : accentOf(i) }} />
            </div>
          );
        })}
      </div>
    </>
  );
}

function Captions({ timeline }: { timeline: VideoTimeline }) {
  const t = useCurrentFrame() / VIDEO.fps;
  const line = timeline.captions.find((c) => t >= c.start && t <= c.end + 0.25);
  if (!line) return null;
  return (
    <div {...stylex.props(s.captions)}>
      <span {...stylex.props(s.caption)} style={{ opacity: interpolate(t, [line.start, line.start + 0.12], [0, 1], clamp) }}>
        {line.text}
      </span>
    </div>
  );
}

// ---------- Scenes ----------

type SceneProps<K extends VideoScreen["kind"]> = { screen: Extract<VideoScreen, { kind: K }>; start: number; duration: number; chapter: number };

function Intro({ screen }: { screen: Extract<VideoScreen, { kind: "intro" }> }) {
  const sub = useRise(f(1.1));
  const toc = useRise(f(1.0));
  return (
    <>
      <Sphere size={240} color="var(--fig-1)" x={1560} y={-30} delay={4} />
      <Sphere size={130} color="var(--fig-2)" x={1790} y={170} delay={9} />
      <Sphere size={96} color="var(--fig-3)" x={1420} y={40} delay={14} />
      <div {...stylex.props(s.introGrid)}>
        <div>
          <LogoMark />
          <h1 {...stylex.props(s.introTitle)}>
            {screen.heading.split(/\s+/).map((w, i) => (
              <Word key={i} delay={6 + i * 4}>
                {w}
              </Word>
            ))}
          </h1>
          <p {...stylex.props(s.introSub)} style={rise(sub)}>
            <Inline src={screen.subheading} />
          </p>
        </div>
        {screen.chapters.length > 1 && (
          <ol {...stylex.props(s.toc)} style={rise(toc, 60)}>
            {screen.chapters.map((c, i) => (
              <TocRow key={i} n={i + 1} text={c.text} delay={cueFrame(c, 0)} />
            ))}
          </ol>
        )}
      </div>
    </>
  );
}

function Word({ delay, children }: { delay: number; children: ReactNode }) {
  const p = useRise(delay, true);
  return (
    <span {...stylex.props(s.word)} style={{ opacity: Math.min(1, p * 1.5), transform: `translateY(${(1 - p) * 60}px) rotate(${(1 - p) * 4}deg)` }}>
      {children}
    </span>
  );
}

function TocRow({ n, text, delay }: { n: number; text: string; delay: number }) {
  const p = useRise(delay);
  return (
    <li {...stylex.props(s.tocRow)} style={rise(p, 20)}>
      <span {...stylex.props(s.tocNum)} style={{ color: accentOf(n) }}>
        {String(n).padStart(2, "0")}
      </span>
      <Inline src={text} />
    </li>
  );
}

function ChapterCard({ screen }: { screen: Extract<VideoScreen, { kind: "chapter" }> }) {
  const frame = useCurrentFrame();
  const accent = accentOf(screen.number);
  const wipe = useRise(0);
  const num = useRise(4, true);
  const head = useRise(10);
  return (
    <>
      <AbsoluteFill style={{ backgroundColor: soft(accent, 20), clipPath: `inset(0 ${(1 - wipe) * 100}% 0 0)` }} />
      <Sphere size={260} color={accent} x={1500} y={160} delay={6} />
      <Sphere size={150} color={accentOf(screen.number + 2)} x={1380} y={700} delay={12} />
      <div {...stylex.props(s.card)}>
        <div {...stylex.props(s.bigNum)} style={{ WebkitTextStroke: `6px ${accent}`, transform: `translateX(${(1 - num) * -160}px)`, opacity: Math.min(1, num) }}>
          {String(screen.number).padStart(2, "0")}
        </div>
        <div {...stylex.props(s.cardHeading)} style={{ ...rise(head, 50), clipPath: `inset(0 ${(1 - head) * 30}% 0 0)` }}>
          <Inline src={screen.heading} />
        </div>
        <div {...stylex.props(s.cardRule)} style={{ width: interpolate(frame, [14, 40], [0, 360], clamp), backgroundColor: accent }} />
      </div>
    </>
  );
}

type EntryState = { p: number; focused: boolean };

/** Cued entries: each appears on its cue; the newest is in focus and earlier ones step back. */
function CuedList({ entries, start, render }: { entries: CuedText[]; start: number; render: (entry: CuedText, i: number, state: EntryState) => ReactNode }) {
  const frame = useCurrentFrame();
  const frames = entries.map((e) => cueFrame(e, start));
  const newest = frames.findLastIndex((at) => frame >= at);
  return (
    <>
      {entries.map((e, i) => (
        <CuedEntry key={i} delay={frames[i]!} focused={i === newest} render={(state) => render(e, i, state)} />
      ))}
    </>
  );
}

function CuedEntry({ delay, focused, render }: { delay: number; focused: boolean; render: (state: EntryState) => ReactNode }) {
  return <>{render({ p: useRise(delay), focused })}</>;
}

/** Long lists get a smaller type size so they fit the frame. */
const sizeFor = (texts: string[], big: number, small: number) => (texts.join(" ").length > 260 ? small : big);

function Points({ screen, start, duration, chapter }: SceneProps<"points">) {
  const accent = accentOf(chapter);
  const size = sizeFor(screen.points.map((p) => p.text), 46, 38);
  return (
    <SceneShell duration={duration}>
      <div {...stylex.props(s.stage)}>
        <Heading text={screen.heading} accent={accent} />
        <ul {...stylex.props(s.points)}>
          <CuedList
            entries={screen.points}
            start={start}
            render={(e, i, { p, focused }) => (
              <li
                {...stylex.props(s.point)}
                style={{ fontSize: size, opacity: Math.min(p * 1.4, focused ? 1 : 0.5), transform: `translateX(${(1 - p) * 50}px)` }}
              >
                <span {...stylex.props(s.bullet)} style={{ backgroundColor: accent, transform: `scale(${focused ? 1 : 0.88})` }}>
                  {i + 1}
                </span>
                <Inline src={e.text} />
              </li>
            )}
          />
        </ul>
      </div>
    </SceneShell>
  );
}

function Statement({ screen, duration, chapter }: SceneProps<"statement">) {
  const frame = useCurrentFrame();
  const accent = accentOf(chapter);
  const p = useRise(4);
  const note = useRise(f(1.2));
  const marks = { "--sweep": `${interpolate(frame, [18, 48], [0, 100], clamp)}%`, "--mark": soft(accent, 45) } as CSSProperties;
  return (
    <SceneShell duration={duration}>
      <div {...stylex.props(s.stage)}>
        <div {...stylex.props(s.statement)}>
          <div {...stylex.props(s.quoteMark)} style={{ color: accent, opacity: p }}>
            “
          </div>
          <p className={`video-mark ${stylex.props(s.statementText).className ?? ""}`} style={{ ...rise(p, 40), ...marks }}>
            <Inline src={screen.text} />
          </p>
          {screen.note && (
            <p {...stylex.props(s.note)} style={rise(note)}>
              <Inline src={screen.note} />
            </p>
          )}
        </div>
      </div>
    </SceneShell>
  );
}

const FENCE = /^```[^\n]*\n([\s\S]*?)\n?```\s*$/;

/** A source block as written: code types itself out, tables and lists reveal row by row. */
function Block({ screen, duration, chapter }: SceneProps<"block">) {
  const frame = useCurrentFrame();
  const card = useRise(6);
  const code = FENCE.exec(screen.markdown)?.[1];
  const reveal = interpolate(frame, [12, Math.max(30, duration * 0.45)], [0, 1], clamp);
  const prose = stylex.props(s.prose);
  return (
    <SceneShell duration={duration}>
      <div {...stylex.props(s.stage)}>
        <Heading text={screen.heading} accent={accentOf(chapter)} />
        {code !== undefined ? (
          <div {...stylex.props(s.code)} style={rise(card, 50)}>
            <div {...stylex.props(s.codeBar)}>
              {["var(--fig-2)", "var(--fig-5)", "var(--fig-3)"].map((c) => (
                <span key={c} {...stylex.props(s.dot)} style={{ backgroundColor: c }} />
              ))}
            </div>
            <pre {...stylex.props(s.codeText)} style={{ fontSize: code.split("\n").length > 10 ? 26 : 34 }}>
              {code.slice(0, Math.round(code.length * reveal))}
              {(reveal < 1 || Math.floor(frame / 15) % 2 === 0) && <span {...stylex.props(s.caret)} />}
            </pre>
          </div>
        ) : (
          <div {...stylex.props(s.proseCard)} style={rise(card, 50)}>
            <div
              className={`prose video-prose ${prose.className ?? ""}`}
              style={{ "--p": reveal } as CSSProperties}
              dangerouslySetInnerHTML={{ __html: renderMarkdown(screen.markdown) }}
            />
          </div>
        )}
      </div>
    </SceneShell>
  );
}

/** Mermaid, Vega and widget figures draw after mount; a render to file waits for them, up to FIGURE_WAIT_MS. */
const FIGURE_WAIT_MS = 10_000;
const DRAWN = "svg, canvas, iframe, [role=alert]";

function useFigureDrawn() {
  const ref = useRef<HTMLDivElement>(null);
  const [handle] = useState(() => delayRender("Drawing a lesson figure"));
  useEffect(() => {
    const el = ref.current;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      observer.disconnect();
      clearTimeout(timer);
      continueRender(handle);
    };
    const observer = new MutationObserver(() => el?.querySelector(DRAWN) && finish());
    const timer = setTimeout(finish, FIGURE_WAIT_MS);
    if (!el || el.querySelector(DRAWN)) finish();
    else observer.observe(el, { childList: true, subtree: true });
    return finish;
  }, [handle]);
  return ref;
}

/** The step's figure, drifting slightly closer while the narration walks through it. */
function FigureScene({ screen, duration, chapter }: SceneProps<"figure">) {
  const drawn = useFigureDrawn();
  const frame = useCurrentFrame();
  const accent = accentOf(chapter);
  const card = useRise(6);
  const caption = useRise(f(1.4));
  const inner = stylex.props(s.figureInner);
  return (
    <SceneShell duration={duration}>
      <div {...stylex.props(s.stage)}>
        <Heading text={screen.heading} accent={accent} />
        <div {...stylex.props(s.figureCard)} style={rise(card, 50)}>
          <div ref={drawn} className={`video-figure ${inner.className ?? ""}`} style={{ transform: `scale(${interpolate(frame, [0, duration], [1, 1.06], clamp)})` }}>
            <FigureView figure={{ ...screen.figure, caption: undefined }} theme="light" />
          </div>
        </div>
        {screen.caption && (
          <div {...stylex.props(s.figureCaption)} style={{ ...rise(caption, 20), backgroundColor: soft(accent, 24) }}>
            <Inline src={screen.caption} />
          </div>
        )}
      </div>
    </SceneShell>
  );
}

/** The problem on the left; solution lines arrive on the right as the narration reaches them. */
function Example({ screen, start, duration, chapter }: SceneProps<"example">) {
  const accent = accentOf(chapter);
  const problem = useRise(6);
  const size = screen.lines.length > 6 ? 30 : 36;
  return (
    <SceneShell duration={duration}>
      <div {...stylex.props(s.stage)}>
        <Heading text={screen.heading} accent={accent} />
        <div {...stylex.props(s.exampleGrid)}>
          <div {...stylex.props(s.problem)} style={{ ...rise(problem, 40), backgroundColor: soft(accent, 22) }}>
            <span {...stylex.props(s.problemLabel)} style={{ color: accent }}>
              ?
            </span>
            <Inline src={screen.problem} />
          </div>
          <ol {...stylex.props(s.lines)}>
            <CuedList
              entries={screen.lines}
              start={start}
              render={(e, i, { p, focused }) => (
                <li
                  {...stylex.props(s.line)}
                  style={{
                    fontSize: size,
                    opacity: Math.min(p * 1.4, focused ? 1 : 0.6),
                    transform: `translateY(${(1 - p) * 24}px)`,
                    backgroundColor: focused ? soft(accent, 26) : "transparent",
                  }}
                >
                  <span {...stylex.props(s.lineNum)} style={{ backgroundColor: focused ? accent : soft(accent, 40), color: focused ? "var(--surface)" : "var(--text)" }}>
                    {i + 1}
                  </span>
                  <Inline src={e.text} />
                </li>
              )}
            />
          </ol>
        </div>
      </div>
    </SceneShell>
  );
}

/** Takeaways pop in on their cues; after the last word the end card takes over. */
function Summary({ screen, start, end, title }: { screen: Extract<VideoScreen, { kind: "summary" }>; start: number; end: number; title: string }) {
  const frame = useCurrentFrame();
  const endFrame = f(end - start);
  const outro = interpolate(frame, [endFrame, endFrame + 18], [0, 1], clamp);
  const endCard = useRise(endFrame + 6, true);
  return (
    <>
      <AbsoluteFill style={{ opacity: 1 - outro, transform: `scale(${1 - outro * 0.04})` }}>
        <div {...stylex.props(s.stage)}>
          <Heading text={screen.heading} accent="var(--text)" />
          <div {...stylex.props(s.summaryGrid)}>
            <CuedList
              entries={screen.points}
              start={start}
              render={(e, i, { p }) => (
                <div {...stylex.props(s.summaryCard)} style={{ opacity: Math.min(1, p * 1.4), transform: `translateY(${(1 - p) * 40}px) scale(${0.94 + 0.06 * p})` }}>
                  <span {...stylex.props(s.check)} style={{ backgroundColor: accentOf(i + 1), transform: `scale(${p})` }}>
                    ✓
                  </span>
                  <Inline src={e.text} />
                </div>
              )}
            />
          </div>
        </div>
      </AbsoluteFill>
      {frame >= endFrame && (
        <AbsoluteFill style={{ opacity: outro }}>
          <Sphere size={220} color="var(--fig-1)" x={520} y={250} delay={endFrame + 2} />
          <Sphere size={150} color="var(--fig-2)" x={1260} y={560} delay={endFrame + 8} />
          <Sphere size={110} color="var(--fig-3)" x={1300} y={230} delay={endFrame + 12} />
          <div {...stylex.props(s.end)} style={{ transform: `scale(${0.9 + 0.1 * endCard})` }}>
            <span {...stylex.props(s.endMark)}>
              <LogoMark />
            </span>
            <span {...stylex.props(s.endWord)}>Clayfold</span>
            <span {...stylex.props(s.endTitle)}>{title}</span>
          </div>
        </AbsoluteFill>
      )}
    </>
  );
}

function Scene({ scene, duration, chapter, end, title }: { scene: VideoScene; duration: number; chapter: number; end: number; title: string }) {
  const { screen, start } = scene;
  switch (screen.kind) {
    case "intro":
      return <Intro screen={screen} />;
    case "chapter":
      return <ChapterCard screen={screen} />;
    case "points":
      return <Points screen={screen} start={start} duration={duration} chapter={chapter} />;
    case "statement":
      return <Statement screen={screen} start={start} duration={duration} chapter={chapter} />;
    case "block":
      return <Block screen={screen} start={start} duration={duration} chapter={chapter} />;
    case "figure":
      return <FigureScene screen={screen} start={start} duration={duration} chapter={chapter} />;
    case "example":
      return <Example screen={screen} start={start} duration={duration} chapter={chapter} />;
    case "summary":
      return <Summary screen={screen} start={start} end={end} title={title} />;
  }
}

/** The whole lesson video: backdrop, a sequence per scene and per narration clip, then chrome and subtitles on top. */
export function LessonVideo({ title, timeline, clipSrcs, captions }: LessonVideoProps) {
  const last = timeline.clips.at(-1);
  const end = last ? last.start + last.duration : timeline.duration;
  return (
    <AbsoluteFill {...stylex.props(lightTheme, bridge.root, s.root)}>
      <Backdrop timeline={timeline} />
      {timeline.clips.map((clip, i) =>
        clipSrcs[i] ? (
          <Sequence key={`clip-${i}`} from={f(clip.start)} durationInFrames={Math.max(1, f(clip.duration) + 2)} layout="none">
            <Html5Audio src={clipSrcs[i]} />
          </Sequence>
        ) : null,
      )}
      {timeline.scenes.map((scene, i) => {
        const from = f(scene.start);
        const duration = Math.max(1, f(timeline.scenes[i + 1]?.start ?? timeline.duration) - from);
        const chapter = timeline.chapters.findLastIndex((c) => c.start <= scene.start + 0.01) + 1;
        return (
          <Sequence key={i} from={from} durationInFrames={duration}>
            <Scene scene={scene} duration={duration} chapter={chapter} end={end} title={title} />
          </Sequence>
        );
      })}
      <Chrome title={title} timeline={timeline} />
      {captions && <Captions timeline={timeline} />}
    </AbsoluteFill>
  );
}

/** The still the player shows before the first play; drawn outside the composition, so it uses no frame hooks. */
export function VideoPoster({ title, meta }: { title: string; meta: string }) {
  return (
    <AbsoluteFill {...stylex.props(lightTheme, bridge.root, s.root)}>
      <div {...stylex.props(s.blob)} style={{ width: 1200, height: 1200, left: -320, top: -460, background: `radial-gradient(circle, ${TINTS[0]} 0%, transparent 65%)` }} />
      <div {...stylex.props(s.blob)} style={{ width: 900, height: 900, right: -260, bottom: -380, background: "radial-gradient(circle, var(--peach-soft) 0%, transparent 65%)" }} />
      <div {...stylex.props(s.sphere)} style={{ ...sphereLook(240, "var(--fig-1)"), left: 1560, top: 90 }} />
      <div {...stylex.props(s.sphere)} style={{ ...sphereLook(130, "var(--fig-2)"), left: 1500, top: 420 }} />
      <div {...stylex.props(s.sphere)} style={{ ...sphereLook(96, "var(--fig-3)"), left: 1740, top: 560 }} />
      <div {...stylex.props(s.poster)}>
        <LogoMark />
        <h1 {...stylex.props(s.introTitle)}>{title}</h1>
        <p {...stylex.props(s.introSub)}>{meta}</p>
        <span {...stylex.props(s.play)} aria-hidden="true">
          <span {...stylex.props(s.playIcon)} />
        </span>
      </div>
    </AbsoluteFill>
  );
}
