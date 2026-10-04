import * as stylex from "@stylexjs/stylex";
import {
  BookA,
  BookOpen,
  CornerDownLeft,
  FileText,
  Languages,
  Layers,
  Moon,
  NotebookPen,
  PawPrint,
  Play,
  Repeat2,
  Search,
  Settings,
  Sparkles,
  SquareStack,
  StickyNote,
  Sun,
  Target,
  X,
} from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { SEARCH_KINDS, type SearchHit, type SearchKind, type SearchText, type TodayView } from "@shared/api";
import { LANGS, translate, type MessageKey } from "@shared/i18n";
import { foldForSearch, markText, queryWords } from "@shared/search";
import { api, errorText } from "../lib/api";
import { useGame } from "../lib/game";
import { lang, setLang, t, useLang } from "../lib/i18n";
import { recentVisits, type RecentVisit } from "../lib/recent";
import { setTheme, useTheme } from "../lib/theme";
import { bp, color, font, motion, radius } from "../theme/tokens.stylex";
import { layout, shadow } from "../theme/ui";
import { Spinner } from "./ui";

const DEBOUNCE_MS = 160;

const s = stylex.create({
  trigger: {
    display: "inline-flex",
    alignItems: "center",
    gap: 10,
    flexGrow: { default: 0, [bp.mobile]: 1 },
    width: { default: 260, [bp.mobile]: "auto" },
    height: 46,
    paddingInline: "16px 10px",
    borderWidth: 1.5,
    borderStyle: "solid",
    borderColor: { default: color.border, ":hover": color.borderStrong, ":focus-visible": color.focus },
    borderRadius: radius.pill,
    backgroundColor: color.surface,
    color: color.textMuted,
    fontFamily: font.body,
    fontSize: 15,
    cursor: "pointer",
    outline: { default: null, ":focus-visible": "none" },
    boxShadow: { default: null, ":focus-visible": `0 0 0 3px ${color.lilacSoft}` },
    transitionProperty: "border-color",
    transitionDuration: motion.fast,
  },
  triggerText: { flexGrow: 1, textAlign: "start" },
  triggerKbd: { display: { default: "inline-grid", [bp.mobile]: "none" } },
  kbd: {
    display: "inline-grid",
    placeItems: "center",
    minWidth: 24,
    height: 26,
    paddingInline: 8,
    borderRadius: 9,
    backgroundColor: color.surface2,
    color: color.textMuted,
    fontFamily: font.mono,
    fontSize: 12,
    fontWeight: 600,
  },
  dialog: {
    width: { default: "min(680px, calc(100vw - 32px))", [bp.phone]: "100vw" },
    maxWidth: "none",
    maxHeight: "none",
    marginTop: { default: "10vh", [bp.phone]: 0 },
    marginInline: "auto",
    padding: 0,
    borderWidth: 0,
    borderRadius: { default: radius.card, [bp.phone]: 0 },
    backgroundColor: color.surface,
    color: color.text,
    overflow: "hidden",
    "::backdrop": { backgroundColor: color.scrim, backdropFilter: "blur(3px)" },
  },
  panel: {
    display: "flex",
    flexDirection: "column",
    height: { default: "auto", [bp.phone]: "100dvh" },
    maxHeight: { default: "min(640px, 80vh)", [bp.phone]: "100dvh" },
  },
  head: { display: "flex", alignItems: "center", gap: 12, paddingInline: "20px 12px", borderBottomWidth: 1, borderBottomStyle: "solid", borderBottomColor: color.border },
  headIcon: { flexShrink: 0, color: color.textMuted },
  input: {
    flexGrow: 1,
    minWidth: 0,
    height: 62,
    borderWidth: 0,
    backgroundColor: "transparent",
    color: color.text,
    fontFamily: font.body,
    fontSize: 17,
    outline: "none",
    "::placeholder": { color: color.textMuted },
  },
  close: {
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
    width: 36,
    height: 36,
    borderWidth: 0,
    borderRadius: "50%",
    backgroundColor: { default: "transparent", ":hover": color.surface2 },
    color: color.textMuted,
    cursor: "pointer",
  },
  body: { flexGrow: 1, minHeight: 0, overflowY: "auto", overscrollBehavior: "contain", padding: 8 },
  group: { display: "grid", gap: 2, paddingBottom: 6 },
  groupLabel: { paddingBlock: "10px 4px", paddingInline: 12, fontSize: 12.5, fontWeight: 700, color: color.textMuted },
  option: {
    display: "grid",
    gridTemplateColumns: "36px minmax(0, 1fr) 18px",
    alignItems: "center",
    gap: 12,
    paddingBlock: 9,
    paddingInline: 10,
    borderRadius: 16,
    cursor: "pointer",
    color: color.text,
  },
  optionOn: { backgroundColor: color.lilacSoft },
  icon: { display: "grid", placeItems: "center", width: 36, height: 36, borderRadius: 12, backgroundColor: color.surface2, color: color.text },
  iconOn: { backgroundColor: color.surface },
  text: { display: "grid", gap: 2, minWidth: 0 },
  clamp: { display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" },
  title: { fontSize: 15, fontWeight: 650, lineHeight: 1.35, overflowWrap: "anywhere" },
  detail: { fontSize: 13.5, lineHeight: 1.45, color: color.textMuted, overflowWrap: "anywhere" },
  context: { fontSize: 12.5, color: color.textMuted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  enter: { color: color.textMuted },
  mark: { backgroundColor: "transparent", color: color.accentText, fontWeight: 750 },
  status: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", paddingBlock: 14, paddingInline: 14, fontSize: 14.5, color: color.textMuted },
  error: { color: color.danger },
  retry: { borderWidth: 0, padding: 0, backgroundColor: "transparent", color: color.accentText, fontFamily: font.body, fontSize: 14.5, fontWeight: 650, cursor: "pointer", textDecoration: { default: "none", ":hover": "underline" } },
  foot: {
    display: { default: "flex", [bp.mobile]: "none" },
    gap: 16,
    paddingBlock: 10,
    paddingInline: 20,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: color.border,
    fontSize: 12.5,
    color: color.textMuted,
  },
  footKey: { display: "inline-flex", alignItems: "center", gap: 6 },
});

const MAC = /Mac|iPhone|iPad/.test(navigator.platform);

type Item = {
  key: string;
  icon: ReactNode;
  title: SearchText | string;
  detail?: SearchText | string | null;
  /** Shows the whole detail instead of two lines: a term's definition. */
  fullDetail?: boolean;
  context?: string | null;
  run: () => void;
};
type Action = Omit<Item, "title"> & { title: string; keywords?: string };
type Group = { key: string; label: string; items: Item[] };

const GROUP_LABEL: Record<SearchKind, MessageKey> = {
  topic: "search.group.topic",
  lesson: "search.group.lesson",
  step: "search.group.step",
  term: "search.group.term",
  note: "search.group.note",
  card: "search.group.card",
};

const ICON_SIZE = 18;

function hitIcon(hit: Pick<SearchHit, "kind" | "topicKind">): ReactNode {
  switch (hit.kind) {
    case "topic":
      return hit.topicKind === "goal" ? <Target size={ICON_SIZE} /> : <Layers size={ICON_SIZE} />;
    case "lesson":
      return <BookOpen size={ICON_SIZE} />;
    case "step":
      return <FileText size={ICON_SIZE} />;
    case "term":
      return <BookA size={ICON_SIZE} />;
    case "note":
      return <StickyNote size={ICON_SIZE} />;
    case "card":
      return <SquareStack size={ICON_SIZE} />;
  }
}

const e = encodeURIComponent;

function hitPath(hit: SearchHit): string {
  switch (hit.kind) {
    case "topic":
      return `/topics/${e(hit.topicId)}`;
    case "term":
      return `/glossary?q=${e(hit.id)}`;
    default:
      if (!hit.lessonId) return `/topics/${e(hit.topicId)}`;
      return `/lessons/${e(hit.lessonId)}${hit.stepIdx === null ? "" : `?step=${hit.stepIdx + 1}`}`;
  }
}

function hitContext(hit: SearchHit): string | null {
  if (hit.kind === "topic") return null;
  if (hit.kind === "lesson" || hit.kind === "term") return hit.topicTitle;
  return [hit.lessonTitle, hit.topicTitle].filter(Boolean).join(" · ");
}

function Marked({ value }: { value: SearchText | string }) {
  if (typeof value === "string") return value;
  const parts: ReactNode[] = [];
  let at = 0;
  for (const [start, end] of value.marks) {
    if (start > at) parts.push(value.text.slice(at, start));
    parts.push(
      <mark key={start} {...stylex.props(s.mark)}>
        {value.text.slice(start, end)}
      </mark>,
    );
    at = end;
  }
  parts.push(value.text.slice(at));
  return parts;
}

/** The top-bar search button and the palette it opens; Cmd+K or Ctrl+K opens and closes it from anywhere. */
export function CommandPalette({ due, goal }: { due: number; goal: TodayView["goal"] | null }) {
  useLang();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (ev: globalThis.KeyboardEvent) => {
      // The key code, not the character, so the shortcut works in a Cyrillic layout too.
      if ((ev.metaKey || ev.ctrlKey) && !ev.altKey && !ev.shiftKey && ev.code === "KeyK") {
        ev.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  return (
    <>
      <button type="button" aria-haspopup="dialog" aria-keyshortcuts="Meta+K Control+K" onClick={() => setOpen(true)} {...stylex.props(s.trigger)}>
        <Search size={18} aria-hidden="true" />
        <span {...stylex.props(s.triggerText)}>{t("search.open")}</span>
        <kbd aria-hidden="true" {...stylex.props(s.kbd, s.triggerKbd)}>
          {MAC ? "⌘K" : "Ctrl K"}
        </kbd>
      </button>
      {open && <Palette due={due} goal={goal} onClose={() => setOpen(false)} />}
    </>
  );
}

function Palette({ due, goal, onClose }: { due: number; goal: TodayView["goal"] | null; onClose: () => void }) {
  useLang();
  const theme = useTheme();
  const { on: game } = useGame();
  const navigate = useNavigate();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  // Set once the learner moves through the list; until then the create option is never preselected.
  const [picked, setPicked] = useState(false);
  const [found, setFound] = useState<{ q: string; hits: SearchHit[] } | null>(null);
  const [failed, setFailed] = useState<{ q: string; message: string } | null>(null);
  const [retries, setRetries] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const recent = useMemo(recentVisits, []);
  const latest = useRef(0);
  const q = query.trim();

  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.showModal();
    input.current?.focus();
    return () => {
      if (!document.activeElement || document.activeElement === document.body) before?.focus();
    };
  }, []);

  // Every keystroke supersedes the request before it; only the latest answer is shown.
  useEffect(() => {
    const id = ++latest.current;
    if (!q) return;
    const timer = setTimeout(() => {
      api.search(q).then(
        (res) => {
          if (id !== latest.current) return;
          setFound({ q, hits: res.hits });
          setFailed(null);
          setActive(0);
          setPicked(false);
        },
        (err) => id === latest.current && setFailed({ q, message: errorText(err) }),
      );
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [q, retries]);

  const go = (to: string, state?: { land: "goal" | "new-topic" }) => {
    onClose();
    navigate(to, state ? { state } : undefined);
  };

  const nextLang = LANGS.find((l) => l !== lang())!;
  const lastLesson = recent.find((v) => v.kind === "lesson");
  const actions: Action[] = [
    {
      key: "review",
      icon: <Repeat2 size={ICON_SIZE} />,
      title: t("search.action.review"),
      detail: due > 0 ? t("nav.due", { cards: t("count.cards", { count: due }) }) : t("search.action.reviewNone"),
      run: () => go("/review"),
    },
    ...(lastLesson
      ? [{ key: "continue", icon: <Play size={ICON_SIZE} />, title: t("search.action.continue"), detail: lastLesson.title, run: () => go(`/lessons/${e(lastLesson.id)}`) }]
      : []),
    ...(goal
      ? [
          {
            key: "goal",
            icon: <Target size={ICON_SIZE} />,
            title: t("search.action.goal"),
            detail: t("home.minutesOf", { done: Math.round(goal.done), total: goal.minutes }),
            run: () => go("/", { land: "goal" }),
          },
        ]
      : []),
    { key: "new", icon: <Sparkles size={ICON_SIZE} />, title: t("search.action.newTopic"), run: () => go("/", { land: "new-topic" }) },
    { key: "glossary", icon: <BookA size={ICON_SIZE} />, title: t("nav.glossary"), run: () => go("/glossary") },
    { key: "mistakes", icon: <NotebookPen size={ICON_SIZE} />, title: t("nav.mistakes"), run: () => go("/mistakes") },
    ...(game ? [{ key: "meerkat", icon: <PawPrint size={ICON_SIZE} />, title: t("nav.meerkat"), run: () => go("/meerkat") }] : []),
    { key: "settings", icon: <Settings size={ICON_SIZE} />, title: t("nav.settings"), run: () => go("/settings") },
    {
      key: "lang",
      icon: <Languages size={ICON_SIZE} />,
      title: t("lang.switchTo", { name: translate(nextLang, "lang.self") }),
      keywords: t("lang.label"),
      run: () => {
        setNotice(null);
        setLang(nextLang).catch((err) => setNotice(t("lang.saveFailed", { error: errorText(err) })));
      },
    },
    {
      key: "theme",
      icon: theme === "dark" ? <Sun size={ICON_SIZE} /> : <Moon size={ICON_SIZE} />,
      title: t(theme === "dark" ? "search.action.themeLight" : "search.action.themeDark"),
      keywords: t("theme.label"),
      run: () => setTheme(theme === "dark" ? "light" : "dark"),
    },
  ];

  const createTopic = async () => {
    setCreating(true);
    setNotice(null);
    try {
      const res = await api.createTopic(q);
      go(`/topics/${e(res.topicId)}?c=${e(res.conversationId)}`);
    } catch (err) {
      setNotice(errorText(err));
      setCreating(false);
    }
  };

  const visitItem = (v: RecentVisit): Item => ({
    key: `${v.kind}:${v.id}`,
    icon: hitIcon({ kind: v.kind, topicKind: v.goal ? "goal" : "topic" }),
    title: v.title,
    context: v.context,
    run: () => go(v.kind === "lesson" ? `/lessons/${e(v.id)}` : `/topics/${e(v.id)}`),
  });

  const hitItem = (hit: SearchHit): Item => ({
    key: `${hit.kind}:${hit.topicId}:${hit.id}`,
    icon: hitIcon(hit),
    title: hit.title,
    detail: hit.snippet,
    fullDetail: hit.kind === "term",
    context: hitContext(hit),
    run: () => go(hitPath(hit)),
  });

  const loaded = !!q && found?.q === q;
  const groups: Group[] = [];
  if (!q) {
    if (recent.length) groups.push({ key: "recent", label: t("search.group.recent"), items: recent.map(visitItem) });
    groups.push({ key: "actions", label: t("search.group.actions"), items: actions });
  } else {
    const words = queryWords(q).all;
    const matching = actions
      .filter((a) => words.every((w) => foldForSearch(`${a.title} ${a.keywords ?? ""}`).includes(w)))
      .map((a): Item => ({ ...a, title: markText(a.title, words) }));
    if (matching.length) groups.push({ key: "actions", label: t("search.group.actions"), items: matching });
    const hits = found?.hits ?? [];
    for (const kind of SEARCH_KINDS) {
      const items = hits.filter((h) => h.kind === kind).map(hitItem);
      if (items.length) groups.push({ key: kind, label: t(GROUP_LABEL[kind]), items });
    }
    // Offered only once this query's results are in, so Enter typed ahead never starts a course by accident.
    if (loaded) {
      groups.push({
        key: "create",
        label: t("search.group.create"),
        items: [{ key: "create", icon: creating ? <Spinner /> : <Sparkles size={ICON_SIZE} />, title: t("search.action.createTopic", { query: q }), run: () => !creating && void createTopic() }],
      });
    }
  }
  const flat = groups.flatMap((g) => g.items);
  const first = Math.min(active, flat.length - 1);
  const current = !picked && flat[first]?.key === "create" ? -1 : first;
  const optionId = (i: number) => `${listId}-${i}`;

  useEffect(() => {
    if (current >= 0) document.getElementById(optionId(current))?.scrollIntoView({ block: "nearest" });
  });

  const searching = !!q && !loaded && failed?.q !== q;
  const results = loaded ? (found?.hits.length ?? 0) : 0;

  const onKeyDown = (ev: KeyboardEvent<HTMLInputElement>) => {
    if (ev.nativeEvent.isComposing) return;
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      ev.preventDefault();
      if (!flat.length) return;
      const from = current < 0 ? (ev.key === "ArrowDown" ? -1 : 0) : current;
      setActive((from + (ev.key === "ArrowDown" ? 1 : flat.length - 1)) % flat.length);
      setPicked(true);
    } else if (ev.key === "Enter") {
      ev.preventDefault();
      flat[current]?.run();
    } else if (ev.key === "Escape") {
      ev.preventDefault();
      onClose();
    }
  };

  // The modal dialog keeps focus on the page out; Tab cycles through the input and the close button.
  const trapTab = (ev: KeyboardEvent<HTMLDialogElement>) => {
    if (ev.key !== "Tab") return;
    const focusable = [...ev.currentTarget.querySelectorAll<HTMLElement>("input, button:not([disabled])")];
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (ev.shiftKey && document.activeElement === first) {
      ev.preventDefault();
      last?.focus();
    } else if (!ev.shiftKey && document.activeElement === last) {
      ev.preventDefault();
      first?.focus();
    }
  };

  let index = 0;
  return (
    <dialog
      ref={dialog}
      aria-label={t("search.dialog")}
      onCancel={(ev) => {
        ev.preventDefault();
        onClose();
      }}
      onClick={(ev) => ev.target === ev.currentTarget && onClose()}
      onKeyDown={trapTab}
      {...stylex.props(s.dialog, shadow.pop)}
    >
      <div {...stylex.props(s.panel)}>
        <div {...stylex.props(s.head)}>
          <Search size={20} aria-hidden="true" {...stylex.props(s.headIcon)} />
          <input
            ref={input}
            type="text"
            role="combobox"
            aria-label={t("search.dialog")}
            aria-expanded={flat.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={current >= 0 ? optionId(current) : undefined}
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="go"
            placeholder={t("search.placeholder")}
            value={query}
            onChange={(ev) => {
              setQuery(ev.target.value);
              setActive(0);
              setPicked(false);
              setNotice(null);
            }}
            onKeyDown={onKeyDown}
            {...stylex.props(s.input)}
          />
          <button type="button" aria-label={t("search.close")} onClick={onClose} {...stylex.props(s.close)}>
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <div {...stylex.props(s.body)}>
          <div role="listbox" id={listId} aria-label={t("search.dialog")} aria-busy={searching}>
            {groups.map((g) => (
              <div key={g.key} role="group" aria-labelledby={`${listId}-${g.key}`} {...stylex.props(s.group)}>
                <div id={`${listId}-${g.key}`} role="presentation" {...stylex.props(s.groupLabel)}>
                  {g.label}
                </div>
                {g.items.map((item) => {
                  const i = index++;
                  const on = i === current;
                  return (
                    <div
                      key={item.key}
                      id={optionId(i)}
                      role="option"
                      aria-selected={on}
                      onMouseMove={() => {
                        if (i === current) return;
                        setActive(i);
                        setPicked(true);
                      }}
                      onMouseDown={(ev) => ev.preventDefault()}
                      onClick={item.run}
                      {...stylex.props(s.option, on && s.optionOn)}
                    >
                      <span aria-hidden="true" {...stylex.props(s.icon, on && s.iconOn)}>
                        {item.icon}
                      </span>
                      <span {...stylex.props(s.text)}>
                        <span {...stylex.props(s.title, s.clamp)}>
                          <Marked value={item.title} />
                        </span>
                        {item.detail && (
                          <span {...stylex.props(s.detail, !item.fullDetail && s.clamp)}>
                            <Marked value={item.detail} />
                          </span>
                        )}
                        {item.context && <span {...stylex.props(s.context)}>{item.context}</span>}
                      </span>
                      {on && <CornerDownLeft size={16} aria-hidden="true" {...stylex.props(s.enter)} />}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          <div role="status" {...stylex.props(searching || failed?.q === q || notice || (loaded && !results) ? s.status : layout.srOnly)}>
            {notice ? (
              <span {...stylex.props(s.error)}>{notice}</span>
            ) : q && failed?.q === q ? (
              <>
                <span {...stylex.props(s.error)}>{t("search.failed", { error: failed.message })}</span>
                <button type="button" onClick={() => setRetries((n) => n + 1)} {...stylex.props(s.retry)}>
                  {t("common.retry")}
                </button>
              </>
            ) : searching ? (
              <>
                <Spinner /> {t("search.searching")}
              </>
            ) : loaded ? (
              results ? t("search.results", { count: results }) : t("search.nothing", { query: q })
            ) : null}
          </div>
        </div>
        <div aria-hidden="true" {...stylex.props(s.foot)}>
          <span {...stylex.props(s.footKey)}>
            <kbd {...stylex.props(s.kbd)}>↑↓</kbd> {t("search.keys.move")}
          </span>
          <span {...stylex.props(s.footKey)}>
            <kbd {...stylex.props(s.kbd)}>↵</kbd> {t("search.keys.open")}
          </span>
          <span {...stylex.props(s.footKey)}>
            <kbd {...stylex.props(s.kbd)}>esc</kbd> {t("search.keys.close")}
          </span>
        </div>
      </div>
    </dialog>
  );
}
