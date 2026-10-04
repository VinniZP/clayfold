import * as stylex from "@stylexjs/stylex";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { GlossaryEntry } from "@shared/api";
import { glossaryScope, lookupTerm } from "../lib/glossary";
import { t, useLang } from "../lib/i18n";
import { color, font, radius, reading } from "../theme/tokens.stylex";
import { shadow } from "../theme/ui";

const WIDTH = 320;
const GAP = 8;
const EDGE = 12;
const SHOW_DELAY_MS = 150;
const HIDE_DELAY_MS = 150;

const s = stylex.create({
  pop: {
    position: "fixed",
    zIndex: 200,
    display: "grid",
    gap: 6,
    width: WIDTH,
    maxWidth: `calc(100vw - ${EDGE * 2}px)`,
    paddingBlock: 14,
    paddingInline: 16,
    borderRadius: radius.inner,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: color.border,
    backgroundColor: color.surface,
    color: color.text,
    fontFamily: reading.font,
    fontSize: `calc(14.5px * ${reading.scale})`,
    lineHeight: 1.45,
  },
  head: { display: "flex", flexWrap: "wrap", alignItems: "baseline", columnGap: 8, rowGap: 2 },
  term: { fontFamily: font.display, fontSize: 16, fontWeight: 800 },
  meta: { fontSize: 13, color: color.textMuted },
});

type Anchor = { getBoundingClientRect(): DOMRect };

type Shown = { term: string; entry: GlossaryEntry | null; top?: number; bottom?: number; left: number };

const termOf = (target: EventTarget | null) => (target instanceof Element ? target.closest<HTMLElement>(".term[data-term]") : null);

let showAt: ((term: string, anchor: Anchor) => void) | null = null;

/** Shows the definition of `term` next to `anchor`, such as a selected range, as for a term mark. */
export function showTermDefinition(term: string, anchor: Anchor) {
  showAt?.(term, anchor);
}

/** One popover for the whole app: the definition of a glossary term mark under the pointer, focus or tap. */
export function TermPopover() {
  useLang();
  const id = useId();
  const [shown, setShown] = useState<Shown | null>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const current = useRef<Anchor | null>(null);

  useEffect(() => {
    let showTimer: ReturnType<typeof setTimeout> | undefined;
    let hideTimer: ReturnType<typeof setTimeout> | undefined;

    const unlink = () => {
      if (current.current instanceof HTMLElement) current.current.removeAttribute("aria-describedby");
    };
    const hide = () => {
      clearTimeout(showTimer);
      unlink();
      current.current = null;
      setShown(null);
    };
    const show = async (anchor: Anchor, term: string) => {
      clearTimeout(hideTimer);
      if (current.current === anchor) return;
      unlink();
      current.current = anchor;
      const entry = await lookupTerm(term).catch(() => null);
      if (current.current !== anchor) return;
      const r = anchor.getBoundingClientRect();
      const left = Math.max(EDGE, Math.min(r.left, window.innerWidth - WIDTH - EDGE));
      const below = window.innerHeight - r.bottom > 180 || r.top < 180;
      if (anchor instanceof HTMLElement) anchor.setAttribute("aria-describedby", id);
      setShown(below ? { term, entry, top: r.bottom + GAP, left } : { term, entry, bottom: window.innerHeight - r.top + GAP, left });
    };
    // Deferred past the event that asked for it, whose click would otherwise close it at once.
    showAt = (term, anchor) => {
      clearTimeout(showTimer);
      showTimer = setTimeout(() => void show(anchor, term));
    };
    const hideSoon = () => {
      clearTimeout(showTimer);
      clearTimeout(hideTimer);
      hideTimer = setTimeout(hide, HIDE_DELAY_MS);
    };

    const onOver = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      if (popRef.current?.contains(e.target as Node)) return clearTimeout(hideTimer);
      const el = termOf(e.target);
      if (!el) return;
      clearTimeout(hideTimer);
      clearTimeout(showTimer);
      showTimer = setTimeout(() => void show(el, el.dataset.term!), SHOW_DELAY_MS);
    };
    const onOut = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      const to = e.relatedTarget as Node | null;
      if (termOf(e.target) || popRef.current?.contains(e.target as Node)) {
        if (to && (termOf(to) === current.current || popRef.current?.contains(to))) return;
        hideSoon();
      }
    };
    const onFocusIn = (e: FocusEvent) => {
      const el = termOf(e.target);
      if (el) void show(el, el.dataset.term!);
    };
    const onFocusOut = (e: FocusEvent) => {
      if (termOf(e.target)) hideSoon();
    };
    const onClick = (e: MouseEvent) => {
      const el = termOf(e.target);
      if (el) {
        if (current.current === el) hide();
        else void show(el, el.dataset.term!);
      } else if (!popRef.current?.contains(e.target as Node)) hide();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !current.current) return;
      // Consumed: the Escape that closes a definition does not also leave lesson focus mode.
      e.preventDefault();
      hide();
    };

    document.addEventListener("pointerover", onOver);
    document.addEventListener("pointerout", onOut);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      showAt = null;
      clearTimeout(showTimer);
      clearTimeout(hideTimer);
      document.removeEventListener("pointerover", onOver);
      document.removeEventListener("pointerout", onOut);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, [id]);

  if (!shown) return null;
  const { entry } = shown;
  const otherCourse = entry && glossaryScope() && entry.topicId !== glossaryScope();
  return createPortal(
    <div
      ref={popRef}
      id={id}
      role="tooltip"
      style={{ top: shown.top, bottom: shown.bottom, left: shown.left }}
      {...stylex.props(s.pop, shadow.pop)}
    >
      <div {...stylex.props(s.head)}>
        <span {...stylex.props(s.term)}>{entry?.term ?? shown.term}</span>
        {entry?.original && <span {...stylex.props(s.meta)}>{entry.original}</span>}
      </div>
      <p>{entry ? entry.definition : t("glossary.missing")}</p>
      {otherCourse && <p {...stylex.props(s.meta)}>{t("glossary.fromCourse", { course: entry.topicTitle })}</p>}
    </div>,
    document.body,
  );
}
