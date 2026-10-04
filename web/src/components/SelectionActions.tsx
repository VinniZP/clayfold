import * as stylex from "@stylexjs/stylex";
import { BookA, Check, Copy, MessageCircle, MessageSquarePlus, NotebookPen, X } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { GlossaryEntry, NoteRequest } from "@shared/api";
import { api, errorText } from "../lib/api";
import { lookupTerm, matchTerm } from "../lib/glossary";
import { t, useLang } from "../lib/i18n";
import { bp, color, font, motion, radius } from "../theme/tokens.stylex";
import { btn, field, layout, shadow, text } from "../theme/ui";
import { showTermDefinition } from "./TermPopover";
import { Spinner } from "./ui";

const QUOTE_MAX = 1500;

const GAP = 10;
const EDGE = 12;
const SETTLE_MS = 180;
// A tap on the toolbar can collapse the page selection before the tap's click arrives.
const PRESS_GRACE_MS = 800;
const TERM_MAX_WORDS = 5;
const TERM_MAX_CHARS = 60;
// ItemView keeps its answer widgets in a fieldset.
const NO_ACTIONS = "input, textarea, select, button, fieldset, [contenteditable]";
const BLOCK = "p, li, td, th, dd, dt, blockquote, figcaption, h1, h2, h3, h4, h5, h6, pre";
const SHORTCUT = /Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌥A" : "Alt+A";

/** What the learner selected; itemId names the practice item it lies in, when the tutor may discuss that item. */
export type SelectedText = { quote: string; itemId?: string };

type Picked = SelectedText & {
  range: Range;
  /** The glossary term to look up: the mark the selection lies in, or the selected words when they are short enough. */
  term: { text: string; marked: boolean } | null;
  /** The paragraph around the selection, for defining a word in context. */
  context: string;
};

type Mode = "actions" | "saving" | "saved" | "comment";

const appear = stylex.keyframes({ from: { opacity: 0, transform: "translateY(4px) scale(0.98)" } });

const s = stylex.create({
  bar: {
    position: "fixed",
    zIndex: 150,
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 2,
    maxWidth: `calc(100vw - ${EDGE * 2}px)`,
    padding: 4,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: color.border,
    backgroundColor: color.surface,
    color: color.text,
    fontFamily: font.body,
    animationName: { default: appear, [bp.reduce]: "none" },
    animationDuration: motion.fast,
    animationTimingFunction: motion.ease,
  },
  barForm: { borderRadius: radius.inner, padding: 8, gap: 8, width: 360 },
  tool: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    height: 36,
    paddingInline: 12,
    borderWidth: 0,
    borderRadius: radius.pill,
    backgroundColor: { default: "transparent", ":hover": color.surface2 },
    color: color.text,
    fontFamily: font.body,
    fontSize: 13.5,
    fontWeight: 650,
    whiteSpace: "nowrap",
    cursor: "pointer",
    transitionProperty: "background-color",
    transitionDuration: motion.fast,
  },
  toolOff: { opacity: 0.45, cursor: "not-allowed", backgroundColor: { default: "transparent", ":hover": "transparent" } },
  toolDone: { color: color.success },
  label: { display: { default: "inline", [bp.phone]: "none" } },
  saved: { paddingInline: 10 },
  form: { display: "flex", gap: 6, flexGrow: 1, minWidth: 0 },
  input: { flexGrow: 1, minWidth: 0, height: 40, paddingBlock: 0, fontSize: 14 },
  error: { flexBasis: "100%", paddingInline: 10, paddingBottom: 4, fontSize: 13 },
});

const squash = (str: string) => str.replace(/\s+/g, " ").trim();
/** Selected text cut to the longest quote a note or a tutor question keeps. */
export const clipQuote = (str: string) => (str.length > QUOTE_MAX ? `${str.slice(0, QUOTE_MAX - 1)}…` : str);
const elementOf = (node: Node) => (node instanceof Element ? node : node.parentElement);
const coarsePointer = () => window.matchMedia("(pointer: coarse)").matches;

function samePlace(a: Range, b: Range): boolean {
  return a.compareBoundaryPoints(Range.START_TO_START, b) === 0 && a.compareBoundaryPoints(Range.END_TO_END, b) === 0;
}

/** The page selection when it lies in one of `roots` and outside answer widgets and fields. */
function readSelection(roots: RefObject<HTMLElement | null>[]): Picked | null {
  const sel = document.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  const raw = sel.toString();
  const flat = squash(raw);
  if (!flat) return null;
  if (!roots.some((r) => r.current?.contains(range.commonAncestorContainer))) return null;
  if ([range.startContainer, range.endContainer].some((n) => elementOf(n)?.closest(NO_ACTIONS))) return null;
  const host = elementOf(range.commonAncestorContainer);
  const mark = host?.closest<HTMLElement>(".term[data-term]");
  const short = flat.split(" ").length <= TERM_MAX_WORDS && flat.length <= TERM_MAX_CHARS;
  const block = squash(elementOf(range.startContainer)?.closest(BLOCK)?.textContent ?? "");
  return {
    quote: clipQuote(raw.replace(/\s*\n\s*/g, "\n").replace(/[^\S\n]+/g, " ").trim()),
    itemId: host?.closest<HTMLElement>("[data-tutor-item]")?.dataset.tutorItem,
    range: range.cloneRange(),
    term: mark ? { text: mark.dataset.term!, marked: true } : short ? { text: flat, marked: false } : null,
    context: block.includes(flat) && block.length <= QUOTE_MAX ? block : clipQuote(flat),
  };
}

type Props = {
  /** Containers whose text the actions work on. */
  roots: RefObject<HTMLElement | null>[];
  /** Why the tutor takes no questions here (L11), or null when it does. */
  tutorBlocked: string | null;
  /** Where a saved note belongs; null hides the note action. */
  noteTarget: Omit<NoteRequest, "quote" | "text"> | null;
  onAsk: (sel: SelectedText) => void;
  /** Asks the tutor what `term` means, with the paragraph around it as the quote. */
  onDefine: (sel: SelectedText & { term: string }) => void;
};

/**
 * A toolbar next to text the learner selects in `roots`: ask the tutor about it, save it as a note,
 * define it from the glossary or through the tutor, copy it. Alt+A (⌥A) moves focus to it, Escape closes it.
 */
export function SelectionActions({ roots, tutorBlocked, noteTarget, onAsk, onDefine }: Props) {
  useLang();
  const hintId = useId();
  const commentId = useId();
  const [picked, setPicked] = useState<Picked | null>(null);
  const [mode, setMode] = useState<Mode>("actions");
  const [entry, setEntry] = useState<GlossaryEntry | null | undefined>(undefined);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [noteId, setNoteId] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const barRef = useRef<HTMLDivElement>(null);
  const rootsRef = useRef(roots);
  rootsRef.current = roots;
  const pickedRef = useRef(picked);
  pickedRef.current = picked;
  const engaged = useRef(false);
  engaged.current = mode !== "actions";
  const pressedAt = useRef(0);
  const returnFocus = useRef<HTMLElement | null>(null);
  const lookup = useRef<Promise<GlossaryEntry | null>>(Promise.resolve(null));

  const close = () => {
    const focusInside = !!barRef.current?.contains(document.activeElement);
    setPicked(null);
    setMode("actions");
    if (focusInside) returnFocus.current?.focus({ preventScroll: true });
    returnFocus.current = null;
  };
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let mouseDown = false;
    const update = () => {
      if (engaged.current) return;
      const next = readSelection(rootsRef.current);
      if (!next && (Date.now() - pressedAt.current < PRESS_GRACE_MS || barRef.current?.contains(document.activeElement))) return;
      setPicked((prev) => (prev && next && prev.quote === next.quote && samePlace(prev.range, next.range) ? prev : next));
    };
    const settle = () => {
      clearTimeout(timer);
      timer = setTimeout(update, SETTLE_MS);
    };
    const onSelection = () => {
      if (!mouseDown) settle();
    };
    const onDown = (e: PointerEvent) => {
      if (barRef.current?.contains(e.target as Node)) {
        pressedAt.current = Date.now();
        return;
      }
      if (e.pointerType === "mouse") mouseDown = true;
      if (engaged.current) closeRef.current();
    };
    const onUp = () => {
      if (!mouseDown) return;
      mouseDown = false;
      settle();
    };
    const onKey = (e: KeyboardEvent) => {
      if (!pickedRef.current) return;
      if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === "KeyA") {
        e.preventDefault();
        const active = document.activeElement;
        if (!barRef.current?.contains(active)) returnFocus.current = active instanceof HTMLElement ? active : null;
        barRef.current?.querySelector<HTMLElement>("[data-tool], input")?.focus();
      } else if (e.key === "Escape") {
        closeRef.current();
      }
    };
    document.addEventListener("selectionchange", onSelection);
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("pointerup", onUp, true);
    document.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("selectionchange", onSelection);
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("pointerup", onUp, true);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  // A new selection starts over: its own glossary lookup, no leftover note or message.
  useEffect(() => {
    setCopied(false);
    setError(null);
    setNoteId(null);
    setComment("");
    setEntry(undefined);
    if (picked) setStatus(t("selection.hint", { shortcut: SHORTCUT }));
    if (!picked?.term) {
      lookup.current = Promise.resolve(null);
      return;
    }
    const { text: term, marked } = picked.term;
    let live = true;
    lookup.current = (marked ? lookupTerm(term) : matchTerm(term)).catch(() => null);
    void lookup.current.then((found) => live && setEntry(found));
    return () => {
      live = false;
    };
  }, [picked]);

  // Keeps the toolbar next to the selection: above it, or below it on touch screens, where the system menu sits above.
  const place = () => {
    const bar = barRef.current;
    const p = pickedRef.current;
    if (!bar || !p) return;
    const rects = p.range.getClientRects();
    const box = p.range.getBoundingClientRect();
    if (rects.length === 0) return closeRef.current();
    const first = rects[0]!;
    const last = rects[rects.length - 1]!;
    const { width, height } = bar.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    const roomAbove = first.top - GAP - height >= EDGE;
    const roomBelow = last.bottom + GAP + height <= vh - EDGE;
    const below = coarsePointer() ? roomBelow || !roomAbove : !roomAbove && roomBelow;
    const top = below ? last.bottom + GAP : first.top - GAP - height;
    const left = box.left + box.width / 2 - width / 2;
    bar.style.top = `${Math.round(Math.min(Math.max(top, EDGE), vh - height - EDGE))}px`;
    bar.style.left = `${Math.round(Math.max(EDGE, Math.min(left, vw - width - EDGE)))}px`;
    bar.style.visibility = box.bottom < 0 || box.top > vh ? "hidden" : "visible";
  };
  useLayoutEffect(place);
  useEffect(() => {
    if (!picked) return;
    let frame = 0;
    const follow = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(place);
    };
    window.addEventListener("scroll", follow, true);
    window.addEventListener("resize", follow);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", follow, true);
      window.removeEventListener("resize", follow);
    };
  }, [picked]);

  const live = (
    <p role="status" {...stylex.props(layout.srOnly)}>
      {status}
    </p>
  );
  if (!picked) return <>{live}{null}</>;

  const askOff = tutorBlocked !== null;
  const defineOff = entry === null && askOff;

  const ask = () => {
    onAsk({ quote: picked.quote, itemId: picked.itemId });
    close();
  };

  const saveNote = async () => {
    if (!noteTarget) return;
    setMode("saving");
    setError(null);
    try {
      const note = await api.addNote({ ...noteTarget, quote: picked.quote, text: "" });
      setNoteId(note.id);
      setMode("saved");
      setStatus(t("selection.noteSaved"));
    } catch (err) {
      setError(errorText(err));
      setMode("actions");
    }
  };

  const saveComment = async () => {
    if (!noteId || !comment.trim()) return;
    setMode("saving");
    setError(null);
    try {
      await api.editNote(noteId, comment.trim());
      setStatus(t("selection.commentSaved"));
      close();
    } catch (err) {
      setError(errorText(err));
      setMode("comment");
    }
  };

  const define = async () => {
    const found = await lookup.current;
    if (found) {
      showTermDefinition(found.term, picked.range);
      setStatus(t("selection.definition", { term: found.term, definition: found.definition }));
      close();
    } else if (!askOff && picked.term) {
      onDefine({ term: picked.term.text, quote: picked.context, itemId: picked.itemId });
      close();
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(picked.quote);
      setCopied(true);
      setStatus(t("selection.copied"));
    } catch {
      setError(t("selection.copyFailed"));
    }
  };

  const onToolKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const tools = [...(barRef.current?.querySelectorAll<HTMLElement>("[data-tool]") ?? [])];
    const at = tools.indexOf(document.activeElement as HTMLElement);
    if (at === -1) return;
    const to = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: tools.length - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    tools[(to + tools.length) % tools.length]?.focus();
  };

  const tool = (props: { label: string; icon: ReactNode; onClick: () => void; off?: string | null; title?: string; done?: boolean; first?: boolean }) => (
    <button
      type="button"
      data-tool=""
      tabIndex={props.first ? 0 : -1}
      aria-label={props.label}
      aria-disabled={props.off ? true : undefined}
      title={props.off ?? props.title}
      onClick={() => !props.off && props.onClick()}
      {...stylex.props(s.tool, !!props.off && s.toolOff, props.done && s.toolDone)}
    >
      {props.icon}
      <span aria-hidden="true" {...stylex.props(s.label)}>
        {props.label}
      </span>
    </button>
  );

  const bar = (
    <div
      ref={barRef}
      role={mode === "actions" ? "toolbar" : "group"}
      aria-label={t("selection.toolbar")}
      aria-describedby={hintId}
      title={t("selection.hint", { shortcut: SHORTCUT })}
      style={{ top: 0, left: 0, visibility: "hidden" }}
      onKeyDown={onToolKey}
      onMouseDown={(e) => {
        if (!(e.target instanceof HTMLInputElement)) e.preventDefault();
      }}
      {...stylex.props(s.bar, mode === "comment" && s.barForm, shadow.pop)}
    >
      <span id={hintId} hidden>
        {t("selection.hint", { shortcut: SHORTCUT })}
      </span>
      {mode === "actions" ? (
        <>
          {tool({ label: t("item.askTutor"), icon: <MessageCircle size={16} aria-hidden="true" />, onClick: ask, off: tutorBlocked, first: true })}
          {noteTarget && tool({ label: t("selection.note"), icon: <NotebookPen size={16} aria-hidden="true" />, onClick: () => void saveNote() })}
          {picked.term &&
            tool({
              label: t("selection.define"),
              icon: <BookA size={16} aria-hidden="true" />,
              onClick: () => void define(),
              off: defineOff ? tutorBlocked : null,
              title: entry === null ? t("selection.defineViaTutor") : undefined,
            })}
          {tool({
            label: copied ? t("selection.copied") : t("selection.copy"),
            icon: copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />,
            onClick: () => void copy(),
            done: copied,
          })}
        </>
      ) : mode === "saving" ? (
        <span {...stylex.props(s.tool, s.saved)}>
          <Spinner /> {t("selection.saving")}
        </span>
      ) : mode === "saved" ? (
        <>
          <span {...stylex.props(s.tool, s.saved, s.toolDone)}>
            <Check size={16} aria-hidden="true" /> {t("selection.noteSaved")}
          </span>
          {tool({ label: t("selection.addComment"), icon: <MessageSquarePlus size={16} aria-hidden="true" />, onClick: () => setMode("comment"), first: true })}
          <button type="button" data-tool="" tabIndex={-1} aria-label={t("selection.close")} onClick={close} {...stylex.props(btn.base, btn.icon, btn.iconSm)}>
            <X size={14} aria-hidden="true" />
          </button>
        </>
      ) : (
        <form
          {...stylex.props(s.form)}
          onSubmit={(e) => {
            e.preventDefault();
            void saveComment();
          }}
        >
          <label htmlFor={commentId} {...stylex.props(layout.srOnly)}>
            {t("selection.comment")}
          </label>
          <input
            id={commentId}
            value={comment}
            autoFocus
            autoComplete="off"
            maxLength={8000}
            placeholder={t("selection.commentPlaceholder")}
            onChange={(e) => setComment(e.target.value)}
            {...stylex.props(field.input, s.input)}
          />
          <button type="submit" disabled={!comment.trim()} {...stylex.props(btn.base, btn.primary, btn.sm)}>
            {t("selection.saveComment")}
          </button>
        </form>
      )}
      {error && (
        <p role="alert" {...stylex.props(text.error, s.error)}>
          {error}
        </p>
      )}
    </div>
  );

  return (
    <>
      {live}
      {createPortal(bar, document.body)}
    </>
  );
}
