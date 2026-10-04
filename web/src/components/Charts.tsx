import * as stylex from "@stylexjs/stylex";
import { useId } from "react";
import { bp, color, font, radius } from "../theme/tokens.stylex";
import { layout, text } from "../theme/ui";

const s = stylex.create({
  bars: { display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: { default: 10, [bp.phone]: 6 }, alignItems: "end" },
  bar: { display: "grid", justifyItems: "center", gap: 6 },
  barValue: { minHeight: 18, fontSize: 13, fontWeight: 700, fontVariantNumeric: "tabular-nums" },
  track: { position: "relative", width: "100%", maxWidth: 40, height: 150, borderRadius: 14, backgroundColor: color.chartTrack, overflow: "hidden" },
  fill: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 14,
    borderWidth: 1.5,
    borderStyle: "solid",
    borderColor: color.chart1,
    backgroundImage: `repeating-linear-gradient(135deg, ${color.chart1} 0 2.5px, transparent 2.5px 7px)`,
  },
  fillToday: { backgroundImage: "none", backgroundColor: color.primary, borderColor: color.primary },
  fillHeight: (pct: number) => ({ height: `${pct}%` }),
  barLabel: { fontSize: 12.5, fontWeight: 600, color: color.textMuted },
  barLabelToday: { color: color.text, fontWeight: 750 },
  rings: { display: "grid", justifyItems: "center", gap: 16 },
  ringTrack: { stroke: color.chartTrack },
  tone1: { stroke: color.chart1 },
  tone2: { stroke: color.chart2 },
  tone3: { stroke: color.chart3 },
  legend: { display: "grid", gap: 6, width: "100%", margin: 0, padding: 0, listStyle: "none" },
  legendRow: { display: "grid", gridTemplateColumns: "10px 1fr auto", columnGap: 8, alignItems: "center", fontSize: 13.5 },
  swatch: { width: 10, height: 10, borderRadius: 3 },
  sw1: { backgroundColor: color.chart1 },
  sw2: { backgroundColor: color.chart2 },
  sw3: { backgroundColor: color.chart3 },
  legendLabel: { fontWeight: 650 },
  legendValue: { fontWeight: 750, fontVariantNumeric: "tabular-nums" },
  legendDetail: { gridColumn: "2 / -1", fontSize: 12.5, color: color.textMuted },
  gauge: { position: "relative", maxWidth: 280, width: "100%", marginInline: "auto" },
  gaugeSvg: { width: "100%", height: "auto" },
  seg: { fill: color.chartTrack },
  segOn: { fill: color.chart1 },
  gaugeValue: { position: "absolute", left: 0, right: 0, bottom: 0, textAlign: "center", fontFamily: font.display, fontSize: 46, fontWeight: 800, lineHeight: 1, letterSpacing: "-0.04em" },
  gaugePct: { fontSize: 20, marginLeft: 2, color: color.textMuted },
  week: { display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, margin: 0, padding: 0, listStyle: "none" },
  weekDay: { display: "grid", justifyItems: "center", gap: 6, fontSize: 12.5, color: color.textMuted },
  weekDot: { width: 22, height: 22, borderRadius: radius.pill, borderWidth: 1.5, borderStyle: "solid", borderColor: color.borderStrong },
  weekDotOn: { backgroundColor: color.chart2, borderColor: color.chart2 },
  shares: { display: "grid", gap: 12, margin: 0, padding: 0, listStyle: "none" },
  sharesDense: { gap: 6 },
  share: { display: "grid", gridTemplateColumns: "minmax(84px, 7.5em) minmax(0, 1fr) 3.4em", columnGap: 12, alignItems: "center" },
  shareLabel: { fontSize: 14, fontWeight: 650 },
  shareLabelDense: { fontSize: 12.5, fontWeight: 600, color: color.textMuted },
  shareTrack: { position: "relative", height: 14, borderRadius: radius.pill, backgroundColor: color.chartTrack, overflow: "hidden" },
  shareTrackDense: { height: 8 },
  shareFill: { position: "absolute", left: 0, top: 0, bottom: 0, borderRadius: radius.pill, backgroundColor: color.chart1 },
  shareFew: {
    backgroundColor: "transparent",
    boxShadow: `inset 0 0 0 1.5px ${color.chart1}`,
    backgroundImage: `repeating-linear-gradient(135deg, ${color.chart1} 0 2px, transparent 2px 6px)`,
  },
  shareWidth: (pct: number) => ({ width: `${pct}%` }),
  shareValue: { textAlign: "right", fontSize: 14, fontWeight: 750, fontVariantNumeric: "tabular-nums" },
  shareValueDense: { fontSize: 12.5, fontWeight: 700 },
  shareDetail: { gridColumn: "2 / -1", marginTop: 4, fontSize: 12.5, color: color.textMuted },
});

export type ShareRow = { label: string; /** 0–1; null without data. */ share: number | null; detail: string; /** Too little data to read; drawn hatched. */ few: boolean };

/** Shares on a 0–100% track, one row each, values written beside the bars; `dense` drops the detail line. */
export function ShareBars({ rows, dense = false, label }: { rows: ShareRow[]; dense?: boolean; label: string }) {
  return (
    <ul aria-label={label} {...stylex.props(s.shares, dense && s.sharesDense)}>
      {rows.map((r) => {
        const pct = r.share === null ? null : Math.round(r.share * 100);
        return (
          <li key={r.label} {...stylex.props(s.share)}>
            <span {...stylex.props(dense ? s.shareLabelDense : s.shareLabel)}>{r.label}</span>
            <span aria-hidden="true" {...stylex.props(s.shareTrack, dense && s.shareTrackDense)}>
              {pct !== null && pct > 0 && <span {...stylex.props(s.shareFill, r.few && s.shareFew, s.shareWidth(pct))} />}
            </span>
            <span {...stylex.props(s.shareValue, dense && s.shareValueDense, r.few && text.muted)}>{pct === null ? "—" : `${pct}%`}</span>
            <span {...stylex.props(dense ? layout.srOnly : s.shareDetail)}>{r.detail}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** Weekly bars: hatched fill over a light full-height track; `highlight` gets a solid fill. */
export function HatchedBars({ data, highlight, unit }: { data: { label: string; value: number }[]; highlight?: number; unit: (n: number) => string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const summary = data.map((d) => `${d.label}: ${unit(d.value)}`).join(", ");
  return (
    <div role="img" aria-label={summary} {...stylex.props(s.bars)}>
      {data.map((d, i) => (
        <div key={d.label} {...stylex.props(s.bar)}>
          <span aria-hidden="true" {...stylex.props(s.barValue)}>
            {d.value > 0 ? d.value : ""}
          </span>
          <div aria-hidden="true" {...stylex.props(s.track)}>
            {d.value > 0 && <div {...stylex.props(s.fill, i === highlight && s.fillToday, s.fillHeight((d.value / max) * 100))} />}
          </div>
          <span aria-hidden="true" {...stylex.props(s.barLabel, i === highlight && s.barLabelToday)}>
            {d.label}
          </span>
        </div>
      ))}
    </div>
  );
}

const TONE = { 1: s.tone1, 2: s.tone2, 3: s.tone3 } as const;
const SWATCH = { 1: s.sw1, 2: s.sw2, 3: s.sw3 } as const;

/** Concentric progress rings, outermost first. */
export function Rings({ rings }: { rings: { label: string; value: number; detail: string; tone: 1 | 2 | 3 }[] }) {
  const size = 148;
  const stroke = 12;
  const gap = 5;
  return (
    <div {...stylex.props(s.rings)}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden="true">
        {rings.map((r, i) => {
          const radiusPx = size / 2 - stroke / 2 - i * (stroke + gap);
          const c = 2 * Math.PI * radiusPx;
          const v = Math.max(0, Math.min(1, r.value));
          return (
            <g key={r.label} transform={`rotate(-90 ${size / 2} ${size / 2})`}>
              <circle cx={size / 2} cy={size / 2} r={radiusPx} strokeWidth={stroke} fill="none" {...stylex.props(s.ringTrack)} />
              {v > 0 && (
                <circle
                  cx={size / 2}
                  cy={size / 2}
                  r={radiusPx}
                  strokeWidth={stroke}
                  fill="none"
                  strokeLinecap="round"
                  strokeDasharray={`${Math.max(0.001, v * c)} ${c}`}
                  {...stylex.props(TONE[r.tone])}
                />
              )}
            </g>
          );
        })}
      </svg>
      <ul {...stylex.props(s.legend)}>
        {rings.map((r) => (
          <li key={r.label} {...stylex.props(s.legendRow)}>
            <i aria-hidden="true" {...stylex.props(s.swatch, SWATCH[r.tone])} />
            <span {...stylex.props(s.legendLabel)}>{r.label}</span>
            <span {...stylex.props(s.legendValue)}>{Math.round(r.value * 100)}%</span>
            <span {...stylex.props(s.legendDetail)}>{r.detail}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One week as filled / empty day dots with weekday labels. */
export function WeekDots({ days, label }: { days: { label: string; active: boolean }[]; label: string }) {
  return (
    <ul aria-label={label} {...stylex.props(s.week)}>
      {days.map((d) => (
        <li key={d.label} {...stylex.props(s.weekDay)}>
          <span aria-hidden="true" {...stylex.props(s.weekDot, d.active && s.weekDotOn)} />
          <span aria-hidden="true">{d.label}</span>
        </li>
      ))}
    </ul>
  );
}

/** Semicircle made of segments; filled share = value. */
export function Gauge({ value, segments = 22, caption }: { value: number; segments?: number; caption: string }) {
  const id = useId();
  const v = Math.max(0, Math.min(1, value));
  const filled = Math.round(v * segments);
  const cx = 120;
  const cy = 118;
  const r1 = 84;
  const r2 = 112;
  const span = Math.PI / segments;
  const pad = span * 0.18;
  return (
    <div {...stylex.props(s.gauge)}>
      <svg viewBox="0 0 240 128" role="img" aria-labelledby={id} {...stylex.props(s.gaugeSvg)}>
        <title id={id}>{`${Math.round(v * 100)}% — ${caption}`}</title>
        {Array.from({ length: segments }, (_, i) => {
          const a0 = Math.PI + i * span + pad / 2;
          const a1 = Math.PI + (i + 1) * span - pad / 2;
          const p = (r: number, a: number) => `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`;
          return (
            <path
              key={i}
              d={`M${p(r1, a0)} L${p(r2, a0)} A${r2},${r2} 0 0 1 ${p(r2, a1)} L${p(r1, a1)} A${r1},${r1} 0 0 0 ${p(r1, a0)} Z`}
              {...stylex.props(s.seg, i < filled && s.segOn)}
            />
          );
        })}
      </svg>
      <div aria-hidden="true" {...stylex.props(s.gaugeValue)}>
        <span {...stylex.props(text.tnum)}>{Math.round(v * 100)}</span>
        <small {...stylex.props(s.gaugePct)}>%</small>
      </div>
    </div>
  );
}
