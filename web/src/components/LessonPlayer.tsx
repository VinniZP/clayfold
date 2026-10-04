import * as stylex from "@stylexjs/stylex";
import { ArrowDown, LocateFixed, Pause, Play, RotateCcw, RotateCw, SkipBack, SkipForward, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import type { NarrationSegment } from "@shared/api";
import type { PublicStep } from "@shared/schemas";
import { api, ApiFailure, errorText } from "../lib/api";
import { clock } from "../lib/format";
import { lang, t, useLang } from "../lib/i18n";
import { afterNarration, blockAt, explainNear, SPEEDS, upcoming, type Track } from "../lib/listen";
import { useShortcuts } from "../lib/shortcuts";
import { color, font, radius } from "../theme/tokens.stylex";
import { btn, field, layout, shadow, text } from "../theme/ui";
import { narrationBodyId } from "./Narration";
import { checksId } from "./Steps";
import { Spinner } from "./ui";

const SKIP = 10;
/** Seconds between the last answered check and the next explanation, to read the feedback first. */
const RESUME_AFTER = 8;
const SPEED_KEY = "clayfold-narration-speed";
const SCROLL_KEYS = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "]);

const s = stylex.create({
  player: {
    position: "sticky",
    bottom: 12,
    zIndex: 20,
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr)",
    gap: 8,
    minWidth: 0,
    paddingBlock: 12,
    paddingInline: 16,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: color.border,
    borderRadius: radius.inner,
    backgroundColor: color.surface,
  },
  head: { display: "flex", alignItems: "center", gap: 8 },
  bar: { display: "flex", flexWrap: "wrap", alignItems: "center", columnGap: 14, rowGap: 6 },
  controls: { display: "flex", alignItems: "center", gap: 4 },
  info: { flex: "1 1 0", minWidth: 0 },
  kicker: { fontSize: 12, fontWeight: 650, color: color.textMuted },
  title: { fontFamily: font.display, fontSize: 15, fontWeight: 700, lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  speed: {
    width: "auto",
    height: 32,
    paddingBlock: 0,
    paddingLeft: 10,
    paddingRight: 26,
    backgroundPosition: "calc(100% - 15px) 50%, calc(100% - 10px) 50%",
    fontSize: 13.5,
    fontWeight: 650,
  },
  seekRow: { flex: "1 1 200px", display: "flex", alignItems: "center", gap: 10, fontSize: 12.5, color: color.textMuted, fontVariantNumeric: "tabular-nums" },
  seek: {
    position: "relative",
    flexGrow: 1,
    height: 20,
    borderRadius: radius.pill,
    outline: { default: "none", ":focus-within": `2px solid ${color.focus}` },
    outlineOffset: 3,
  },
  track: { position: "absolute", left: 0, right: 0, top: 7, height: 6, borderRadius: radius.pill, backgroundColor: color.surface3, overflow: "hidden" },
  fill: { height: "100%", backgroundColor: color.primary },
  marker: { position: "absolute", top: 5, width: 2, height: 10, borderRadius: 1, backgroundColor: color.borderStrong, transform: "translateX(-1px)", pointerEvents: "none" },
  thumb: {
    position: "absolute",
    top: 3,
    width: 14,
    height: 14,
    borderRadius: "50%",
    backgroundColor: color.primary,
    boxShadow: `0 0 0 2px ${color.surface}`,
    transform: "translateX(-7px)",
    pointerEvents: "none",
  },
  range: { position: "absolute", inset: 0, width: "100%", height: "100%", margin: 0, opacity: 0, cursor: "pointer" },
  status: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, fontSize: 13.5 },
  statusText: { flex: "1 1 220px" },
  play: { width: 44, height: 44 },
});

type Loaded = { stepId: string; url: string; segments: NarrationSegment[] };

/** What the player shows: on an explain step its own phase, elsewhere the explanation that comes next. */
type Phase =
  | { type: "idle" }
  | { type: "preparing" }
  | { type: "ready" }
  | { type: "checks" }
  | { type: "countdown"; pos: number; left: number }
  | { type: "wait"; pos: number }
  | { type: "writing" }
  | { type: "end" }
  | { type: "error"; message: string; needsSettings: boolean };

function storedSpeed(): number {
  try {
    const v = Number(localStorage.getItem(SPEED_KEY));
    return (SPEEDS as readonly number[]).includes(v) ? v : 1;
  } catch {
    return 1;
  }
}

const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

type Props = {
  /** One entry per outline position. */
  tracks: Track[];
  titles: string[];
  steps: Record<number, PublicStep>;
  /** The step on screen; the player always plays this step when it is an explanation. */
  pos: number;
  settled: Readonly<Record<string, boolean>>;
  go: (pos: number) => void;
  lessonTitle: string;
  topicTitle: string | null;
  prefetch: boolean;
  onClose: () => void;
};

/**
 * Lesson player: plays the explanation on screen and goes on through the lesson's explanations.
 * It stops at an explanation's open retrieval checks and at steps the learner has to do, and
 * plays the next explanation when the learner gets there (L4, L7).
 */
export function LessonPlayer({ tracks, titles, steps, pos, settled, go, lessonTitle, topicTitle, prefetch, onClose }: Props) {
  useLang();
  const audioRef = useRef<HTMLAudioElement>(null);
  const playerRef = useRef<HTMLElement>(null);
  const cache = useRef(new Map<string, Promise<Loaded>>());
  const load = useRef(0);
  const block = useRef<number | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [phase, setPhase] = useState<Phase>({ type: "idle" });
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState(storedSpeed);
  const [follow, setFollow] = useState(true);
  // Playing on: the player plays each explanation the learner reaches. Pause turns it off.
  const [want, setWant] = useState(true);
  const wantRef = useRef(want);
  wantRef.current = want;

  const step = steps[pos];
  const stepId = step?.kind === "explain" ? step.id : null;
  const nextPos = upcoming(tracks, pos);
  const openChecks = tracks[pos]?.checks.filter((id) => !settled[id]).length ?? 0;
  const shown: Phase = stepId ? phase : tracks[pos]?.kind === "explain" ? { type: "writing" } : nextPos < 0 ? { type: "end" } : { type: "wait", pos: nextPos };
  const target = stepId || tracks[pos]?.kind === "explain" ? pos : nextPos;
  const explains = tracks.flatMap((track, i) => (track.kind === "explain" && track.state !== "dropped" ? [i] : []));

  const fetchTrack = (id: string): Promise<Loaded> => {
    let run = cache.current.get(id);
    if (!run) {
      run = (async () => {
        const view = await api.narrate(id);
        const res = await fetch(view.audioUrl);
        if (!res.ok) throw new ApiFailure(t("error.server", { status: res.status }), res.status);
        return { stepId: id, url: URL.createObjectURL(await res.blob()), segments: view.segments };
      })();
      cache.current.set(id, run);
      run.catch(() => cache.current.delete(id));
    }
    return run;
  };

  const mark = (next: number | null, id = loaded?.stepId) => {
    block.current = next;
    const blocks = (id && document.getElementById(narrationBodyId(id))?.firstElementChild?.children) || [];
    for (let i = 0; i < blocks.length; i++) blocks[i]!.toggleAttribute("data-narrating", i === next);
    return next === null ? null : (blocks[next] ?? null);
  };

  const scrollToBlock = (el: Element) => {
    const r = el.getBoundingClientRect();
    const bottom = window.innerHeight - (playerRef.current?.offsetHeight ?? 0) - 24;
    if (r.top >= 80 && r.bottom <= bottom) return;
    window.scrollTo({ top: window.scrollY + r.top - window.innerHeight * 0.25, behavior: reduceMotion() ? "auto" : "smooth" });
  };

  const playHere = async () => {
    const audio = audioRef.current;
    if (!stepId || !audio) return;
    if (loaded?.stepId === stepId) {
      setPhase({ type: "ready" });
      void audio.play().catch(() => {});
      return;
    }
    const token = ++load.current;
    setPhase({ type: "preparing" });
    try {
      const track = await fetchTrack(stepId);
      if (load.current !== token) return;
      audio.src = track.url;
      audio.defaultPlaybackRate = speed;
      audio.playbackRate = speed;
      setLoaded(track);
      setPhase({ type: "ready" });
      if (wantRef.current) await audio.play().catch(() => {});
    } catch (err) {
      if (load.current === token) setPhase({ type: "error", message: errorText(err), needsSettings: err instanceof ApiFailure && err.status === 409 });
    }
  };

  // Arriving at a step: the previous explanation stops; an explanation plays while playing is on.
  useEffect(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    setLoaded(null);
    setTime(0);
    setDuration(0);
    setFollow(true);
    setPhase({ type: "idle" });
    if (!stepId) return;
    if (wantRef.current) void playHere();
    return () => {
      load.current++;
      mark(null, stepId);
    };
  }, [stepId]);

  // Answered checks let the lesson go on: straight to an adjacent explanation after a pause to read the feedback.
  useEffect(() => {
    if (phase.type !== "checks" || openChecks > 0) return;
    const next = afterNarration(tracks, pos, settled);
    if (next.type === "advance") setPhase(wantRef.current ? { type: "countdown", pos: next.pos, left: RESUME_AFTER } : { type: "wait", pos: next.pos });
    else if (next.type !== "checks") setPhase(next);
  }, [phase.type, openChecks]);

  useEffect(() => {
    if (phase.type !== "countdown") return;
    if (phase.left <= 0) return go(phase.pos);
    const timer = setTimeout(() => setPhase({ ...phase, left: phase.left - 1 }), 1000);
    return () => clearTimeout(timer);
  }, [phase]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.preservesPitch = true;
    audio.defaultPlaybackRate = speed;
    audio.playbackRate = speed;
    try {
      localStorage.setItem(SPEED_KEY, String(speed));
    } catch {
      // Storage may be unavailable (private mode); the speed then lasts for this page only.
    }
  }, [speed]);

  // Scrolling by hand stops the player from following the text; the Follow button turns it back on.
  useEffect(() => {
    if (!playing || !follow) return;
    const off = () => setFollow(false);
    const onKey = (e: KeyboardEvent) => {
      const el = e.target instanceof Element ? e.target : null;
      if (SCROLL_KEYS.has(e.key) && !el?.closest("input, textarea, select, button, [contenteditable], [data-lesson-player]")) off();
    };
    window.addEventListener("wheel", off, { passive: true });
    window.addEventListener("touchmove", off, { passive: true });
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("wheel", off);
      window.removeEventListener("touchmove", off);
      window.removeEventListener("keydown", onKey);
    };
  }, [playing, follow]);

  useEffect(() => {
    const tracks = cache.current;
    return () => {
      for (const run of tracks.values()) run.then((track) => URL.revokeObjectURL(track.url)).catch(() => {});
      tracks.clear();
    };
  }, []);

  const seek = (to: number) => {
    const audio = audioRef.current;
    if (!audio || !loaded) return;
    audio.currentTime = Math.max(0, Math.min(to, audio.duration || to));
    if (phase.type !== "ready") setPhase({ type: "ready" });
  };

  const jump = (to: number) => {
    if (to < 0) return;
    setWant(true);
    if (to === pos) void playHere();
    else go(to);
  };

  const pause = () => {
    setWant(false);
    audioRef.current?.pause();
  };

  const resume = () => {
    switch (shown.type) {
      case "preparing":
        return setWant(true);
      case "idle":
      case "error":
        setWant(true);
        return void playHere();
      case "ready":
      case "end":
        if (!loaded) return;
        setWant(true);
        setPhase({ type: "ready" });
        void audioRef.current?.play().catch(() => {});
        return;
      case "checks":
        return jump(nextPos);
      case "countdown":
      case "wait":
        return jump(shown.pos);
      case "writing":
        return;
    }
  };

  const busy = shown.type === "preparing" && want;
  const toggle = () => (playing || busy ? pause() : resume());
  const previous = () => (loaded && (audioRef.current?.currentTime ?? 0) > 3 ? seek(0) : jump(explainNear(tracks, pos, -1)));
  const next = () => jump(explainNear(tracks, pos, 1));
  const skip = (by: number) => seek((audioRef.current?.currentTime ?? 0) + by);
  useShortcuts("page", (a) => {
    if (a.name !== "narration") return false;
    toggle();
    return true;
  });

  const actions = useRef({ resume, pause, seek, skip, previous, next });
  actions.current = { resume, pause, seek, skip, previous, next };

  // Hardware media keys and the OS lock screen.
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    const session = navigator.mediaSession;
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ["play", () => actions.current.resume()],
      ["pause", () => actions.current.pause()],
      ["seekbackward", (d) => actions.current.skip(-(d.seekOffset ?? SKIP))],
      ["seekforward", (d) => actions.current.skip(d.seekOffset ?? SKIP)],
      ["seekto", (d) => d.seekTime !== undefined && actions.current.seek(d.seekTime)],
      ["previoustrack", () => actions.current.previous()],
      ["nexttrack", () => actions.current.next()],
    ];
    for (const [action, handler] of handlers) {
      try {
        session.setActionHandler(action, handler);
      } catch {
        // The browser does not support this action.
      }
    }
    return () => {
      for (const [action] of handlers) {
        try {
          session.setActionHandler(action, null);
        } catch {
          // Not supported, nothing was set.
        }
      }
      session.metadata = null;
      session.playbackState = "none";
    };
  }, []);

  const title = titles[target] ?? lessonTitle;
  useEffect(() => {
    if ("mediaSession" in navigator) navigator.mediaSession.metadata = new MediaMetadata({ title, artist: topicTitle ?? lessonTitle, album: lessonTitle });
  }, [title, topicTitle, lessonTitle]);

  useEffect(() => {
    if ("mediaSession" in navigator) navigator.mediaSession.playbackState = playing ? "playing" : "paused";
  }, [playing]);

  const onTime = (audio: HTMLAudioElement) => {
    setTime(audio.currentTime);
    if (!loaded) return;
    const now = blockAt(loaded.segments, audio.currentTime);
    if (now !== block.current) {
      const el = mark(now);
      if (el && follow && !audio.paused) scrollToBlock(el);
    }
    if ("mediaSession" in navigator && Number.isFinite(audio.duration) && audio.currentTime <= audio.duration) {
      navigator.mediaSession.setPositionState({ duration: audio.duration, position: audio.currentTime, playbackRate: audio.playbackRate });
    }
  };

  const onEnded = () => {
    mark(null);
    const after = afterNarration(tracks, pos, settled);
    if (after.type === "advance") return go(after.pos);
    setPhase(after);
    if (after.type === "checks") document.getElementById(checksId(stepId ?? ""))?.scrollIntoView({ block: "start", behavior: reduceMotion() ? "auto" : "smooth" });
  };

  const onPlay = () => {
    setPlaying(true);
    if (phase.type !== "ready") setPhase({ type: "ready" });
    const ahead = explainNear(tracks, pos, 1);
    const aheadId = steps[ahead]?.id;
    if (prefetch && aheadId) fetchTrack(aheadId).catch(() => {});
  };

  const followNow = () => {
    setFollow(true);
    const el = block.current === null ? null : mark(block.current);
    if (el) scrollToBlock(el);
  };

  const status = (() => {
    switch (shown.type) {
      case "preparing":
        return <span {...stylex.props(s.statusText)}>{t("narration.preparing")}</span>;
      case "checks":
        return (
          <>
            <span {...stylex.props(s.statusText)}>{t("narration.answerChecks")}</span>
            <button
              type="button"
              onClick={() => document.getElementById(checksId(stepId ?? ""))?.scrollIntoView({ block: "start", behavior: reduceMotion() ? "auto" : "smooth" })}
              {...stylex.props(btn.base, btn.ghost, btn.sm)}
            >
              <ArrowDown size={15} aria-hidden="true" /> {t("narration.toChecks")}
            </button>
          </>
        );
      case "countdown":
        return (
          <>
            <span aria-hidden="true" {...stylex.props(s.statusText)}>
              {t("narration.nextIn", { title: titles[shown.pos] ?? "", seconds: shown.left })}
            </span>
            <span {...stylex.props(layout.srOnly)}>{t("narration.upNext", { title: titles[shown.pos] ?? "" })}</span>
            <button type="button" onClick={() => setPhase({ type: "wait", pos: shown.pos })} {...stylex.props(btn.base, btn.ghost, btn.sm)}>
              {t("narration.stay")}
            </button>
          </>
        );
      case "wait":
        return (
          <span {...stylex.props(s.statusText)}>
            {t("narration.upNext", { title: titles[shown.pos] ?? "" })} {want && t("narration.playsOnArrival")}
          </span>
        );
      case "writing":
        return <span {...stylex.props(s.statusText)}>{t("narration.waitWriting")}</span>;
      case "end":
        return <span {...stylex.props(s.statusText)}>{t("narration.ended")}</span>;
      case "error":
        return (
          <span {...stylex.props(s.statusText, text.error)}>
            {shown.message}
            {shown.needsSettings && (
              <Link to="/settings" {...stylex.props(text.link)}>
                {t("narration.openSettings")}
              </Link>
            )}
          </span>
        );
      default:
        return null;
    }
  })();

  const n = explains.indexOf(target);
  const pct = (at: number) => `${duration > 0 ? Math.min(100, (at / duration) * 100) : 0}%`;
  const number = new Intl.NumberFormat(lang());
  const playLabel = playing || busy ? t("narration.pause") : shown.type === "checks" || shown.type === "countdown" || shown.type === "wait" ? t("narration.continue") : t("narration.play");
  const canPlay = playing || busy || !(shown.type === "writing" || (shown.type === "end" && !loaded) || (shown.type === "checks" && nextPos < 0));

  return (
    <section
      ref={playerRef}
      data-lesson-player=""
      aria-label={t("narration.player")}
      onKeyDown={(e) => {
        const el = e.target as Element;
        if (e.key !== " " || el.closest("button, select, a")) return;
        e.preventDefault();
        toggle();
      }}
      {...stylex.props(s.player, shadow.pop)}
    >
      <audio
        ref={audioRef}
        preload="auto"
        onPlay={onPlay}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(e) => onTime(e.currentTarget)}
        onSeeked={(e) => onTime(e.currentTarget)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onEnded={onEnded}
      />
      <div {...stylex.props(s.head)}>
        <div {...stylex.props(s.info)}>
          {n >= 0 && <p {...stylex.props(s.kicker)}>{t("narration.nowPlaying", { n: n + 1, total: explains.length })}</p>}
          <p {...stylex.props(s.title)}>{title}</p>
        </div>
        {playing && !follow && (
          <button type="button" onClick={followNow} {...stylex.props(btn.base, btn.ghost, btn.sm)}>
            <LocateFixed size={15} aria-hidden="true" /> {t("narration.follow")}
          </button>
        )}
        <select aria-label={t("narration.speed")} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} {...stylex.props(field.input, field.select, s.speed)}>
          {SPEEDS.map((v) => (
            <option key={v} value={v}>
              {number.format(v)}×
            </option>
          ))}
        </select>
        <button type="button" aria-label={t("narration.close")} title={t("narration.close")} onClick={onClose} {...stylex.props(btn.base, btn.icon, btn.iconSm)}>
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      <div {...stylex.props(s.bar)}>
        <div {...stylex.props(s.controls)}>
          <button type="button" aria-label={t("narration.previous")} title={t("narration.previous")} onClick={previous} disabled={!loaded && explainNear(tracks, pos, -1) < 0} {...stylex.props(btn.base, btn.icon, btn.iconSm)}>
            <SkipBack size={16} aria-hidden="true" />
          </button>
          <button type="button" aria-label={t("narration.back")} title={t("narration.back")} onClick={() => skip(-SKIP)} disabled={!loaded} {...stylex.props(btn.base, btn.icon, btn.iconSm)}>
            <RotateCcw size={16} aria-hidden="true" />
          </button>
          <button type="button" aria-label={playLabel} title={playLabel} onClick={toggle} disabled={!canPlay} {...stylex.props(btn.base, btn.icon, btn.iconSolid, s.play)}>
            {busy ? <Spinner /> : playing ? <Pause size={18} aria-hidden="true" /> : <Play size={18} aria-hidden="true" />}
          </button>
          <button type="button" aria-label={t("narration.forward")} title={t("narration.forward")} onClick={() => skip(SKIP)} disabled={!loaded} {...stylex.props(btn.base, btn.icon, btn.iconSm)}>
            <RotateCw size={16} aria-hidden="true" />
          </button>
          <button type="button" aria-label={t("narration.next")} title={t("narration.next")} onClick={next} disabled={explainNear(tracks, pos, 1) < 0} {...stylex.props(btn.base, btn.icon, btn.iconSm)}>
            <SkipForward size={16} aria-hidden="true" />
          </button>
        </div>
        {loaded && (
          <div {...stylex.props(s.seekRow)}>
            <span>{clock(time)}</span>
            <div {...stylex.props(s.seek)}>
              <div {...stylex.props(s.track)}>
                <div {...stylex.props(s.fill)} style={{ width: pct(time) }} />
              </div>
              {loaded.segments.slice(1).map((seg) => (
                <span key={seg.block} aria-hidden="true" {...stylex.props(s.marker)} style={{ left: pct(seg.start) }} />
              ))}
              <span aria-hidden="true" {...stylex.props(s.thumb)} style={{ left: pct(time) }} />
              <input
                type="range"
                min={0}
                max={duration || 0}
                step="any"
                value={time}
                aria-label={t("narration.seek")}
                aria-valuetext={t("narration.position", { time: clock(time), duration: clock(duration) })}
                onChange={(e) => seek(Number(e.target.value))}
                onKeyDown={(e) => {
                  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
                  e.preventDefault();
                  skip(e.key === "ArrowLeft" ? -5 : 5);
                }}
                {...stylex.props(s.range)}
              />
            </div>
            <span>{clock(duration)}</span>
          </div>
        )}
      </div>
      <div role="status" {...stylex.props(status ? s.status : layout.srOnly)}>
        {status}
      </div>
    </section>
  );
}
