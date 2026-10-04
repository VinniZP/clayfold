import * as stylex from "@stylexjs/stylex";
import { ArrowLeft, ArrowRight, BookOpen, Check, CircleCheck, Clock, Flag, GraduationCap, RefreshCw, Repeat, ShieldCheck, TriangleAlert, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { FINAL_PASS_SHARE, type PracticeAnswerUpdate, type PracticeQuestion, type PracticeTestView } from "@shared/api";
import type { Answer, PublicItem } from "@shared/schemas";
import { useHeader } from "../components/header";
import { AnswerInput, draftFromAnswer, toAnswer, type Draft } from "../components/ItemView";
import { ItemPrompt } from "../components/ItemPrompt";
import { CardHead, ErrorBox, Markdown, PageLoading, Progress, Spinner } from "../components/ui";
import { api, ApiFailure, errorText } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { t, useLang } from "../lib/i18n";
import { useOverlayScroll } from "../lib/overlayScroll";
import { useResource } from "../lib/useResource";
import { bp, color, font, motion, radius } from "../theme/tokens.stylex";
import { banner, btn, card, chip, layout, shadow, text } from "../theme/ui";

const SAVE_DELAY_MS = 500;
const POLL_MS = 2000;
/** A node scored below this share gets "review the lesson" as a next action; the exit-check bar of L12. */
const WEAK_SHARE = 0.8;

const s = stylex.create({
  passed: { backgroundColor: color.successSoft, fontWeight: 650 },
  page: { display: "grid", gridTemplateColumns: "repeat(12, minmax(0, 1fr))", gap: 24, alignItems: "start" },
  main: { gridColumn: { default: "span 8", [bp.tablet]: "1 / -1" }, display: "grid", gap: 20, alignContent: "start", minWidth: 0 },
  side: {
    gridColumn: { default: "span 4", [bp.tablet]: "1 / -1" },
    position: { default: "sticky", [bp.tablet]: "static" },
    top: 24,
    display: "grid",
    gap: 16,
    alignContent: "start",
    minWidth: 0,
  },
  full: { gridColumn: "1 / -1" },
  progressRow: { display: "flex", alignItems: "center", gap: 14 },
  grow: { flexGrow: 1 },
  keepOrder: { justifySelf: "start" },
  qHead: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" },
  qTitle: { fontFamily: font.display, fontSize: 15, fontWeight: 700, color: color.textMuted, outline: "none" },
  question: { display: "grid", gap: 18, minHeight: 260 },
  fieldset: { margin: 0, padding: 0, borderWidth: 0, minWidth: 0 },
  flagOn: { backgroundColor: { default: color.warningSoft, ":hover": color.warningSoft }, borderColor: color.warning, color: color.warning },
  nav: { display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", paddingTop: 16, borderTopWidth: 1, borderTopStyle: "solid", borderTopColor: color.border },
  timer: { display: "flex", alignItems: "center", gap: 10, fontFamily: font.display, fontSize: 28, fontWeight: 800, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.02em" },
  timerLow: { color: color.danger },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(40px, 1fr))", gap: 6, margin: 0, padding: 0, listStyle: "none" },
  cell: {
    position: "relative",
    display: "grid",
    placeItems: "center",
    width: "100%",
    height: 40,
    borderRadius: 12,
    borderWidth: 1.5,
    borderStyle: "solid",
    borderColor: { default: color.border, ":hover": color.borderStrong },
    backgroundColor: color.surface,
    color: color.text,
    fontSize: 14,
    fontWeight: 700,
    fontVariantNumeric: "tabular-nums",
    cursor: "pointer",
    outline: { default: "none", ":focus-visible": `2px solid ${color.focus}` },
    outlineOffset: 2,
    transitionProperty: "background-color, border-color",
    transitionDuration: motion.fast,
  },
  cellAnswered: { backgroundColor: color.primary, borderColor: { default: color.primary, ":hover": color.primary }, color: color.onPrimary },
  cellCurrent: { boxShadow: `0 0 0 2px ${color.surface}, 0 0 0 4px ${color.focus}` },
  cellFlag: { position: "absolute", top: -6, right: -6, display: "grid", placeItems: "center", width: 18, height: 18, borderRadius: "50%", backgroundColor: color.warning, color: color.surface },
  legend: { display: "flex", flexWrap: "wrap", gap: "6px 14px", fontSize: 12.5, color: color.textMuted },
  legendItem: { display: "inline-flex", alignItems: "center", gap: 6 },
  swatch: { width: 12, height: 12, borderRadius: 4, borderWidth: 1.5, borderStyle: "solid", borderColor: color.border, backgroundColor: color.surface },
  swatchAnswered: { backgroundColor: color.primary, borderColor: color.primary },
  swatchFlag: { backgroundColor: color.warning, borderColor: color.warning, borderRadius: "50%" },
  kbd: { display: "inline-grid", placeItems: "center", minWidth: 22, height: 22, paddingInline: 5, borderRadius: 7, backgroundColor: color.surface2, color: color.text, fontSize: 12, fontFamily: font.mono },
  keys: { display: { default: "grid", [bp.mobile]: "none" }, gap: 6, margin: 0, padding: 0, listStyle: "none", fontSize: 13, color: color.textMuted },
  saved: { display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: color.textMuted },
  dialog: {
    width: "min(460px, calc(100vw - 32px))",
    padding: 0,
    borderWidth: 0,
    borderRadius: radius.card,
    backgroundColor: color.surface,
    color: color.text,
    "::backdrop": { backgroundColor: color.scrim },
  },
  dialogBody: { display: "grid", gap: 14, padding: 26 },
  dialogTitle: { fontFamily: font.display, fontSize: 22, fontWeight: 800 },
  counts: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, margin: 0, padding: 0, listStyle: "none" },
  count: { display: "grid", gap: 2, paddingBlock: 10, paddingInline: 12, borderRadius: 14, backgroundColor: color.surface2, fontSize: 12.5, color: color.textMuted },
  countNum: { fontFamily: font.display, fontSize: 22, fontWeight: 800, color: color.text, fontVariantNumeric: "tabular-nums" },
  scoreRow: { display: "flex", alignItems: "baseline", flexWrap: "wrap", gap: "4px 14px" },
  score: { fontFamily: font.display, fontSize: { default: 56, [bp.mobile]: 44 }, fontWeight: 800, lineHeight: 1, letterSpacing: "-0.04em", fontVariantNumeric: "tabular-nums" },
  scoreOf: { fontSize: 20, fontWeight: 700, letterSpacing: "normal", color: color.textMuted },
  nodes: { display: "grid", gap: 12, margin: 0, padding: 0, listStyle: "none" },
  node: { display: "grid", gap: 6 },
  nodeHead: { display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 },
  nodeTitle: { fontWeight: 650, minWidth: 0 },
  weakFill: { backgroundColor: color.warning },
  actions: { display: "grid", gap: 8, margin: 0, padding: 0, listStyle: "none" },
  action: { display: "flex", alignItems: "center", gap: 12, paddingBlock: 12, paddingInline: 14, borderRadius: radius.inner, backgroundColor: color.surface2 },
  actionIcon: { display: "grid", placeItems: "center", flexShrink: 0, width: 34, height: 34, borderRadius: "50%", backgroundColor: color.lilacSoft, color: color.accentText },
  actionBody: { display: "grid", gap: 2, flexGrow: 1, minWidth: 0 },
  filter: { display: "inline-flex", gap: 4, padding: 4, borderRadius: radius.pill, backgroundColor: color.surface2 },
  filterBtn: { height: 32, paddingInline: 14, borderWidth: 0, borderRadius: radius.pill, backgroundColor: "transparent", color: color.text, fontSize: 13.5, fontWeight: 650, cursor: "pointer" },
  filterOn: { backgroundColor: color.surface, boxShadow: `0 1px 2px ${color.shadow}` },
  review: { display: "grid", gap: 14, margin: 0, padding: 0, listStyle: "none" },
  reviewItem: { display: "grid", gap: 12, paddingBlock: 18, paddingInline: 20, borderRadius: radius.inner, borderWidth: 1.5, borderStyle: "solid", borderColor: color.border },
  reviewHead: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" },
  num: { display: "grid", placeItems: "center", width: 28, height: 28, borderRadius: "50%", backgroundColor: color.surface2, fontSize: 13, fontWeight: 750, fontVariantNumeric: "tabular-nums" },
  answers: { display: "grid", gap: 6, paddingBlock: 12, paddingInline: 14, borderRadius: radius.field, backgroundColor: color.surface2, fontSize: 15 },
  answerLabel: { color: color.textMuted, fontWeight: 600, marginRight: 6 },
  wrongAnswer: { color: color.danger },
  solutionSummary: { cursor: "pointer", fontWeight: 650, color: color.accentText },
});

/** The answer a draft stands for; a cloze with any blank filled is kept, so a reload does not lose it. */
function draftAnswer(d: Draft): Answer | null {
  if (d.format === "cloze" && d.blanks.some((b) => b.trim())) return { format: "cloze", blanks: d.blanks.map((b) => b.trim()) };
  return toAnswer(d);
}

const isTyping = (el: EventTarget | null) => el instanceof HTMLElement && !!el.closest("input:not([type=radio]):not([type=checkbox]), textarea, select, [contenteditable]");

const mmss = (ms: number) => {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

export function PracticeTestPage() {
  useLang();
  const { testId = "" } = useParams();
  const res = useResource(() => api.practiceTest(testId), testId);
  const [timedOut, setTimedOut] = useState(false);
  const v = res.data;
  useHeader({
    title: t(v?.test.kind === "final" ? "final.title" : "practice.title"),
    back: v ? { to: `/topics/${v.scope.id}`, label: v.scope.title } : undefined,
    art: "cards-stack",
  });

  const grading = v?.test.status === "grading";
  const { reload } = res;
  useEffect(() => {
    if (!grading) return;
    const id = setInterval(() => void reload(), POLL_MS);
    return () => clearInterval(id);
  }, [grading, reload]);

  if (res.loading && !v) return <PageLoading />;
  if (res.error && !v)
    return (
      <div {...stylex.props(s.page)}>
        <section {...stylex.props(card.base, s.full)}>
          <ErrorBox error={res.error} onRetry={res.reload} />
        </section>
      </div>
    );
  if (!v) return null;
  if (v.test.status === "open")
    return (
      <TakeTest
        key={v.test.id}
        view={v}
        onSubmitted={(next, byTimer) => {
          setTimedOut(byTimer);
          res.setData(() => next);
          window.scrollTo({ top: 0 });
        }}
        onClosed={() => void res.reload()}
      />
    );
  return <Results view={v} timedOut={timedOut} onChange={(next) => res.setData(() => next)} />;
}

// ---------- Taking the test ----------

function TakeTest({ view, onSubmitted, onClosed }: { view: PracticeTestView; onSubmitted: (v: PracticeTestView, byTimer: boolean) => void; onClosed: () => void }) {
  useLang();
  const testId = view.test.id;
  const qs = view.questions;
  const [pos, setPos] = useState(() => Math.max(0, qs.findIndex((q) => !q.answer)));
  const [drafts, setDrafts] = useState<Record<number, Draft>>(() => Object.fromEntries(qs.map((q) => [q.idx, draftFromAnswer(q.item, q.answer)])));
  const [answers, setAnswers] = useState<Record<number, Answer | null>>(() => Object.fromEntries(qs.map((q) => [q.idx, q.answer])));
  const [flags, setFlags] = useState<Record<number, boolean>>(() => Object.fromEntries(qs.map((q) => [q.idx, q.flagged])));
  const [inflight, setInflight] = useState(0);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useOverlayScroll(dialog, true);

  // Unsaved changes per question, merged until sent; saves of one question go out in order.
  const pending = useRef(new Map<number, PracticeAnswerUpdate>());
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const chains = useRef(new Map<number, Promise<void>>());
  const shownAt = useRef(Date.now());
  const closed = useRef(false);
  const posRef = useRef(pos);
  posRef.current = pos;

  const flush = useCallback(
    (idx: number): Promise<void> => {
      clearTimeout(timers.current.get(idx));
      timers.current.delete(idx);
      const body = pending.current.get(idx);
      if (!body) return chains.current.get(idx) ?? Promise.resolve();
      pending.current.delete(idx);
      const next = (chains.current.get(idx) ?? Promise.resolve()).then(async () => {
        setInflight((n) => n + 1);
        try {
          await api.savePracticeAnswer(testId, idx, body);
          setSaveError(null);
        } catch (err) {
          if (err instanceof ApiFailure && err.status === 409) {
            closed.current = true;
            onClosed();
            return;
          }
          const later = pending.current.get(idx);
          pending.current.set(idx, { ...body, ...later, spentMs: (body.spentMs ?? 0) + (later?.spentMs ?? 0) });
          setSaveError(errorText(err));
        } finally {
          setInflight((n) => n - 1);
        }
      });
      chains.current.set(idx, next);
      return next;
    },
    [testId, onClosed],
  );

  const queue = useCallback(
    (idx: number, patch: PracticeAnswerUpdate, delay = SAVE_DELAY_MS) => {
      const prev = pending.current.get(idx);
      pending.current.set(idx, { ...prev, ...patch, spentMs: (prev?.spentMs ?? 0) + (patch.spentMs ?? 0) });
      clearTimeout(timers.current.get(idx));
      timers.current.set(
        idx,
        setTimeout(() => void flush(idx), delay),
      );
    },
    [flush],
  );

  const flushAll = useCallback(() => Promise.all([...new Set([...pending.current.keys(), ...chains.current.keys()])].map(flush)), [flush]);

  /** Adds the time since the current question was shown to its answer time. */
  const account = useCallback(() => {
    if (closed.current) return;
    const ms = Date.now() - shownAt.current;
    shownAt.current = Date.now();
    if (ms >= 1000) queue(posRef.current, { spentMs: ms });
  }, [queue]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        account();
        void flushAll();
      } else shownAt.current = Date.now();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      account();
      void flushAll();
    };
  }, [account, flushAll]);

  const go = (next: number) => {
    if (next < 0 || next >= qs.length || next === pos) return;
    account();
    void flush(qs[pos]!.idx);
    setPos(next);
    requestAnimationFrame(() => headingRef.current?.focus());
  };

  const q = qs[pos]!;
  const setDraft = (d: Draft) => {
    setDrafts((m) => ({ ...m, [q.idx]: d }));
    const answer = draftAnswer(d);
    setAnswers((m) => ({ ...m, [q.idx]: answer }));
    queue(q.idx, { answer }, d.format === "single" || d.format === "multi" ? 0 : SAVE_DELAY_MS);
  };
  const keepOrder = () => setDraft(drafts[q.idx]!);
  const toggleFlag = () => {
    const flagged = !flags[q.idx];
    setFlags((m) => ({ ...m, [q.idx]: flagged }));
    queue(q.idx, { flagged }, 0);
  };

  const answered = qs.filter((x) => answers[x.idx]).length;
  const flagged = qs.filter((x) => flags[x.idx]).length;

  const submit = useCallback(
    async (byTimer: boolean) => {
      setSubmitting(true);
      setSubmitError(null);
      try {
        account();
        await flushAll();
        const next = await api.submitPracticeTest(testId);
        closed.current = true;
        dialog.current?.close();
        onSubmitted(next, byTimer);
      } catch (err) {
        setSubmitError(errorText(err));
        setSubmitting(false);
      }
    },
    [account, flushAll, testId, onSubmitted],
  );

  // The timer only ends the test (L20): no score depends on speed.
  const end = view.test.endsAt ? Date.parse(view.test.endsAt) : null;
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (end === null) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [end]);
  const left = end === null ? null : end - now;
  const timeUp = left !== null && left <= 0;
  useEffect(() => {
    if (timeUp && !submitting) void submit(true);
  }, [timeUp, submitting, submit]);
  const minute = left === null ? null : Math.ceil(left / 60_000);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || isTyping(e.target) || dialog.current?.open) return;
      if (e.code === "KeyN" || (e.code === "ArrowRight" && !(e.target instanceof HTMLInputElement))) {
        e.preventDefault();
        go(pos + 1);
      } else if (e.code === "KeyP" || (e.code === "ArrowLeft" && !(e.target instanceof HTMLInputElement))) {
        e.preventDefault();
        go(pos - 1);
      } else if (e.code === "KeyF") {
        e.preventDefault();
        toggleFlag();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const firstOpen = qs.findIndex((x) => !answers[x.idx]);

  return (
    <div {...stylex.props(s.page)}>
      <section aria-labelledby="question-title" {...stylex.props(card.base, s.main)}>
        <p {...stylex.props(banner.base, banner.ink)}>
          <ShieldCheck size={18} aria-hidden="true" /> {t("practice.banner")}
        </p>
        <div {...stylex.props(s.progressRow)}>
          <span {...stylex.props(text.small, text.muted, text.tnum)}>{t("practice.answeredOf", { answered, total: qs.length })}</span>
          <div {...stylex.props(s.grow)}>
            <Progress value={answered} max={qs.length} label={t("practice.progress")} />
          </div>
        </div>
        <div {...stylex.props(s.question)}>
          <div {...stylex.props(s.qHead)}>
            <h2 id="question-title" ref={headingRef} tabIndex={-1} {...stylex.props(s.qTitle)}>
              {t("practice.questionOf", { n: pos + 1, total: qs.length })}
            </h2>
            <button type="button" aria-pressed={!!flags[q.idx]} onClick={toggleFlag} {...stylex.props(btn.base, btn.ghost, btn.sm, flags[q.idx] && s.flagOn)}>
              <Flag size={14} aria-hidden="true" /> {t(flags[q.idx] ? "practice.flagged" : "practice.flag")}
            </button>
          </div>
          <ItemPrompt key={`p${q.idx}`} src={q.item.prompt} id={`prompt-${q.idx}`} />
          <fieldset key={`f${q.idx}`} aria-describedby={`prompt-${q.idx}`} disabled={submitting} {...stylex.props(s.fieldset)}>
            <legend {...stylex.props(layout.srOnly)}>{t("item.yourAnswer")}</legend>
            <AnswerInput item={q.item} draft={drafts[q.idx]!} wrong={null} locked={submitting} onChange={setDraft} />
          </fieldset>
          {q.item.format === "order" && !answers[q.idx] && (
            <button type="button" onClick={keepOrder} {...stylex.props(btn.base, btn.outline, btn.sm, s.keepOrder)}>
              <Check size={14} aria-hidden="true" /> {t("practice.keepOrder")}
            </button>
          )}
        </div>
        <div {...stylex.props(s.nav)}>
          <button type="button" disabled={pos === 0} onClick={() => go(pos - 1)} {...stylex.props(btn.base, btn.ghost)}>
            <ArrowLeft size={16} aria-hidden="true" /> {t("practice.previous")}
          </button>
          {pos < qs.length - 1 ? (
            <button type="button" onClick={() => go(pos + 1)} {...stylex.props(btn.base, btn.primary)}>
              {t("lesson.next")} <ArrowRight size={16} aria-hidden="true" />
            </button>
          ) : (
            <button type="button" onClick={() => dialog.current?.showModal()} {...stylex.props(btn.base, btn.primary)}>
              {t("practice.finish")}
            </button>
          )}
        </div>
      </section>

      <aside aria-label={t("practice.navigator")} {...stylex.props(card.base, s.side)}>
        {left !== null && (
          <div>
            <p role="timer" aria-label={t("practice.timeLeft", { time: mmss(left) })} {...stylex.props(s.timer, left < 60_000 && s.timerLow)}>
              <Clock size={22} aria-hidden="true" /> {mmss(left)}
            </p>
            <p aria-live="polite" {...stylex.props(text.small, text.muted)}>
              {minute !== null && minute <= 5 ? t("practice.minutesLeft", { count: minute }) : t("practice.timerNote")}
            </p>
          </div>
        )}
        <CardHead title={t("practice.questions")} />
        <ol {...stylex.props(s.grid)}>
          {qs.map((x, i) => {
            const state = [answers[x.idx] ? t("practice.state.answered") : t("practice.state.open"), flags[x.idx] ? t("practice.state.flagged") : null].filter(Boolean).join(", ");
            return (
              <li key={x.idx}>
                <button
                  type="button"
                  aria-current={i === pos ? "step" : undefined}
                  aria-label={t("practice.cell", { n: i + 1, state })}
                  onClick={() => go(i)}
                  {...stylex.props(s.cell, !!answers[x.idx] && s.cellAnswered, i === pos && s.cellCurrent)}
                >
                  {i + 1}
                  {flags[x.idx] && (
                    <span aria-hidden="true" {...stylex.props(s.cellFlag)}>
                      <Flag size={10} />
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ol>
        <div aria-hidden="true" {...stylex.props(s.legend)}>
          <span {...stylex.props(s.legendItem)}>
            <span {...stylex.props(s.swatch, s.swatchAnswered)} /> {t("practice.state.answered")}
          </span>
          <span {...stylex.props(s.legendItem)}>
            <span {...stylex.props(s.swatch)} /> {t("practice.state.open")}
          </span>
          <span {...stylex.props(s.legendItem)}>
            <span {...stylex.props(s.swatch, s.swatchFlag)} /> {t("practice.state.flagged")}
          </span>
        </div>
        <p role="status" {...stylex.props(s.saved)}>
          {saveError ? (
            <span {...stylex.props(text.error)}>
              <TriangleAlert size={14} aria-hidden="true" /> {t("practice.saveFailed", { error: saveError })}
            </span>
          ) : inflight > 0 ? (
            <>
              <Spinner /> {t("practice.saving")}
            </>
          ) : (
            <>
              <Check size={14} aria-hidden="true" /> {t("practice.saved")}
            </>
          )}
        </p>
        {saveError && (
          <button type="button" onClick={() => void flushAll()} {...stylex.props(btn.base, btn.ghost, btn.sm)}>
            <RefreshCw size={14} aria-hidden="true" /> {t("common.retry")}
          </button>
        )}
        <button type="button" onClick={() => dialog.current?.showModal()} {...stylex.props(btn.base, btn.primary, btn.block)}>
          {t("practice.finish")}
        </button>
        <ul aria-label={t("practice.keys")} {...stylex.props(s.keys)}>
          <li>
            <kbd {...stylex.props(s.kbd)}>N</kbd> <kbd {...stylex.props(s.kbd)}>→</kbd> {t("practice.keyNext")}
          </li>
          <li>
            <kbd {...stylex.props(s.kbd)}>P</kbd> <kbd {...stylex.props(s.kbd)}>←</kbd> {t("practice.keyPrevious")}
          </li>
          <li>
            <kbd {...stylex.props(s.kbd)}>F</kbd> {t("practice.keyFlag")}
          </li>
        </ul>
      </aside>

      <dialog ref={dialog} aria-labelledby="submit-title" {...stylex.props(s.dialog, shadow.pop)}>
        <div {...stylex.props(s.dialogBody)}>
          <h2 id="submit-title" {...stylex.props(s.dialogTitle)}>
            {t("practice.submitTitle")}
          </h2>
          <ul {...stylex.props(s.counts)}>
            <li {...stylex.props(s.count)}>
              <span {...stylex.props(s.countNum)}>{answered}</span> {t("practice.state.answered")}
            </li>
            <li {...stylex.props(s.count)}>
              <span {...stylex.props(s.countNum)}>{qs.length - answered}</span> {t("practice.state.open")}
            </li>
            <li {...stylex.props(s.count)}>
              <span {...stylex.props(s.countNum)}>{flagged}</span> {t("practice.state.flagged")}
            </li>
          </ul>
          <p>{qs.length - answered > 0 ? t("practice.submitUnanswered", { count: qs.length - answered }) : t("practice.submitAll")}</p>
          {submitError && (
            <p role="alert" {...stylex.props(text.error)}>
              {submitError}
            </p>
          )}
          <div {...stylex.props(layout.actions)}>
            <button type="button" disabled={submitting} onClick={() => void submit(false)} {...stylex.props(btn.base, btn.primary)}>
              {submitting && <Spinner />} {t("practice.submit")}
            </button>
            {firstOpen >= 0 ? (
              <button
                type="button"
                onClick={() => {
                  dialog.current?.close();
                  go(firstOpen);
                }}
                {...stylex.props(btn.base, btn.ghost)}
              >
                {t("practice.toUnanswered")}
              </button>
            ) : (
              <button type="button" onClick={() => dialog.current?.close()} {...stylex.props(btn.base, btn.ghost)}>
                {t("practice.keepWorking")}
              </button>
            )}
          </div>
        </div>
      </dialog>
    </div>
  );
}

// ---------- Results ----------

function answerText(item: PublicItem, answer: Answer): string {
  switch (answer.format) {
    case "single":
      return item.options?.[answer.choice]?.text ?? "";
    case "multi":
      return answer.choices.map((c) => item.options?.[c]?.text ?? "").join("; ");
    case "order":
      return answer.sequence.join(" → ");
    case "cloze":
      return answer.blanks.map((b, i) => `${i + 1}: ${b || "—"}`).join("; ");
    case "number":
      return `${answer.value}${item.unit ? ` ${item.unit}` : ""}`;
    case "short":
      return answer.text;
  }
}

function ResultChip({ q }: { q: PracticeQuestion }) {
  useLang();
  const r = q.result!;
  if (r.gradingFailed) return <span {...stylex.props(chip.base, chip.danger)}>{t("practice.gradingFailedOne")}</span>;
  if (r.correct === null)
    return (
      <span {...stylex.props(chip.base, chip.butter)}>
        <Spinner size={12} /> {t("practice.grading")}
      </span>
    );
  if (!q.answer) return <span {...stylex.props(chip.base, chip.danger)}>{t("practice.notAnswered")}</span>;
  return r.correct ? (
    <span {...stylex.props(chip.base, chip.pistachio)}>
      <CircleCheck size={13} aria-hidden="true" /> {t("item.right")}
    </span>
  ) : (
    <span {...stylex.props(chip.base, chip.danger)}>
      <X size={13} aria-hidden="true" /> {t("item.wrong")}
    </span>
  );
}

function Results({ view, timedOut, onChange }: { view: PracticeTestView; timedOut: boolean; onChange: (v: PracticeTestView) => void }) {
  useLang();
  const [filter, setFilter] = useState<"all" | "missed">("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const qs = view.questions;
  const total = qs.length;
  const correct = qs.filter((q) => q.result?.correct === true).length;
  const pending = qs.filter((q) => q.result?.correct === null && !q.result.gradingFailed).length;
  const failed = qs.filter((q) => q.result?.gradingFailed).length;
  const missed = qs.filter((q) => q.result?.correct === false);
  const goal = view.scope.kind === "goal";

  const weakLessons = new Map<string, string>();
  for (const n of view.breakdown) if (n.correct / n.total < WEAK_SHARE) for (const l of n.lessons) weakLessons.set(l.id, l.title);

  const regrade = async () => {
    setBusy(true);
    setError(null);
    try {
      onChange(await api.regradePracticeTest(view.test.id));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const shown = filter === "missed" ? qs.filter((q) => q.result?.correct !== true) : qs;

  return (
    <div {...stylex.props(s.page)}>
      <section aria-labelledby="score-title" {...stylex.props(card.base, s.main)}>
        <CardHead title={t("practice.resultsTitle")} id="score-title">
          <span {...stylex.props(text.small, text.muted)}>{view.test.submittedAt && formatDateTime(view.test.submittedAt)}</span>
        </CardHead>
        {timedOut && (
          <p role="status" {...stylex.props(banner.base, banner.butter)}>
            <Clock size={16} aria-hidden="true" /> {t("practice.timedOut")}
          </p>
        )}
        <div role="status" {...stylex.props(s.scoreRow)}>
          <p {...stylex.props(s.score)}>
            {correct} <span {...stylex.props(s.scoreOf)}>{t("steps.scoreOf", { total })}</span>
          </p>
          <p {...stylex.props(text.h3, text.muted)}>{total ? Math.round((correct / total) * 100) : 0}%</p>
        </div>
        {view.test.kind === "final" && view.test.status === "done" && (
          <p role="status" {...stylex.props(banner.base, correct / total >= FINAL_PASS_SHARE ? s.passed : banner.butter)}>
            {correct / total >= FINAL_PASS_SHARE ? (
              <>
                <GraduationCap size={18} aria-hidden="true" /> {t("final.resultPassed")}
              </>
            ) : (
              t("final.resultFailed", { pass: Math.round(FINAL_PASS_SHARE * 100) })
            )}
          </p>
        )}
        {pending > 0 && (
          <p role="status" {...stylex.props(banner.base, banner.lilac)}>
            <Spinner /> {t("practice.gradingPending", { count: pending })}
          </p>
        )}
        {failed > 0 && (
          <div role="alert" {...stylex.props(banner.base, banner.danger)}>
            <TriangleAlert size={16} aria-hidden="true" /> <span {...stylex.props(s.grow)}>{t("practice.gradingFailed", { count: failed })}</span>
            <button type="button" disabled={busy} onClick={regrade} {...stylex.props(btn.base, btn.ghost, btn.sm)}>
              {busy ? <Spinner /> : <RefreshCw size={14} aria-hidden="true" />} {t("practice.regrade")}
            </button>
          </div>
        )}
        {error && (
          <p role="alert" {...stylex.props(text.error)}>
            {error}
          </p>
        )}

        <section aria-labelledby="by-node" {...stylex.props(layout.stack)}>
          <h3 id="by-node" {...stylex.props(text.h3)}>
            {t("practice.byNode")}
          </h3>
          <ul {...stylex.props(s.nodes)}>
            {view.breakdown.map((n) => (
              <li key={`${n.topicId}/${n.nodeId}`} {...stylex.props(s.node)}>
                <div {...stylex.props(s.nodeHead)}>
                  <span {...stylex.props(s.nodeTitle)}>
                    {n.title}
                    {goal && <span {...stylex.props(text.small, text.muted)}> · {n.topicTitle}</span>}
                  </span>
                  <span {...stylex.props(text.small, text.tnum)}>{t("common.xOfY", { x: n.correct, y: n.total })}</span>
                </div>
                <Progress value={n.correct} max={n.total} label={n.title} fill={n.correct / n.total < WEAK_SHARE ? s.weakFill : undefined} />
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="answers-title" {...stylex.props(layout.stack)}>
          <div {...stylex.props(s.qHead)}>
            <h3 id="answers-title" {...stylex.props(text.h3)}>
              {t("practice.answers")}
            </h3>
            <div role="group" aria-label={t("practice.filter")} {...stylex.props(s.filter)}>
              {(["all", "missed"] as const).map((f) => (
                <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)} {...stylex.props(s.filterBtn, filter === f && s.filterOn)}>
                  {t(f === "all" ? "practice.filterAll" : "practice.filterMissed")}
                </button>
              ))}
            </div>
          </div>
          {shown.length === 0 ? (
            <p {...stylex.props(text.muted)}>{t("steps.noMistakes")}</p>
          ) : (
            <ol {...stylex.props(s.review)}>
              {shown.map((q) => (
                <li key={q.idx} {...stylex.props(s.reviewItem)}>
                  <div {...stylex.props(s.reviewHead)}>
                    <span {...stylex.props(s.num)}>{q.idx + 1}</span>
                    <ResultChip q={q} />
                    <span {...stylex.props(text.small, text.muted)}>{q.result!.nodeTitle}</span>
                  </div>
                  <ItemPrompt src={q.item.prompt} />
                  <div {...stylex.props(s.answers)}>
                    <p>
                      <span {...stylex.props(s.answerLabel)}>{t("practice.yourAnswer")}</span>
                      {q.answer ? (
                        <span {...stylex.props(q.result!.correct === false && s.wrongAnswer)}>
                          <Markdown src={answerText(q.item, q.answer)} inline />
                        </span>
                      ) : (
                        <span {...stylex.props(text.muted)}>{t("practice.notAnswered")}</span>
                      )}
                    </p>
                    <p>
                      <span {...stylex.props(s.answerLabel)}>{t("item.correctAnswer")}</span>
                      <strong>
                        <Markdown src={q.result!.correctAnswer} inline />
                      </strong>
                    </p>
                  </div>
                  {q.result!.feedback && <Markdown src={q.result!.feedback} />}
                  <details open={q.result!.correct === false}>
                    <summary {...stylex.props(s.solutionSummary)}>{t("item.solution")}</summary>
                    <Markdown src={q.result!.solution} />
                  </details>
                </li>
              ))}
            </ol>
          )}
        </section>
      </section>

      <aside aria-labelledby="next-title" {...stylex.props(card.base, s.side)}>
        <CardHead title={t("practice.next")} id="next-title" />
        <ul {...stylex.props(s.actions)}>
          {[...weakLessons].slice(0, 3).map(([id, title]) => (
            <li key={id} {...stylex.props(s.action)}>
              <span aria-hidden="true" {...stylex.props(s.actionIcon)}>
                <BookOpen size={16} />
              </span>
              <span {...stylex.props(s.actionBody)}>
                <Link to={`/lessons/${id}`} {...stylex.props(text.link)}>
                  {t("practice.reviewLesson", { title })}
                </Link>
                <span {...stylex.props(text.xs, text.muted)}>{t("practice.reviewLessonWhy")}</span>
              </span>
            </li>
          ))}
          {view.reviewFrom && missed.length > 0 && (
            <li {...stylex.props(s.action)}>
              <span aria-hidden="true" {...stylex.props(s.actionIcon)}>
                <Repeat size={16} />
              </span>
              <span {...stylex.props(s.actionBody)}>
                <Link to={goal ? "/review" : `/review?topicId=${encodeURIComponent(view.scope.id)}`} {...stylex.props(text.link)}>
                  {t("practice.retryInReview", { count: missed.length })}
                </Link>
                <span {...stylex.props(text.xs, text.muted)}>{t("practice.retryFrom", { date: formatDateTime(view.reviewFrom) })}</span>
              </span>
            </li>
          )}
          {missed.length === 0 && pending === 0 && failed === 0 && (
            <li {...stylex.props(s.action)}>
              <span aria-hidden="true" {...stylex.props(s.actionIcon)}>
                <CircleCheck size={16} />
              </span>
              <span {...stylex.props(s.actionBody)}>{t("practice.allRight")}</span>
            </li>
          )}
        </ul>
        <Link to={`/topics/${view.scope.id}`} {...stylex.props(btn.base, btn.primary)}>
          {t("practice.another")} <ArrowRight size={16} aria-hidden="true" />
        </Link>
        <p {...stylex.props(text.small, text.muted)}>{t("practice.masteryNote")}</p>
      </aside>
    </div>
  );
}
