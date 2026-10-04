import * as stylex from "@stylexjs/stylex";
import { X } from "lucide-react";
import { Fragment, useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { MessageKey } from "@shared/i18n";
import { t, useLang } from "../lib/i18n";
import { useOverlayScroll } from "../lib/overlayScroll";
import { shortcutPage, useKeyHints, useShortcuts, type ShortcutPage } from "../lib/shortcuts";
import { bp, color, font, radius } from "../theme/tokens.stylex";
import { btn, shadow, text } from "../theme/ui";

const s = stylex.create({
  hint: {
    display: { default: "none", [bp.finePointer]: "inline-grid" },
    placeItems: "center",
    flexShrink: 0,
    minWidth: 22,
    height: 22,
    paddingInline: 5,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "currentColor",
    borderRadius: 7,
    fontFamily: font.mono,
    fontSize: 12,
    fontWeight: 600,
    lineHeight: 1,
    opacity: 0.55,
  },
  dialog: {
    width: "min(620px, calc(100vw - 32px))",
    maxHeight: "calc(100vh - 48px)",
    padding: 0,
    borderWidth: 0,
    borderRadius: radius.card,
    backgroundColor: color.surface,
    color: color.text,
    overflowY: "auto",
    "::backdrop": { backgroundColor: color.scrim },
  },
  body: { display: "grid", gap: 22, padding: { default: 28, [bp.phone]: 20 } },
  head: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 },
  title: { fontFamily: font.display, fontSize: 24, fontWeight: 800, letterSpacing: "-0.01em" },
  section: { display: "grid", gap: 10 },
  rows: { display: "grid", gap: 8, margin: 0 },
  row: {
    display: "grid",
    gridTemplateColumns: { default: "minmax(150px, max-content) minmax(0, 1fr)", [bp.phone]: "minmax(0, 1fr)" },
    gap: { default: 16, [bp.phone]: 4 },
    alignItems: "baseline",
  },
  keys: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 4, color: color.textMuted, fontSize: 13 },
  desc: { margin: 0 },
  key: {
    display: "inline-grid",
    placeItems: "center",
    minWidth: 26,
    height: 26,
    paddingInline: 7,
    borderRadius: 8,
    backgroundColor: color.surface2,
    boxShadow: `inset 0 -1.5px 0 ${color.borderStrong}`,
    color: color.text,
    fontFamily: font.mono,
    fontSize: 12.5,
    fontWeight: 600,
  },
});

/** A key badge on an option or a primary button; shown with a fine pointer and while the setting is on. */
export function KeyHint({ children }: { children: ReactNode }) {
  const on = useKeyHints();
  if (!on) return null;
  return (
    <kbd aria-hidden="true" {...stylex.props(s.hint)}>
      {children}
    </kbd>
  );
}

type Section = "general" | "answer" | "order" | "lesson" | "review";
type Row = { keys: string[][]; label: MessageKey };

const PAGE_SECTIONS: Record<ShortcutPage, Section[]> = {
  lesson: ["lesson", "answer", "order"],
  review: ["review", "answer", "order"],
};

const MAC = /Mac|iPhone|iPad/.test(navigator.userAgent);

function rows(section: Section): Row[] {
  const enter = t("keys.enter");
  const esc = t("keys.esc");
  const space = t("keys.space");
  const alt = MAC ? "⌥" : t("keys.alt");
  const ctrl = MAC ? "⌘" : t("keys.ctrl");
  switch (section) {
    case "general":
      return [
        { keys: [["?"]], label: "keys.help" },
        { keys: [[esc]], label: "keys.escape" },
      ];
    case "answer":
      return [
        { keys: [["1–9"]], label: "keys.choose" },
        { keys: [[enter]], label: "keys.submit" },
        { keys: [[ctrl, enter]], label: "keys.submitText" },
        { keys: [["H"]], label: "keys.hint" },
        { keys: [["G"]], label: "keys.giveUp" },
      ];
    case "order":
      return [
        { keys: [["↑"], ["↓"]], label: "keys.orderFocus" },
        { keys: [[space]], label: "keys.orderGrab" },
        { keys: [[alt, "↑"], [alt, "↓"]], label: "keys.orderMove" },
        { keys: [[esc]], label: "keys.orderCancel" },
      ];
    case "lesson":
      return [
        { keys: [["J"], [alt, "↓"]], label: "keys.nextStep" },
        { keys: [["K"], [alt, "↑"]], label: "keys.prevStep" },
        { keys: [["T"]], label: "keys.tutor" },
        { keys: [["N"]], label: "keys.note" },
        { keys: [["L"]], label: "keys.narration" },
        { keys: [["F"]], label: "keys.focus" },
      ];
    case "review":
      return [
        { keys: [[space], [enter]], label: "keys.reveal" },
        { keys: [["1–4"]], label: "keys.rate" },
        { keys: [[enter]], label: "keys.reviewNext" },
      ];
  }
}

function Keys({ keys }: { keys: string[][] }) {
  return keys.map((combo, i) => (
    <Fragment key={i}>
      {i > 0 && <span>{t("keys.or")}</span>}
      {combo.map((k, j) => (
        <Fragment key={j}>
          {j > 0 && <span aria-hidden="true">+</span>}
          <kbd {...stylex.props(s.key)}>{k}</kbd>
        </Fragment>
      ))}
    </Fragment>
  ));
}

let openSheet: (() => void) | null = null;

/** Opens the shortcut sheet, as the ? key does. */
export const showShortcuts = () => openSheet?.();

/** The modal list of the shortcuts of the current page and the global ones, opened with ?. */
export function ShortcutSheet() {
  useLang();
  const dialog = useRef<HTMLDialogElement>(null);
  const [sections, setSections] = useState<Section[] | null>(null);
  const titleId = useId();
  useOverlayScroll(dialog, sections !== null);

  useEffect(() => {
    const open = () => {
      const page = shortcutPage();
      setSections([...(page ? PAGE_SECTIONS[page] : []), "general"]);
    };
    openSheet = open;
    return () => {
      if (openSheet === open) openSheet = null;
    };
  }, []);

  // Opened once the content is in, so the dialog focuses its close button.
  useEffect(() => {
    if (sections && !dialog.current?.open) dialog.current?.showModal();
  }, [sections]);

  useShortcuts("page", (a) => {
    if (a.name !== "help") return false;
    showShortcuts();
    return true;
  });

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      onClose={() => setSections(null)}
      onClick={(e) => e.target === e.currentTarget && e.currentTarget.close()}
      {...stylex.props(s.dialog, shadow.pop)}
    >
      {sections && (
        <div {...stylex.props(s.body)}>
          <div {...stylex.props(s.head)}>
            <h2 id={titleId} {...stylex.props(s.title)}>
              {t("keys.title")}
            </h2>
            <button type="button" aria-label={t("keys.close")} onClick={() => dialog.current?.close()} {...stylex.props(btn.base, btn.icon)}>
              <X size={20} aria-hidden="true" />
            </button>
          </div>
          {sections.map((section) => (
            <section key={section} aria-labelledby={`${titleId}-${section}`} {...stylex.props(s.section)}>
              <h3 id={`${titleId}-${section}`} {...stylex.props(text.h3)}>
                {t(`keys.section.${section}`)}
              </h3>
              <dl {...stylex.props(s.rows)}>
                {rows(section).map((r) => (
                  <div key={r.label} {...stylex.props(s.row)}>
                    <dt {...stylex.props(s.keys)}>
                      <Keys keys={r.keys} />
                    </dt>
                    <dd {...stylex.props(s.desc)}>{t(r.label)}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
          <p {...stylex.props(text.small, text.muted)}>{t("keys.layoutNote")}</p>
        </div>
      )}
    </dialog>
  );
}
