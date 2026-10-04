import * as stylex from "@stylexjs/stylex";
import { ArrowRight, ClipboardCheck, Play, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { PRACTICE_LENGTHS, PRACTICE_MAX_QUESTIONS, PRACTICE_TIME_LIMITS, type PracticeTestOverview, type PracticeTestRequest, type PracticeTestSummary } from "@shared/api";
import { api, errorText } from "../lib/api";
import { formatDate } from "../lib/format";
import { t, useLang } from "../lib/i18n";
import { useOverlayScroll } from "../lib/overlayScroll";
import { useResource } from "../lib/useResource";
import { color, font, radius } from "../theme/tokens.stylex";
import { banner, btn, card, chip, field, layout, shadow, text } from "../theme/ui";
import { CardHead, Empty, ErrorBox, Skeleton, Spinner } from "./ui";

const s = stylex.create({
  embedded: { display: "grid", gap: 14, paddingBlock: 16, paddingInline: 16, borderRadius: radius.inner, backgroundColor: color.surface2 },
  body: { display: "grid", gap: 16 },
  form: { display: "grid", gap: 14 },
  fieldset: { display: "grid", gap: 8, margin: 0, padding: 0, borderWidth: 0, minWidth: 0 },
  lengths: { display: "flex", flexWrap: "wrap", gap: 6 },
  pill: {
    position: "relative",
    display: "inline-flex",
    alignItems: "center",
    height: 38,
    paddingInline: 16,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderStyle: "solid",
    borderColor: { default: color.border, ":hover": color.borderStrong },
    backgroundColor: color.surface,
    fontSize: 14,
    fontWeight: 650,
    fontVariantNumeric: "tabular-nums",
    cursor: "pointer",
  },
  pillOn: { borderColor: { default: color.primary, ":hover": color.primary }, backgroundColor: color.lilacSoft },
  pillOff: { opacity: 0.45, cursor: "not-allowed" },
  pillFocus: { outline: `2px solid ${color.focus}`, outlineOffset: 2 },
  hiddenInput: { position: "absolute", opacity: 0, pointerEvents: "none", width: 1, height: 1, margin: 0 },
  timer: { width: "auto", minWidth: 150, height: 40, paddingBlock: 0, fontSize: 14 },
  start: { justifySelf: "start" },
  history: { display: "grid", gap: 10 },
  trend: { display: "flex", alignItems: "flex-end", gap: 6, height: 64, paddingBottom: 2, borderBottomWidth: 1, borderBottomStyle: "solid", borderBottomColor: color.border },
  trendBar: { flexGrow: 1, maxWidth: 28, minHeight: 3, borderRadius: "6px 6px 2px 2px", backgroundColor: color.chart1 },
  trendLatest: { backgroundColor: color.primary },
  trendHeight: (pct: number) => ({ height: `${Math.max(pct, 4)}%` }),
  rows: { display: "grid", gap: 6, margin: 0, padding: 0, listStyle: "none" },
  row: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingBlock: 10,
    paddingInline: 14,
    borderRadius: radius.field,
    backgroundColor: { default: color.surface2, ":hover": color.surface3 },
    boxShadow: { default: "none", ":focus-within": `0 0 0 3px ${color.focus}` },
  },
  rowEmbedded: { backgroundColor: { default: color.surface, ":hover": color.surface3 } },
  rowLink: { color: color.text, fontWeight: 650, textDecoration: "none", outline: "none", "::after": { content: '""', position: "absolute", inset: 0, borderRadius: radius.field } },
  kind: { marginRight: "auto" },
  score: { fontFamily: font.display, fontWeight: 800, fontVariantNumeric: "tabular-nums" },
  dialog: {
    width: "min(440px, calc(100vw - 32px))",
    padding: 0,
    borderWidth: 0,
    borderRadius: radius.card,
    backgroundColor: color.surface,
    color: color.text,
    "::backdrop": { backgroundColor: color.scrim },
  },
  dialogBody: { display: "grid", gap: 14, padding: 26 },
  dialogTitle: { fontFamily: font.display, fontSize: 22, fontWeight: 800 },
});

const pct = (x: PracticeTestSummary) => (x.questions && x.correct !== null ? Math.round((x.correct / x.questions) * 100) : 0);

function LengthPill({ value, label, checked, disabled, onPick }: { value: string; label: string; checked: boolean; disabled: boolean; onPick: () => void }) {
  const [focus, setFocus] = useState(false);
  return (
    <label {...stylex.props(s.pill, checked && s.pillOn, disabled && s.pillOff, focus && s.pillFocus)}>
      <input
        type="radio"
        name="practice-length"
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={onPick}
        onFocus={(e) => setFocus(e.currentTarget.matches(":focus-visible"))}
        onBlur={() => setFocus(false)}
        {...stylex.props(s.hiddenInput)}
      />
      {label}
    </label>
  );
}

function StartForm({ scopeId, overview }: { scopeId: string; overview: PracticeTestOverview }) {
  useLang();
  const navigate = useNavigate();
  const fits = PRACTICE_LENGTHS.filter((n) => n <= overview.eligible);
  const [length, setLength] = useState<PracticeTestRequest["length"]>(fits[0] ?? "all");
  const [limit, setLimit] = useState<PracticeTestRequest["timeLimitMin"]>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const view = await api.startPracticeTest(scopeId, { length, timeLimitMin: limit });
      navigate(`/tests/${view.test.id}`);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <div {...stylex.props(s.form)}>
      <fieldset {...stylex.props(s.fieldset)}>
        <legend {...stylex.props(field.label)}>{t("practice.length")}</legend>
        <div {...stylex.props(s.lengths)}>
          {PRACTICE_LENGTHS.map((n) => (
            <LengthPill key={n} value={String(n)} label={String(n)} checked={length === n} disabled={n > overview.eligible} onPick={() => setLength(n)} />
          ))}
          <LengthPill value="all" label={t("practice.lengthAll", { count: Math.min(overview.eligible, PRACTICE_MAX_QUESTIONS) })} checked={length === "all"} disabled={false} onPick={() => setLength("all")} />
        </div>
      </fieldset>
      <label {...stylex.props(field.stack)}>
        <span {...stylex.props(field.label)}>{t("practice.timer")}</span>
        <select
          value={limit ?? ""}
          onChange={(e) => setLimit(e.target.value ? (Number(e.target.value) as PracticeTestRequest["timeLimitMin"]) : null)}
          {...stylex.props(field.input, field.select, s.timer)}
        >
          <option value="">{t("practice.timerOff")}</option>
          {PRACTICE_TIME_LIMITS.map((m) => (
            <option key={m} value={m}>
              {t("practice.timerMinutes", { count: m })}
            </option>
          ))}
        </select>
      </label>
      <p {...stylex.props(text.small, text.muted)}>{t(limit ? "practice.timerOnHint" : "practice.timerHint")}</p>
      {error && (
        <p role="alert" {...stylex.props(text.error)}>
          {error}
        </p>
      )}
      <button type="button" disabled={busy} onClick={start} {...stylex.props(btn.base, btn.primary, s.start)}>
        {busy ? <Spinner /> : <Play size={16} aria-hidden="true" />} {t("practice.start")}
      </button>
      <p {...stylex.props(text.xs, text.muted)}>{t("practice.pool", { count: overview.eligible, lessons: overview.lessonsFinished })}</p>
    </div>
  );
}

function OpenTest({ test, onDiscarded }: { test: PracticeTestSummary; onDiscarded: () => void }) {
  useLang();
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useOverlayScroll(dialog, true);

  const discard = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.discardPracticeTest(test.id);
      dialog.current?.close();
      onDiscarded();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div {...stylex.props(s.form)}>
      <p {...stylex.props(banner.base, banner.lilac)}>{t("practice.inProgress", { answered: test.answered, total: test.questions })}</p>
      <div {...stylex.props(layout.actions)}>
        <Link to={`/tests/${test.id}`} {...stylex.props(btn.base, btn.primary)}>
          {t("practice.resume")} <ArrowRight size={16} aria-hidden="true" />
        </Link>
        <button type="button" onClick={() => dialog.current?.showModal()} {...stylex.props(btn.base, btn.ghost)}>
          <Trash2 size={15} aria-hidden="true" /> {t("practice.discard")}
        </button>
      </div>
      <dialog ref={dialog} aria-labelledby={`discard-${test.id}`} {...stylex.props(s.dialog, shadow.pop)}>
        <div {...stylex.props(s.dialogBody)}>
          <h2 id={`discard-${test.id}`} {...stylex.props(s.dialogTitle)}>
            {t("practice.discardTitle")}
          </h2>
          <p>{t("practice.discardBody")}</p>
          {error && (
            <p role="alert" {...stylex.props(text.error)}>
              {error}
            </p>
          )}
          <div {...stylex.props(layout.actions)}>
            <button type="button" disabled={busy} onClick={discard} {...stylex.props(btn.base, btn.danger)}>
              {busy && <Spinner />} {t("practice.discardConfirm")}
            </button>
            <button type="button" onClick={() => dialog.current?.close()} {...stylex.props(btn.base, btn.ghost)}>
              {t("common.cancel")}
            </button>
          </div>
        </div>
      </dialog>
    </div>
  );
}

function History({ tests, embedded }: { tests: PracticeTestSummary[]; embedded: boolean }) {
  useLang();
  const trend = tests.filter((x) => x.status === "done").slice(0, 10).reverse();
  return (
    <section aria-labelledby="practice-history" {...stylex.props(s.history)}>
      <h3 id="practice-history" {...stylex.props(text.h3)}>
        {t("practice.history")}
      </h3>
      {trend.length > 1 && (
        <div role="img" aria-label={t("practice.trend", { scores: trend.map((x) => `${pct(x)}%`).join(", ") })} {...stylex.props(s.trend)}>
          {trend.map((x, i) => (
            <span key={x.id} aria-hidden="true" {...stylex.props(s.trendBar, i === trend.length - 1 && s.trendLatest, s.trendHeight(pct(x)))} />
          ))}
        </div>
      )}
      <ul {...stylex.props(s.rows)}>
        {tests.map((x) => (
          <li key={x.id} {...stylex.props(s.row, embedded && s.rowEmbedded)}>
            <Link to={`/tests/${x.id}`} {...stylex.props(s.rowLink)}>
              {formatDate(x.submittedAt ?? x.createdAt)}
            </Link>
            {x.kind === "final" && <span {...stylex.props(chip.base, chip.lilac, s.kind)}>{t("final.historyChip")}</span>}
            {x.status === "grading" ? (
              <span {...stylex.props(chip.base, chip.butter)}>{t("practice.grading")}</span>
            ) : (
              <span {...stylex.props(text.small, text.tnum)}>
                <span {...stylex.props(s.score)}>{t("common.xOfY", { x: x.correct ?? 0, y: x.questions })}</span> · {pct(x)}%
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Starts, resumes and lists practice tests of a topic or a goal (L20). `embedded` sits inside another card, as on
 * the goal page, and stays hidden until the goal has a finished lesson.
 */
export function PracticeTestCard({ scopeId, embedded = false }: { scopeId: string; embedded?: boolean }) {
  useLang();
  const res = useResource(() => api.practiceTests(scopeId), `practice:${scopeId}`);
  const o = res.data;
  if (embedded && (!o || (o.eligible === 0 && !o.open && o.history.length === 0))) return null;

  const body =
    res.loading && !o ? (
      <Skeleton lines={3} />
    ) : res.error && !o ? (
      <ErrorBox error={res.error} onRetry={res.reload} />
    ) : o ? (
      <div {...stylex.props(s.body)}>
        <p {...stylex.props(text.small, text.muted)}>{t("practice.about")}</p>
        {o.open ? (
          <OpenTest test={o.open} onDiscarded={() => void res.reload()} />
        ) : o.eligible === 0 ? (
          <Empty title={t("practice.lockedTitle")} art={embedded ? null : "empty-seedling"}>
            {t("practice.lockedBody")}
          </Empty>
        ) : (
          <StartForm scopeId={scopeId} overview={o} />
        )}
        {o.history.length > 0 && <History tests={o.history} embedded={embedded} />}
      </div>
    ) : null;

  if (embedded)
    return (
      <section aria-labelledby={`practice-${scopeId}`} {...stylex.props(s.embedded)}>
        <h3 id={`practice-${scopeId}`} {...stylex.props(text.h3)}>
          {t("practice.goalTitle")}
        </h3>
        {body}
      </section>
    );
  return (
    <section aria-labelledby={`practice-${scopeId}`} {...stylex.props(card.base)}>
      <CardHead title={t("practice.title")} id={`practice-${scopeId}`}>
        <ClipboardCheck size={20} aria-hidden="true" />
      </CardHead>
      {body}
    </section>
  );
}
