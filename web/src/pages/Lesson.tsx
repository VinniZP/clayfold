import * as stylex from "@stylexjs/stylex";
import { ArrowLeft, ArrowRight, BookOpen, Check, CircleSlash, Clapperboard, Copy, MessageCircle, NotebookText, PanelRightClose, RotateCcw, ShieldCheck, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import type { LessonView, PracticeFrom } from "@shared/api";
import type { MessageKey } from "@shared/i18n";
import type { PublicItem, PublicStep } from "@shared/schemas";
import { Chat } from "../components/Chat";
import { DayProgress } from "../components/DayProgress";
import { FinalInvite } from "../components/FinalExamCard";
import { GenProgress, type Rejection } from "../components/GenProgress";
import { LearnerChip } from "../components/LessonList";
import { ChallengeBanner, LessonCompanion, LessonReward, useLessonFocus } from "../components/meerkat/LessonGame";
import { StaleSources } from "../components/LessonStatus";
import { useHeader } from "../components/header";
import type { ItemResult } from "../components/ItemView";
import { FOCUS_LABEL, PracticeDialog, PracticeEnd, PracticeOffer } from "../components/Practice";
import { ProposedCards } from "../components/ProposedCards";
import { SelectionActions, type SelectedText } from "../components/SelectionActions";
import { StepView, type LineResults, type TutorHooks } from "../components/Steps";
import { CardHead, Clay, Empty, ErrorBox, Markdown, PageLoading, Progress, Spinner } from "../components/ui";
import { VideoLesson } from "../components/VideoLesson";
import { api, errorText } from "../lib/api";
import { formatDateTime, kindLabel, levelLabel } from "../lib/format";
import { useCelebrationHold } from "../lib/game";
import { t, useLang } from "../lib/i18n";
import { useOverlayScroll } from "../lib/overlayScroll";
import { useRecentVisit } from "../lib/recent";
import { useStreamStatus, useTopicStream } from "../lib/stream";
import { useGlossaryScope } from "../lib/glossary";
import { useResource } from "../lib/useResource";
import { bp, color, font, radius } from "../theme/tokens.stylex";
import { banner, btn, card, chip, layout, shadow, text } from "../theme/ui";

type StepState = LessonView["stepStatus"][number];

/** First-try share of the exit check that passes it (L12, server/review/mastery.ts). */
const CROWN_SHARE = 0.8;

type Offer = { itemId: string; stepId: string; reason: "wrong_twice" | "idle" };

function itemsOf(step: PublicStep): PublicItem[] {
  switch (step.kind) {
    case "activate":
    case "check":
      return step.items;
    case "explain":
      return step.checks;
    case "practice":
      return [step.item];
    default:
      return [];
  }
}

function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      const m = window.matchMedia(query);
      m.addEventListener("change", notify);
      return () => m.removeEventListener("change", notify);
    },
    () => window.matchMedia(query).matches,
  );
}

const STATUS_TEXT: Record<StepState, MessageKey> = {
  pending: "lesson.step.pending",
  checking: "lesson.step.checking",
  published: "lesson.step.published",
  dropped: "lesson.step.dropped",
};

const s = stylex.create({
  tabs: { display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 4 },
  tab: {
    display: "inline-flex",
    alignItems: "center",
    gap: 10,
    height: 52,
    paddingInline: 24,
    borderWidth: 0,
    borderRadius: 18,
    backgroundColor: { default: color.surface2, ":hover": color.surface3 },
    color: color.text,
    fontSize: 16,
    fontWeight: 600,
  },
  tabOn: { backgroundColor: { default: color.primary, ":hover": color.primary }, color: color.onPrimary },
  grid: {
    display: "grid",
    gridTemplateColumns: { default: "minmax(280px, 320px) minmax(0, 1fr)", [bp.mobile]: "minmax(0, 1fr)" },
    gap: { default: 20, [bp.mobile]: 12 },
    alignItems: "start",
    scrollSnapAlign: { default: "start", [bp.mobile]: "none" },
    scrollMarginTop: 24,
  },
  gridDocked: { gridTemplateColumns: "minmax(270px, 310px) minmax(0, 1fr) minmax(280px, 320px)", gap: 16 },
  outline: {
    position: { default: "sticky", [bp.mobile]: "relative" },
    top: 24,
    maxHeight: { default: "calc(100vh - 48px)", [bp.mobile]: "none" },
    overflowY: "auto",
    paddingBlock: 22,
    paddingInline: 12,
  },
  outlineTitle: { fontFamily: font.display, fontSize: 22, fontWeight: 800, letterSpacing: "-0.01em", lineHeight: 1.2, paddingInline: 8, marginBottom: 4 },
  outlineMeta: { paddingInline: 8, marginBottom: 14 },
  mobileOnly: { display: { default: "none", [bp.mobile]: "block" } },
  desktopOnly: { display: { default: "block", [bp.mobile]: "none" } },
  mobileSummary: { cursor: "pointer", fontWeight: 650, paddingBlock: 4, paddingInline: 8 },
  stepsWrap: { position: "relative" },
  steps: { position: "relative", display: "grid", gap: 2, margin: 0, padding: 0, listStyle: "none" },
  rail: { position: "absolute", left: 25, top: 18, bottom: 18, borderLeftWidth: 2, borderLeftStyle: "solid", borderLeftColor: color.border },
  item: {
    position: "relative",
    display: "grid",
    gridTemplateColumns: "32px minmax(0, 1fr)",
    gap: 10,
    alignItems: "center",
    width: "100%",
    paddingBlock: 8,
    paddingInline: 10,
    borderWidth: 0,
    borderRadius: 16,
    backgroundColor: { default: "transparent", ":hover": color.surface2, ":disabled": "transparent" },
    color: color.text,
    textAlign: "left",
    cursor: { default: "pointer", ":disabled": "default" },
  },
  itemCurrent: { backgroundColor: { default: color.lilacSoft, ":hover": color.lilacSoft } },
  marker: {
    position: "relative",
    zIndex: 1,
    display: "grid",
    placeItems: "center",
    width: 32,
    height: 32,
    borderRadius: "50%",
    borderWidth: 2,
    borderStyle: "solid",
    borderColor: color.borderStrong,
    backgroundColor: color.surface,
    color: color.text,
    fontSize: 13,
    fontWeight: 750,
    fontVariantNumeric: "tabular-nums",
  },
  markerDone: { borderColor: color.success, backgroundColor: color.successSoft, color: color.success },
  markerCurrent: { borderColor: color.primary, backgroundColor: color.primary, color: color.onPrimary },
  markerWaiting: { borderStyle: "dashed", color: color.textMuted },
  markerDropped: { color: color.textMuted, textDecoration: "line-through" },
  badge: {
    position: "absolute",
    right: -5,
    bottom: -4,
    display: "grid",
    placeItems: "center",
    width: 16,
    height: 16,
    borderRadius: "50%",
    boxShadow: `0 0 0 2px ${color.surface}`,
  },
  badgeDone: { backgroundColor: color.success, color: color.surface },
  badgeWait: { backgroundColor: color.lilacSoft, color: color.accentText },
  badgeDropped: { backgroundColor: color.surface2, color: color.textMuted },
  itemText: { display: "grid", minWidth: 0 },
  itemTitle: { fontSize: 14, fontWeight: 650, lineHeight: 1.3 },
  itemTitleMuted: { color: color.textMuted, fontWeight: 500 },
  itemTitleDropped: { textDecoration: "line-through" },
  itemSub: { fontSize: 12.5, color: color.textMuted },
  main: { minWidth: 0, paddingBlock: { default: 28, [bp.mobile]: 20 }, paddingInline: { default: 30, [bp.mobile]: 18 }, minHeight: 560, display: "grid", gap: 20, alignContent: "start" },
  progressRow: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 14 },
  progressBar: { flexGrow: 1, flexBasis: 160 },
  interrupted: { flexWrap: "wrap" },
  interruptedText: { flexGrow: 1, flexBasis: 240 },
  wait: { display: "grid", justifyItems: "center", gap: 10, paddingBlock: 72, paddingInline: 24, textAlign: "center", color: color.textMuted, outline: "none" },
  waitText: { maxWidth: "44ch", color: color.text },
  nav: { display: "flex", justifyContent: "space-between", gap: 12, paddingTop: 20, borderTopWidth: 1, borderTopStyle: "solid", borderTopColor: color.border },
  navBtn: { flexGrow: { default: 0, [bp.phone]: 1 } },
  tutor: {
    display: "flex",
    flexDirection: "column",
    gap: 14,
    paddingBlock: 22,
    paddingInline: 20,
    position: "sticky",
    top: 24,
    height: "calc(100vh - 48px)",
    minHeight: 520,
  },
  tutorFloating: {
    position: "fixed",
    zIndex: 40,
    top: { default: 24, [bp.mobile]: "auto" },
    right: { default: 24, [bp.mobile]: 0 },
    bottom: { default: 24, [bp.mobile]: 0 },
    left: { default: "auto", [bp.mobile]: 0 },
    width: { default: 380, [bp.mobile]: "auto" },
    height: { default: "auto", [bp.mobile]: "80vh" },
    minHeight: 0,
    borderRadius: { default: radius.card, [bp.mobile]: "28px 28px 0 0" },
  },
  tutorHead: { display: "flex", alignItems: "center", gap: 12 },
  tutorAvatar: { borderRadius: "50%", backgroundColor: color.surface2 },
  tutorName: { fontFamily: font.display, fontSize: 22, fontWeight: 800, letterSpacing: "-0.01em", flexGrow: 1 },
  tutorIntro: { display: "grid", gap: 8, color: color.textMuted },
  tutorList: { display: "grid", gap: 4, margin: 0, paddingLeft: 18, fontSize: 13.5 },
  offer: { display: "grid", gap: 10, padding: 16, borderRadius: radius.inner, backgroundColor: color.lilacSoft },
  checkNote: { display: "grid", gap: 10, justifyItems: "center", textAlign: "center", paddingBlock: 40, paddingInline: 20 },
  end: { display: "grid", gap: 22 },
  endTitle: { fontFamily: font.display, fontSize: { default: 30, [bp.mobile]: 24 }, fontWeight: 800, outline: "none" },
  summary: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 18, paddingBlock: 18, paddingInline: 22, borderRadius: radius.inner, backgroundColor: color.pistachioSoft },
  score: { fontFamily: font.display, fontSize: 44, fontWeight: 800, lineHeight: 1, fontVariantNumeric: "tabular-nums" },
  scoreOf: { fontFamily: font.body, fontSize: 16, fontWeight: 600, color: color.textMuted },
  start: { justifySelf: "start" },
  notes: { display: "grid", gap: 12, margin: 0, padding: 0, listStyle: "none" },
  note: { display: "grid", gap: 6, paddingBlock: 14, paddingInline: 18, borderRadius: radius.inner, backgroundColor: color.surface2 },
  quote: { paddingBlock: 8, paddingInline: 12, borderRadius: 12, backgroundColor: color.surface, fontStyle: "italic", color: color.textMuted, fontSize: 14 },
});

/** Step marker: the step number always shows; state is the fill plus a small corner badge. */
function Marker({ n, st, done, current }: { n: number | null; st: StepState; done: boolean; current: boolean }) {
  const badge =
    st === "checking" ? (
      <span {...stylex.props(s.badge, s.badgeWait)}>
        <Spinner size={10} />
      </span>
    ) : st === "dropped" ? (
      <span {...stylex.props(s.badge, s.badgeDropped)}>
        <CircleSlash size={10} aria-hidden="true" />
      </span>
    ) : done ? (
      <span {...stylex.props(s.badge, s.badgeDone)}>
        <Check size={10} strokeWidth={3.5} aria-hidden="true" />
      </span>
    ) : null;
  return (
    <span aria-hidden="true" {...stylex.props(s.marker, done && s.markerDone, current && s.markerCurrent, (st === "pending" || st === "checking") && s.markerWaiting, st === "dropped" && s.markerDropped)}>
      {n ?? <Check size={15} strokeWidth={3} />}
      {badge}
    </span>
  );
}

export function LessonPage() {
  useLang();
  const { lessonId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const view = useResource(() => api.lesson(lessonId), lessonId);
  const [outline, setOutline] = useState<{ kind: string; title: string }[]>([]);
  const [status, setStatus] = useState<StepState[]>([]);
  const [steps, setSteps] = useState<Record<number, PublicStep>>({});
  const [retrying, setRetrying] = useState<Record<number, boolean>>({});
  const [checkingSince, setCheckingSince] = useState<Record<number, number>>({});
  const [rejection, setRejection] = useState<Rejection | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [checkResults, setCheckResults] = useState<{ item: PublicItem; result: ItemResult | undefined }[] | null>(null);
  const [tutorOpen, setTutorOpen] = useState(false);
  const [tab, setTab] = useState<"lesson" | "cards" | "notes" | "video">("lesson");
  const videoOn = useResource(() => api.settings(), "settings").data?.video.enabled ?? false;
  const docked = useMediaQuery("(min-width: 1281px)");
  const outlineRef = useRef<HTMLElement>(null);
  useOverlayScroll(outlineRef);
  const [offer, setOffer] = useState<Offer | null>(null);
  const [tutorCtx, setTutorCtx] = useState<{ itemId?: string; stepId?: string; line?: number }>({});
  const [lineResults, setLineResults] = useState<Record<string, LineResults>>({});
  const [tutorConv, setTutorConv] = useState<string | null>(null);
  const [autoSend, setAutoSend] = useState<{ text: string; quote?: string; nonce: number } | null>(null);
  const [tutorQuote, setTutorQuote] = useState<string | null>(null);
  const [tutorFocus, setTutorFocus] = useState(0);
  const mainRef = useRef<HTMLElement>(null);
  const tutorRef = useRef<HTMLElement>(null);
  const offered = useRef(new Set<string>());
  const navigated = useRef(false);
  const v = view.data;
  const [resuming, setResuming] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);
  const [practiceFrom, setPracticeFrom] = useState<PracticeFrom | null>(null);
  const [stopping, setStopping] = useState(false);
  const practice = v?.lesson.practice ?? null;
  const stop = async () => {
    if (!v?.authorConversationId) return;
    setStopping(true);
    try {
      await api.cancel(v.authorConversationId);
    } catch {
      setStopping(false);
    }
  };
  const resume = async () => {
    setResuming(true);
    setResumeError(null);
    try {
      await api.resumeLesson(lessonId);
      await view.reload();
    } catch (err) {
      setResumeError(errorText(err));
    } finally {
      setResuming(false);
    }
  };
  const topicId = v?.lesson.topicId ?? null;
  useGlossaryScope(topicId);
  const streamStatus = useStreamStatus(topicId);
  const topics = useResource(api.topics, topicId ? "topics" : null);
  const topicTitle = topics.data?.find((t) => t.id === topicId)?.title ?? null;
  useRecentVisit(v ? { kind: "lesson", id: lessonId, title: v.lesson.title, context: topicTitle, goal: false } : null);

  // The lesson grid is the page's snap point: stopping near it lines the sticky outline and tutor up with the viewport.
  useEffect(() => {
    const root = document.documentElement;
    root.style.scrollSnapType = "y proximity";
    return () => {
      root.style.scrollSnapType = "";
    };
  }, []);

  useEffect(() => {
    if (!v) return;
    setOutline(v.outline);
    setStatus(v.stepStatus);
    setCheckingSince((m) => {
      const next = { ...m };
      v.stepStatus.forEach((s, i) => s === "checking" && next[i] === undefined && (next[i] = Date.now()));
      return next;
    });
    setSteps(Object.fromEntries(v.steps.map((s) => [s.idx, s])));
    setSummary(v.lesson.summary);
    setTutorConv((c) => c ?? v.tutorConversationId);
  }, [v]);

  useTopicStream(
    topicId,
    (e) => {
      switch (e.type) {
        case "lesson.planned":
          if (e.lessonId !== lessonId) return;
          setOutline(e.outline);
          setStatus((s) => e.outline.map((_, i) => s[i] ?? "pending"));
          return;
        case "step.status":
          if (e.lessonId !== lessonId) return;
          setStatus((s) => s.map((x, i) => (i === e.idx ? (e.status === "dropped" ? "dropped" : "checking") : x)));
          setRetrying((r) => ({ ...r, [e.idx]: e.status === "rejected" }));
          if (e.status === "checking") setCheckingSince((m) => ({ ...m, [e.idx]: Date.now() }));
          if (e.status === "rejected") setRejection({ idx: e.idx, message: e.violations[0]?.message ?? t("lesson.violations") });
          if (e.status === "dropped") setRejection((r) => (r?.idx === e.idx ? null : r));
          return;
        case "step.published":
          if (e.lessonId !== lessonId) return;
          setSteps((m) => ({ ...m, [e.step.idx]: e.step }));
          setRejection((r) => (r?.idx === e.step.idx ? null : r));
          setStatus((s) => {
            const next = [...s];
            next[e.step.idx] = "published";
            return next;
          });
          return;
        case "lesson.finished":
          if (e.lessonId === lessonId) setSummary(e.summary);
          return;
        case "conv.done":
          if (e.conversationId !== v?.authorConversationId) return;
          setStopping(false);
          void view.reload();
          return;
        case "worked.answered":
          if (e.lessonId !== lessonId) return;
          setLineResults((m) => ({ ...m, [e.stepId]: { ...m[e.stepId], [e.idx]: { text: e.text, correct: e.correct } } }));
          return;
        case "tutor.offer": {
          if (e.lessonId !== lessonId) return;
          const step = Object.values(steps).find((s) => itemsOf(s).some((i) => i.id === e.itemId));
          if (step && step.kind !== "check") openOffer({ itemId: e.itemId, stepId: step.id, reason: e.reason });
          return;
        }
      }
    },
    () => void view.reload(),
  );

  const total = outline.length;
  const requested = Number(params.get("step"));
  const firstPublished = status.findIndex((s) => s === "published");
  const pos = Number.isInteger(requested) && requested >= 1 && requested <= total + 1 ? requested - 1 : Math.max(0, firstPublished);
  const current = steps[pos];
  const isEnd = total > 0 && pos >= total;
  const inCheck = current?.kind === "check";
  // A new item never interrupts an exercise: unlocks wait for the lesson end.
  useCelebrationHold(!isEnd);
  useLessonFocus(lessonId, isEnd && checkResults !== null);

  const go = (p: number) => {
    navigated.current = true;
    setParams({ step: String(p + 1) }, { replace: false });
  };
  const nextPos = (() => {
    for (let i = pos + 1; i < total; i++) if (status[i] !== "dropped") return i;
    return total;
  })();
  const prevPos = (() => {
    for (let i = pos - 1; i >= 0; i--) if (status[i] !== "dropped") return i;
    return -1;
  })();

  // Move focus to the new step's heading after the learner navigates.
  useEffect(() => {
    if (!navigated.current) return;
    const el = current ? document.getElementById(`step-title-${current.id}`) : document.getElementById("step-placeholder");
    el?.focus();
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
  }, [pos, current]);

  // L11: no tutor during the exit check.
  useEffect(() => {
    if (inCheck) setTutorOpen(false);
  }, [inCheck]);

  const openOffer = useCallback((o: Offer) => {
    const key = `${o.itemId}:${o.reason}`;
    if (offered.current.has(key)) return;
    offered.current.add(key);
    setOffer(o);
    setTutorCtx({ itemId: o.itemId, stepId: o.stepId });
    setTutorOpen(true);
  }, []);

  const tutorHooks: TutorHooks = useMemo(
    () => ({
      onOfferTutor: (itemId, stepId, reason) => openOffer({ itemId, stepId, reason }),
      onAskTutor: (itemId, stepId) => {
        setOffer(null);
        setTutorCtx({ itemId, stepId });
        setTutorOpen(true);
      },
      onAnswerLine: (stepId, line) => {
        setOffer(null);
        setTutorCtx({ stepId, line });
        setTutorOpen(true);
        setAutoSend({ text: t("lesson.answerLineMessage", { n: line + 1 }), nonce: Date.now() });
      },
    }),
    [openOffer],
  );

  const askAbout = (sel: SelectedText) => {
    setOffer(null);
    setTutorCtx({ stepId: current?.id, itemId: sel.itemId });
    setTutorQuote(sel.quote);
    setTutorOpen(true);
    setTutorFocus((n) => n + 1);
  };
  const defineViaTutor = (sel: SelectedText & { term: string }) => {
    setOffer(null);
    setTutorCtx({ stepId: current?.id, itemId: sel.itemId });
    setTutorOpen(true);
    setAutoSend({ text: t("selection.defineMessage", { term: sel.term }), quote: sel.quote, nonce: Date.now() });
  };

  useHeader({
    title: v?.lesson.title ?? t("lesson.title"),
    sub: v?.lesson.objective,
    back: topicId ? { to: `/topics/${topicId}`, label: t("lesson.backToCourse") } : undefined,
    art: "spheres",
  });

  if (view.loading && !v) return <PageLoading />;
  if (view.error && !v)
    return (
      <section {...stylex.props(card.base)}>
        <ErrorBox error={view.error} onRetry={view.reload} title={t("lesson.loadFailed")} />
      </section>
    );
  if (!v) return null;

  const published = status.filter((st) => st === "published").length;
  const done = Math.min(pos, total);
  const showTutor = !inCheck && (docked || tutorOpen);

  const outlineList = (
    <div {...stylex.props(s.stepsWrap)}>
    <span aria-hidden="true" {...stylex.props(s.rail)} />
    <ol {...stylex.props(s.steps)}>
      {outline.map((o, i) => {
        const st = status[i] ?? "pending";
        const ready = st === "published";
        return (
          <li key={i}>
            <button
              type="button"
              aria-current={i === pos ? "step" : undefined}
              disabled={!ready}
              onClick={() => go(i)}
              {...stylex.props(s.item, i === pos && s.itemCurrent)}
            >
              <Marker n={i + 1} st={st} done={ready && i < pos} current={i === pos && ready} />
              <span {...stylex.props(s.itemText)}>
                <span {...stylex.props(s.itemTitle, !ready && s.itemTitleMuted, st === "dropped" && s.itemTitleDropped)}>{steps[i]?.title ?? o.title}</span>
                <span {...stylex.props(s.itemSub)}>
                  {o.kind === "check" ? t("lesson.noHints") : kindLabel(o.kind)}
                  {!ready && <> · {t(retrying[i] && st === "checking" ? "lesson.step.retrying" : STATUS_TEXT[st])}</>}
                </span>
                <span {...stylex.props(layout.srOnly)}>{t(STATUS_TEXT[st])}</span>
              </span>
            </button>
          </li>
        );
      })}
      {total > 0 && (
        <li>
          <button type="button" aria-current={isEnd ? "step" : undefined} onClick={() => go(total)} {...stylex.props(s.item, isEnd && s.itemCurrent)}>
            <Marker n={null} st="published" done={false} current={isEnd} />
            <span {...stylex.props(s.itemText)}>
              <span {...stylex.props(s.itemTitle)}>{t(practice ? "practiceSet.results" : "lesson.summaryAndCards")}</span>
            </span>
          </button>
        </li>
      )}
    </ol>
    </div>
  );

  const tabs = (
    <div role="tablist" aria-label={t("lesson.sections")} {...stylex.props(s.tabs)}>
      {(
        [
          ["lesson", "lesson.title", <BookOpen key="i" size={20} aria-hidden="true" />],
          ["video", "lesson.tab.video", <Clapperboard key="i" size={20} aria-hidden="true" />],
          ["cards", "lesson.tab.cards", <Copy key="i" size={20} aria-hidden="true" />],
          ["notes", "lesson.tab.notes", <NotebookText key="i" size={20} aria-hidden="true" />],
        ] as const
      )
        .filter(([key]) => (key !== "video" || videoOn) && !(practice && (key === "video" || key === "cards")))
        .map(([key, label, icon]) => (
        <button
          key={key}
          type="button"
          role="tab"
          id={`tab-${key}`}
          aria-selected={tab === key}
          aria-controls={`panel-${key}`}
          onClick={() => setTab(key)}
          {...stylex.props(s.tab, tab === key && s.tabOn)}
        >
          {icon} {t(label)}
        </button>
      ))}
    </div>
  );

  const stale = v.lesson.supersededBy ? (
    <p role="note" {...stylex.props(banner.base, banner.lilac)}>
      {t("lesson.oldVersion")}{" "}
      <Link to={`/lessons/${v.lesson.supersededBy}`} {...stylex.props(text.link)}>
        {t("lesson.openNewVersion")} <ArrowRight size={15} aria-hidden="true" />
      </Link>
    </p>
  ) : (
    <StaleSources lesson={v.lesson} />
  );

  if (tab !== "lesson")
    return (
      <>
        {tabs}
        {stale}
        <section role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} {...stylex.props(card.base)}>
          {tab === "cards" ? (
            <>
              <CardHead title={t("lesson.reviewCards")} />
              <p {...stylex.props(text.small, text.muted)}>{t("lesson.reviewCardsHint")}</p>
              {topicId ? <ProposedCards topicId={topicId} /> : <Spinner label={t("common.loading")} />}
            </>
          ) : tab === "video" ? (
            <VideoLesson
              lessonId={lessonId}
              topicId={topicId}
              title={v.lesson.title}
              writing={v.lesson.status === "generating"}
              steps={v.steps}
              itemStates={v.itemStates}
            />
          ) : topicId ? (
            <LessonNotes topicId={topicId} lessonId={lessonId} />
          ) : (
            <Spinner label={t("common.loading")} />
          )}
        </section>
      </>
    );

  return (
    <>
      {tabs}
      {stale}
      <div role="tabpanel" id="panel-lesson" aria-labelledby="tab-lesson" {...stylex.props(s.grid, showTutor && docked && s.gridDocked)}>
        <aside ref={outlineRef} aria-label={t("lesson.outline")} {...stylex.props(card.base, s.outline)}>
          <p {...stylex.props(s.outlineTitle)}>{topicTitle ?? t("lesson.plan")}</p>
          <p {...stylex.props(s.outlineMeta, text.small, text.muted, text.tnum)}>
            {practice
              ? t("practiceSet.outlineMeta", { focus: t(FOCUS_LABEL[practice.focus]), ready: published, total })
              : t("lesson.outlineMeta", { level: levelLabel(v.lesson.level), ready: published, total })}
          </p>
          <p {...stylex.props(s.outlineMeta)}>
            <LearnerChip status={v.lesson.learnerStatus} />
            {streamStatus === "reconnecting" && <span {...stylex.props(chip.base, chip.xs, chip.butter)}> {t("lesson.reconnecting")}</span>}
          </p>
          <details {...stylex.props(s.mobileOnly)}>
            <summary {...stylex.props(s.mobileSummary)}>{isEnd ? t(practice ? "practiceSet.results" : "lesson.summaryTitle") : t("lesson.stepOf", { n: pos + 1, total })} · {t("lesson.contents")}</summary>
            {outlineList}
          </details>
          <nav aria-label={t("lesson.steps")} {...stylex.props(s.desktopOnly)}>
            {outlineList}
          </nav>
        </aside>

        <section ref={mainRef} aria-label={t("lesson.step")} {...stylex.props(card.base, s.main)}>
          {v.lesson.status === "failed" && (
            <div role="alert" {...stylex.props(banner.base, banner.danger, s.interrupted)}>
              <TriangleAlert size={16} aria-hidden="true" />
              <span {...stylex.props(s.interruptedText)}>
                {resumeError ? t("lesson.resumeFailed", { error: resumeError }) : t(practice ? "practiceSet.interrupted" : "lesson.interrupted")}
              </span>
              <button type="button" disabled={resuming} onClick={resume} {...stylex.props(btn.base, btn.danger, btn.sm)}>
                {resuming ? <Spinner /> : <RotateCcw size={14} aria-hidden="true" />} {t("lesson.resume")}
              </button>
            </div>
          )}
          {total === 0 ? (
            <div id="step-placeholder" tabIndex={-1} {...stylex.props(s.wait)}>
              <Spinner size={24} />
              <p {...stylex.props(s.waitText)}>{t("lesson.planningWait")}</p>
            </div>
          ) : (
            <>
              {v.lesson.status !== "failed" && status.some((st) => st === "pending" || st === "checking") && (
                <GenProgress
                  outline={outline.map((o, i) => ({ title: steps[i]?.title ?? o.title }))}
                  status={status}
                  checkingSince={checkingSince}
                  rejection={rejection}
                  practice={practice && v.authorConversationId ? { onStop: stop, stopping } : undefined}
                />
              )}
              <div {...stylex.props(s.progressRow)}>
                <span {...stylex.props(text.small, text.muted, text.tnum)}>{isEnd ? t(practice ? "practiceSet.results" : "lesson.summaryShort") : t("lesson.stepOf", { n: pos + 1, total })}</span>
                <div {...stylex.props(s.progressBar)}>
                  <Progress value={done} max={total} label={t("lesson.stepsDone")} />
                </div>
                {!inCheck && !isEnd && !docked && (
                  <button type="button" aria-expanded={tutorOpen} onClick={() => setTutorOpen((o) => !o)} {...stylex.props(btn.base, btn.ghost, btn.sm)}>
                    <MessageCircle size={16} aria-hidden="true" /> {t("lesson.tutor")}
                  </button>
                )}
                {inCheck && (
                  <span {...stylex.props(chip.base, chip.xs)}>
                    <ShieldCheck size={12} aria-hidden="true" /> {t("lesson.noHintsChip")}
                  </span>
                )}
              </div>

              {Object.values(steps).map((st) => (
                <div key={st.id} hidden={st.idx !== pos || isEnd}>
                  {st.idx === v.challengeIdx && <ChallengeBanner />}
                  {st.idx === 0 && <LessonReward lessonId={lessonId} />}
                  <StepView
                    step={st}
                    topicId={topicId}
                    lessonId={lessonId}
                    active={st.idx === pos && !isEnd}
                    tutor={tutorHooks}
                    onCheckResults={(_, r) => setCheckResults(r)}
                    onPractiseMore={(itemId) => setPracticeFrom({ itemId })}
                    itemStates={v.itemStates}
                    revealedLines={v.revealedLines[st.id] ?? []}
                    lineResults={lineResults[st.id]}
                    alternatives={v.alternatives[st.id] ?? []}
                  />
                </div>
              ))}

              {!isEnd && !current && (
                <div id="step-placeholder" tabIndex={-1} role="status" {...stylex.props(s.wait)}>
                  {status[pos] === "dropped" ? (
                    <>
                      <CircleSlash size={24} aria-hidden="true" />
                      <p {...stylex.props(s.waitText)}>{t("lesson.droppedStep")}</p>
                    </>
                  ) : (
                    <>
                      <Spinner size={24} />
                      <p {...stylex.props(s.waitText)}>
                        {t(status[pos] === "checking" ? (retrying[pos] ? "lesson.wait.retrying" : "lesson.wait.checking") : "lesson.wait.writing")}
                      </p>
                      <p {...stylex.props(text.small)}>{t("steps.quote", { quote: outline[pos]?.title ?? "" })}</p>
                    </>
                  )}
                </div>
              )}

              {isEnd &&
                (practice ? (
                  <PracticeEnd lessonId={lessonId} topicId={topicId} summary={summary} generating={v.lesson.status === "generating" && !summary} />
                ) : (
                  <LessonEnd lessonId={lessonId} summary={summary} generating={v.lesson.status === "generating" && !summary} checkResults={checkResults} topicId={topicId} />
                ))}

              <nav aria-label={t("lesson.stepNav")} {...stylex.props(s.nav)}>
                <button type="button" disabled={prevPos < 0} onClick={() => go(prevPos)} {...stylex.props(btn.base, btn.ghost, s.navBtn)}>
                  <ArrowLeft size={17} aria-hidden="true" /> {t("lesson.back")}
                </button>
                {!isEnd && (
                  <button type="button" onClick={() => go(nextPos)} {...stylex.props(btn.base, btn.primary, s.navBtn)}>
                    {t(nextPos >= total ? "lesson.toSummary" : "lesson.next")} <ArrowRight size={17} aria-hidden="true" />
                  </button>
                )}
              </nav>
            </>
          )}
        </section>

        {docked && inCheck && (
          <aside aria-label={t("lesson.tutor")} {...stylex.props(card.base, s.checkNote)}>
            <Clay name="tutor-reading" size={160} />
            <p {...stylex.props(text.h3)}>{t("lesson.checkNoTutor")}</p>
            <p {...stylex.props(text.small, text.muted)}>{t("lesson.checkNoTutorBody")}</p>
          </aside>
        )}

        <PracticeDialog from={practiceFrom} defaultFocus="mistakes" onClose={() => setPracticeFrom(null)} />

        {showTutor && topicId && (
          <aside ref={tutorRef} aria-label={t("lesson.aiTutor")} {...stylex.props(card.base, s.tutor, !docked && s.tutorFloating, !docked && shadow.pop)}>
            <div {...stylex.props(s.tutorHead)}>
              <Clay name="tutor-avatar" size={56} xstyle={s.tutorAvatar} />
              <h2 {...stylex.props(s.tutorName)}>{t("lesson.aiTutor")}</h2>
              {!docked && (
                <button type="button" aria-label={t("lesson.closeTutor")} onClick={() => setTutorOpen(false)} {...stylex.props(btn.base, btn.icon)}>
                  <PanelRightClose size={18} aria-hidden="true" />
                </button>
              )}
            </div>
            {offer && (
              <div role="status" {...stylex.props(s.offer)}>
                <p>
                  {offer.reason === "wrong_twice"
                    ? t("lesson.offerWrongTwice")
                    : t("lesson.offerIdle")}
                </p>
                <div {...stylex.props(layout.actions)}>
                  <button
                    type="button"
                    onClick={() => {
                      setAutoSend({ text: t("lesson.offerMessage"), nonce: Date.now() });
                      setOffer(null);
                    }}
                    {...stylex.props(btn.base, btn.primary, btn.sm)}
                  >
                    {t("lesson.offerAccept")}
                  </button>
                  <button type="button" onClick={() => setOffer(null)} {...stylex.props(btn.base, btn.ghost, btn.sm)}>
                    {t("lesson.offerDecline")}
                  </button>
                </div>
              </div>
            )}
            <Chat
              conversationId={tutorConv}
              topicId={topicId}
              label={t("lesson.tutorChat")}
              placeholder={t("lesson.tutorPlaceholder")}
              persona={{ avatar: "tutor-avatar", illustration: "tutor-reading" }}
              autoSend={autoSend}
              quote={tutorQuote ? { text: tutorQuote, onRemove: () => setTutorQuote(null) } : null}
              focusKey={tutorFocus}
              empty={
                <div {...stylex.props(s.tutorIntro)}>
                  <p {...stylex.props(text.small)}>{t("lesson.tutorIntro")}</p>
                  <ul {...stylex.props(s.tutorList)}>
                    <li>{t("lesson.tutorFind")}</li>
                    <li>{t("lesson.tutorAsk")}</li>
                    <li>{t("lesson.tutorExplain")}</li>
                  </ul>
                </div>
              }
              onSend={async (msg, quote) => {
                const res = await api.tutor(lessonId, { ...tutorCtx, stepId: tutorCtx.stepId ?? current?.id, quote, text: msg });
                setTutorConv(res.conversationId);
                return res.conversationId;
              }}
            />
          </aside>
        )}
      </div>
      <LessonCompanion topicId={topicId} step={pos} total={total} />
      <SelectionActions
        roots={[mainRef, tutorRef]}
        tutorBlocked={inCheck ? t("selection.tutorOffCheck") : null}
        noteTarget={topicId ? { topicId, lessonId, stepId: current?.id } : null}
        onAsk={askAbout}
        onDefine={defineViaTutor}
      />
    </>
  );
}

function LessonNotes({ topicId, lessonId }: { topicId: string; lessonId: string }) {
  useLang();
  const notes = useResource(() => api.notes(topicId), topicId);
  const mine = (notes.data ?? []).filter((n) => n.lessonId === lessonId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    <>
      <CardHead title={t("lesson.notes")}>
        <Link to={`/memory/${topicId}`} {...stylex.props(text.link)}>
          {t("lesson.allMemory")} <ArrowRight size={15} aria-hidden="true" />
        </Link>
      </CardHead>
      {notes.loading && !notes.data ? (
        <Spinner label={t("lesson.loadingNotes")} />
      ) : notes.error ? (
        <ErrorBox error={notes.error} onRetry={notes.reload} />
      ) : mine.length === 0 ? (
        <Empty title={t("lesson.noNotesTitle")}>{t("lesson.noNotesBody")}</Empty>
      ) : (
        <ul {...stylex.props(s.notes)}>
          {mine.map((n) => (
            <li key={n.id} {...stylex.props(s.note)}>
              {n.quote && <blockquote {...stylex.props(s.quote)}>{n.quote}</blockquote>}
              {n.text && <p>{n.text}</p>}
              <p {...stylex.props(text.xs, text.muted)}>{formatDateTime(n.createdAt)}</p>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function LessonEnd({
  lessonId,
  summary,
  generating,
  checkResults,
  topicId,
}: {
  lessonId: string;
  summary: string | null;
  generating: boolean;
  checkResults: { item: PublicItem; result: ItemResult | undefined }[] | null;
  topicId: string | null;
}) {
  useLang();
  const correct = checkResults?.filter((r) => r.result?.response.correct === true).length ?? 0;
  return (
    <div {...stylex.props(s.end)}>
      <h2 id="step-placeholder" tabIndex={-1} {...stylex.props(s.endTitle)}>
        {t("lesson.summaryTitle")}
      </h2>
      {checkResults && (
        <div {...stylex.props(s.summary)}>
          <p {...stylex.props(s.score)}>
            {correct} <span {...stylex.props(s.scoreOf)}>{t("steps.scoreOf", { total: checkResults.length })}</span>
          </p>
          <p>{t("lesson.endScore")}</p>
        </div>
      )}
      <LessonReward lessonId={lessonId} end />
      <PracticeOffer lessonId={lessonId} belowCrown={!!checkResults && checkResults.length > 0 && correct / checkResults.length < CROWN_SHARE} />
      {topicId && <FinalInvite topicId={topicId} />}
      <DayProgress />
      {summary ? (
        <Markdown src={summary} />
      ) : generating ? (
        <p {...stylex.props(text.muted)}>
          <Spinner /> {t("lesson.stillWriting")}
        </p>
      ) : null}
      <section aria-labelledby="cards-title">
        <CardHead title={t("lesson.reviewCards")} id="cards-title" />
        <p {...stylex.props(text.small, text.muted)}>{t("lesson.reviewCardsHint")}</p>
        {topicId ? <ProposedCards topicId={topicId} /> : <Empty title={t("lesson.findingTopic")} />}
      </section>
      {topicId && (
        <Link to={`/topics/${topicId}`} {...stylex.props(btn.base, btn.primary, s.start)}>
          {t("lesson.toCourseMap")} <ArrowRight size={16} aria-hidden="true" />
        </Link>
      )}
    </div>
  );
}
