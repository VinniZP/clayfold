import * as stylex from "@stylexjs/stylex";
import { ArrowDown, ArrowRight, ArrowUp, CircleCheck, CircleX, GripVertical, Info, Lightbulb, MessageCircle, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { AttemptRequest, AttemptResponse, GiveUpResponse, ItemState } from "@shared/api";
import type { Answer, PublicItem } from "@shared/schemas";
import { api, errorText } from "../lib/api";
import { t, useLang } from "../lib/i18n";
import { bp, color, motion, radius, space } from "../theme/tokens.stylex";
import { btn, field, layout, text } from "../theme/ui";
import { ItemPrompt } from "./ItemPrompt";
import { Markdown, Spinner } from "./ui";

/**
 * practice: retries, hint ladder, give-up, tutor (L9, L10).
 * activate: one ungraded answer, then the solution (L2).
 * check:    one answer, no hints, no tutor; results shown by the parent at the end (L11).
 * review:   delayed retrieval; retries and give-up, no hints or tutor.
 */
export type ItemMode = "practice" | "activate" | "check" | "review";

export type ItemResult = { response: AttemptResponse; gaveUp: GiveUpResponse | null };

type Draft =
  | { format: "single"; choice: number | null }
  | { format: "multi"; choices: number[] }
  | { format: "order"; sequence: string[] }
  | { format: "cloze"; blanks: string[] }
  | { format: "number"; value: string }
  | { format: "short"; text: string };

function initialDraft(item: PublicItem): Draft {
  switch (item.format) {
    case "single":
      return { format: "single", choice: null };
    case "multi":
      return { format: "multi", choices: [] };
    case "order":
      return { format: "order", sequence: [...(item.entries ?? [])] };
    case "cloze":
      return { format: "cloze", blanks: Array.from({ length: item.blankCount ?? countBlanks(item.text ?? "") }, () => "") };
    case "number":
      return { format: "number", value: "" };
    case "short":
      return { format: "short", text: "" };
  }
}

function countBlanks(text: string): number {
  return new Set([...text.matchAll(/\{\{(\d+)\}\}/g)].map((m) => m[1])).size;
}

function toAnswer(d: Draft): Answer | null {
  switch (d.format) {
    case "single":
      return d.choice === null ? null : { format: "single", choice: d.choice };
    case "multi":
      return d.choices.length ? { format: "multi", choices: [...d.choices].sort((a, b) => a - b) } : null;
    case "order":
      return { format: "order", sequence: d.sequence };
    case "cloze":
      return d.blanks.every((b) => b.trim()) ? { format: "cloze", blanks: d.blanks.map((b) => b.trim()) } : null;
    case "number": {
      const v = Number(d.value.replace(",", ".").replace(/\s/g, ""));
      return d.value.trim() && Number.isFinite(v) ? { format: "number", value: v } : null;
    }
    case "short":
      return d.text.trim() ? { format: "short", text: d.text.trim() } : null;
  }
}

const rise = stylex.keyframes({ from: { opacity: 0, transform: "translateY(4px)" } });

const s = stylex.create({
  item: { display: "grid", gap: space.lg },
  prompt: { display: "flex", gap: space.md, alignItems: "flex-start", marginBottom: space.sm },
  num: {
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
    width: 30,
    height: 30,
    borderRadius: "50%",
    backgroundColor: color.lilacSoft,
    fontSize: 13,
    fontWeight: 750,
    fontVariantNumeric: "tabular-nums",
  },
  fieldset: { margin: 0, padding: 0, borderWidth: 0, minWidth: 0 },
  choices: { display: "grid", gap: 10, maxWidth: "64ch" },
  choice: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    gap: 14,
    minHeight: 58,
    paddingBlock: 12,
    paddingInline: 18,
    borderRadius: radius.field,
    borderWidth: 1.5,
    borderStyle: "solid",
    borderColor: { default: "transparent", ":hover": color.borderStrong },
    backgroundColor: color.surface2,
    cursor: "pointer",
    fontSize: 16,
    transitionProperty: "border-color, background-color",
    transitionDuration: motion.fast,
  },
  choiceOn: { borderColor: { default: color.primary, ":hover": color.primary }, backgroundColor: color.lilacSoft },
  choiceWrong: { borderColor: { default: color.danger, ":hover": color.danger }, backgroundColor: color.dangerSoft },
  choiceLocked: { cursor: "default", borderColor: { default: "transparent", ":hover": "transparent" } },
  choiceFocus: { outline: `2px solid ${color.focus}`, outlineOffset: 2 },
  hiddenInput: { position: "absolute", opacity: 0, pointerEvents: "none", width: 1, height: 1, margin: 0 },
  mark: {
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
    width: 24,
    height: 24,
    borderWidth: 2,
    borderStyle: "solid",
    borderColor: color.borderStrong,
    backgroundColor: color.surface,
    color: color.onPrimary,
  },
  radio: { borderRadius: "50%" },
  box: { borderRadius: 7 },
  radioOn: { borderColor: color.primary, boxShadow: `inset 0 0 0 5px ${color.surface}`, backgroundColor: color.primary },
  radioWrong: { borderColor: color.danger, boxShadow: `inset 0 0 0 5px ${color.surface}`, backgroundColor: color.danger },
  boxOn: { borderColor: color.primary, backgroundColor: color.primary },
  boxWrong: { borderColor: color.danger, backgroundColor: color.danger },
  choiceText: { flexGrow: 1, minWidth: 0 },
  yours: { display: "inline-flex", alignItems: "center", gap: 6, flexShrink: 0, color: color.danger, fontSize: 13, fontWeight: 650 },
  yoursIcon: { display: "grid", placeItems: "center", width: 24, height: 24, borderRadius: "50%", backgroundColor: color.danger, color: color.surface },
  hintLine: { fontSize: 13.5, color: color.textMuted },
  orderList: { display: "grid", gap: 8, maxWidth: "64ch", marginTop: 8, padding: 0, listStyle: "none" },
  orderRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    paddingBlock: 8,
    paddingInline: "14px 8px",
    borderRadius: radius.field,
    borderWidth: 1.5,
    borderStyle: "solid",
    borderColor: { default: "transparent", ":hover": color.borderStrong },
    backgroundColor: color.surface2,
    cursor: "grab",
    userSelect: "none",
  },
  orderDragging: { borderStyle: "dashed", borderColor: color.primary, backgroundColor: color.lilacSoft },
  grip: { flexShrink: 0, color: color.textMuted, display: { default: "block", [bp.phone]: "none" } },
  orderIdx: { width: 22, flexShrink: 0, fontWeight: 750, color: color.textMuted, fontVariantNumeric: "tabular-nums" },
  orderText: { flexGrow: 1 },
  orderBtns: { display: "flex", gap: 4 },
  cloze: { maxWidth: "64ch", fontSize: 17, lineHeight: 2.3 },
  clozeInput: {
    display: "inline-block",
    minWidth: "5ch",
    marginInline: 4,
    paddingBlock: 2,
    paddingInline: 10,
    borderWidth: 0,
    borderBottomWidth: 2,
    borderBottomStyle: "solid",
    borderBottomColor: { default: color.borderStrong, ":focus-visible": color.focus },
    borderRadius: "10px 10px 0 0",
    backgroundColor: color.surface2,
    color: color.text,
    fontWeight: 650,
    lineHeight: 1.4,
    outline: { default: null, ":focus-visible": "none" },
  },
  numberRow: { display: "inline-flex", alignItems: "center", gap: 10 },
  numberInput: { width: 170, fontVariantNumeric: "tabular-nums", fontWeight: 650 },
  unit: { fontWeight: 650, color: color.textMuted },
  textarea: { maxWidth: "64ch" },
  hints: { display: "grid", gap: 8, maxWidth: "64ch", margin: 0, padding: 0, listStyle: "none" },
  hint: { paddingBlock: 11, paddingInline: 16, borderRadius: radius.field, backgroundColor: color.butter },
  hintLabel: { display: "block", marginBottom: 2, fontSize: 12, fontWeight: 750, color: color.warning },
  feedbackRegion: { display: "grid", gap: 10 },
  feedback: {
    display: "grid",
    gridTemplateColumns: "auto minmax(0, 1fr)",
    columnGap: 14,
    rowGap: 6,
    maxWidth: "68ch",
    paddingBlock: 16,
    paddingInline: 18,
    borderRadius: radius.inner,
    animationName: rise,
    animationDuration: motion.base,
    animationTimingFunction: motion.ease,
  },
  fbSuccess: { backgroundColor: color.successSoft },
  fbDanger: { backgroundColor: color.dangerSoft },
  fbNeutral: { backgroundColor: color.surface2 },
  fbIcon: { display: "grid", placeItems: "center", width: 36, height: 36, borderRadius: "50%", gridRow: "1 / span 4" },
  fbIconSuccess: { backgroundColor: color.success, color: color.surface },
  fbIconDanger: { backgroundColor: color.danger, color: color.surface },
  fbIconNeutral: { backgroundColor: color.lilacSoft, color: color.accentText },
  fbBody: { display: "grid", gap: 6, minWidth: 0 },
  fbTitle: { fontWeight: 750 },
  fbTitleSuccess: { color: color.success },
  fbTitleDanger: { color: color.danger },
  solutionSummary: { cursor: "pointer", fontWeight: 650, color: color.accentText },
});

const IDLE_MS = 90_000;

/** The latest attempt as the server recorded it, for showing progress restored after a reload. */
export function restoredResponse(state: ItemState | undefined, mode: ItemMode): AttemptResponse | null {
  if (!state || state.attempts === 0) return null;
  const lastWrong = !state.solved && state.wrongAttempts > 0;
  return {
    correct: mode === "activate" ? null : state.solved ? true : lastWrong ? false : null,
    feedback: state.lastFeedback ?? "",
    solution: state.solution,
    correctAnswer: state.correctAnswer,
    attemptNo: state.attempts,
    offerTutor: false,
  };
}

type Props = {
  item: PublicItem;
  mode: ItemMode;
  context: AttemptRequest["context"];
  /** Visible on screen; the idle timer runs only then. */
  active?: boolean;
  onResult?: (itemId: string, result: ItemResult) => void;
  onOfferTutor?: (itemId: string, reason: "wrong_twice" | "idle") => void;
  onAskTutor?: (itemId: string) => void;
  /** check mode: show the graded result (after the whole check is submitted). */
  revealed?: boolean;
  number?: number;
  /** Progress recorded on the server (LessonView.itemStates). */
  initial?: ItemState;
};

export function ItemView({ item, mode, context, active = true, onResult, onOfferTutor, onAskTutor, revealed, number, initial }: Props) {
  useLang();
  const [draft, setDraft] = useState<Draft>(() => initialDraft(item));
  const [restored] = useState(() => restoredResponse(initial, mode));
  const [responses, setResponses] = useState<AttemptResponse[]>(() => (restored ? [restored] : []));
  const [hints, setHints] = useState<string[]>(() => initial?.hints ?? []);
  const [gaveUp, setGaveUp] = useState<GiveUpResponse | null>(() =>
    initial?.gaveUp ? { solution: initial.solution ?? "", correctAnswer: initial.correctAnswer ?? "" } : null,
  );
  const [busy, setBusy] = useState<"submit" | "hint" | "giveup" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const started = useRef<number | null>(null);
  const idleOffered = useRef(false);
  const [touch, setTouch] = useState(0);
  /** The draft that produced the latest wrong answer; the chosen option is marked until it changes. */
  const [submitted, setSubmitted] = useState<Draft | null>(null);
  const promptId = useId();

  const last = responses[responses.length - 1];
  const oneShot = mode === "activate" || mode === "check";
  const done = !!gaveUp || last?.correct === true || (oneShot && !!last) || (last?.correct === null && !!last);
  const allowHints = mode === "practice" && item.hintCount > 0;
  const allowTutor = mode === "practice" && !!onAskTutor;
  // Wrong attempts before the restored one are known only as a count.
  const earlierWrong = initial ? initial.wrongAttempts - (restored?.correct === false ? 1 : 0) : 0;
  const wrongCount = earlierWrong + responses.filter((r) => r.correct === false).length;

  useEffect(() => {
    if (active && started.current === null) started.current = Date.now();
  }, [active]);

  // L10: offer the tutor after 90 s without progress on a visible item.
  useEffect(() => {
    if (mode !== "practice" || !active || done || idleOffered.current || !onOfferTutor) return;
    const t = setTimeout(() => {
      idleOffered.current = true;
      onOfferTutor(item.id, "idle");
    }, IDLE_MS);
    return () => clearTimeout(t);
  }, [mode, active, done, touch, item.id, onOfferTutor]);

  const update = (d: Draft) => {
    setDraft(d);
    setTouch((n) => n + 1);
  };

  const answer = toAnswer(draft);
  const locked = done || busy === "submit";

  const submit = async () => {
    if (!answer) return;
    setBusy("submit");
    setError(null);
    try {
      const res = await api.attempt(item.id, {
        answer,
        hintsUsed: hints.length,
        durationMs: Date.now() - (started.current ?? Date.now()),
        context,
      });
      setResponses((r) => [...r, res]);
      setSubmitted(res.correct === false ? draft : null);
      setTouch((n) => n + 1);
      onResult?.(item.id, { response: res, gaveUp: null });
      // L10: the server flags the offer; the same threshold (two wrong attempts) applies here as a fallback.
      const wrongNow = wrongCount + (res.correct === false ? 1 : 0);
      if (mode === "practice" && (res.offerTutor || (res.correct === false && wrongNow >= 2))) onOfferTutor?.(item.id, "wrong_twice");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  const hint = async () => {
    setBusy("hint");
    setError(null);
    try {
      const res = await api.hint(item.id, hints.length + 1);
      setHints((h) => [...h, res.hint]);
      setTouch((n) => n + 1);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  const giveUp = async () => {
    setBusy("giveup");
    setError(null);
    try {
      const res = await api.giveUp(item.id);
      setGaveUp(res);
      if (last) onResult?.(item.id, { response: last, gaveUp: res });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  const showResult = mode !== "check" || revealed;
  const wrongDraft = last?.correct === false && submitted === draft ? submitted : null;

  return (
    <div onFocus={() => setTouch((n) => n + 1)} {...stylex.props(s.item)}>
      <div id={promptId} {...stylex.props(s.prompt)}>
        {number !== undefined && <span {...stylex.props(s.num)}>{number}</span>}
        <ItemPrompt src={item.prompt} />
      </div>

      <fieldset disabled={locked} aria-describedby={promptId} {...stylex.props(s.fieldset)}>
        <legend {...stylex.props(layout.srOnly)}>{t("item.yourAnswer")}</legend>
        <AnswerInput item={item} draft={draft} wrong={wrongDraft} locked={locked} onChange={update} />
      </fieldset>

      {error && (
        <p role="alert" {...stylex.props(text.error)}>
          {error}
        </p>
      )}

      {!done && (
        <div {...stylex.props(layout.actions)}>
          {allowHints && (
            <button
              type="button"
              disabled={hints.length >= item.hintCount || busy !== null}
              onClick={hint}
              {...stylex.props(btn.base, btn.outline)}
            >
              {busy === "hint" ? <Spinner /> : <Lightbulb size={17} aria-hidden="true" />}
              {t("item.hint")} <span {...stylex.props(text.tnum)}>{t("common.xOfY", { x: Math.min(hints.length + 1, item.hintCount), y: item.hintCount })}</span>
            </button>
          )}
          {(mode === "practice" || mode === "review") && wrongCount > 0 && (
            <button type="button" disabled={busy !== null} onClick={giveUp} {...stylex.props(btn.base, btn.plain)}>
              {busy === "giveup" && <Spinner />}
              {t("item.giveUp")}
            </button>
          )}
          {allowTutor && (
            <button type="button" onClick={() => onAskTutor?.(item.id)} {...stylex.props(btn.base, btn.ghost)}>
              <MessageCircle size={16} aria-hidden="true" /> {t("item.askTutor")}
            </button>
          )}
          <button type="button" disabled={!answer || busy !== null} onClick={submit} {...stylex.props(btn.base, btn.primary)}>
            {busy === "submit" && <Spinner />}
            {t(mode === "activate" ? "item.answer" : mode === "check" ? "item.acceptAnswer" : wrongCount > 0 ? "item.tryAgain" : "item.check")}
            {mode !== "check" && mode !== "activate" && <ArrowRight size={17} aria-hidden="true" />}
          </button>
        </div>
      )}

      {hints.length > 0 && (
        <ol aria-label={t("item.hints")} {...stylex.props(s.hints)}>
          {hints.map((h, i) => (
            <li key={i} {...stylex.props(s.hint)}>
              <span {...stylex.props(s.hintLabel)}>{t("item.hintN", { n: i + 1 })}</span>
              <Markdown src={h} />
            </li>
          ))}
        </ol>
      )}

      <div aria-live="polite" {...stylex.props(s.feedbackRegion)}>
        {last && !showResult && (
          <FeedbackBox tone="neutral" icon={<Info size={18} aria-hidden="true" />} title={t("item.accepted")}>
            <p>{t("item.resultsAtEnd")}</p>
          </FeedbackBox>
        )}
        {last && showResult && <Feedback mode={mode} response={last} attempts={responses.length} />}
        {gaveUp && (
          <FeedbackBox tone="neutral" icon={<Info size={18} aria-hidden="true" />} title={t("item.walkthrough")}>
            <p>
              {t("item.correctAnswer")} <strong>{gaveUp.correctAnswer}</strong>
            </p>
            <Markdown src={gaveUp.solution} />
          </FeedbackBox>
        )}
      </div>
    </div>
  );
}

function FeedbackBox({ tone, icon, title, children }: { tone: "success" | "danger" | "neutral"; icon: ReactNode; title: ReactNode; children?: ReactNode }) {
  return (
    <div {...stylex.props(s.feedback, tone === "success" ? s.fbSuccess : tone === "danger" ? s.fbDanger : s.fbNeutral)}>
      <span {...stylex.props(s.fbIcon, tone === "success" ? s.fbIconSuccess : tone === "danger" ? s.fbIconDanger : s.fbIconNeutral)}>{icon}</span>
      <div {...stylex.props(s.fbBody)}>
        <p {...stylex.props(s.fbTitle, tone === "success" && s.fbTitleSuccess, tone === "danger" && s.fbTitleDanger)}>{title}</p>
        {children}
      </div>
    </div>
  );
}

function Feedback({ mode, response, attempts }: { mode: ItemMode; response: AttemptResponse; attempts: number }) {
  useLang();
  const tone = mode === "activate" || response.correct === null ? "neutral" : response.correct ? "success" : "danger";
  const icon = tone === "success" ? <CircleCheck size={18} aria-hidden="true" /> : tone === "danger" ? <X size={18} strokeWidth={3} aria-hidden="true" /> : <Info size={18} aria-hidden="true" />;
  const title =
    mode === "activate" ? (
      t("item.warmupNoGrade")
    ) : response.correct === true ? (
      t("item.right")
    ) : response.correct === false ? (
      <>
        {t(mode === "check" ? "item.wrong" : "item.notYet")}
        {mode !== "check" && attempts > 1 && <span {...stylex.props(text.muted, text.tnum)}> · {t("item.attempt", { n: attempts })}</span>}
      </>
    ) : (
      t("item.sentForGrading")
    );
  return (
    <FeedbackBox tone={tone} icon={icon} title={title}>
      {response.feedback && <Markdown src={response.feedback} />}
      {response.correctAnswer && (mode === "activate" || response.correct === true) && (
        <p>
          {t("item.correctAnswer")} <strong>{response.correctAnswer}</strong>
        </p>
      )}
      {response.solution && (
        <details open={mode === "activate"}>
          <summary {...stylex.props(s.solutionSummary)}>{t("item.solution")}</summary>
          <Markdown src={response.solution} />
        </details>
      )}
      {response.correct === false && mode !== "check" && <p {...stylex.props(text.muted)}>{t("item.fixAndRetry")}</p>}
    </FeedbackBox>
  );
}

function YourAnswer() {
  useLang();
  return (
    <span {...stylex.props(s.yours)}>
      <span {...stylex.props(s.yoursIcon)} aria-hidden="true">
        <X size={14} strokeWidth={3} />
      </span>
      {t("item.yourAnswer")}
    </span>
  );
}

function Choice({
  type,
  name,
  checked,
  wrong,
  locked,
  onChange,
  children,
}: {
  type: "radio" | "checkbox";
  name?: string;
  checked: boolean;
  wrong: boolean;
  locked: boolean;
  onChange: () => void;
  children: ReactNode;
}) {
  const [focus, setFocus] = useState(false);
  const isRadio = type === "radio";
  return (
    <label {...stylex.props(s.choice, checked && s.choiceOn, wrong && s.choiceWrong, locked && s.choiceLocked, focus && s.choiceFocus)}>
      <input
        type={type}
        name={name}
        checked={checked}
        onChange={onChange}
        onFocus={(e) => setFocus(e.currentTarget.matches(":focus-visible"))}
        onBlur={() => setFocus(false)}
        {...stylex.props(s.hiddenInput)}
      />
      <span
        aria-hidden="true"
        {...stylex.props(
          s.mark,
          isRadio ? s.radio : s.box,
          checked && (isRadio ? (wrong ? s.radioWrong : s.radioOn) : wrong ? s.boxWrong : s.boxOn),
        )}
      >
        {!isRadio && checked && <CheckMark />}
      </span>
      <span {...stylex.props(s.choiceText)}>{children}</span>
      {wrong && <YourAnswer />}
    </label>
  );
}

function CheckMark() {
  return (
    <svg viewBox="0 0 16 16" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3.5 8.5l3 3 6-7" />
    </svg>
  );
}

function AnswerInput({
  item,
  draft,
  wrong,
  locked,
  onChange,
}: {
  item: PublicItem;
  draft: Draft;
  /** The draft of the latest wrong answer, while unchanged. */
  wrong: Draft | null;
  locked: boolean;
  onChange: (d: Draft) => void;
}) {
  useLang();
  const name = useId();
  switch (draft.format) {
    case "single":
      return (
        <div role="radiogroup" {...stylex.props(s.choices)}>
          {(item.options ?? []).map((o, i) => (
            <Choice
              key={i}
              type="radio"
              name={name}
              checked={draft.choice === i}
              wrong={wrong?.format === "single" && wrong.choice === i}
              locked={locked}
              onChange={() => onChange({ format: "single", choice: i })}
            >
              <Markdown src={o.text} inline />
            </Choice>
          ))}
        </div>
      );
    case "multi":
      return (
        <div {...stylex.props(s.choices)}>
          <p {...stylex.props(s.hintLine)}>{t("item.selectAll")}</p>
          {(item.options ?? []).map((o, i) => {
            const on = draft.choices.includes(i);
            return (
              <Choice
                key={i}
                type="checkbox"
                checked={on}
                wrong={on && wrong?.format === "multi"}
                locked={locked}
                onChange={() => onChange({ format: "multi", choices: on ? draft.choices.filter((c) => c !== i) : [...draft.choices, i] })}
              >
                <Markdown src={o.text} inline />
              </Choice>
            );
          })}
        </div>
      );
    case "order":
      return <OrderInput sequence={draft.sequence} onChange={(sequence) => onChange({ format: "order", sequence })} />;
    case "cloze":
      return <ClozeInput text={item.text ?? ""} blanks={draft.blanks} onChange={(blanks) => onChange({ format: "cloze", blanks })} />;
    case "number":
      return (
        <label {...stylex.props(field.inline)}>
          <span {...stylex.props(field.label)}>{t("item.answerLabel")}</span>
          <span {...stylex.props(s.numberRow)}>
            <input
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={draft.value}
              onChange={(e) => onChange({ format: "number", value: e.target.value })}
              {...stylex.props(field.input, s.numberInput)}
            />
            {item.unit && <span {...stylex.props(s.unit)}>{item.unit}</span>}
          </span>
        </label>
      );
    case "short":
      return (
        <label {...stylex.props(field.stack)}>
          <span {...stylex.props(field.label)}>{t("item.yourAnswer")}</span>
          <textarea rows={4} value={draft.text} onChange={(e) => onChange({ format: "short", text: e.target.value })} {...stylex.props(field.input, field.textarea, s.textarea)} />
        </label>
      );
  }
}

function ClozeInput({ text: source, blanks, onChange }: { text: string; blanks: string[]; onChange: (b: string[]) => void }) {
  useLang();
  const parts = source.split(/\{\{(\d+)\}\}/);
  return (
    <p {...stylex.props(s.cloze)}>
      {parts.map((part, i) => {
        if (i % 2 === 0) return <span key={i}>{part}</span>;
        const idx = Number(part) - 1;
        return (
          <input
            key={i}
            aria-label={t("item.blank", { n: idx + 1 })}
            value={blanks[idx] ?? ""}
            size={Math.max(6, (blanks[idx] ?? "").length + 1)}
            autoComplete="off"
            onChange={(e) => onChange(blanks.map((b, j) => (j === idx ? e.target.value : b)))}
            {...stylex.props(s.clozeInput)}
          />
        );
      })}
    </p>
  );
}

function OrderInput({ sequence, onChange }: { sequence: string[]; onChange: (s: string[]) => void }) {
  useLang();
  const [dragging, setDragging] = useState<number | null>(null);
  const [announce, setAnnounce] = useState("");
  const refs = useRef<(HTMLLIElement | null)[]>([]);
  const helpId = useId();

  const move = (from: number, to: number, focus = false) => {
    if (to < 0 || to >= sequence.length || from === to) return;
    const next = [...sequence];
    const [x] = next.splice(from, 1);
    next.splice(to, 0, x!);
    onChange(next);
    setAnnounce(t("item.movedTo", { entry: x!, position: to + 1, total: sequence.length }));
    if (focus) requestAnimationFrame(() => refs.current[to]?.focus());
  };

  return (
    <>
      <p id={helpId} {...stylex.props(s.hintLine)}>
        {t("item.orderHelp")}
      </p>
      <ol aria-describedby={helpId} {...stylex.props(s.orderList)}>
        {sequence.map((entry, i) => (
          <li
            key={entry}
            ref={(el) => {
              refs.current[i] = el;
            }}
            draggable
            tabIndex={0}
            aria-label={`${i + 1}. ${entry}`}
            onDragStart={(e) => {
              setDragging(i);
              e.dataTransfer.effectAllowed = "move";
            }}
            onDragOver={(e) => {
              e.preventDefault();
              if (dragging !== null && dragging !== i) {
                move(dragging, i);
                setDragging(i);
              }
            }}
            onDragEnd={() => setDragging(null)}
            onKeyDown={(e) => {
              if (e.altKey && e.key === "ArrowUp") {
                e.preventDefault();
                move(i, i - 1, true);
              } else if (e.altKey && e.key === "ArrowDown") {
                e.preventDefault();
                move(i, i + 1, true);
              }
            }}
            {...stylex.props(s.orderRow, dragging === i && s.orderDragging)}
          >
            <GripVertical size={16} aria-hidden="true" {...stylex.props(s.grip)} />
            <span aria-hidden="true" {...stylex.props(s.orderIdx)}>
              {i + 1}
            </span>
            <span {...stylex.props(s.orderText)}>{entry}</span>
            <span {...stylex.props(s.orderBtns)}>
              <button type="button" aria-label={t("item.moveUp", { entry })} disabled={i === 0} onClick={() => move(i, i - 1)} {...stylex.props(btn.base, btn.icon, btn.iconSm)}>
                <ArrowUp size={14} aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label={t("item.moveDown", { entry })}
                disabled={i === sequence.length - 1}
                onClick={() => move(i, i + 1)}
                {...stylex.props(btn.base, btn.icon, btn.iconSm)}
              >
                <ArrowDown size={14} aria-hidden="true" />
              </button>
            </span>
          </li>
        ))}
      </ol>
      <p aria-live="assertive" {...stylex.props(layout.srOnly)}>
        {announce}
      </p>
    </>
  );
}
