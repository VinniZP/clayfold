import * as stylex from "@stylexjs/stylex";
import { Check, Lightbulb, RotateCcw, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { lensesFor, type AlternativeView, type ExplainLens } from "@shared/api";
import type { MessageKey } from "@shared/i18n";
import { api, errorText } from "../lib/api";
import { t, useLang } from "../lib/i18n";
import { color, font, motion, radius } from "../theme/tokens.stylex";
import { btn, layout, text } from "../theme/ui";
import { Markdown, Skeleton, Spinner } from "./ui";

const LABEL: Record<ExplainLens, MessageKey> = {
  simpler: "explain.lens.simpler",
  analogy: "explain.lens.analogy",
  steps: "explain.lens.steps",
  example: "explain.lens.example",
  precise: "explain.lens.precise",
};

const HINT: Record<ExplainLens, MessageKey> = {
  simpler: "explain.hint.simpler",
  analogy: "explain.hint.analogy",
  steps: "explain.hint.steps",
  example: "explain.hint.example",
  precise: "explain.hint.precise",
};

const s = stylex.create({
  wrap: { display: "grid", gap: 14 },
  card: { display: "grid", gap: 10, paddingBlock: 18, paddingInline: 20, borderRadius: radius.inner, backgroundColor: color.lilacSoft },
  busy: { opacity: 0.55 },
  head: { display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8 },
  title: { display: "flex", alignItems: "center", gap: 8, fontFamily: font.display, fontSize: 15, fontWeight: 700, color: color.accentText, outline: "none" },
  actions: { display: "flex", alignItems: "center", gap: 4, flexShrink: 0 },
  body: { fontSize: 16 },
  lenses: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(176px, 1fr))", gap: 8, margin: 0, padding: 0, listStyle: "none" },
  lens: {
    display: "grid",
    gap: 2,
    width: "100%",
    height: "100%",
    paddingBlock: 10,
    paddingInline: 14,
    borderWidth: 1.5,
    borderStyle: "solid",
    borderColor: { default: color.border, ":hover": color.primary, ":disabled": color.border },
    borderRadius: radius.field,
    backgroundColor: { default: color.surface, ":hover": color.surface2, ":disabled": color.surface },
    color: color.text,
    textAlign: "left",
    cursor: { default: "pointer", ":disabled": "not-allowed" },
    opacity: { default: 1, ":disabled": 0.45 },
    transitionProperty: "background-color, border-color",
    transitionDuration: motion.fast,
  },
  lensName: { display: "flex", alignItems: "center", gap: 6, fontSize: 14.5, fontWeight: 650 },
  lensHint: { fontSize: 12.5, color: color.textMuted },
  ready: { color: color.success },
});

/**
 * The "Explain differently" control of an explain or worked-example step. A lens already written opens its latest
 * version at once; "Another version" asks for a new one.
 */
export function ExplainDifferently({ stepId, kind, initial }: { stepId: string; kind: "explain" | "worked_example"; initial: AlternativeView[] }) {
  useLang();
  const [written, setWritten] = useState(initial);
  const [shown, setShown] = useState<string[]>([]);
  const [pending, setPending] = useState<ExplainLens | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const latest = (lens: ExplainLens) => written.findLast((a) => a.lens === lens);
  const shownOf = (lens: ExplainLens) => shown.find((id) => written.find((a) => a.id === id)?.lens === lens);

  const reveal = (alt: AlternativeView) => {
    setShown((ids) => {
      const at = ids.findIndex((id) => written.find((a) => a.id === id)?.lens === alt.lens);
      return at === -1 ? [...ids, alt.id] : ids.map((id, i) => (i === at ? alt.id : id));
    });
    setFocused(alt.id);
  };

  const write = async (lens: ExplainLens) => {
    setOpen(false);
    setPending(lens);
    setError(null);
    try {
      const alt = await api.explainDifferently(stepId, lens);
      setWritten((all) => [...all, alt]);
      reveal(alt);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setPending(null);
    }
  };

  const pick = (lens: ExplainLens) => {
    const stored = latest(lens);
    if (!stored) return void write(lens);
    setOpen(false);
    reveal(stored);
  };

  return (
    <section aria-label={t("explain.region")} {...stylex.props(s.wrap)}>
      {shown.map((id) => {
        const alt = written.find((a) => a.id === id)!;
        return (
          <AlternativeCard
            key={id}
            alt={alt}
            busy={pending === alt.lens}
            disabled={pending !== null}
            focus={focused === id}
            onAgain={() => void write(alt.lens)}
            onHide={() => setShown((ids) => ids.filter((x) => x !== id))}
          />
        );
      })}
      {pending && !shownOf(pending) && (
        <div role="status" {...stylex.props(s.card)}>
          <p {...stylex.props(s.title)}>
            <Spinner /> {t("explain.title", { lens: t(LABEL[pending]) })}
          </p>
          <p {...stylex.props(text.small, text.muted)}>{t("explain.writing", { lens: t(LABEL[pending]) })}</p>
          <Skeleton lines={3} />
        </div>
      )}
      {pending && shownOf(pending) && (
        <p role="status" {...stylex.props(layout.srOnly)}>
          {t("explain.writing", { lens: t(LABEL[pending]) })}
        </p>
      )}
      {error && (
        <p role="alert" {...stylex.props(text.error)}>
          {error}
        </p>
      )}
      <div {...stylex.props(layout.row)}>
        <button type="button" aria-expanded={open} aria-controls={menuId} onClick={() => setOpen((o) => !o)} {...stylex.props(btn.base, btn.soft, btn.sm)}>
          <Lightbulb size={16} aria-hidden="true" /> {t("explain.open")}
        </button>
      </div>
      {open && (
        <ul id={menuId} aria-label={t("explain.pick")} {...stylex.props(s.lenses)}>
          {lensesFor(kind).map((lens) => {
            const ready = latest(lens) !== undefined;
            return (
              <li key={lens}>
                <button type="button" disabled={pending !== null} onClick={() => pick(lens)} {...stylex.props(s.lens)}>
                  <span {...stylex.props(s.lensName)}>
                    {t(LABEL[lens])}
                    {ready && (
                      <>
                        <Check size={14} aria-hidden="true" {...stylex.props(s.ready)} />
                        <span {...stylex.props(layout.srOnly)}>{t("explain.ready")}</span>
                      </>
                    )}
                  </span>
                  <span {...stylex.props(s.lensHint)}>{t(HINT[lens])}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function AlternativeCard({
  alt,
  busy,
  disabled,
  focus,
  onAgain,
  onHide,
}: {
  alt: AlternativeView;
  busy: boolean;
  disabled: boolean;
  focus: boolean;
  onAgain: () => void;
  onHide: () => void;
}) {
  useLang();
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (focus) ref.current?.focus();
  }, [focus]);
  return (
    <article aria-busy={busy} {...stylex.props(s.card)}>
      <div {...stylex.props(s.head)}>
        <h3 ref={ref} tabIndex={-1} {...stylex.props(s.title)}>
          {busy ? <Spinner /> : <Lightbulb size={16} aria-hidden="true" />} {t("explain.title", { lens: t(LABEL[alt.lens]) })}
        </h3>
        <div {...stylex.props(s.actions)}>
          <button type="button" disabled={disabled} onClick={onAgain} {...stylex.props(btn.base, btn.plain, btn.sm)}>
            <RotateCcw size={14} aria-hidden="true" /> {t("explain.again")}
          </button>
          <button type="button" aria-label={t("explain.hide")} title={t("explain.hide")} onClick={onHide} {...stylex.props(btn.base, btn.icon, btn.iconSm)}>
            <X size={15} aria-hidden="true" />
          </button>
        </div>
      </div>
      <div {...stylex.props(busy && s.busy)}>
        <Markdown src={alt.body} xstyle={s.body} />
      </div>
    </article>
  );
}
