import * as stylex from "@stylexjs/stylex";
import { ArrowRight, Check, Undo2, X } from "lucide-react";
import { useId, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { t, useLang } from "../lib/i18n";
import { bp, color, font, motion, radius, space } from "../theme/tokens.stylex";
import { btn, layout } from "../theme/ui";
import { Markdown } from "./ui";

// Match and sort answers are built by picking an entry, then where it goes; dragging is an extra path
// for a pointer, so keyboard and touch never depend on it.

const s = stylex.create({
  root: { display: "grid", gap: space.lg, maxWidth: "72ch" },
  help: { fontSize: 13.5, color: color.textMuted },
  rows: { display: "grid", gap: space.sm, margin: 0, padding: 0, listStyle: "none" },
  row: {
    display: "grid",
    gridTemplateColumns: { default: "minmax(0, 1fr) auto minmax(0, 1fr)", [bp.phone]: "minmax(0, 1fr)" },
    alignItems: "center",
    gap: { default: 10, [bp.phone]: space.xs },
    paddingBlock: space.sm,
    paddingInline: "14px 8px",
    borderRadius: radius.field,
    borderWidth: 1.5,
    borderStyle: "solid",
    borderColor: "transparent",
    backgroundColor: color.surface2,
    transitionProperty: "border-color, background-color",
    transitionDuration: motion.fast,
  },
  right: { borderColor: color.success, backgroundColor: color.successSoft },
  wrong: { borderColor: color.danger, backgroundColor: color.dangerSoft },
  entry: { display: "flex", alignItems: "baseline", gap: 10, minWidth: 0, overflowWrap: "anywhere" },
  idx: { width: 22, flexShrink: 0, fontWeight: 750, color: color.textMuted, fontVariantNumeric: "tabular-nums" },
  arrow: { flexShrink: 0, color: color.textMuted, display: { default: "block", [bp.phone]: "none" } },
  slotLine: { display: "flex", alignItems: "center", gap: space.xs, minWidth: 0 },
  target: {
    display: "flex",
    alignItems: "center",
    flexGrow: 1,
    minWidth: 0,
    minHeight: 44,
    paddingBlock: space.sm,
    paddingInline: 14,
    borderRadius: radius.small,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: { default: color.borderStrong, ":hover": color.primary },
    backgroundColor: "transparent",
    color: color.textMuted,
    fontFamily: font.body,
    fontSize: 15,
    lineHeight: 1.35,
    textAlign: "start",
    overflowWrap: "anywhere",
    cursor: { default: "pointer", ":disabled": "default" },
    transitionProperty: "border-color, background-color",
    transitionDuration: motion.fast,
  },
  filled: {
    borderStyle: "solid",
    borderColor: { default: color.border, ":hover": color.borderStrong, ":disabled": "transparent" },
    backgroundColor: color.surface,
    color: color.text,
    fontWeight: 600,
  },
  picked: {
    borderStyle: "solid",
    borderColor: { default: color.primary, ":hover": color.primary },
    backgroundColor: color.lilacSoft,
    color: color.text,
  },
  over: { borderColor: color.primary, backgroundColor: color.lilacSoft },
  pool: { display: "grid", gap: space.sm },
  label: { fontSize: 12.5, fontWeight: 700, color: color.textMuted },
  chips: { display: "flex", flexWrap: "wrap", gap: space.sm, margin: 0, padding: 0, listStyle: "none" },
  chip: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.sm,
    maxWidth: "100%",
    minHeight: 44,
    paddingBlock: space.sm,
    paddingInline: 14,
    borderRadius: radius.small,
    borderWidth: 1.5,
    borderStyle: "solid",
    borderColor: { default: color.border, ":hover": color.borderStrong, ":disabled": "transparent" },
    backgroundColor: color.surface,
    color: color.text,
    fontFamily: font.body,
    fontSize: 15,
    fontWeight: 600,
    lineHeight: 1.35,
    textAlign: "start",
    overflowWrap: "anywhere",
    cursor: { default: "pointer", ":disabled": "default" },
    boxShadow: `0 1px 0 ${color.shadow}`,
    transitionProperty: "border-color, background-color, opacity",
    transitionDuration: motion.fast,
  },
  chipBlock: { display: "flex", width: "100%" },
  chipText: { flexGrow: 1, minWidth: 0 },
  dragged: { opacity: 0.45 },
  mark: { display: "grid", placeItems: "center", flexShrink: 0, width: 24, height: 24, borderRadius: "50%", color: color.surface },
  markRight: { backgroundColor: color.success },
  markWrong: { backgroundColor: color.danger },
  tray: {
    display: "grid",
    gap: space.sm,
    paddingBlock: space.md,
    paddingInline: space.md,
    borderRadius: radius.field,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: color.border,
  },
  trayEmpty: { fontSize: 13.5, color: color.textMuted },
  columns: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 190px), 1fr))", gap: space.md },
  column: {
    display: "grid",
    gap: space.sm,
    alignContent: "start",
    padding: space.md,
    borderRadius: radius.field,
    borderWidth: 1.5,
    borderStyle: "solid",
    borderColor: "transparent",
    backgroundColor: color.surface2,
    transitionProperty: "border-color, background-color",
    transitionDuration: motion.fast,
  },
  columnHead: { display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: space.sm, fontWeight: 750, overflowWrap: "anywhere" },
  count: { flexShrink: 0, fontSize: 13, fontWeight: 650, color: color.textMuted, fontVariantNumeric: "tabular-nums" },
  columnList: { display: "grid", gap: space.xs, margin: 0, padding: 0, listStyle: "none" },
  drop: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
    paddingInline: space.md,
    borderRadius: radius.small,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: color.border,
    backgroundColor: "transparent",
    color: color.textMuted,
    fontFamily: font.body,
    fontSize: 13.5,
    fontWeight: 650,
    cursor: { default: "pointer", ":disabled": "default" },
    opacity: { default: 1, ":disabled": 0.6 },
    transitionProperty: "border-color, background-color, color",
    transitionDuration: motion.fast,
  },
  dropReady: {
    borderColor: { default: color.primary, ":hover": color.primary },
    backgroundColor: { default: color.lilacSoft, ":hover": color.lilac },
    color: color.text,
  },
});

function ResultMark({ right }: { right: boolean }) {
  useLang();
  return (
    <span {...stylex.props(s.mark, right ? s.markRight : s.markWrong)}>
      {right ? <Check size={14} strokeWidth={3} aria-hidden="true" /> : <X size={14} strokeWidth={3} aria-hidden="true" />}
      <span {...stylex.props(layout.srOnly)}>{t(right ? "item.markRight" : "item.markWrong")}</span>
    </span>
  );
}

const dragData = (e: DragEvent, index: number) => {
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", String(index));
};

type Picked = { side: "entry" | "target"; index: number } | null;

export function MatchInput({
  entries,
  targets,
  pairs,
  marks,
  done,
  onChange,
}: {
  entries: string[];
  targets: string[];
  /** Per entry, the index of its chosen target. */
  pairs: (number | null)[];
  marks: boolean[] | null;
  done: boolean;
  onChange: (pairs: (number | null)[]) => void;
}) {
  useLang();
  const [picked, setPicked] = useState<Picked>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const [announce, setAnnounce] = useState("");
  const slots = useRef<(HTMLButtonElement | null)[]>([]);
  const chips = useRef<(HTMLButtonElement | null)[]>([]);
  const helpId = useId();
  const poolId = useId();
  const free = targets.map((_, j) => j).filter((j) => !pairs.includes(j));
  const leftOver = targets.length - entries.length;

  /** Pairs `entry` with `target`, taking the target from any entry that had it, then moves on to the next entry without a match. */
  const pair = (entry: number, target: number, fromPool: boolean) => {
    const next = pairs.map((p) => (p === target ? null : p));
    next[entry] = target;
    onChange(next);
    setAnnounce(t("item.matchPaired", { entry: entries[entry]!, target: targets[target]! }));
    const open = next.map((_, k) => (entry + 1 + k) % next.length).find((k) => next[k] === null);
    setPicked(open === undefined ? null : { side: "entry", index: open });
    if (fromPool) {
      const remaining = targets.map((_, j) => j).filter((j) => !next.includes(j));
      requestAnimationFrame(() => (open === undefined || remaining.length === 0 ? slots.current[entry] : chips.current[remaining[0]!])?.focus());
    }
  };

  const clear = (entry: number) => {
    onChange(pairs.map((p, k) => (k === entry ? null : p)));
    setAnnounce(t("item.matchCleared", { entry: entries[entry]! }));
    setPicked({ side: "entry", index: entry });
    requestAnimationFrame(() => slots.current[entry]?.focus());
  };

  const pickEntry = (entry: number) => {
    if (picked?.side === "target") pair(entry, picked.index, false);
    else setPicked(picked?.side === "entry" && picked.index === entry ? null : { side: "entry", index: entry });
  };

  const pickTarget = (target: number) => {
    if (picked?.side === "entry") pair(picked.index, target, true);
    else setPicked(picked?.side === "target" && picked.index === target ? null : { side: "target", index: target });
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape" && picked) {
      e.stopPropagation();
      setPicked(null);
    }
  };

  return (
    <div onKeyDown={onKeyDown} {...stylex.props(s.root)}>
      <p id={helpId} {...stylex.props(s.help)}>
        {t("item.matchHelp")}
        {leftOver > 0 && ` ${t("item.matchLeftOver", { count: leftOver })}`}
      </p>
      <ol aria-describedby={helpId} {...stylex.props(s.rows)}>
        {entries.map((entry, i) => {
          const target = pairs[i] ?? null;
          const mark = marks?.[i];
          return (
            <li key={i} {...stylex.props(s.row, mark === true && s.right, mark === false && s.wrong)}>
              <span {...stylex.props(s.entry)}>
                <span aria-hidden="true" {...stylex.props(s.idx)}>
                  {i + 1}
                </span>
                <Markdown src={entry} inline />
              </span>
              <ArrowRight size={16} aria-hidden="true" {...stylex.props(s.arrow)} />
              <span {...stylex.props(s.slotLine)}>
                <button
                  ref={(el) => {
                    slots.current[i] = el;
                  }}
                  type="button"
                  aria-pressed={picked?.side === "entry" && picked.index === i}
                  onClick={() => pickEntry(i)}
                  onDragOver={(e) => {
                    if (dragging === null) return;
                    e.preventDefault();
                    setOver(i);
                  }}
                  onDragLeave={() => setOver((o) => (o === i ? null : o))}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragging !== null) pair(i, dragging, false);
                    setDragging(null);
                    setOver(null);
                  }}
                  {...stylex.props(
                    s.target,
                    target !== null && s.filled,
                    picked?.side === "entry" && picked.index === i && s.picked,
                    over === i && s.over,
                  )}
                >
                  <span {...stylex.props(layout.srOnly)}>{t("item.matchFor", { entry })}: </span>
                  {target !== null ? <Markdown src={targets[target]!} inline /> : t("item.matchChoose")}
                </button>
                {target !== null && !done && mark === undefined && (
                  <button type="button" aria-label={t("item.matchClear", { entry })} onClick={() => clear(i)} {...stylex.props(btn.base, btn.icon, btn.iconSm)}>
                    <X size={14} aria-hidden="true" />
                  </button>
                )}
                {mark !== undefined && <ResultMark right={mark} />}
              </span>
            </li>
          );
        })}
      </ol>
      {free.length > 0 && (
        <div role="group" aria-labelledby={poolId} {...stylex.props(s.pool)}>
          <p id={poolId} {...stylex.props(s.label)}>
            {t("item.matchPool")}
          </p>
          <ul {...stylex.props(s.chips)}>
            {free.map((j) => (
              <li key={j}>
                <button
                  ref={(el) => {
                    chips.current[j] = el;
                  }}
                  type="button"
                  draggable={!done}
                  aria-pressed={picked?.side === "target" && picked.index === j}
                  onClick={() => pickTarget(j)}
                  onDragStart={(e) => {
                    dragData(e, j);
                    setDragging(j);
                  }}
                  onDragEnd={() => {
                    setDragging(null);
                    setOver(null);
                  }}
                  {...stylex.props(s.chip, picked?.side === "target" && picked.index === j && s.picked, dragging === j && s.dragged)}
                >
                  <Markdown src={targets[j]!} inline />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p aria-live="assertive" {...stylex.props(layout.srOnly)}>
        {announce}
      </p>
    </div>
  );
}

export function SortInput({
  entries,
  categories,
  placed,
  marks,
  done,
  onChange,
}: {
  entries: string[];
  categories: string[];
  /** Per entry, the index of its category; null while unsorted. */
  placed: (number | null)[];
  marks: boolean[] | null;
  done: boolean;
  onChange: (placed: (number | null)[]) => void;
}) {
  useLang();
  const [picked, setPicked] = useState<number | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | "tray" | null>(null);
  const [announce, setAnnounce] = useState("");
  const chips = useRef<(HTMLButtonElement | null)[]>([]);
  const helpId = useId();
  const trayId = useId();
  const unsorted = entries.map((_, i) => i).filter((i) => placed[i] === null);

  /** Moves `entry` into `category` (null: back to the tray), then puts focus on the next unsorted entry. */
  const place = (entry: number, category: number | null) => {
    const next = placed.map((c, i) => (i === entry ? category : c));
    onChange(next);
    setAnnounce(
      category === null ? t("item.sortReturned", { entry: entries[entry]! }) : t("item.sortPlaced", { entry: entries[entry]!, category: categories[category]! }),
    );
    setPicked(null);
    const open = next.findIndex((c) => c === null);
    requestAnimationFrame(() => chips.current[open >= 0 ? open : entry]?.focus());
  };

  const dropZone = (target: number | "tray") => ({
    onDragOver: (e: DragEvent) => {
      if (dragging === null) return;
      e.preventDefault();
      setOver(target);
    },
    onDragLeave: (e: DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver((o) => (o === target ? null : o));
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      if (dragging !== null) place(dragging, target === "tray" ? null : target);
      setDragging(null);
      setOver(null);
    },
  });

  const chip = (i: number, block: boolean) => {
    const mark = marks?.[i];
    return (
      <button
        ref={(el) => {
          chips.current[i] = el;
        }}
        type="button"
        draggable={!done}
        aria-pressed={picked === i}
        onClick={() => setPicked(picked === i ? null : i)}
        onDragStart={(e) => {
          dragData(e, i);
          setDragging(i);
        }}
        onDragEnd={() => {
          setDragging(null);
          setOver(null);
        }}
        {...stylex.props(
          s.chip,
          block && s.chipBlock,
          mark === true && s.right,
          mark === false && s.wrong,
          picked === i && s.picked,
          dragging === i && s.dragged,
        )}
      >
        <span {...stylex.props(s.chipText)}>
          <Markdown src={entries[i]!} inline />
        </span>
        {mark !== undefined && <ResultMark right={mark} />}
      </button>
    );
  };

  const pickedEntry = picked === null ? "" : entries[picked]!;

  return (
    <div
      onKeyDown={(e) => {
        if (e.key === "Escape" && picked !== null) {
          e.stopPropagation();
          setPicked(null);
        }
      }}
      {...stylex.props(s.root)}
    >
      <p id={helpId} {...stylex.props(s.help)}>
        {t("item.sortHelp")}
      </p>
      <section aria-labelledby={trayId} aria-describedby={helpId} {...dropZone("tray")} {...stylex.props(s.tray, over === "tray" && s.over)}>
        <p id={trayId} {...stylex.props(s.label)}>
          {t("item.sortTray")}
        </p>
        {unsorted.length > 0 ? (
          <ul {...stylex.props(s.chips)}>
            {unsorted.map((i) => (
              <li key={i}>{chip(i, false)}</li>
            ))}
          </ul>
        ) : (
          <p {...stylex.props(s.trayEmpty)}>{t("item.sortTrayEmpty")}</p>
        )}
        {picked !== null && placed[picked] !== null && (
          <button type="button" onClick={() => place(picked, null)} {...stylex.props(btn.base, btn.ghost, btn.sm)}>
            <Undo2 size={15} aria-hidden="true" /> {t("item.sortBack")}
          </button>
        )}
      </section>
      <div {...stylex.props(s.columns)}>
        {categories.map((category, k) => {
          const inside = entries.map((_, i) => i).filter((i) => placed[i] === k);
          const ready = picked !== null && placed[picked] !== k;
          return (
            <section key={k} aria-label={category} {...dropZone(k)} {...stylex.props(s.column, over === k && s.over)}>
              <p {...stylex.props(s.columnHead)}>
                <span>{category}</span>
                <span {...stylex.props(s.count)}>{inside.length}</span>
              </p>
              {inside.length > 0 && (
                <ul {...stylex.props(s.columnList)}>
                  {inside.map((i) => (
                    <li key={i}>{chip(i, true)}</li>
                  ))}
                </ul>
              )}
              {!done && (
                <button
                  type="button"
                  disabled={!ready}
                  aria-label={ready ? t("item.sortPlaceIn", { entry: pickedEntry, category }) : undefined}
                  onClick={() => picked !== null && place(picked, k)}
                  {...stylex.props(s.drop, ready && s.dropReady)}
                >
                  {t("item.sortPlaceHere")}
                </button>
              )}
            </section>
          );
        })}
      </div>
      <p aria-live="assertive" {...stylex.props(layout.srOnly)}>
        {announce}
      </p>
    </div>
  );
}
