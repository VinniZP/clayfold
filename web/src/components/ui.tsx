import * as stylex from "@stylexjs/stylex";
import { LoaderCircle, RefreshCw, TriangleAlert } from "lucide-react";
import { useState, type ReactNode } from "react";
import { errorText } from "../lib/api";
import { t, useLang } from "../lib/i18n";
import { renderInline, renderMarkdown } from "../lib/markdown";
import { bp, color, radius } from "../theme/tokens.stylex";
import { btn, card, layout, text } from "../theme/ui";

const spin = stylex.keyframes({ to: { transform: "rotate(360deg)" } });
const shimmer = stylex.keyframes({ from: { backgroundPosition: "100% 0" }, to: { backgroundPosition: "-100% 0" } });

const s = stylex.create({
  spinner: { display: "inline-grid", placeItems: "center", color: "currentColor", flexShrink: 0 },
  spinnerIcon: { animationName: spin, animationDuration: "0.9s", animationTimingFunction: "linear", animationIterationCount: "infinite" },
  errorBox: {
    display: "flex",
    alignItems: "flex-start",
    gap: 12,
    paddingBlock: 14,
    paddingInline: 18,
    borderRadius: radius.inner,
    backgroundColor: color.dangerSoft,
    color: color.text,
  },
  errorIcon: { flexShrink: 0, color: color.danger, marginTop: 2 },
  grow: { flexGrow: 1 },
  errorTitle: { fontWeight: 650, color: color.danger },
  errorText: { fontSize: 14 },
  empty: {
    display: "flex",
    alignItems: "center",
    gap: 16,
    paddingBlock: 18,
    paddingInline: 20,
    borderRadius: radius.inner,
    backgroundColor: color.surface2,
  },
  emptyArt: { flexShrink: 0, display: { default: "block", [bp.phone]: "none" } },
  emptyBody: { display: "grid", gap: 4, justifyItems: "start" },
  emptyTitle: { fontWeight: 700 },
  emptyText: { maxWidth: "52ch", color: color.textMuted, fontSize: 14 },
  emptyAction: { marginTop: 8 },
  skeletonLines: { display: "grid", gap: 12 },
  skeleton: {
    height: 14,
    borderRadius: 8,
    backgroundImage: `linear-gradient(90deg, ${color.surface2} 0%, ${color.surface3} 50%, ${color.surface2} 100%)`,
    backgroundSize: "200% 100%",
    animationName: shimmer,
    animationDuration: "1.4s",
    animationTimingFunction: "ease-in-out",
    animationIterationCount: "infinite",
  },
  skeletonHeight: (h: number) => ({ height: h }),
  skeletonWidth: (w: number) => ({ width: `${w}%` }),
  grid: { display: "grid", gridTemplateColumns: "repeat(12, minmax(0, 1fr))", gap: 16 },
  span8: { gridColumn: { default: "span 8", [bp.mobile]: "1 / -1" } },
  span4: { gridColumn: { default: "span 4", [bp.mobile]: "1 / -1" } },
  span12: { gridColumn: "1 / -1" },
  progress: { height: 8, borderRadius: radius.pill, backgroundColor: color.chartTrack, overflow: "hidden" },
  progressOnCard: { backgroundColor: color.surface },
  progressFill: { height: "100%", borderRadius: radius.pill, backgroundColor: color.primary, transitionProperty: "clip-path", transitionDuration: "220ms" },
  progressClip: (pct: number) => ({ clipPath: `inset(0 ${100 - pct}% 0 0 round 999px)` }),
  cardHead: { display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 18, minHeight: 34 },
  cardHeadAside: { display: "flex", alignItems: "center", gap: 8 },
});

/** Markdown from the model, sanitized; inner elements are styled by `.prose` in styles/global.css. */
export function Markdown({ src, inline, xstyle }: { src: string; inline?: boolean; xstyle?: stylex.StyleXStyles }) {
  const html = inline ? renderInline(src) : renderMarkdown(src);
  if (inline) return <span {...stylex.props(xstyle)} dangerouslySetInnerHTML={{ __html: html }} />;
  const p = stylex.props(xstyle);
  return <div className={`prose ${p.className ?? ""}`} style={p.style} dangerouslySetInnerHTML={{ __html: html }} />;
}

export function Spinner({ label, size = 16 }: { label?: string; size?: number }) {
  return (
    <span {...stylex.props(s.spinner)} role={label ? "status" : undefined}>
      <LoaderCircle size={size} aria-hidden="true" {...stylex.props(s.spinnerIcon)} />
      {label && <span {...stylex.props(layout.srOnly)}>{label}</span>}
    </span>
  );
}

export function ErrorBox({ error, onRetry, title = t("common.loadFailed") }: { error: unknown; onRetry?: () => void; title?: string }) {
  useLang();
  return (
    <div {...stylex.props(s.errorBox)} role="alert">
      <TriangleAlert size={18} aria-hidden="true" {...stylex.props(s.errorIcon)} />
      <div {...stylex.props(s.grow)}>
        <p {...stylex.props(s.errorTitle)}>{title}</p>
        <p {...stylex.props(s.errorText)}>{errorText(error)}</p>
      </div>
      {onRetry && (
        <button type="button" {...stylex.props(btn.base, btn.ghost, btn.sm)} onClick={onRetry}>
          <RefreshCw size={14} aria-hidden="true" /> {t("common.retry")}
        </button>
      )}
    </div>
  );
}

export function Empty({ title, children, action, art = "empty-seedling" }: { title: string; children?: ReactNode; action?: ReactNode; art?: ClayName | null }) {
  return (
    <div {...stylex.props(s.empty)}>
      {art && <Clay name={art} size={64} xstyle={s.emptyArt} />}
      <div {...stylex.props(s.emptyBody)}>
        <p {...stylex.props(s.emptyTitle)}>{title}</p>
        {children && <p {...stylex.props(s.emptyText)}>{children}</p>}
        {action && <div {...stylex.props(s.emptyAction)}>{action}</div>}
      </div>
    </div>
  );
}

export function Skeleton({ lines = 3, height }: { lines?: number; height?: number }) {
  if (height) return <div {...stylex.props(s.skeleton, s.skeletonHeight(height))} aria-hidden="true" />;
  return (
    <div {...stylex.props(s.skeletonLines)} aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} {...stylex.props(s.skeleton, s.skeletonWidth(92 - i * 14))} />
      ))}
    </div>
  );
}

export function PageLoading({ label = t("common.loading") }: { label?: string }) {
  useLang();
  return (
    <div {...stylex.props(s.grid)} aria-busy="true">
      <span {...stylex.props(layout.srOnly)} role="status">
        {label}
      </span>
      <section {...stylex.props(card.base, s.span8)}>
        <Skeleton lines={4} />
      </section>
      <section {...stylex.props(card.base, s.span4)}>
        <Skeleton height={160} />
      </section>
      <section {...stylex.props(card.base, s.span12)}>
        <Skeleton lines={3} />
      </section>
    </div>
  );
}

export function Progress({
  value,
  max,
  label,
  onCard,
  fill,
}: {
  value: number;
  max: number;
  label: string;
  onCard?: boolean;
  fill?: stylex.StyleXStyles;
}) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div
      {...stylex.props(s.progress, onCard && s.progressOnCard)}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-label={label}
    >
      <div {...stylex.props(s.progressFill, fill, s.progressClip(pct))} />
    </div>
  );
}

export function CardHead({ title, children, id }: { title: string; children?: ReactNode; id?: string }) {
  return (
    <div {...stylex.props(s.cardHead)}>
      <h2 id={id} {...stylex.props(text.h2)}>
        {title}
      </h2>
      {children && <div {...stylex.props(s.cardHeadAside)}>{children}</div>}
    </div>
  );
}

export const CLAY_TOPICS = [
  "topic-book",
  "topic-chart",
  "topic-branch",
  "topic-mat",
  "topic-bulb",
  "topic-globe",
  "topic-gear",
  "topic-code",
  "topic-flask",
  "topic-palette",
  "topic-note",
  "topic-brain",
  "topic-calculator",
  "topic-leaf",
] as const;

export type ClayName =
  | "hero-knot"
  | "tutor-avatar"
  | "tutor-reading"
  | "spheres"
  | "cards-stack"
  | "streak-flame"
  | "empty-seedling"
  | "search-magnifier"
  | (typeof CLAY_TOPICS)[number];

/** Decorative clay object (chrome only, never inside lesson content: V1). Hidden if the file is missing. */
export function Clay({ name, size, xstyle, eager }: { name: ClayName; size: number; xstyle?: stylex.StyleXStyles; eager?: boolean }) {
  const [missing, setMissing] = useState(false);
  if (missing) return null;
  const file = size > 200 ? 512 : 256;
  return (
    <img
      src={`/clay-web/${name}-${file}.webp`}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      draggable={false}
      onError={() => setMissing(true)}
      {...stylex.props(xstyle)}
    />
  );
}
