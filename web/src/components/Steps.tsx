import * as stylex from "@stylexjs/stylex";
import { Check, CircleCheck, CircleX, ExternalLink, Flag, MessageCircle, NotebookPen, Quote, ShieldCheck, X } from "lucide-react";
import { useId, useRef, useState, type ReactNode, type RefObject } from "react";
import type { AlternativeView, ItemState } from "@shared/api";
import type { PublicCite, PublicItem, PublicStep } from "@shared/schemas";
import { api, errorText } from "../lib/api";
import { gameProgress } from "../lib/game";
import type { MessageKey } from "@shared/i18n";
import { t, useLang } from "../lib/i18n";
import { ExplainDifferently } from "./ExplainDifferently";
import { isTypingTarget } from "../lib/keys";
import { isCurrent, submitOnModEnter, useShortcuts } from "../lib/shortcuts";
import { FigureView } from "./Figure";
import { ItemView, restoredResponse, type ItemResult } from "./ItemView";
import { NarratedBody } from "./Narration";
import { clipQuote } from "./SelectionActions";
import { KeyHint } from "./Shortcuts";
import { bp, color, font, motion, radius } from "../theme/tokens.stylex";
import { banner, btn, chip, field, layout, text } from "../theme/ui";
import { Markdown, Spinner } from "./ui";

const s = stylex.create({
  step: { display: "grid", gap: 22 },
  title: { fontFamily: font.display, fontSize: { default: 30, [bp.mobile]: 24 }, fontWeight: 800, letterSpacing: "-0.02em", lineHeight: 1.15, outline: "none" },
  body: { fontSize: 17 },
  items: { display: "grid", gap: 32 },
  checks: { display: "grid", gap: 16, paddingTop: 22, borderTopWidth: 1, borderTopStyle: "solid", borderTopColor: color.border },
  checksTitle: { fontFamily: font.display, fontSize: { default: 26, [bp.mobile]: 22 }, fontWeight: 800, letterSpacing: "-0.02em" },
  cites: { display: "grid", gap: 8 },
  citesTitle: { fontSize: 13, fontWeight: 650, color: color.textMuted },
  citeList: { display: "flex", flexWrap: "wrap", gap: 8, margin: 0, padding: 0, listStyle: "none" },
  cite: { display: "inline-flex", alignItems: "center", gap: 2, paddingBlock: 3, paddingInline: "12px 4px", borderRadius: radius.pill, backgroundColor: color.surface2, fontSize: 13 },
  citeAnchor: { position: "relative", display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 550, cursor: "help", borderRadius: 6 },
  citeTip: {
    position: "absolute",
    zIndex: 20,
    left: -12,
    bottom: "calc(100% + 10px)",
    width: "min(380px, 80vw)",
    paddingBlock: 10,
    paddingInline: 14,
    borderRadius: 14,
    backgroundColor: color.primary,
    color: color.onPrimary,
    fontSize: 13.5,
    fontWeight: 450,
    lineHeight: 1.5,
    pointerEvents: "none",
    opacity: { default: 0, [stylex.when.ancestor(":hover")]: 1, [stylex.when.ancestor(":focus")]: 1 },
    transform: { default: "translateY(4px)", [stylex.when.ancestor(":hover")]: "none", [stylex.when.ancestor(":focus")]: "none" },
    transitionProperty: "opacity, transform",
    transitionDuration: motion.fast,
  },
  citeCount: { fontSize: 12, fontWeight: 650, color: color.textMuted },
  citeQuote: { display: "block", marginTop: { default: 0, ":not(:first-child)": 8 } },
  citeLink: { display: "grid", placeItems: "center", width: 28, height: 28, borderRadius: "50%", color: color.accentText, backgroundColor: { default: "transparent", ":hover": color.lilacSoft } },
  problem: { paddingBlock: 18, paddingInline: 20, borderRadius: radius.inner, backgroundColor: color.lilacSoft, fontSize: 16, fontWeight: 500 },
  lines: { display: "grid", gap: 10, margin: 0, padding: 0, listStyle: "none" },
  line: { display: "grid", gridTemplateColumns: "30px minmax(0, 1fr)", gap: 14, alignItems: "start", paddingBlock: 10, paddingInline: 12 },
  lineFaded: { borderWidth: 1.5, borderStyle: "dashed", borderColor: color.borderStrong, borderRadius: radius.field },
  lineNum: { display: "grid", placeItems: "center", width: 30, height: 30, borderRadius: "50%", backgroundColor: color.surface2, fontSize: 13, fontWeight: 750, fontVariantNumeric: "tabular-nums" },
  lineNumFaded: { backgroundColor: color.butter, color: color.warning },
  verdict: { display: "flex", alignItems: "center", gap: 6, marginBottom: 4, fontSize: 14, fontWeight: 650 },
  verdictOk: { color: color.success },
  verdictOff: { color: color.warning },
  faded: { display: "grid", gap: 8 },
  fadedPrompt: { fontWeight: 650 },
  fadedRow: { display: "flex", gap: 8, maxWidth: "52ch" },
  reflect: { display: "grid", gap: 12, maxWidth: "66ch" },
  reflectPrompt: { fontSize: 18, fontWeight: 550 },
  checkFoot: { display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12, paddingBlock: 14, paddingInline: 18, borderRadius: radius.inner, backgroundColor: color.surface2 },
  summary: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 18, paddingBlock: 18, paddingInline: 22, borderRadius: radius.inner, backgroundColor: color.pistachioSoft },
  score: { fontFamily: font.display, fontSize: 44, fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" },
  scoreOf: { fontFamily: font.body, fontSize: 16, fontWeight: 600, color: color.textMuted, letterSpacing: 0 },
  tools: { display: "grid", gap: 12, paddingTop: 4 },
  toolForm: { display: "grid", gap: 8, maxWidth: "62ch", padding: 16, borderRadius: radius.inner, backgroundColor: color.surface2 },
  quote: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8, paddingBlock: 8, paddingInline: 12, borderRadius: 12, backgroundColor: color.surface, fontSize: 14, fontStyle: "italic", color: color.textMuted },
});

/** Retrieval checks of an explain step, where the lesson player sends the learner after the explanation. */
export const checksId = (stepId: string) => `checks-${stepId}`;

export type TutorHooks = {
  onOfferTutor: (itemId: string, stepId: string, reason: "wrong_twice" | "idle") => void;
  onAskTutor: (itemId: string, stepId: string) => void;
  /** Opens the tutor on a worked-example line whose open question the learner answers there. */
  onAnswerLine: (stepId: string, line: number) => void;
};

/** A faded line's result recorded through the tutor, keyed by line index. */
export type LineResults = Record<number, { text: string; correct: boolean }>;

type StepProps = {
  step: PublicStep;
  topicId: string | null;
  lessonId: string;
  active: boolean;
  /** Without it the step offers no tutor, as on a page that has no tutor panel. */
  tutor?: TutorHooks;
  onCheckResults?: (stepId: string, results: { item: PublicItem; result: ItemResult | undefined }[]) => void;
  /** Asks for a practice set like a practice item the learner got wrong. */
  onPractiseMore?: (itemId: string) => void;
  /** An answer to one of an explain step's retrieval checks. */
  onExplainCheck?: (itemId: string, result: ItemResult) => void;
  itemStates: Record<string, ItemState>;
  revealedLines: { idx: number; text: string }[];
  lineResults?: LineResults;
  /** Stored alternative explanations of the step; without it the step offers none. */
  alternatives?: AlternativeView[];
};

export function StepView({ step, topicId, lessonId, active, tutor, onCheckResults, itemStates, revealedLines, lineResults, alternatives, onPractiseMore, onExplainCheck }: StepProps) {
  const ref = useRef<HTMLElement>(null);
  return (
    <article ref={ref} data-shortcut-scope="step" aria-labelledby={`step-title-${step.id}`} {...stylex.props(s.step)}>
      <h2 id={`step-title-${step.id}`} tabIndex={-1} {...stylex.props(s.title)}>
        {step.title}
      </h2>
      <StepBody
        step={step}
        active={active}
        tutor={tutor}
        onCheckResults={onCheckResults}
        itemStates={itemStates}
        revealedLines={revealedLines}
        lineResults={lineResults}
        alternatives={alternatives}
        onPractiseMore={onPractiseMore}
        onExplainCheck={onExplainCheck}
      />
      <StepTools step={step} topicId={topicId} lessonId={lessonId} active={active} container={ref} />
    </article>
  );
}

function StepBody({ step, active, tutor, onCheckResults, itemStates, revealedLines, lineResults, alternatives, onPractiseMore, onExplainCheck }: Omit<StepProps, "topicId" | "lessonId">) {
  useLang();
  const offer = tutor && ((itemId: string, reason: "wrong_twice" | "idle") => tutor.onOfferTutor(itemId, step.id, reason));
  const ask = tutor && ((itemId: string) => tutor.onAskTutor(itemId, step.id));
  switch (step.kind) {
    case "activate":
      return (
        <>
          <p {...stylex.props(banner.base, banner.butter)}>{t("steps.warmupBanner")}</p>
          <div {...stylex.props(s.items)}>
            {step.items.map((item, i) => (
              <ItemView key={item.id} item={item} mode="activate" context="activate" active={active} number={i + 1} initial={itemStates[item.id]} />
            ))}
          </div>
        </>
      );
    case "explain":
      return (
        <>
          <NarratedBody stepId={step.id} body={step.body} active={active} xstyle={s.body} />
          {step.figure && <FigureView figure={step.figure} />}
          {alternatives && <ExplainDifferently stepId={step.id} kind="explain" initial={alternatives} />}
          <Citations cites={step.cites} />
          {step.checks.length > 0 && (
            <section id={checksId(step.id)} aria-label={t("steps.selfCheck")} {...stylex.props(s.checks)}>
              <h3 {...stylex.props(s.checksTitle)}>{t("steps.selfCheck")}</h3>
              <div {...stylex.props(s.items)}>
                {step.checks.map((item, i) => (
                  <ItemView
                    key={item.id}
                    item={item}
                    mode="practice"
                    context="explain"
                    active={active}
                    number={step.checks.length > 1 ? i + 1 : undefined}
                    initial={itemStates[item.id]}
                    onResult={onExplainCheck}
                    onOfferTutor={offer}
                    onAskTutor={ask}
                    onPractiseMore={onPractiseMore}
                  />
                ))}
              </div>
            </section>
          )}
        </>
      );
    case "worked_example":
      return (
        <WorkedExample
          step={step}
          revealedLines={revealedLines}
          lineResults={lineResults}
          onAnswerLine={(line) => tutor?.onAnswerLine(step.id, line)}
          explainDifferently={alternatives && <ExplainDifferently stepId={step.id} kind="worked_example" initial={alternatives} />}
        />
      );
    case "practice":
      return (
        <ItemView
          item={step.item}
          mode="practice"
          context="practice"
          active={active}
          initial={itemStates[step.item.id]}
          onOfferTutor={offer}
          onAskTutor={ask}
          onPractiseMore={onPractiseMore}
        />
      );
    case "reflect":
      return <Reflect step={step} />;
    case "check":
      return <CheckStep step={step} active={active} onResults={onCheckResults} itemStates={itemStates} />;
  }
}

/** One chip per source; every quote cited from it goes in its tooltip. */
function Citations({ cites }: { cites: PublicCite[] }) {
  useLang();
  const base = useId();
  const sources: { sourceId: string; title: string; url: string; quotes: string[] }[] = [];
  for (const c of cites) {
    const known = sources.find((x) => x.sourceId === c.sourceId);
    if (!known) sources.push({ sourceId: c.sourceId, title: c.title, url: c.url, quotes: [c.quote] });
    else if (!known.quotes.includes(c.quote)) known.quotes.push(c.quote);
  }
  if (sources.length === 0) return null;
  return (
    <section aria-label={t("steps.sources")} {...stylex.props(s.cites)}>
      <h3 {...stylex.props(s.citesTitle)}>{t("steps.sources")}</h3>
      <ol {...stylex.props(s.citeList)}>
        {sources.map((c, i) => (
          <li key={c.sourceId} {...stylex.props(s.cite)}>
            <span tabIndex={0} aria-describedby={`${base}-${i}`} {...stylex.props(s.citeAnchor, stylex.defaultMarker())}>
              <Quote size={14} aria-hidden="true" />
              <span>{c.title}</span>
              {c.quotes.length > 1 && <span {...stylex.props(s.citeCount)}>×{c.quotes.length}</span>}
              <span role="tooltip" id={`${base}-${i}`} {...stylex.props(s.citeTip)}>
                {c.quotes.map((q, j) => (
                  <span key={j} {...stylex.props(s.citeQuote)}>
                    {t("steps.quote", { quote: q })}
                  </span>
                ))}
              </span>
            </span>
            <a href={c.url} target="_blank" rel="noopener noreferrer" aria-label={t("steps.openSource", { title: c.title })} {...stylex.props(s.citeLink)}>
              <ExternalLink size={14} aria-hidden="true" />
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}

type WorkedStep = Extract<PublicStep, { kind: "worked_example" }>;

type Revealed = { text: string; correct?: boolean; answer?: string };

function WorkedExample({
  step,
  revealedLines,
  lineResults,
  onAnswerLine,
  explainDifferently,
}: {
  step: WorkedStep;
  revealedLines: { idx: number; text: string }[];
  lineResults?: LineResults;
  onAnswerLine: (line: number) => void;
  explainDifferently?: ReactNode;
}) {
  useLang();
  const [own, setRevealed] = useState<Record<number, Revealed>>(() =>
    Object.fromEntries(revealedLines.map((l) => [l.idx, { text: l.text }])),
  );
  const revealed: Record<number, Revealed> = { ...own, ...lineResults };
  // Lines after the first unanswered faded line stay hidden until it is filled in (L5).
  const firstOpen = step.lines.findIndex((l) => l.text === undefined && !revealed[l.idx]);
  const visible = firstOpen === -1 ? step.lines : step.lines.slice(0, firstOpen + 1);
  return (
    <>
      <div {...stylex.props(s.problem)}>
        <Markdown src={step.problem} />
      </div>
      {step.figure && <FigureView figure={step.figure} />}
      <ol {...stylex.props(s.lines)}>
        {visible.map((line, n) => {
          const r = revealed[line.idx];
          const num = (
            <span aria-hidden="true" {...stylex.props(s.lineNum, line.text === undefined && s.lineNumFaded)}>
              {n + 1}
            </span>
          );
          if (line.text !== undefined) {
            return (
              <li key={line.idx} {...stylex.props(s.line)}>
                {num}
                <Markdown src={line.text} />
              </li>
            );
          }
          return (
            <li key={line.idx} {...stylex.props(s.line, s.lineFaded)}>
              {num}
              {r ? (
                <div>
                  {r.correct !== undefined && (
                    <p aria-live="polite" {...stylex.props(s.verdict, r.correct ? s.verdictOk : s.verdictOff)}>
                      {r.correct ? <CircleCheck size={16} aria-hidden="true" /> : <CircleX size={16} aria-hidden="true" />}
                      {r.correct ? t("item.right") : r.answer ? t("steps.yourVersion", { answer: r.answer }) : t("steps.lineShown")}
                    </p>
                  )}
                  <Markdown src={r.text} />
                </div>
              ) : line.blankOpen ? (
                <OpenLine
                  prompt={line.blankPrompt ?? t("steps.finishLine")}
                  onAnswer={() => onAnswerLine(line.idx)}
                  onReveal={async () => {
                    const res = await api.revealWorkedLine(step.id, line.idx);
                    setRevealed((m) => ({ ...m, [line.idx]: { ...res, answer: "" } }));
                  }}
                />
              ) : (
                <FadedLine
                  prompt={line.blankPrompt ?? t("steps.finishLine")}
                  onSubmit={async (answer) => {
                    const res = await api.workedLine(step.id, line.idx, answer);
                    gameProgress({ kind: "answer", correct: res.correct });
                    setRevealed((m) => ({ ...m, [line.idx]: { ...res, answer } }));
                  }}
                />
              )}
            </li>
          );
        })}
      </ol>
      {firstOpen !== -1 && step.lines.length > visible.length && (
        <p {...stylex.props(text.muted, text.small)}>
          {t("steps.moreLines", { count: step.lines.length - visible.length })}
        </p>
      )}
      {explainDifferently}
      <Citations cites={step.cites} />
    </>
  );
}

/** A line whose answer is an action or reason in words: the tutor asks it and judges the answer by meaning. */
function OpenLine({ prompt, onAnswer, onReveal }: { prompt: string; onAnswer: () => void; onReveal: () => Promise<void> }) {
  useLang();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div {...stylex.props(s.faded)}>
      <p {...stylex.props(s.fadedPrompt)}>{prompt}</p>
      <p {...stylex.props(text.small, text.muted)}>{t("steps.openLineHint")}</p>
      <div {...stylex.props(layout.actions)}>
        <button type="button" onClick={onAnswer} {...stylex.props(btn.base, btn.primary, btn.sm)}>
          <MessageCircle size={15} aria-hidden="true" /> {t("steps.answerTutor")}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await onReveal();
            } catch (err) {
              setError(errorText(err));
              setBusy(false);
            }
          }}
          {...stylex.props(btn.base, btn.ghost, btn.sm)}
        >
          {busy && <Spinner />} {t("steps.showLine")}
        </button>
      </div>
      {error && (
        <p role="alert" {...stylex.props(text.error)}>
          {error}
        </p>
      )}
    </div>
  );
}

function FadedLine({ prompt, onSubmit }: { prompt: string; onSubmit: (answer: string) => Promise<void> }) {
  useLang();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  return (
    <form
      {...stylex.props(s.faded)}
      onSubmit={async (e) => {
        e.preventDefault();
        if (!value.trim()) return;
        setBusy(true);
        setError(null);
        try {
          await onSubmit(value.trim());
        } catch (err) {
          setError(errorText(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <label htmlFor={id} {...stylex.props(s.fadedPrompt)}>
        {prompt}
      </label>
      <div {...stylex.props(s.fadedRow)}>
        <input id={id} value={value} onChange={(e) => setValue(e.target.value)} autoComplete="off" {...stylex.props(field.input)} />
        <button type="submit" disabled={!value.trim() || busy} {...stylex.props(btn.base, btn.primary)}>
          {busy && <Spinner />} {t("item.check")}
        </button>
      </div>
      {error && (
        <p role="alert" {...stylex.props(text.error)}>
          {error}
        </p>
      )}
    </form>
  );
}

const PURPOSE: Record<Extract<PublicStep, { kind: "reflect" }>["purpose"], MessageKey> = {
  why: "steps.purpose.why",
  connect: "steps.purpose.connect",
  confidence: "steps.purpose.confidence",
};

function Reflect({ step }: { step: Extract<PublicStep, { kind: "reflect" }> }) {
  useLang();
  const [answer, setAnswer] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  return (
    <form
      {...stylex.props(s.reflect)}
      onKeyDown={submitOnModEnter}
      onSubmit={async (e) => {
        e.preventDefault();
        setState("busy");
        setError(null);
        try {
          await api.reflect(step.id, answer.trim());
          setState("saved");
        } catch (err) {
          setError(errorText(err));
          setState("idle");
        }
      }}
    >
      <p {...stylex.props(chip.base, chip.lilac)}>{t(PURPOSE[step.purpose])}</p>
      <label htmlFor={id} {...stylex.props(s.reflectPrompt)}>
        {step.prompt}
      </label>
      <textarea id={id} rows={5} value={answer} disabled={state === "saved"} onChange={(e) => setAnswer(e.target.value)} {...stylex.props(field.input, field.textarea)} />
      <div {...stylex.props(layout.actions)}>
        {state === "saved" ? (
          <p role="status" {...stylex.props(text.saved)}>
            <Check size={16} aria-hidden="true" /> {t("steps.answerSaved")}
          </p>
        ) : (
          <button type="submit" disabled={!answer.trim() || state === "busy"} {...stylex.props(btn.base, btn.primary)}>
            {state === "busy" && <Spinner />} {t("steps.saveAnswer")}
          </button>
        )}
      </div>
      {error && (
        <p role="alert" {...stylex.props(text.error)}>
          {error}
        </p>
      )}
    </form>
  );
}

function CheckStep({
  step,
  active,
  onResults,
  itemStates,
}: {
  step: Extract<PublicStep, { kind: "check" }>;
  active: boolean;
  onResults?: StepProps["onCheckResults"];
  itemStates: Record<string, ItemState>;
}) {
  useLang();
  const [results, setResults] = useState<Record<string, ItemResult>>(() => {
    const out: Record<string, ItemResult> = {};
    for (const item of step.items) {
      const response = restoredResponse(itemStates[item.id], "check");
      if (response) out[item.id] = { response, gaveUp: null };
    }
    return out;
  });
  // A check answered in full before a reload opens with its results.
  const [revealed, setRevealed] = useState(() => step.items.every((i) => results[i.id]));
  const summaryRef = useRef<HTMLDivElement>(null);
  const answered = step.items.filter((i) => results[i.id]).length;
  const correct = step.items.filter((i) => results[i.id]?.response.correct === true).length;
  const pending = step.items.filter((i) => results[i.id] && results[i.id]!.response.correct === null).length;
  const wrong = answered - correct - pending;

  const finish = () => {
    setRevealed(true);
    onResults?.(step.id, step.items.map((item) => ({ item, result: results[item.id] })));
    requestAnimationFrame(() => summaryRef.current?.focus());
  };

  useShortcuts(
    "step",
    (a) => {
      if (a.name !== "submit" || answered < step.items.length) return false;
      finish();
      return true;
    },
    active && !revealed,
  );

  return (
    <>
      <p {...stylex.props(banner.base, banner.ink)}>
        <ShieldCheck size={18} aria-hidden="true" /> {t("steps.checkBanner")}
      </p>
      <div {...stylex.props(s.items)}>
        {step.items.map((item, i) => (
          <ItemView
            key={item.id}
            item={item}
            mode="check"
            context="check"
            active={active}
            number={i + 1}
            revealed={revealed}
            initial={itemStates[item.id]}
            onResult={(id, r) => setResults((m) => ({ ...m, [id]: r }))}
          />
        ))}
      </div>
      {!revealed ? (
        <div {...stylex.props(s.checkFoot)}>
          <p {...stylex.props(text.muted, text.tnum)}>
            {t("steps.answered", { answered, total: step.items.length })}
          </p>
          <button
            type="button"
            disabled={answered < step.items.length}
            {...stylex.props(btn.base, btn.primary)}
            onClick={finish}
          >
            {t("steps.finishCheck")} <KeyHint>↵</KeyHint>
          </button>
        </div>
      ) : (
        <div ref={summaryRef} tabIndex={-1} role="status" {...stylex.props(s.summary)}>
          <p {...stylex.props(s.score)}>
            {correct} <span {...stylex.props(s.scoreOf)}>{t("steps.scoreOf", { total: step.items.length })}</span>
          </p>
          <p>
            {wrong === 0 ? t("steps.noMistakes") : t("steps.mistakes", { mistakes: t("count.mistakes", { count: wrong }) })}
            {pending > 0 && ` ${t("steps.pendingGrading", { count: pending })}`}
          </p>
        </div>
      )}
    </>
  );
}

function StepTools({
  step,
  topicId,
  lessonId,
  active,
  container,
}: {
  step: PublicStep;
  topicId: string | null;
  lessonId: string;
  active: boolean;
  container: RefObject<HTMLElement | null>;
}) {
  useLang();
  const [open, setOpen] = useState<"note" | "report" | null>(null);
  const [quote, setQuote] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  const noteButton = useRef<HTMLButtonElement>(null);
  const reportButton = useRef<HTMLButtonElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const captureSelection = () => {
    const sel = window.getSelection();
    const picked = sel?.toString().trim() ?? "";
    if (picked && sel?.anchorNode && container.current?.contains(sel.anchorNode)) setQuote(clipQuote(picked));
  };

  const toggle = (which: "note" | "report") => {
    setDone(null);
    setError(null);
    setNote("");
    if (which === "report") setQuote("");
    setOpen((o) => (o === which ? null : which));
  };

  useShortcuts(
    "step",
    (a, e) => {
      if (!isCurrent(container.current, "step")) return false;
      if (a.name === "note") {
        if (open === "note") formRef.current?.querySelector("textarea")?.focus();
        else {
          captureSelection();
          toggle("note");
        }
        return true;
      }
      if (a.name === "escape" && open && (formRef.current?.contains(e.target as Node) || !isTypingTarget(e.target))) {
        setOpen(null);
        (open === "note" ? noteButton : reportButton).current?.focus();
        return true;
      }
      return false;
    },
    active,
  );

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (open === "note") {
        if (!topicId) throw new Error(t("steps.topicNotLoaded"));
        await api.addNote({ topicId, lessonId, stepId: step.id, quote: quote || undefined, text: note.trim() });
        setDone(t("steps.noteSaved"));
      } else {
        await api.report({ targetType: "step", targetId: step.id, text: note.trim() });
        setDone(t("steps.reportSent"));
      }
      setOpen(null);
      setQuote("");
      setNote("");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <footer {...stylex.props(s.tools)}>
      <div {...stylex.props(layout.row)}>
        <button
          ref={noteButton}
          type="button"
          {...stylex.props(btn.base, btn.ghost, btn.sm)}
          aria-expanded={open === "note"}
          onPointerDown={captureSelection}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && captureSelection()}
          onClick={() => toggle("note")}
        >
          <NotebookPen size={16} aria-hidden="true" /> {t("steps.note")}
        </button>
        <button ref={reportButton} type="button" aria-expanded={open === "report"} onClick={() => toggle("report")} {...stylex.props(btn.base, btn.ghost, btn.sm)}>
          <Flag size={16} aria-hidden="true" /> {t("steps.reportProblem")}
        </button>
        {done && (
          <p role="status" {...stylex.props(text.saved)}>
            <Check size={16} aria-hidden="true" /> {done}
          </p>
        )}
      </div>
      {open && (
        <form
          ref={formRef}
          {...stylex.props(s.toolForm)}
          onKeyDown={submitOnModEnter}
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {open === "note" && quote && (
            <blockquote {...stylex.props(s.quote)}>
              <span>{quote}</span>
              <button type="button" aria-label={t("steps.removeQuote")} onClick={() => setQuote("")} {...stylex.props(btn.base, btn.icon, btn.iconSm)}>
                <X size={14} aria-hidden="true" />
              </button>
            </blockquote>
          )}
          {open === "note" && !quote && <p {...stylex.props(text.muted, text.small)}>{t("steps.quoteHint")}</p>}
          <label htmlFor={id} {...stylex.props(field.label)}>
            {t(open === "note" ? "steps.noteText" : "steps.whatsWrong")}
          </label>
          <textarea id={id} rows={3} value={note} onChange={(e) => setNote(e.target.value)} autoFocus {...stylex.props(field.input, field.textarea)} />
          {error && (
            <p role="alert" {...stylex.props(text.error)}>
              {error}
            </p>
          )}
          <div {...stylex.props(layout.actions)}>
            <button type="submit" disabled={!(note.trim() || (open === "note" && quote)) || busy} {...stylex.props(btn.base, btn.primary, btn.sm)}>
              {busy && <Spinner />} {t(open === "note" ? "steps.saveNote" : "cards.send")}
            </button>
            <button type="button" onClick={() => setOpen(null)} {...stylex.props(btn.base, btn.ghost, btn.sm)}>
              {t("common.cancel")}
            </button>
          </div>
        </form>
      )}
    </footer>
  );
}
