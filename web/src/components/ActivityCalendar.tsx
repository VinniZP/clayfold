import * as stylex from "@stylexjs/stylex";
import { Crown, Snowflake } from "lucide-react";
import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { ActivityDay, TodayView } from "@shared/api";
import { dateFormat, dayKey } from "../lib/format";
import { t, useLang } from "../lib/i18n";
import { bp, color, font, motion } from "../theme/tokens.stylex";
import { layout } from "../theme/ui";
import { useDayCrowns } from "./meerkat/Crowns";
import { Clay } from "./ui";

export type CalendarDay = {
  key: string;
  date: Date;
  minutes: number;
  attempts: number;
  reviews: number;
  active: boolean;
  /** A freeze covered this missed day. */
  frozen: boolean;
  today: boolean;
  future: boolean;
  /** Minutes against the daily goal: 0 none, 1 under half, 2 under the goal, 3 goal met, 4 twice the goal. */
  level: 0 | 1 | 2 | 3 | 4;
  /** Run of consecutive active or frozen days; null outside a run. */
  run: number | null;
  runLength: number;
  /** In the current streak; heat grows from 0 at its first day to 1 at its last. */
  current: boolean;
  heat: number;
  head: boolean;
};

export const CALENDAR_WEEKS = 10;
const ROWS = 7;

/** Ten weeks Monday to Sunday ending with the current week, joined with the server's streak. */
export function buildCalendar(activity: ActivityDay[], today: TodayView | null, now: Date = new Date()): CalendarDay[] {
  const byKey = new Map(activity.map((d) => [d.date, d]));
  const frozen = new Set(today?.streak.frozen ?? []);
  const goal = today?.goal.minutes ?? 10;
  const todayKey = dayKey(now);
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7) - 7 * (CALENDAR_WEEKS - 1));

  let run = -1;
  let inRun = false;
  const days = Array.from({ length: CALENDAR_WEEKS * ROWS }, (_, i): CalendarDay => {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const key = dayKey(date);
    const a = byKey.get(key);
    const active = !!a && a.attempts + a.reviews > 0;
    const isToday = key === todayKey;
    const future = !isToday && date > now;
    const isFrozen = !active && frozen.has(key);
    const ratio = (a?.minutes ?? 0) / goal;
    const level = !active ? 0 : ratio >= 2 ? 4 : ratio >= 1 ? 3 : ratio >= 0.5 ? 2 : 1;
    const joins = active || isFrozen;
    if (joins && !inRun) run++;
    if (!(isToday && !active)) inRun = joins;
    return {
      key,
      date,
      minutes: a?.minutes ?? 0,
      attempts: a?.attempts ?? 0,
      reviews: a?.reviews ?? 0,
      active,
      frozen: isFrozen,
      today: isToday,
      future,
      level,
      run: joins ? run : null,
      runLength: 0,
      current: false,
      heat: 0,
      head: false,
    };
  });

  const lengths = new Map<number, number>();
  for (const d of days) if (d.run !== null) lengths.set(d.run, (lengths.get(d.run) ?? 0) + 1);
  for (const d of days) if (d.run !== null) d.runLength = lengths.get(d.run)!;

  const last = days.findLast((d) => d.run !== null);
  const yesterday = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  if (last && (today?.streak.days ?? 0) > 0 && (last.key === todayKey || last.key === yesterday)) {
    const streak = days.filter((d) => d.run === last.run);
    streak.forEach((d, i) => {
      d.current = true;
      d.heat = streak.length === 1 ? 1 : i / (streak.length - 1);
    });
    last.head = true;
  }
  return days;
}

const weekdayFmt = () => dateFormat({ weekday: "short" });
const dateFmt = () => dateFormat({ day: "numeric", month: "short" });
const monthFmt = () => dateFormat({ month: "short" });

function describe(d: CalendarDay): string {
  const day = d.today ? t("common.today") : `${weekdayFmt().format(d.date).replace(/^./, (c) => c.toUpperCase())}, ${dateFmt().format(d.date).replace(".", "")}`;
  if (d.frozen) return `${day} · ${t("calendar.frozen")}`;
  if (!d.active) return `${day} · ${t(d.today ? "calendar.noStudyYet" : "calendar.noStudy")}`;
  const parts = [
    d.minutes > 0 && t("calendar.minutes", { count: Math.round(d.minutes) }),
    d.attempts > 0 && t("count.tasks", { count: d.attempts }),
    d.reviews > 0 && t("count.cards", { count: d.reviews }),
  ].filter(Boolean);
  return [day, ...parts].join(" · ");
}

/** Short month name over the week column that holds the month's first day, and over the first column. */
function monthLabels(days: CalendarDay[]): (string | null)[] {
  return Array.from({ length: CALENDAR_WEEKS }, (_, c) => {
    const week = days.slice(c * ROWS, c * ROWS + ROWS);
    const first = week.find((d) => d.date.getDate() === 1) ?? (c === 0 ? week[0] : undefined);
    return first ? monthFmt().format(first.date).replace(".", "") : null;
  });
}

/** Row labels, Monday first; only Monday, Wednesday and Friday are named. 1 January 2024 was a Monday. */
const weekdays = () => [0, 1, 2, 3, 4, 5, 6].map((i) => (i % 2 === 0 && i < 6 ? weekdayFmt().format(new Date(2024, 0, 1 + i)) : ""));
const GAP = 6;

const tileIn = stylex.keyframes({
  from: { transform: "scale(0.45)", opacity: 0.15 },
});
const haloIn = stylex.keyframes({
  from: { opacity: 0, transform: "scale(0.7)" },
});
const flameIn = stylex.keyframes({
  "0%": { transform: "translateY(6px) scale(0) rotate(-14deg)" },
  "70%": { transform: "translateY(-2px) scale(1.12) rotate(4deg)" },
  "100%": { transform: "translateY(0) scale(1) rotate(0deg)" },
});
const flicker = stylex.keyframes({
  "0%, 100%": { transform: "rotate(-3deg) scaleY(1)" },
  "50%": { transform: "rotate(3deg) scaleY(1.06)" },
});
const ring = stylex.keyframes({
  "0%": { boxShadow: `0 0 0 0 ${color.chart2}` },
  "70%, 100%": { boxShadow: "0 0 0 7px transparent" },
});
const plop = stylex.keyframes({
  "0%": { transform: "translateY(-14px) scale(0.3)", opacity: 0 },
  "55%": { transform: "translateY(1px) scale(1.12, 0.9)", opacity: 1 },
  "80%": { transform: "translateY(-1px) scale(0.97, 1.03)" },
  "100%": { transform: "translateY(0) scale(1)" },
});
const tipIn = stylex.keyframes({
  from: { opacity: 0, transform: "translate(-50%, calc(-100% + 4px))" },
});

const s = stylex.create({
  wrap: {
    position: "relative",
    borderRadius: 14,
    outline: "none",
    boxShadow: { default: "none", ":focus-visible": `0 0 0 3px ${color.focus}` },
  },
  grid: {
    display: "grid",
    gridTemplateColumns: `auto repeat(${CALENDAR_WEEKS}, minmax(0, 1fr))`,
    columnGap: GAP,
    rowGap: GAP,
    alignItems: "center",
    isolation: "isolate",
  },
  month: { fontSize: 11.5, fontWeight: 650, color: color.textMuted, whiteSpace: "nowrap", lineHeight: 1, paddingBottom: 2 },
  weekday: { fontSize: 11.5, fontWeight: 600, color: color.textMuted, paddingRight: 4, lineHeight: 1 },
  cell: { position: "relative", aspectRatio: "1", cursor: "default" },
  dayCrown: { position: "absolute", top: "6%", left: "50%", zIndex: 2, display: "flex", transform: "translateX(-50%)", pointerEvents: "none", filter: "drop-shadow(0 1px 1px rgb(50 37 63 / 0.35))" },

  // Ribbon
  halo: {
    position: "absolute",
    inset: -4,
    borderRadius: 11,
    zIndex: 0,
    animationName: { default: haloIn, [bp.reduce]: "none" },
    animationDuration: "700ms",
    animationTimingFunction: motion.ease,
    animationFillMode: "backwards",
    animationDelay: "450ms",
  },
  // Opaque, so the overlapping pieces of one run (a halo per day, a bridge between days) show no seams.
  haloCurrent: { backgroundColor: `color-mix(in oklab, ${color.chart2} 26%, ${color.surface})` },
  haloPast: { backgroundColor: `color-mix(in oklab, ${color.chart1} 16%, ${color.surface})` },
  bridgeDown: { inset: "auto", left: -4, right: -4, top: "50%", height: `calc(100% + ${GAP}px)`, borderRadius: 0 },
  bridgeRight: { inset: "auto", top: -4, bottom: -4, left: "50%", width: `calc(100% + ${GAP}px)`, borderRadius: 0 },
  tile: {
    position: "absolute",
    inset: 0,
    zIndex: 1,
    display: "grid",
    placeItems: "center",
    borderRadius: 7,
    backgroundColor: color.chartTrack,
    transitionProperty: "transform, box-shadow",
    transitionDuration: motion.fast,
    transitionTimingFunction: motion.ease,
    animationName: { default: tileIn, [bp.reduce]: "none" },
    animationDuration: "520ms",
    animationTimingFunction: motion.ease,
    animationFillMode: "backwards",
  },
  lv1: { backgroundColor: `color-mix(in oklab, ${color.chart1} 32%, ${color.chartTrack})` },
  lv2: { backgroundColor: `color-mix(in oklab, ${color.chart1} 58%, ${color.chartTrack})` },
  lv3: { backgroundColor: `color-mix(in oklab, ${color.chart1} 84%, ${color.chartTrack})` },
  lv4: { backgroundColor: color.chart1, boxShadow: `inset 0 0 0 2px color-mix(in oklab, ${color.chart1} 60%, ${color.text})` },
  hot1: { backgroundColor: `color-mix(in oklab, ${color.chart2} 38%, ${color.chartTrack})` },
  hot2: { backgroundColor: `color-mix(in oklab, ${color.chart2} 62%, ${color.chartTrack})` },
  hot3: { backgroundColor: `color-mix(in oklab, ${color.chart2} 86%, ${color.chartTrack})` },
  hot4: { backgroundColor: color.chart2, boxShadow: `inset 0 0 0 2px color-mix(in oklab, ${color.chart2} 55%, white)` },
  tileFrozen: { backgroundColor: `color-mix(in oklab, ${color.fig4} 26%, ${color.surface})`, color: color.fig4 },
  tileFuture: { backgroundColor: "transparent", borderWidth: 1.5, borderStyle: "dashed", borderColor: color.border },
  tileToday: {
    outlineWidth: 2,
    outlineStyle: "solid",
    outlineColor: color.chart2,
    outlineOffset: 2,
  },
  tileTodayEmpty: { backgroundColor: "transparent", borderWidth: 1.5, borderStyle: "dashed", borderColor: color.chart2 },
  pulse: {
    animationName: { default: ring, [bp.reduce]: "none" },
    animationDuration: "1.8s",
    animationTimingFunction: "ease-out",
    animationIterationCount: "infinite",
    animationDelay: "1.2s",
  },
  tileHot: { transform: "scale(1.16)", boxShadow: `0 4px 10px -2px ${color.shadowStrong}`, zIndex: 3 },
  flame: {
    position: "absolute",
    zIndex: 4,
    inset: "-26%",
    pointerEvents: "none",
    transformOrigin: "50% 100%",
    animationName: { default: `${flameIn}, ${flicker}`, [bp.reduce]: "none" },
    animationDuration: "650ms, 2.4s",
    animationTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1), ease-in-out",
    animationDelay: "900ms, 1.55s",
    animationIterationCount: "1, infinite",
    animationFillMode: "backwards, none",
  },
  flameImg: { width: "100%", height: "100%", filter: "drop-shadow(0 2px 2px rgb(120 50 20 / 0.3))" },

  // Clay
  dimple: {
    position: "absolute",
    inset: "14%",
    borderRadius: "50%",
    backgroundColor: color.surface2,
    boxShadow: `inset 1px 2px 3px ${color.shadowStrong}, inset -1px -1px 1px color-mix(in oklab, ${color.surface} 70%, white)`,
  },
  dimpleFuture: { opacity: 0.45 },
  dimpleToday: {
    backgroundColor: "transparent",
    boxShadow: "none",
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: color.chart2,
  },
  sphere: {
    position: "absolute",
    zIndex: 1,
    left: "50%",
    top: "50%",
    display: "grid",
    placeItems: "center",
    borderRadius: "50%",
    color: "white",
    transitionProperty: "translate, scale",
    transitionDuration: motion.base,
    transitionTimingFunction: motion.ease,
    animationName: { default: plop, [bp.reduce]: "none" },
    animationDuration: "620ms",
    animationTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)",
    animationFillMode: "backwards",
  },
  sphereHot: { translate: "0 -3px", scale: "1.1", zIndex: 3 },
  sphereLook: (size: number, image: string, shadow: string) => ({
    width: `${size}%`,
    height: `${size}%`,
    marginLeft: `${-size / 2}%`,
    marginTop: `${-size / 2}%`,
    backgroundImage: image,
    boxShadow: shadow,
  }),
  clayFlame: {
    position: "absolute",
    zIndex: 2,
    inset: "-22%",
    pointerEvents: "none",
    transformOrigin: "50% 90%",
    animationName: { default: `${plop}, ${flicker}`, [bp.reduce]: "none" },
    animationDuration: "700ms, 2.4s",
    animationTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1), ease-in-out",
    animationIterationCount: "1, infinite",
    animationFillMode: "backwards, none",
  },
  delay: (ms: number) => ({ animationDelay: `${ms}ms` }),
  delays: (ms: number) => ({ animationDelay: `${ms}ms, ${ms + 700}ms` }),

  tip: {
    position: "absolute",
    zIndex: 10,
    transform: "translate(-50%, -100%)",
    paddingBlock: 7,
    paddingInline: 11,
    borderRadius: 11,
    backgroundColor: color.primary,
    color: color.onPrimary,
    fontFamily: font.body,
    fontSize: 12.5,
    fontWeight: 600,
    whiteSpace: "nowrap",
    pointerEvents: "none",
    boxShadow: `0 6px 18px -6px ${color.shadowStrong}`,
    animationName: { default: tipIn, [bp.reduce]: "none" },
    animationDuration: motion.fast,
    animationTimingFunction: motion.ease,
  },
  tipPos: (x: number, y: number) => ({ left: x, top: y }),
});

// Clay objects keep their colours in both themes, like the clay illustrations.
const CLAY = { lilac: "#A99BEA", peach: "#F6B196", ember: "#E3602F", ice: "#93C8E4" };

function clayLook(d: CalendarDay, goal: number): { size: number; image: string; shadow: string } {
  const base = d.frozen
    ? CLAY.ice
    : d.current
      ? `color-mix(in oklab, ${CLAY.ember} ${Math.round(d.heat * 100)}%, ${CLAY.peach})`
      : CLAY.lilac;
  const size = d.frozen ? 62 : 40 + 52 * Math.min(1, d.minutes / (2 * goal));
  const sheen = d.level >= 3 ? "radial-gradient(circle at 31% 27%, rgb(255 255 255 / 0.95) 0 7%, rgb(255 255 255 / 0) 17%), " : "";
  const body = `radial-gradient(circle at 34% 30%, color-mix(in oklab, ${base}, white 48%) 0%, ${base} 46%, color-mix(in oklab, ${base}, black 26%) 100%)`;
  const glow = d.current && d.heat > 0.6 ? `, 0 0 ${Math.round(6 + 8 * d.heat)}px -1px color-mix(in oklab, ${CLAY.ember} 70%, transparent)` : "";
  return { size, image: sheen + body, shadow: `0 3px 5px -1px rgb(70 35 20 / 0.32), inset -2px -3px 5px rgb(0 0 0 / 0.12)${glow}` };
}

/**
 * Ten weeks of study days. `ribbon`: tiles shaded by minutes against the daily goal, runs of days joined
 * into one shape, the current streak in warm tiles with a flame at its end. `clay`: clay balls sized by minutes,
 * warming along the current streak. Hover or arrow keys show a day's numbers.
 */
export function ActivityCalendar({ days, variant, goal, label }: { days: CalendarDay[]; variant: "ribbon" | "clay"; goal: number; label: string }) {
  useLang();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null);
  const active = hover ?? cursor;
  const shown = active !== null && !days[active]!.future ? active : null;
  const lastPast = days.findLastIndex((d) => !d.future);
  const months = monthLabels(days);
  const crowned = useDayCrowns();
  const describeDay = (d: CalendarDay) => (crowned?.has(d.key) ? `${describe(d)} · ${t("game.dayCrown")}` : describe(d));

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    const el = shown === null ? null : wrap?.querySelector<HTMLElement>(`[data-idx="${shown}"]`);
    if (!wrap || !el) return setTip(null);
    const w = wrap.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const half = 84;
    setTip({ x: Math.min(Math.max(r.left + r.width / 2 - w.left, half), w.width - half), y: r.top - w.top - 8 });
  }, [shown]);

  const onPointer = (e: PointerEvent) => {
    const idx = (e.target as HTMLElement).closest<HTMLElement>("[data-idx]")?.dataset.idx;
    setHover(idx === undefined ? null : Number(idx));
  };
  const onKey = (e: KeyboardEvent) => {
    const step = { ArrowLeft: -ROWS, ArrowRight: ROWS, ArrowUp: -1, ArrowDown: 1 }[e.key];
    if (step === undefined && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    setHover(null);
    setCursor((c) => {
      if (e.key === "Home") return 0;
      if (e.key === "End") return lastPast;
      return Math.min(Math.max((c ?? lastPast) + step!, 0), lastPast);
    });
  };

  const sameRun = (a: CalendarDay, b: CalendarDay | undefined) => !!b && a.run !== null && b.run === a.run && (a.runLength > 1 || a.current);

  const cell = (d: CalendarDay, i: number) => {
    const row = i % ROWS;
    const col = Math.floor(i / ROWS);
    const hot = shown === i;
    if (variant === "ribbon") {
      const inRun = d.run !== null && (d.runLength > 1 || d.current);
      const haloTone = d.current ? s.haloCurrent : s.haloPast;
      return (
        <>
          {inRun && <span aria-hidden="true" {...stylex.props(s.halo, haloTone)} />}
          {inRun && row < ROWS - 1 && sameRun(d, days[i + 1]) && <span aria-hidden="true" {...stylex.props(s.halo, haloTone, s.bridgeDown)} />}
          {inRun && sameRun(d, days[i + ROWS]) && <span aria-hidden="true" {...stylex.props(s.halo, haloTone, s.bridgeRight)} />}
          <span
            aria-hidden="true"
            {...stylex.props(
              s.tile,
              s.delay((col + row) * 24),
              d.level === 1 && (d.current ? s.hot1 : s.lv1),
              d.level === 2 && (d.current ? s.hot2 : s.lv2),
              d.level === 3 && (d.current ? s.hot3 : s.lv3),
              d.level === 4 && (d.current ? s.hot4 : s.lv4),
              d.frozen && s.tileFrozen,
              d.future && s.tileFuture,
              d.today && (d.active ? s.tileToday : s.tileTodayEmpty),
              d.today && s.pulse,
              hot && s.tileHot,
            )}
          >
            {d.frozen && <Snowflake size="62%" strokeWidth={2.4} />}
          </span>
          {d.head && (
            <span aria-hidden="true" {...stylex.props(s.flame)}>
              <Clay name="streak-flame" size={64} xstyle={s.flameImg} eager />
            </span>
          )}
        </>
      );
    }
    const look = d.active || d.frozen ? clayLook(d, goal) : null;
    return (
      <>
        <span aria-hidden="true" {...stylex.props(s.dimple, d.future && s.dimpleFuture, d.today && !d.active && s.dimpleToday, d.today && !d.active && s.pulse)} />
        {d.head ? (
          <span aria-hidden="true" {...stylex.props(s.clayFlame, s.delays(i * 14))}>
            <Clay name="streak-flame" size={64} xstyle={s.flameImg} eager />
          </span>
        ) : (
          look && (
            <span aria-hidden="true" {...stylex.props(s.sphere, s.sphereLook(look.size, look.image, look.shadow), s.delay(i * 14), hot && s.sphereHot)}>
              {d.frozen && <Snowflake size="64%" strokeWidth={2.6} />}
            </span>
          )
        )}
      </>
    );
  };

  return (
    <div
      ref={wrapRef}
      tabIndex={0}
      role="group"
      aria-label={`${label}. ${t("calendar.arrowsHint")}`}
      onPointerMove={onPointer}
      onPointerLeave={() => setHover(null)}
      onFocus={() => setCursor((c) => c ?? lastPast)}
      onBlur={() => setCursor(null)}
      onKeyDown={onKey}
      {...stylex.props(s.wrap)}
    >
      <div {...stylex.props(s.grid)}>
        <span />
        {months.map((m, c) => (
          <span key={`m${c}`} {...stylex.props(s.month)}>
            {m}
          </span>
        ))}
        {weekdays().map((w, row) => [
          <span key={`w${row}`} aria-hidden="true" {...stylex.props(s.weekday)}>
            {w}
          </span>,
          ...Array.from({ length: CALENDAR_WEEKS }, (_, col) => {
            const i = col * ROWS + row;
            const d = days[i]!;
            return (
              <div key={d.key} data-idx={i} {...stylex.props(s.cell)}>
                {cell(d, i)}
                {crowned?.has(d.key) && !d.head && (
                  <span aria-hidden="true" {...stylex.props(s.dayCrown)}>
                    <Crown size={10} strokeWidth={2.2} color="#865000" fill="#F6C453" />
                  </span>
                )}
              </div>
            );
          }),
        ])}
      </div>
      {tip && shown !== null && (
        <div key={shown} {...stylex.props(s.tip, s.tipPos(tip.x, tip.y))}>
          {describeDay(days[shown]!)}
        </div>
      )}
      <p aria-live="polite" {...stylex.props(layout.srOnly)}>
        {cursor !== null && hover === null && !days[cursor]!.future ? describeDay(days[cursor]!) : ""}
      </p>
    </div>
  );
}

/** Shades used by the ribbon legend, lightest first. */
export function RibbonLegend() {
  useLang();
  return (
    <span aria-hidden="true" {...stylex.props(legend.row)}>
      {t("calendar.less")}
      {[legend.l0, legend.l1, legend.l2, legend.l3, legend.l4].map((l, i) => (
        <i key={i} {...stylex.props(legend.sw, l)} />
      ))}
      {t("calendar.overGoal")}
      <i {...stylex.props(legend.sw, legend.hot)} />
      {t("calendar.currentStreak")}
      <i {...stylex.props(legend.sw, legend.ice)}>
        <Snowflake size={9} strokeWidth={3} />
      </i>
      {t("calendar.freeze")}
    </span>
  );
}

const legend = stylex.create({
  row: { display: "inline-flex", alignItems: "center", flexWrap: "wrap", gap: 5, fontSize: 12, color: color.textMuted },
  sw: { display: "inline-grid", placeItems: "center", width: 12, height: 12, borderRadius: 3.5, backgroundColor: color.chartTrack },
  l0: { backgroundColor: color.chartTrack },
  l1: { backgroundColor: `color-mix(in oklab, ${color.chart1} 32%, ${color.chartTrack})` },
  l2: { backgroundColor: `color-mix(in oklab, ${color.chart1} 58%, ${color.chartTrack})` },
  l3: { backgroundColor: `color-mix(in oklab, ${color.chart1} 84%, ${color.chartTrack})` },
  l4: { backgroundColor: color.chart1 },
  hot: { marginLeft: 6, backgroundColor: color.chart2 },
  ice: { marginLeft: 6, backgroundColor: `color-mix(in oklab, ${color.fig4} 26%, ${color.surface})`, color: color.fig4 },
});
