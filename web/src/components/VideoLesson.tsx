import * as stylex from "@stylexjs/stylex";
import { Captions, Clapperboard, Download, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Player, type PlayerRef } from "@remotion/player";
import { Link } from "react-router";
import type { ItemState, VideoExportView, VideoView } from "@shared/api";
import type { PublicStep } from "@shared/schemas";
import { api, ApiFailure, errorText } from "../lib/api";
import { t, useLang } from "../lib/i18n";
import { prefersReducedMotion } from "../lib/reading";
import { useResource } from "../lib/useResource";
import { bp, color, font, radius } from "../theme/tokens.stylex";
import { btn, layout, readable, text } from "../theme/ui";
import { LessonVideo, VideoPoster, VIDEO, type LessonVideoProps } from "../video/LessonVideo";
import { ItemView } from "./ItemView";
import { StepView } from "./Steps";
import { CardHead, ErrorBox, Progress, Spinner } from "./ui";

const s = stylex.create({
  panel: { display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 22 },
  intro: { maxWidth: "62ch" },
  watch: { display: "grid", gridTemplateColumns: { default: "minmax(0, 1fr) 280px", [bp.mobile]: "minmax(0, 1fr)" }, gap: 18, alignItems: "start" },
  player: { borderRadius: radius.inner, overflow: "hidden", borderWidth: 1, borderStyle: "solid", borderColor: color.border, backgroundColor: color.surface },
  chapters: { display: "grid", gap: 4, margin: 0, padding: 0, listStyle: "none" },
  chaptersTitle: { marginBottom: 6, fontSize: 13, fontWeight: 650, color: color.textMuted },
  chapter: {
    display: "grid",
    gridTemplateColumns: "22px 1fr auto",
    gap: 10,
    alignItems: "baseline",
    width: "100%",
    paddingBlock: 8,
    paddingInline: 10,
    borderWidth: 0,
    borderRadius: 12,
    textAlign: "left",
    font: "inherit",
    fontSize: 14,
    color: color.text,
    cursor: "pointer",
    backgroundColor: { default: "transparent", ":hover": color.surface2 },
  },
  chapterOn: { backgroundColor: { default: color.lilacSoft, ":hover": color.lilacSoft } },
  chapterNum: { fontFamily: font.display, fontWeight: 800, color: color.accentText },
  chapterTime: { fontSize: 12.5, color: color.textMuted, fontVariantNumeric: "tabular-nums" },
  captions: { marginTop: 12 },
  building: { display: "grid", gap: 10, maxWidth: "62ch" },
  failed: { display: "grid", gap: 6, maxWidth: "70ch", paddingBlock: 14, paddingInline: 18, borderRadius: radius.inner, backgroundColor: color.dangerSoft, color: color.danger },
  section: { display: "grid", gap: 26, paddingTop: 22, borderTopWidth: 1, borderTopStyle: "solid", borderTopColor: color.border },
  sectionTitle: { fontFamily: font.display, fontSize: { default: 26, [bp.mobile]: 22 }, fontWeight: 800, letterSpacing: "-0.02em" },
  items: { display: "grid", gap: 32 },
  download: { display: "grid", gap: 10 },
  exporting: { display: "grid", gap: 8, maxWidth: "70ch" },
  statusLine: { display: "flex", alignItems: "flex-start", gap: 10 },
});

const POLL_MS = 2500;
// The Player sizes itself from its inline style; with only a width it keeps the composition's aspect ratio.
const PLAYER_STYLE = { width: "100%" };

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

type LessonContext = {
  lessonId: string;
  topicId: string | null;
  title: string;
  writing: boolean;
  steps: PublicStep[];
  itemStates: Record<string, ItemState>;
};

/**
 * The lesson as a video: the warm-up, then the video in place of the explanations and worked examples, then every
 * question of the lesson.
 */
export function VideoLesson(props: LessonContext) {
  useLang();
  const { lessonId, writing } = props;
  const video = useResource<VideoView | null>(
    () => api.lessonVideo(lessonId).catch((err: unknown) => (err instanceof ApiFailure && err.status === 404 ? null : Promise.reject(err))),
    lessonId,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; needsSettings: boolean } | null>(null);
  const data = video.data;
  const status = data?.status;

  useEffect(() => {
    if (status !== "building") return;
    const id = setInterval(() => void video.reload(), POLL_MS);
    return () => clearInterval(id);
  }, [status, video.reload]);

  const make = async () => {
    setBusy(true);
    setError(null);
    try {
      const view = await api.makeLessonVideo(lessonId);
      video.setData(() => view);
    } catch (err) {
      setError({ message: errorText(err), needsSettings: err instanceof ApiFailure && err.status === 409 });
    } finally {
      setBusy(false);
    }
  };

  const makeButton = (label: string, primary: boolean) => (
    <button type="button" disabled={busy || writing} onClick={() => void make()} {...stylex.props(btn.base, primary ? btn.primary : btn.ghost, !primary && btn.sm)}>
      {busy ? <Spinner /> : primary ? <Clapperboard size={18} aria-hidden="true" /> : <RotateCcw size={16} aria-hidden="true" />} {label}
    </button>
  );

  return (
    <div {...stylex.props(s.panel)}>
      <CardHead title={t("video.title")}>{status === "ready" && makeButton(t("video.remake"), false)}</CardHead>
      {video.error && !data ? (
        <ErrorBox error={video.error} onRetry={() => void video.reload()} />
      ) : data === undefined ? (
        <Spinner label={t("common.loading")} />
      ) : data === null ? (
        <>
          <p {...stylex.props(text.muted, s.intro)}>{t("video.intro")}</p>
          <div {...stylex.props(layout.row)}>{makeButton(t("video.make"), true)}</div>
          <p {...stylex.props(text.small, text.muted, s.intro)}>{t("video.costNote")}</p>
        </>
      ) : data.status === "building" ? (
        <div role="status" {...stylex.props(s.building)}>
          <p {...stylex.props(s.statusLine)}>
            <Spinner /> <span>{t("video.building", { done: data.done, total: data.total })}</span>
          </p>
          <Progress value={data.done} max={data.total} label={t("video.title")} />
        </div>
      ) : data.status === "failed" ? (
        <>
          <div role="alert" {...stylex.props(s.failed)}>
            <p {...stylex.props(text.strong)}>{t("video.failed")}</p>
            <p>{data.error}</p>
          </div>
          <div {...stylex.props(layout.row)}>{makeButton(t("video.retry"), true)}</div>
        </>
      ) : (
        <Watch key={data.clipUrls.join()} view={data} {...props} />
      )}
      {error && (
        <p role="alert" {...stylex.props(text.error)}>
          {error.message}
          {error.needsSettings && (
            <Link to="/settings" {...stylex.props(text.link)}>
              {t("narration.openSettings")}
            </Link>
          )}
        </p>
      )}
    </div>
  );
}

function Watch({ view, lessonId, topicId, title, steps, itemStates }: LessonContext & { view: Extract<VideoView, { status: "ready" }> }) {
  useLang();
  const player = useRef<PlayerRef>(null);
  const questions = useRef<HTMLElement>(null);
  const [clips, setClips] = useState<Blob[] | null>(null);
  const [clipSrcs, setClipSrcs] = useState<string[] | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [chapter, setChapter] = useState(-1);
  const [captions, setCaptions] = useState(false);

  // Clips are loaded as blobs so seeking works without HTTP range requests.
  useEffect(() => {
    let live = true;
    const load = (url: string) =>
      fetch(url).then((res) => (res.ok ? res.blob() : Promise.reject(new ApiFailure(t("error.server", { status: res.status }), res.status))));
    Promise.all(view.clipUrls.map(load))
      .then((blobs) => live && setClips(blobs))
      .catch((err: unknown) => live && setLoadError(err));
    return () => {
      live = false;
    };
  }, [view.clipUrls]);

  useEffect(() => {
    if (!clips) return;
    const urls = clips.map((b) => URL.createObjectURL(b));
    setClipSrcs(urls);
    return () => {
      urls.forEach((u) => URL.revokeObjectURL(u));
      setClipSrcs(null);
    };
  }, [clips]);

  useEffect(() => {
    const p = player.current;
    if (!p) return;
    const onFrame = ({ detail }: { detail: { frame: number } }) => setChapter(view.chapters.findLastIndex((c) => c.start <= detail.frame / VIDEO.fps));
    const onEnded = () => questions.current?.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
    p.addEventListener("frameupdate", onFrame);
    p.addEventListener("ended", onEnded);
    return () => {
      p.removeEventListener("frameupdate", onFrame);
      p.removeEventListener("ended", onEnded);
    };
  }, [clipSrcs, view.chapters]);

  if (loadError) return <ErrorBox error={loadError} />;

  const warmup = steps.filter((st) => st.kind === "activate");
  const after = steps.filter((st) => st.kind === "explain" || st.kind === "practice" || st.kind === "reflect" || st.kind === "check");
  const stepProps = { topicId, lessonId, active: true, itemStates, revealedLines: [] };
  const inputProps: LessonVideoProps | null = clipSrcs ? { title, timeline: view, clipSrcs, captions } : null;

  return (
    <>
      {warmup.length > 0 && (
        <section aria-labelledby="video-warmup" {...stylex.props(s.section, readable.surface)}>
          <h3 id="video-warmup" {...stylex.props(s.sectionTitle)}>
            {t("video.warmup")}
          </h3>
          {warmup.map((st) => (
            <StepView key={st.id} step={st} {...stepProps} />
          ))}
        </section>
      )}

      <div {...stylex.props(s.watch)}>
        <div aria-label={t("video.player", { title })} role="region" {...stylex.props(s.player)}>
          {inputProps ? (
            <Player
              ref={player}
              component={LessonVideo}
              inputProps={inputProps}
              durationInFrames={Math.max(1, Math.ceil(view.duration * VIDEO.fps))}
              compositionWidth={VIDEO.width}
              compositionHeight={VIDEO.height}
              fps={VIDEO.fps}
              controls
              allowFullscreen
              clickToPlay
              showPlaybackRateControl
              showPosterWhenUnplayed
              posterFillMode="composition-size"
              renderPoster={() => <VideoPoster title={title} meta={t("video.posterMeta", { count: view.chapters.length, duration: clock(view.duration) })} />}
              style={PLAYER_STYLE}
            />
          ) : (
            <Spinner label={t("common.loading")} />
          )}
        </div>
        <nav aria-label={t("video.chapters")}>
          <p {...stylex.props(s.chaptersTitle)}>{t("video.chapters")}</p>
          <ol {...stylex.props(s.chapters)}>
            {view.chapters.map((c, i) => (
              <li key={i}>
                <button
                  type="button"
                  aria-current={i === chapter ? "true" : undefined}
                  onClick={() => {
                    player.current?.seekTo(Math.round(c.start * VIDEO.fps));
                    player.current?.play();
                  }}
                  {...stylex.props(s.chapter, i === chapter && s.chapterOn)}
                >
                  <span {...stylex.props(s.chapterNum)}>{i + 1}</span>
                  <span>{c.title}</span>
                  <span {...stylex.props(s.chapterTime)}>{clock(c.start)}</span>
                </button>
              </li>
            ))}
          </ol>
          <button type="button" aria-pressed={captions} onClick={() => setCaptions((v) => !v)} {...stylex.props(btn.base, btn.ghost, btn.sm, s.captions)}>
            <Captions size={16} aria-hidden="true" /> {t("video.captions")}
          </button>
        </nav>
      </div>

      <VideoDownload lessonId={lessonId} view={view} />

      {after.length > 0 && (
        <section ref={questions} aria-labelledby="video-questions" {...stylex.props(s.section, readable.surface)}>
          <div>
            <h3 id="video-questions" {...stylex.props(s.sectionTitle)}>
              {t("video.questions")}
            </h3>
            <p {...stylex.props(text.small, text.muted)}>{t("video.questionsHint")}</p>
          </div>
          {after.map((st) =>
            st.kind === "explain" ? (
              <div key={st.id} {...stylex.props(s.items)}>
                {st.checks.map((item) => (
                  <ItemView key={item.id} item={item} mode="practice" context="explain" initial={itemStates[item.id]} />
                ))}
              </div>
            ) : (
              <StepView key={st.id} step={st} {...stepProps} />
            ),
          )}
        </section>
      )}
    </>
  );
}

/** Renders the video to MP4 on request, then offers the file. */
function VideoDownload({ lessonId, view }: { lessonId: string; view: Extract<VideoView, { status: "ready" }> }) {
  useLang();
  const exp = useResource<VideoExportView>(() => api.videoExport(lessonId), `${lessonId}:${view.clipUrls[0] ?? ""}`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const data = exp.data;

  useEffect(() => {
    if (data?.status !== "rendering") return;
    const id = setInterval(() => void exp.reload(), POLL_MS);
    return () => clearInterval(id);
  }, [data?.status, exp.reload]);

  const render = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await api.startVideoExport(lessonId);
      exp.setData(() => next);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div {...stylex.props(s.download)}>
      {data?.status === "rendering" ? (
        <div role="status" {...stylex.props(s.exporting)}>
          <p {...stylex.props(s.statusLine, text.small)}>
            <Spinner /> <span>{t("video.exporting", { percent: Math.round(data.progress * 100) })}</span>
          </p>
          <Progress value={Math.round(data.progress * 100)} max={100} label={t("video.download")} />
        </div>
      ) : data?.status === "ready" ? (
        <div {...stylex.props(layout.row)}>
          <a href={data.url} download {...stylex.props(btn.base, btn.primary, btn.sm)}>
            <Download size={16} aria-hidden="true" /> {t("video.downloadReady", { size: Math.max(1, Math.round(data.sizeBytes / 1_000_000)) })}
          </a>
        </div>
      ) : (
        <div {...stylex.props(layout.row)}>
          <button type="button" disabled={busy} onClick={() => void render()} {...stylex.props(btn.base, btn.primary, btn.sm)}>
            {busy ? <Spinner /> : <Download size={16} aria-hidden="true" />} {t("video.download")}
          </button>
        </div>
      )}
      {data?.status === "failed" && (
        <p role="alert" {...stylex.props(text.error)}>
          {t("video.exportFailed", { error: data.error })}
        </p>
      )}
      {error && (
        <p role="alert" {...stylex.props(text.error)}>
          {error}
        </p>
      )}
    </div>
  );
}
