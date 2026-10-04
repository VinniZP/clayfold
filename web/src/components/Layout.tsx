import * as stylex from "@stylexjs/stylex";
import { ArrowLeft, Bell, BookA, Brain, CircleArrowUp, House, Layers, Menu, Moon, PawPrint, Repeat2, Search, Settings, ShieldCheck, Snowflake, SquareTerminal, Sun, X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router";
import type { TodayView, TopicSummary, UpdateMode, UpdateView } from "@shared/api";
import { LANGS, translate, type Lang, type MessageKey } from "@shared/i18n";
import { api, errorText } from "../lib/api";
import { setClaudeMode, useClaudeMode } from "../lib/claudeMode";
import { refreshGame, useGame } from "../lib/game";
import { lang, setLang, t, useLang } from "../lib/i18n";
import { useOverlayScroll } from "../lib/overlayScroll";
import { setTheme, useTheme } from "../lib/theme";
import { bp, color, font, motion, radius } from "../theme/tokens.stylex";
import { btn, layout, shadow, text } from "../theme/ui";
import { AppRoot } from "./AppRoot";
import { ClaudePanel } from "./ClaudePanel";
import { Celebrations } from "./meerkat/Celebrations";
import { HeaderProvider, type HeaderInfo } from "./header";
import { Intro } from "./Intro";
import { Clay } from "./ui";

const pulse = stylex.keyframes({
  "0%": { transform: "scale(0.6)", opacity: 0.7 },
  "100%": { transform: "scale(1.8)", opacity: 0 },
});

const s = stylex.create({
  skip: {
    position: "absolute",
    left: 16,
    top: { default: -60, ":focus": 16 },
    zIndex: 100,
    paddingBlock: 10,
    paddingInline: 16,
    borderRadius: radius.pill,
    backgroundColor: color.primary,
    color: color.onPrimary,
    fontWeight: 650,
    textDecoration: "none",
  },
  frame: {
    display: "grid",
    gridTemplateColumns: { default: "96px minmax(0, 1fr)", [bp.mobile]: "minmax(0, 1fr)" },
    maxWidth: 1680,
    minHeight: { default: "calc(100vh - 48px)", [bp.mobile]: "100vh" },
    marginInline: "auto",
    borderRadius: { default: radius.frame, [bp.mobile]: 0 },
    backgroundColor: color.frame,
    boxShadow: `0 30px 80px -40px ${color.shadowStrong}`,
  },
  railCol: {
    display: { default: "block", [bp.mobile]: "none" },
    borderRightWidth: 1,
    borderRightStyle: "solid",
    borderRightColor: color.border,
  },
  rail: {
    position: "sticky",
    // Sticky makes a stacking context; lifting it keeps the rail tooltips above the page cards.
    zIndex: 30,
    top: 24,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 10,
    height: "calc(100vh - 48px)",
    paddingBlock: 28,
  },
  logo: { marginBottom: 18, borderRadius: 14 },
  railNav: { display: "grid", gap: 10 },
  railLink: {
    position: "relative",
    display: "grid",
    placeItems: "center",
    width: 54,
    height: 54,
    borderRadius: "50%",
    color: color.text,
    backgroundColor: { default: "transparent", ":hover": color.surface2 },
    transitionProperty: "background-color, color",
    transitionDuration: motion.fast,
  },
  railActive: { backgroundColor: { default: color.primary, ":hover": color.primaryHover }, color: color.onPrimary },
  tip: {
    position: "absolute",
    left: 64,
    top: "50%",
    zIndex: 20,
    paddingBlock: 6,
    paddingInline: 10,
    borderRadius: 10,
    backgroundColor: color.primary,
    color: color.onPrimary,
    fontSize: 13,
    fontWeight: 600,
    whiteSpace: "nowrap",
    pointerEvents: "none",
    opacity: { default: 0, [stylex.when.ancestor(":hover")]: 1, [stylex.when.ancestor(":focus-visible")]: 1 },
    transform: {
      default: "translate(-4px, -50%)",
      [stylex.when.ancestor(":hover")]: "translate(0, -50%)",
      [stylex.when.ancestor(":focus-visible")]: "translate(0, -50%)",
    },
    transitionProperty: "opacity, transform",
    transitionDuration: motion.fast,
  },
  badge: {
    position: "absolute",
    top: 2,
    right: 0,
    minWidth: 20,
    height: 20,
    paddingInline: 5,
    display: "grid",
    placeItems: "center",
    borderRadius: radius.pill,
    backgroundColor: color.peach,
    color: color.text,
    fontSize: 11.5,
    fontWeight: 750,
    fontVariantNumeric: "tabular-nums",
    boxShadow: `0 0 0 2px ${color.frame}`,
  },
  railFoot: { marginTop: "auto", display: "grid", gap: 8 },
  railEnd: { marginTop: "auto", display: "grid", justifyItems: "center", gap: 10 },
  modeToggle: { borderWidth: 0, cursor: "pointer" },
  modeSwitch: { width: "100%", borderWidth: 0, fontFamily: font.body, fontSize: "inherit", textAlign: "start", cursor: "pointer" },
  themeBtn: {
    display: "grid",
    placeItems: "center",
    width: 44,
    height: 44,
    borderWidth: 0,
    borderRadius: "50%",
    backgroundColor: { default: "transparent", ":hover": color.surface2 },
    color: color.textMuted,
  },
  langSwitch: { marginTop: 0 },
  langWrap: { position: "relative" },
  langError: {
    position: "absolute",
    left: 56,
    bottom: 0,
    zIndex: 20,
    width: 260,
    margin: 0,
    paddingBlock: 8,
    paddingInline: 12,
    borderRadius: 10,
    backgroundColor: color.dangerSoft,
    color: color.danger,
    fontSize: 13,
    fontWeight: 600,
  },
  langBtn: { fontSize: 12.5, fontWeight: 750, letterSpacing: "0.04em" },
  themeOn: { backgroundColor: { default: color.lilacSoft, ":hover": color.lilacSoft }, color: color.text },
  main: { minWidth: 0, display: "flex", flexDirection: "column", gap: 24, paddingBlock: { default: "28px 40px", [bp.mobile]: "12px 28px" }, paddingInline: { default: 32, [bp.tablet]: 24, [bp.mobile]: 16 }, outline: "none" },
  top: { display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" },
  wordmark: {
    fontFamily: font.display,
    fontSize: 26,
    fontWeight: 800,
    letterSpacing: "-0.02em",
    color: color.text,
    textDecoration: "none",
    marginRight: "auto",
    display: { default: "block", [bp.mobile]: "none" },
  },
  topTools: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", justifyContent: "flex-end", width: { default: "auto", [bp.mobile]: "100%" } },
  search: { position: "relative", flexGrow: { default: 0, [bp.mobile]: 1 } },
  searchIcon: { position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", color: color.textMuted, pointerEvents: "none" },
  searchInput: {
    width: { default: 260, [bp.mobile]: "100%" },
    height: 46,
    paddingInline: "44px 18px",
    borderWidth: 1.5,
    borderStyle: "solid",
    borderColor: { default: color.border, ":hover": color.borderStrong, ":focus-visible": color.focus },
    borderRadius: radius.pill,
    backgroundColor: color.surface,
    color: color.text,
    outline: { default: null, ":focus-visible": "none" },
    boxShadow: { default: null, ":focus-visible": `0 0 0 3px ${color.lilacSoft}` },
  },
  popover: {
    position: "absolute",
    zIndex: 30,
    top: "calc(100% + 8px)",
    right: 0,
    minWidth: "100%",
    padding: 6,
    borderRadius: 18,
    backgroundColor: color.surface,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: color.border,
    listStyle: "none",
    margin: 0,
  },
  popNote: { paddingBlock: 10, paddingInline: 12, color: color.textMuted, fontSize: 14 },
  option: { display: "flex", justifyContent: "space-between", gap: 12, paddingBlock: 10, paddingInline: 12, borderRadius: 12, cursor: "pointer", backgroundColor: { default: "transparent", ":hover": color.lilacSoft } },
  optionOn: { backgroundColor: color.lilacSoft },
  rel: { position: "relative" },
  dot: { position: "absolute", top: 10, right: 11, width: 9, height: 9, borderRadius: "50%", backgroundColor: color.chart2, boxShadow: `0 0 0 2px ${color.surface2}` },
  notifPop: { width: 300 },
  notifItem: { display: "flex", gap: 10, alignItems: "center", paddingBlock: 10, paddingInline: 12, borderRadius: 12, color: color.text, textDecoration: "none", fontSize: 14, backgroundColor: { default: "transparent", ":hover": color.surface2 } },
  pill: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    height: 46,
    paddingInline: "10px 18px",
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderStyle: "solid",
    borderColor: color.border,
    backgroundColor: color.surface,
    color: color.text,
    fontSize: 15,
    fontWeight: 600,
    textDecoration: "none",
    whiteSpace: "nowrap",
  },
  pillStrong: { fontWeight: 800 },
  pillFreeze: { display: "inline-flex", alignItems: "center", gap: 3, color: color.accentText },
  working: { backgroundColor: { default: color.lilacSoft, ":hover": color.lilac }, borderColor: "transparent", paddingInline: 16, maxWidth: 340 },
  workingCompact: { height: 36, paddingInline: 12, fontSize: 13 },
  workingWide: { display: { default: "inline-flex", [bp.mobile]: "none" } },
  workingText: { overflow: "hidden", textOverflow: "ellipsis" },
  workingTopic: { color: color.textMuted, fontWeight: 500 },
  updateWide: { display: { default: "block", [bp.mobile]: "none" } },
  updateBtn: { fontFamily: font.body, cursor: "pointer" },
  updatePop: {
    display: "grid",
    gap: 12,
    padding: 16,
    // On a phone the pill sits mid-bar, so the popover spans the screen below the bar instead.
    position: { default: "absolute", [bp.mobile]: "fixed" },
    top: { default: "calc(100% + 8px)", [bp.mobile]: 64 },
    left: { default: "auto", [bp.mobile]: 16 },
    right: { default: 0, [bp.mobile]: 16 },
    width: { default: 360, [bp.mobile]: "auto" },
    minWidth: { default: "100%", [bp.mobile]: 0 },
  },
  updateTitle: { margin: 0, fontSize: 15, fontWeight: 700 },
  updateList: { display: "grid", gap: 6, maxHeight: 220, overflowY: "auto", fontSize: 14 },
  updateSha: { marginInlineEnd: 8, fontFamily: font.mono, fontSize: 12.5, color: color.textMuted },
  updateNote: { margin: 0, fontSize: 14, color: color.textMuted },
  updateError: { margin: 0, fontSize: 14, color: color.danger, overflowWrap: "anywhere" },
  updateActions: { display: "flex", flexWrap: "wrap", gap: 8 },
  pulseDot: {
    position: "relative",
    flexShrink: 0,
    width: 9,
    height: 9,
    borderRadius: "50%",
    backgroundColor: color.accentText,
    "::after": {
      content: '""',
      position: "absolute",
      inset: -5,
      borderRadius: "50%",
      borderWidth: 2,
      borderStyle: "solid",
      borderColor: color.accentText,
      opacity: 0,
      animationName: pulse,
      animationDuration: "1.6s",
      animationTimingFunction: motion.ease,
      animationIterationCount: "infinite",
    },
  },
  head: { position: "relative", display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 24, minHeight: { default: 120, [bp.mobile]: 0 } },
  headText: { display: "grid", gap: 8, minWidth: 0, maxWidth: 980 },
  back: { display: "inline-flex", alignItems: "center", gap: 8, width: "fit-content", fontSize: 16, fontWeight: 600, color: color.text, textDecoration: { default: "none", ":hover": "underline" } },
  h1: { fontSize: { default: 56, [bp.tablet]: 44, [bp.mobile]: 32 } },
  sub: { fontSize: { default: 17, [bp.mobile]: 15 }, color: color.textMuted, maxWidth: "62ch" },
  headArt: { flexShrink: 0, display: { default: "block", [bp.tablet]: "none" }, marginBlock: -24, marginRight: -8 },
  mobileBar: {
    display: { default: "none", [bp.mobile]: "flex" },
    alignItems: "center",
    gap: 10,
    position: "sticky",
    top: 0,
    zIndex: 20,
    paddingBlock: 10,
    paddingInline: 16,
    backgroundColor: color.frame,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: color.border,
  },
  mobileWord: { fontFamily: font.display, fontSize: 21, fontWeight: 800, color: color.text, textDecoration: "none", marginRight: "auto", whiteSpace: "nowrap" },
  drawer: {
    position: "fixed",
    inset: "0 auto 0 0",
    width: "min(320px, 86vw)",
    height: "100%",
    maxHeight: "none",
    margin: 0,
    padding: 0,
    borderWidth: 0,
    backgroundColor: color.frame,
    color: color.text,
    "::backdrop": { backgroundColor: color.scrim },
  },
  drawerInner: { display: "flex", flexDirection: "column", gap: 24, height: "100%", padding: 18 },
  drawerHead: { display: "flex", alignItems: "center", justifyContent: "space-between" },
  drawerNav: { display: "grid", gap: 6 },
  drawerLink: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    minHeight: 50,
    paddingInline: 14,
    borderRadius: 18,
    color: color.text,
    textDecoration: "none",
    fontWeight: 600,
    backgroundColor: { default: "transparent", ":hover": color.surface2 },
  },
  drawerActive: { backgroundColor: { default: color.primary, ":hover": color.primary }, color: color.onPrimary },
  drawerBadge: { marginLeft: "auto", minWidth: 24, paddingInline: 7, borderRadius: radius.pill, backgroundColor: color.peach, color: color.text, fontSize: 12, fontWeight: 750, textAlign: "center" },
  themeSwitch: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, padding: 4, borderRadius: radius.pill, backgroundColor: color.surface2, marginTop: "auto" },
  themeSwitchBtn: { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, height: 40, borderWidth: 0, borderRadius: radius.pill, backgroundColor: "transparent", color: color.textMuted, fontSize: 14, fontWeight: 600 },
  themeSwitchOn: { backgroundColor: color.primary, color: color.onPrimary },
});

function LogoMark({ size = 44 }: { size?: number }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true" {...stylex.props(s.logo)}>
      <rect width="32" height="32" rx="10" fill="var(--primary)" />
      <rect x="7" y="19" width="6" height="6" rx="2" fill="var(--peach-soft)" />
      <rect x="13" y="13" width="6" height="12" rx="2" fill="var(--lilac-soft)" />
      <rect x="19" y="7" width="6" height="18" rx="2" fill="var(--pistachio-soft)" />
    </svg>
  );
}

// game: shown only while the meerkat is on.
const NAV: { to: string; label: MessageKey; icon: ReactNode; end?: boolean; due?: boolean; game?: boolean }[] = [
  { to: "/", label: "nav.home", icon: <House size={22} />, end: true },
  { to: "/topics", label: "nav.topics", icon: <Layers size={22} /> },
  { to: "/review", label: "nav.review", icon: <Repeat2 size={22} />, due: true },
  { to: "/memory", label: "nav.memory", icon: <Brain size={22} /> },
  { to: "/glossary", label: "nav.glossary", icon: <BookA size={22} /> },
  { to: "/meerkat", label: "nav.meerkat", icon: <PawPrint size={22} />, game: true },
  { to: "/audit", label: "nav.audit", icon: <ShieldCheck size={22} /> },
  { to: "/settings", label: "nav.settings", icon: <Settings size={22} /> },
];

const dueLabel = (n: number) => t("nav.due", { cards: t("count.cards", { count: n }) });

function Rail({ due }: { due: number }) {
  useLang();
  const theme = useTheme();
  const { on: game } = useGame();
  return (
    <aside data-print="hide" {...stylex.props(s.railCol)}>
      <div {...stylex.props(s.rail)}>
      <Link to="/" aria-label={t("nav.homeLink")}>
        <LogoMark />
      </Link>
      <nav aria-label={t("nav.sections")}>
        <ul {...stylex.props(layout.plainList, s.railNav)}>
          {NAV.filter((it) => game || !it.game).map((it) => (
            <li key={it.to}>
              <NavLink
                to={it.to}
                end={it.end}
                aria-label={it.due && due ? `${t(it.label)}: ${dueLabel(due)}` : t(it.label)}
                className={({ isActive }) => stylex.props(s.railLink, isActive && s.railActive, stylex.defaultMarker()).className ?? ""}
              >
                <span aria-hidden="true">{it.icon}</span>
                {it.due && due > 0 && (
                  <span {...stylex.props(s.badge)} aria-hidden="true">
                    {due}
                  </span>
                )}
                <span {...stylex.props(s.tip)} aria-hidden="true">
                  {t(it.label)}
                </span>
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <div {...stylex.props(s.railEnd)}>
        <ClaudeModeToggle />
        <div {...stylex.props(s.railFoot)} role="group" aria-label={t("theme.label")}>
          <button type="button" aria-pressed={theme === "light"} aria-label={t("theme.light")} title={t("theme.light")} onClick={() => setTheme("light")} {...stylex.props(s.themeBtn, theme === "light" && s.themeOn)}>
            <Sun size={20} aria-hidden="true" />
          </button>
          <button type="button" aria-pressed={theme === "dark"} aria-label={t("theme.dark")} title={t("theme.dark")} onClick={() => setTheme("dark")} {...stylex.props(s.themeBtn, theme === "dark" && s.themeOn)}>
            <Moon size={20} aria-hidden="true" />
          </button>
          <LangToggle />
        </div>
      </div>
      </div>
    </aside>
  );
}

function SearchBox() {
  useLang();
  const [query, setQuery] = useState("");
  const [topics, setTopics] = useState<TopicSummary[] | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const navigate = useNavigate();
  const listId = useId();
  const q = query.trim().toLowerCase();
  const results = q && topics ? topics.filter((t) => t.title.toLowerCase().includes(q)).slice(0, 6) : [];

  const go = (t: TopicSummary) => {
    setOpen(false);
    setQuery("");
    navigate(`/topics/${t.id}`);
  };

  return (
    <div {...stylex.props(s.search)} onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setOpen(false)}>
      <Search size={18} aria-hidden="true" {...stylex.props(s.searchIcon)} />
      <input
        type="search"
        role="combobox"
        aria-label={t("search.label")}
        aria-expanded={open && q.length > 0}
        aria-controls={listId}
        aria-activedescendant={results[active] ? `${listId}-${active}` : undefined}
        placeholder={t("search.label")}
        value={query}
        {...stylex.props(s.searchInput)}
        onFocus={() => {
          if (topics === null) api.topics().then(setTopics, () => setTopics([]));
          setOpen(true);
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, results.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter" && results[active]) {
            e.preventDefault();
            go(results[active]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {open && q && (
        <ul id={listId} role="listbox" aria-label={t("search.results")} {...stylex.props(s.popover, shadow.pop)}>
          {topics === null ? (
            <li {...stylex.props(s.popNote)}>{t("search.searching")}</li>
          ) : results.length === 0 ? (
            <li {...stylex.props(s.popNote)}>{t("search.nothing")}</li>
          ) : (
            results.map((t, i) => (
              <li
                key={t.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                {...stylex.props(s.option, i === active && s.optionOn)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  go(t);
                }}
              >
                <span>{t.title}</span>
                <span {...stylex.props(text.muted, text.tnum)}>
                  {t.nodesMastered}/{t.nodesTotal}
                </span>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

/** Closes an open popover on a pointer press outside `ref` or on Escape. */
function useDismiss(open: boolean, ref: React.RefObject<HTMLElement | null>, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && close();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, ref, close]);
}

function Notifications({ due }: { due: number }) {
  useLang();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(open, ref, () => setOpen(false));
  return (
    <div ref={ref} {...stylex.props(s.rel)}>
      <button
        type="button"
        aria-label={due ? t("nav.notificationsDue", { due: dueLabel(due) }) : t("nav.notifications")}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        {...stylex.props(btn.base, btn.icon)}
      >
        <Bell size={19} aria-hidden="true" />
        {due > 0 && <span {...stylex.props(s.dot)} aria-hidden="true" />}
      </button>
      {open && (
        <div role="dialog" aria-label={t("nav.notifications")} {...stylex.props(s.popover, shadow.pop, s.notifPop)}>
          {due > 0 ? (
            <Link to="/review" onClick={() => setOpen(false)} {...stylex.props(s.notifItem)}>
              <Repeat2 size={16} aria-hidden="true" />
              <span>
                {t("nav.dueToday")} <strong {...stylex.props(text.tnum)}>{t("count.cards", { count: due })}</strong>
              </span>
            </Link>
          ) : (
            <p {...stylex.props(s.popNote)}>{t("nav.noNotifications")}</p>
          )}
        </div>
      )}
    </div>
  );
}

const POLL_MS = 5000;

/** Topics with a Claude run in progress; polled while the tab is visible. */
function useRunningTopics(): TopicSummary[] {
  const [running, setRunning] = useState<TopicSummary[]>([]);
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const poll = () =>
      api.topics().then(
        (ts) =>
          setRunning((prev) => {
            const next = ts.filter((t) => t.running);
            return prev.length === next.length && prev.every((p, i) => p.id === next[i]?.id && p.title === next[i]?.title) ? prev : next;
          }),
        () => {},
      );
    const start = () => {
      if (timer) return;
      void poll();
      timer = setInterval(poll, POLL_MS);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => (document.visibilityState === "visible" ? start() : stop());
    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);
  return running;
}

function WorkingPill({ topics, compact }: { topics: TopicSummary[]; compact?: boolean }) {
  useLang();
  if (topics.length === 0) return null;
  const only = topics.length === 1 ? topics[0]! : null;
  const where = only ? only.title : t("count.topics", { count: topics.length });
  return (
    <Link
      to={only ? `/topics/${only.id}` : "/topics"}
      aria-label={t("nav.claudeWorkingOn", { where })}
      title={t("nav.claudeWorkingOn", { where })}
      {...stylex.props(s.pill, s.working, compact ? s.workingCompact : s.workingWide)}
    >
      <span {...stylex.props(s.pulseDot)} aria-hidden="true" />
      <span {...stylex.props(s.workingText)}>
        {t("nav.claudeWorking")}
        {!compact && <span {...stylex.props(s.workingTopic)}> · {where}</span>}
      </span>
    </Link>
  );
}

const UPDATE_BUSY_POLL_MS = 2000;
const LISTED_COMMITS = 8;

const updateBusy = (view: UpdateView | null) => view !== null && (view.state === "waiting" || view.state === "installing" || view.state === "restarting");

/**
 * The server's update state, asked for on page load and whenever the tab regains focus (the server
 * fetches origin at most every 30 minutes), and polled while an update runs. Reloads the page once
 * the server answers from another version.
 */
function useUpdate(): [UpdateView | null, (view: UpdateView) => void] {
  const [view, setView] = useState<UpdateView | null>(null);
  const loaded = useRef<string | null>(null);
  const busy = updateBusy(view);
  useEffect(() => {
    const poll = () =>
      api.update().then(
        (next) => {
          if (loaded.current && next.version && next.version !== loaded.current) return window.location.reload();
          loaded.current ??= next.version;
          setView(next);
        },
        // The server is down while it restarts.
        () => {},
      );
    void poll();
    if (busy) {
      const timer = setInterval(poll, UPDATE_BUSY_POLL_MS);
      return () => clearInterval(timer);
    }
    const onFocus = () => document.visibilityState === "visible" && void poll();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [busy]);
  return [view, setView];
}

const UPDATE_LABEL: Record<UpdateView["state"], MessageKey> = {
  idle: "update.available",
  waiting: "update.waiting",
  installing: "update.installing",
  restarting: "update.restarting",
  failed: "update.failed",
};

function UpdatePill({ view, onChange, compact }: { view: UpdateView | null; onChange: (view: UpdateView) => void; compact?: boolean }) {
  useLang();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, ref, close);
  if (!view || (view.commits.length === 0 && view.state === "idle")) return null;

  const label = t(UPDATE_LABEL[view.state]);
  const processes = t("count.claudeProcesses", { count: view.running });
  const start = (mode: UpdateMode) => {
    setError(null);
    api.startUpdate(mode).then(onChange, (e) => setError(errorText(e)));
  };
  const canStart = (view.state === "idle" || view.state === "failed") && !view.blocked;
  const rest = view.commits.length - LISTED_COMMITS;

  return (
    <div ref={ref} {...stylex.props(s.rel, !compact && s.updateWide)}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        {...stylex.props(s.pill, s.working, s.updateBtn, compact && s.workingCompact)}
      >
        {updateBusy(view) ? <span {...stylex.props(s.pulseDot)} aria-hidden="true" /> : <CircleArrowUp size={18} aria-hidden="true" />}
        <span {...stylex.props(s.workingText)}>{label}</span>
      </button>
      {open && (
        <div role="dialog" aria-label={label} {...stylex.props(s.popover, shadow.pop, s.updatePop)}>
          {view.commits.length > 0 && (
            <>
              <p {...stylex.props(s.updateTitle)}>{t("update.title", { changes: t("count.changes", { count: view.commits.length }) })}</p>
              <ul {...stylex.props(layout.plainList, s.updateList)}>
                {view.commits.slice(0, LISTED_COMMITS).map((c) => (
                  <li key={c.sha}>
                    <span {...stylex.props(s.updateSha)}>{c.sha}</span>
                    {c.subject}
                  </li>
                ))}
                {rest > 0 && <li {...stylex.props(s.updateNote)}>{t("update.more", { count: rest })}</li>}
              </ul>
            </>
          )}
          {view.state === "failed" && view.error && <p {...stylex.props(s.updateError)}>{t("update.failedNote", { error: view.error })}</p>}
          {view.state === "waiting" && (
            <>
              <p {...stylex.props(s.updateNote)}>{t("update.waitingFor", { processes })}</p>
              <div {...stylex.props(s.updateActions)}>
                <button type="button" onClick={() => start("now")} {...stylex.props(btn.base, btn.soft, btn.sm)}>
                  {t("update.now")}
                </button>
              </div>
            </>
          )}
          {view.blocked && <p {...stylex.props(s.updateNote)}>{t(`update.blocked.${view.blocked}`)}</p>}
          {canStart && view.running === 0 && (
            <div {...stylex.props(s.updateActions)}>
              <button type="button" onClick={() => start("idle")} {...stylex.props(btn.base, btn.primary, btn.sm)}>
                {t("update.install")}
              </button>
            </div>
          )}
          {canStart && view.running > 0 && (
            <>
              <div {...stylex.props(s.updateActions)}>
                <button type="button" onClick={() => start("idle")} {...stylex.props(btn.base, btn.primary, btn.sm)}>
                  {t("update.idle")}
                </button>
                <button type="button" onClick={() => start("now")} {...stylex.props(btn.base, btn.soft, btn.sm)}>
                  {t("update.now")}
                </button>
              </div>
              <p {...stylex.props(s.updateNote)}>{t("update.nowNote", { processes })}</p>
            </>
          )}
          {error && <p {...stylex.props(s.updateError)}>{error}</p>}
        </div>
      )}
    </div>
  );
}

function StreakPill({ streak }: { streak: TodayView["streak"] | null }) {
  useLang();
  if (!streak || streak.days < 1) return null;
  const { days, freezes } = streak;
  return (
    <span title={t("streak.freezesTitle", { count: freezes })} {...stylex.props(s.pill)}>
      <Clay name="streak-flame" size={30} />
      <span>
        {t("streak.label")} <strong {...stylex.props(s.pillStrong, text.tnum)}>{days}</strong> {t("word.days", { count: days })}
      </span>
      {freezes > 0 && (
        <span aria-label={t("count.freezes", { count: freezes })} {...stylex.props(s.pillFreeze, text.tnum)}>
          <Snowflake size={15} aria-hidden="true" />
          {freezes}
        </span>
      )}
    </span>
  );
}

/** Saves the chosen language; a failure stays on screen. */
function useLangChoice() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const choose = async (next: Lang) => {
    if (next === lang() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await setLang(next);
    } catch (err) {
      setError(t("lang.saveFailed", { error: errorText(err) }));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, choose };
}

/** Rail button that switches to the other language; with two languages a toggle is enough. */
function LangToggle() {
  useLang();
  const { busy, error, choose } = useLangChoice();
  const next = LANGS.find((l) => l !== lang())!;
  const label = t("lang.switchTo", { name: translate(next, "lang.self") });
  return (
    <div {...stylex.props(s.langWrap)}>
      <button type="button" lang={next} aria-label={label} title={label} disabled={busy} onClick={() => void choose(next)} {...stylex.props(s.themeBtn, s.langBtn)}>
        {next.toUpperCase()}
      </button>
      {error && (
        <p role="alert" {...stylex.props(s.langError)}>
          {error}
        </p>
      )}
    </div>
  );
}

function LangSwitch() {
  useLang();
  const { busy, error, choose } = useLangChoice();
  return (
    <>
      <div role="group" aria-label={t("lang.label")} {...stylex.props(s.themeSwitch, s.langSwitch)}>
        {LANGS.map((l) => (
          <button key={l} type="button" lang={l} aria-pressed={l === lang()} disabled={busy} onClick={() => void choose(l)} {...stylex.props(s.themeSwitchBtn, l === lang() && s.themeSwitchOn)}>
            {translate(l, "lang.self")}
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" {...stylex.props(text.error)}>
          {error}
        </p>
      )}
    </>
  );
}

function ClaudeModeToggle() {
  useLang();
  const on = useClaudeMode();
  return (
    <button type="button" aria-pressed={on} aria-label={t("claudeMode.toggle")} onClick={() => setClaudeMode(!on)} {...stylex.props(s.railLink, on && s.railActive, s.modeToggle, stylex.defaultMarker())}>
      <SquareTerminal size={22} aria-hidden="true" />
      <span {...stylex.props(s.tip)} aria-hidden="true">
        {t("claudeMode.toggle")}
      </span>
    </button>
  );
}

function ClaudeModeSwitch() {
  useLang();
  const on = useClaudeMode();
  return (
    <button type="button" aria-pressed={on} onClick={() => setClaudeMode(!on)} {...stylex.props(s.drawerLink, s.modeSwitch, on && s.drawerActive)}>
      <SquareTerminal size={22} aria-hidden="true" />
      <span>{t("claudeMode.toggle")}</span>
    </button>
  );
}

function ThemeSwitch() {
  useLang();
  const theme = useTheme();
  return (
    <div role="group" aria-label={t("theme.label")} {...stylex.props(s.themeSwitch)}>
      <button type="button" aria-pressed={theme === "light"} onClick={() => setTheme("light")} {...stylex.props(s.themeSwitchBtn, theme === "light" && s.themeSwitchOn)}>
        <Sun size={16} aria-hidden="true" /> {t("theme.lightShort")}
      </button>
      <button type="button" aria-pressed={theme === "dark"} onClick={() => setTheme("dark")} {...stylex.props(s.themeSwitchBtn, theme === "dark" && s.themeSwitchOn)}>
        <Moon size={16} aria-hidden="true" /> {t("theme.darkShort")}
      </button>
    </div>
  );
}

export function Layout() {
  useLang();
  const [header, setHeader] = useState<HeaderInfo>({ title: "" });
  const [due, setDue] = useState(0);
  const [streak, setStreak] = useState<TodayView["streak"] | null>(null);
  const location = useLocation();
  const drawer = useRef<HTMLDialogElement>(null);
  const onHeader = useCallback((info: HeaderInfo) => setHeader(info), []);
  const running = useRunningTopics();
  const [update, setUpdate] = useUpdate();
  const claudeMode = useClaudeMode();
  const { on: game } = useGame();
  useOverlayScroll(drawer);

  useEffect(() => {
    refreshGame();
    api.review().then(
      (r) => setDue(r.cards.length + r.items.length),
      () => setDue(0),
    );
    api.today().then(
      (t) => setStreak(t.streak),
      () => setStreak(null),
    );
  }, [location.pathname]);

  useEffect(() => {
    drawer.current?.close();
  }, [location.pathname]);

  return (
    <AppRoot>
      <a href="#main" data-print="hide" {...stylex.props(s.skip)}>
        {t("nav.skipToContent")}
      </a>
      <div data-print="flow" {...stylex.props(s.frame)}>
        <Rail due={due} />

        <div data-print="hide" {...stylex.props(s.mobileBar)}>
          <Link to="/" {...stylex.props(s.mobileWord)}>
            Clayfold
          </Link>
          <WorkingPill topics={running} compact />
          <UpdatePill view={update} onChange={setUpdate} compact />
          <button type="button" aria-label={t("nav.openMenu")} onClick={() => drawer.current?.showModal()} {...stylex.props(btn.base, btn.icon)}>
            <Menu size={20} aria-hidden="true" />
          </button>
        </div>
        <dialog ref={drawer} aria-label={t("nav.menu")} onClick={(e) => e.target === e.currentTarget && e.currentTarget.close()} {...stylex.props(s.drawer)}>
          <div {...stylex.props(s.drawerInner)}>
            <div {...stylex.props(s.drawerHead)}>
              <Link to="/" {...stylex.props(s.mobileWord)}>
                Clayfold
              </Link>
              <button type="button" aria-label={t("nav.closeMenu")} onClick={() => drawer.current?.close()} {...stylex.props(btn.base, btn.icon)}>
                <X size={20} aria-hidden="true" />
              </button>
            </div>
            <nav aria-label={t("nav.sections")}>
              <ul {...stylex.props(layout.plainList, s.drawerNav)}>
                {NAV.filter((it) => game || !it.game).map((it) => (
                  <li key={it.to}>
                    <NavLink
                      to={it.to}
                      end={it.end}
                      onClick={() => drawer.current?.close()}
                      className={({ isActive }) => stylex.props(s.drawerLink, isActive && s.drawerActive).className ?? ""}
                    >
                      <span aria-hidden="true">{it.icon}</span>
                      <span>{t(it.label)}</span>
                      {it.due && due > 0 && (
                        <span aria-label={dueLabel(due)} {...stylex.props(s.drawerBadge)}>
                          {due}
                        </span>
                      )}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </nav>
            <StreakPill streak={streak} />
            <ClaudeModeSwitch />
            <ThemeSwitch />
            <LangSwitch />
          </div>
        </dialog>

        <main id="main" tabIndex={-1} {...stylex.props(s.main)}>
          <div data-print="hide" {...stylex.props(s.top)}>
            <Link to="/" {...stylex.props(s.wordmark)}>
              Clayfold
            </Link>
            <div {...stylex.props(s.topTools)}>
              <SearchBox />
              <UpdatePill view={update} onChange={setUpdate} />
              <WorkingPill topics={running} />
              <StreakPill streak={streak} />
              <Notifications due={due} />
            </div>
          </div>

          <header {...stylex.props(s.head)}>
            <div {...stylex.props(s.headText)}>
              {header.back && (
                <Link to={header.back.to} data-print="hide" {...stylex.props(s.back)}>
                  <ArrowLeft size={20} aria-hidden="true" /> {header.back.label}
                </Link>
              )}
              <h1 {...stylex.props(text.display, s.h1)}>{header.title}</h1>
              {header.sub && <p {...stylex.props(s.sub)}>{header.sub}</p>}
            </div>
            {header.art && <Clay name={header.art} size={168} xstyle={s.headArt} eager />}
          </header>

          <HeaderProvider onChange={onHeader}>
            <Outlet />
          </HeaderProvider>
        </main>
      </div>
      {claudeMode && (
        <div data-print="hide">
          <ClaudePanel />
        </div>
      )}
      <Intro />
      <Celebrations />
    </AppRoot>
  );
}
