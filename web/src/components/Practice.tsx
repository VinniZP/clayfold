import * as stylex from "@stylexjs/stylex";
import { ArrowRight, Dumbbell, Sparkles } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { practiceSizes, type PracticeFrom } from "@shared/api";
import type { MessageKey } from "@shared/i18n";
import type { PracticeFocus, PracticeSize } from "@shared/schemas";
import { api, errorText } from "../lib/api";
import { t, useLang } from "../lib/i18n";
import { useResource } from "../lib/useResource";
import { bp, color, font, motion, radius } from "../theme/tokens.stylex";
import { banner, btn, field, layout, shadow, text } from "../theme/ui";
import { DayProgress } from "./DayProgress";
import { ErrorBox, Markdown, Progress, Spinner } from "./ui";

const s = stylex.create({
  dialog: {
    width: "min(520px, calc(100vw - 32px))",
    maxHeight: "calc(100vh - 32px)",
    padding: 0,
    borderWidth: 0,
    borderRadius: radius.card,
    backgroundColor: color.surface,
    color: color.text,
    "::backdrop": { backgroundColor: color.scrim },
  },
  body: { display: "grid", gap: 18, padding: 26 },
  title: { fontFamily: font.display, fontSize: 22, fontWeight: 800 },
  group: { display: "grid", gap: 8, margin: 0, padding: 0, borderWidth: 0, minWidth: 0 },
  sizes: { display: "flex", flexWrap: "wrap", gap: 6 },
  size: {
    height: 38,
    paddingInline: 16,
    borderWidth: 0,
    borderRadius: radius.pill,
    backgroundColor: { default: color.surface2, ":hover": color.surface3 },
    color: color.text,
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
  },
  sizeOn: { backgroundColor: { default: color.primary, ":hover": color.primary }, color: color.onPrimary },
  focus: {
    display: "flex",
    alignItems: "flex-start",
    gap: 12,
    paddingBlock: 12,
    paddingInline: 16,
    borderRadius: radius.field,
    borderWidth: 1.5,
    borderStyle: "solid",
    borderColor: { default: "transparent", ":hover": color.borderStrong },
    backgroundColor: color.surface2,
    cursor: "pointer",
    transitionProperty: "border-color, background-color",
    transitionDuration: motion.fast,
  },
  focusOn: { borderColor: { default: color.primary, ":hover": color.primary }, backgroundColor: color.lilacSoft },
  focusOff: { cursor: "not-allowed", opacity: 0.55, borderColor: { default: "transparent", ":hover": "transparent" } },
  radio: { marginTop: 3, accentColor: color.primary, flexShrink: 0 },
  focusText: { display: "grid", gap: 2 },
  focusName: { fontWeight: 650 },
  note: { alignItems: "flex-start" },
  noteIcon: { flexShrink: 0, marginTop: 2 },
  end: { display: "grid", gap: 22 },
  endTitle: { fontFamily: font.display, fontSize: { default: 30, [bp.mobile]: 24 }, fontWeight: 800, outline: "none" },
  score: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 18, paddingBlock: 18, paddingInline: 22, borderRadius: radius.inner, backgroundColor: color.pistachioSoft },
  scoreNum: { fontFamily: font.display, fontSize: 44, fontWeight: 800, lineHeight: 1, fontVariantNumeric: "tabular-nums" },
  scoreOf: { fontFamily: font.body, fontSize: 16, fontWeight: 600, color: color.textMuted },
  nodes: { display: "grid", gap: 12, margin: 0, padding: 0, listStyle: "none" },
  node: { display: "grid", gap: 8, paddingBlock: 14, paddingInline: 18, borderRadius: radius.inner, backgroundColor: color.surface2 },
  nodeHead: { display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 8 },
  offer: { display: "grid", gap: 12, paddingBlock: 16, paddingInline: 18, borderRadius: radius.inner, backgroundColor: color.lilacSoft },
  offerUrgent: { backgroundColor: color.butter },
  start: { justifySelf: "start" },
});

const FOCUSES = ["same", "harder", "mistakes"] as const satisfies readonly PracticeFocus[];

export const FOCUS_LABEL: Record<PracticeFocus, MessageKey> = {
  same: "practiceSet.focus.same",
  harder: "practiceSet.focus.harder",
  mistakes: "practiceSet.focus.mistakes",
};

const FOCUS_HINT: Record<Exclude<PracticeFocus, "mistakes">, MessageKey> = {
  same: "practiceSet.focus.sameHint",
  harder: "practiceSet.focus.harderHint",
};

/**
 * Asks for a practice set from `from`: its size and focus. Open while `from` is set; Claude writes the set
 * after Start, and the page moves to it at once.
 */
export function PracticeDialog({ from, defaultFocus = "same", onClose }: { from: PracticeFrom | null; defaultFocus?: PracticeFocus; onClose: () => void }) {
  useLang();
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const navigate = useNavigate();
  const key = from ? JSON.stringify(from) : null;
  const scope = useResource(() => api.practiceScope(from!), key);
  const sizes = from ? practiceSizes(from) : [];
  const [size, setSize] = useState<PracticeSize>(5);
  const [focus, setFocus] = useState<PracticeFocus>(defaultFocus);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!key) return;
    setFocus(defaultFocus);
    setSize(practiceSizes(JSON.parse(key) as PracticeFrom)[1]!);
    setError(null);
    if (!dialog.current?.open) dialog.current?.showModal();
  }, [key, defaultFocus]);

  const mistakes = scope.data?.mistakes ?? 0;
  const chosen: PracticeFocus = focus === "mistakes" && scope.data && mistakes === 0 ? "same" : focus;

  const start = async () => {
    if (!from) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.startPractice({ from, size, focus: chosen });
      dialog.current?.close();
      navigate(`/lessons/${res.lessonId}`);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog ref={dialog} aria-labelledby={titleId} onClose={onClose} {...stylex.props(s.dialog, shadow.pop)}>
      <div {...stylex.props(s.body)}>
        <div>
          <h2 id={titleId} {...stylex.props(s.title)}>
            {t("practiceSet.dialogTitle")}
          </h2>
          {scope.data && from && "courseId" in from ? (
            <>
              <p {...stylex.props(text.muted)}>{t("practiceSet.dialogCourse", { count: scope.data.nodes.length })}</p>
              {scope.data.weakNodeIds.length > 0 && (
                <p {...stylex.props(text.small, text.muted)}>
                  {t("practiceSet.dialogWeak", { nodes: scope.data.nodes.filter((n) => scope.data!.weakNodeIds.includes(n.id)).map((n) => n.title).join(", ") })}
                </p>
              )}
            </>
          ) : (
            scope.data && <p {...stylex.props(text.muted)}>{t("practiceSet.dialogOn", { nodes: scope.data.nodes.map((n) => n.title).join(", ") })}</p>
          )}
        </div>
        {scope.error ? (
          <ErrorBox error={scope.error} onRetry={scope.reload} />
        ) : !scope.data ? (
          <Spinner label={t("common.loading")} />
        ) : (
          <>
            <fieldset {...stylex.props(s.group)}>
              <legend {...stylex.props(field.label)}>{t("practiceSet.size")}</legend>
              <div {...stylex.props(s.sizes)}>
                {sizes.map((n) => (
                  <button key={n} type="button" aria-pressed={size === n} onClick={() => setSize(n)} {...stylex.props(s.size, size === n && s.sizeOn)}>
                    {t("count.items", { count: n })}
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset {...stylex.props(s.group)}>
              <legend {...stylex.props(field.label)}>{t("practiceSet.focus")}</legend>
              {FOCUSES.map((f) => {
                const off = f === "mistakes" && mistakes === 0;
                return (
                  <label key={f} {...stylex.props(s.focus, chosen === f && s.focusOn, off && s.focusOff)}>
                    <input type="radio" name={`${titleId}-focus`} checked={chosen === f} disabled={off} onChange={() => setFocus(f)} {...stylex.props(s.radio)} />
                    <span {...stylex.props(s.focusText)}>
                      <span {...stylex.props(s.focusName)}>{t(FOCUS_LABEL[f])}</span>
                      <span {...stylex.props(text.small, text.muted)}>
                        {f === "mistakes" ? (off ? t("practiceSet.focus.noMistakes") : t("practiceSet.focus.mistakesHint", { count: mistakes })) : t(FOCUS_HINT[f])}
                      </span>
                    </span>
                  </label>
                );
              })}
            </fieldset>
          </>
        )}
        <p {...stylex.props(banner.base, banner.lilac, s.note)}>
          <Sparkles size={16} aria-hidden="true" {...stylex.props(s.noteIcon)} />
          <span {...stylex.props(text.small)}>{t("practiceSet.usesClaude")}</span>
        </p>
        {error && (
          <p role="alert" {...stylex.props(text.error)}>
            {t("practiceSet.startFailed", { error })}
          </p>
        )}
        <div {...stylex.props(layout.actions)}>
          <button type="button" disabled={busy || !scope.data} onClick={start} {...stylex.props(btn.base, btn.primary)}>
            {busy ? <Spinner /> : <Dumbbell size={16} aria-hidden="true" />} {t("practiceSet.start")}
          </button>
          <button type="button" onClick={() => dialog.current?.close()} {...stylex.props(btn.base, btn.ghost)}>
            {t("common.cancel")}
          </button>
        </div>
      </div>
    </dialog>
  );
}

/** A button that opens the practice dialog for `from`. */
export function PracticeButton({
  from,
  label = t("practiceSet.more"),
  defaultFocus,
  primary,
  small,
  xstyle,
}: {
  from: PracticeFrom;
  label?: string;
  defaultFocus?: PracticeFocus;
  primary?: boolean;
  small?: boolean;
  xstyle?: stylex.StyleXStyles;
}) {
  useLang();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} {...stylex.props(btn.base, primary ? btn.primary : btn.outline, small && btn.sm, xstyle)}>
        <Dumbbell size={small ? 14 : 16} aria-hidden="true" /> {label}
      </button>
      <PracticeDialog from={open ? from : null} defaultFocus={defaultFocus} onClose={() => setOpen(false)} />
    </>
  );
}

/** The end of a lesson: more practice on its nodes, urged when the exit check fell short of 80% (L12). */
export function PracticeOffer({ lessonId, belowCrown }: { lessonId: string; belowCrown: boolean }) {
  useLang();
  return (
    <div {...stylex.props(s.offer, belowCrown && s.offerUrgent)}>
      <p>{t(belowCrown ? "practiceSet.belowCrown" : "practiceSet.afterLesson")}</p>
      <PracticeButton from={{ lessonId }} defaultFocus={belowCrown ? "mistakes" : "same"} primary={belowCrown} small xstyle={s.start} />
    </div>
  );
}

/** The end of a practice set: first-try results per node, the set's summary and the way on. */
export function PracticeEnd({ lessonId, topicId, summary, generating }: { lessonId: string; topicId: string | null; summary: string | null; generating: boolean }) {
  useLang();
  const results = useResource(() => api.practiceResults(lessonId), lessonId);
  const r = results.data;
  return (
    <div {...stylex.props(s.end)}>
      <h2 id="step-placeholder" tabIndex={-1} {...stylex.props(s.endTitle)}>
        {t("practiceSet.results")}
      </h2>
      {results.error ? (
        <ErrorBox error={results.error} onRetry={results.reload} />
      ) : !r ? (
        <Spinner label={t("common.loading")} />
      ) : (
        <>
          <div {...stylex.props(s.score)}>
            <p {...stylex.props(s.scoreNum)}>
              {r.firstTry} <span {...stylex.props(s.scoreOf)}>{t("steps.scoreOf", { total: r.total })}</span>
            </p>
            <p>{t("practiceSet.score")}</p>
          </div>
          <ul {...stylex.props(s.nodes)}>
            {r.nodes.map((n) => (
              <li key={n.nodeId} {...stylex.props(s.node)}>
                <div {...stylex.props(s.nodeHead)}>
                  <span {...stylex.props(text.strong)}>{n.title}</span>
                  <span {...stylex.props(text.small, text.muted, text.tnum)}>{t("practiceSet.nodeScore", { firstTry: n.firstTry, total: n.total })}</span>
                </div>
                <Progress value={n.firstTry} max={n.total} label={t("practiceSet.nodeAccuracy", { title: n.title })} />
                {n.solved > n.firstTry && <p {...stylex.props(text.small, text.muted)}>{t("practiceSet.nodeSolved", { count: n.solved - n.firstTry })}</p>}
              </li>
            ))}
          </ul>
          {r.total > r.solved && <p {...stylex.props(text.muted)}>{t("practiceSet.open", { count: r.total - r.solved })}</p>}
        </>
      )}
      <DayProgress />
      {summary ? (
        <Markdown src={summary} />
      ) : generating ? (
        <p {...stylex.props(text.muted)}>
          <Spinner /> {t("practiceSet.stillWriting")}
        </p>
      ) : null}
      <div {...stylex.props(layout.actions)}>
        <PracticeButton from={{ lessonId }} primary />
        {topicId && (
          <Link to={`/topics/${topicId}`} {...stylex.props(btn.base, btn.ghost)}>
            {t("lesson.toCourseMap")} <ArrowRight size={16} aria-hidden="true" />
          </Link>
        )}
      </div>
    </div>
  );
}
