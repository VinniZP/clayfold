import * as stylex from "@stylexjs/stylex";
import { Square, SquareTerminal, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import type { ClaudeInstance, SystemView } from "@shared/api";
import { setClaudeMode } from "../lib/claudeMode";
import { useElapsed } from "../lib/elapsed";
import { formatDateTime, formatUsd } from "../lib/format";
import { api, errorText } from "../lib/api";
import { t, useLang } from "../lib/i18n";
import { useOverlayScroll } from "../lib/overlayScroll";
import { bp, color, font, radius } from "../theme/tokens.stylex";
import { btn, layout, shadow, text } from "../theme/ui";

const POLL_MS = 2000;

const s = stylex.create({
  panel: {
    position: "fixed",
    zIndex: 40,
    right: { default: 24, [bp.mobile]: 8 },
    bottom: { default: 24, [bp.mobile]: 8 },
    left: { default: "auto", [bp.mobile]: 8 },
    width: { default: 420, [bp.mobile]: "auto" },
    maxHeight: "min(72vh, 680px)",
    display: "flex",
    flexDirection: "column",
    borderRadius: radius.inner,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: color.border,
    backgroundColor: color.surface,
    color: color.text,
  },
  head: { display: "flex", alignItems: "center", gap: 10, paddingBlock: 10, paddingInline: "16px 10px", borderBottomWidth: 1, borderBottomStyle: "solid", borderBottomColor: color.border },
  title: { fontFamily: font.display, fontSize: 16, fontWeight: 750, marginRight: "auto" },
  body: { overflow: "auto", display: "grid", gap: 16, paddingBlock: 14, paddingInline: 16 },
  section: { display: "grid", gap: 8 },
  factRow: { display: "contents" },
  instances: { display: "grid", gap: 8 },
  sectionTitle: { margin: 0, fontSize: 12.5, fontWeight: 750, letterSpacing: "0.04em", textTransform: "uppercase", color: color.textMuted },
  facts: { display: "grid", gridTemplateColumns: "10rem minmax(0, 1fr)", gap: "4px 14px", margin: 0, fontSize: 13.5 },
  term: { color: color.textMuted },
  value: { margin: 0, fontVariantNumeric: "tabular-nums", overflowWrap: "anywhere" },
  instance: { display: "grid", gap: 4, paddingBlock: 10, paddingInline: 12, borderRadius: radius.small, backgroundColor: color.surface2 },
  instanceHead: { display: "flex", alignItems: "center", gap: 8, minWidth: 0 },
  kind: { flexShrink: 0, paddingBlock: 2, paddingInline: 8, borderRadius: radius.pill, backgroundColor: color.lilac, color: color.onLilac, fontSize: 12, fontWeight: 700 },
  where: { flexGrow: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 14, fontWeight: 600, color: color.text },
  elapsed: { flexShrink: 0, fontVariantNumeric: "tabular-nums", fontSize: 13, color: color.textMuted },
  meta: { fontFamily: font.mono, fontSize: 12, color: color.textMuted, overflowWrap: "anywhere" },
  stopFailed: { color: color.danger },
  live: { width: 8, height: 8, borderRadius: "50%", backgroundColor: color.success },
  stale: { backgroundColor: color.danger },
});

const mb = (v: number) => `${v.toFixed(v < 10 ? 1 : 0)} MB`;
const pct = (v: number) => `${v.toFixed(1)}%`;

function buildLabel(builtAt: string | null): string {
  if (__MOCK__) return t("claudeMode.build.mock");
  if (import.meta.env.DEV) return t("claudeMode.build.dev");
  return builtAt ? t("claudeMode.build.dist", { date: formatDateTime(builtAt) }) : t("claudeMode.build.missing");
}

function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl {...stylex.props(s.facts)}>
      {rows.map(([term, value]) => (
        <div key={term} {...stylex.props(s.factRow)}>
          <dt {...stylex.props(s.term)}>{term}</dt>
          <dd {...stylex.props(s.value)}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Uptime({ since }: { since: string }) {
  return <>{useElapsed(since)}</>;
}

function StopButton({ conversationId }: { conversationId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const stop = () => {
    setBusy(true);
    setError(null);
    // The instance leaves the list on a later poll; until then the button stays disabled.
    api.cancel(conversationId).catch((e: unknown) => {
      setError(e);
      setBusy(false);
    });
  };
  return (
    <button
      type="button"
      disabled={busy}
      aria-label={t("claudeMode.stop")}
      title={error ? errorText(error) : t("claudeMode.stop")}
      onClick={stop}
      {...stylex.props(btn.base, btn.icon, btn.iconSm, Boolean(error) && s.stopFailed)}
    >
      <Square size={12} aria-hidden="true" />
    </button>
  );
}

function Instance({ instance: it }: { instance: ClaudeInstance }) {
  useLang();
  const elapsed = useElapsed(it.startedAt);
  const to = it.lessonId ? `/lessons/${encodeURIComponent(it.lessonId)}` : it.topicId ? `/topics/${encodeURIComponent(it.topicId)}` : null;
  const meta = [
    `PID ${it.pid}`,
    it.model,
    it.effort ? t("claudeMode.effort", { effort: t(`settings.effort.${it.effort}`) }) : null,
    it.rssMb !== null ? mb(it.rssMb) : null,
    it.cpuPercent !== null ? `CPU ${pct(it.cpuPercent)}` : null,
    it.queued ? t("claudeMode.queued", { count: it.queued }) : null,
  ].filter(Boolean);
  return (
    <li {...stylex.props(s.instance)}>
      <div {...stylex.props(s.instanceHead)}>
        <span {...stylex.props(s.kind)}>{t(`claudeMode.kind.${it.kind}`)}</span>
        {to && it.topicTitle ? (
          <Link to={to} {...stylex.props(s.where)}>
            {it.topicTitle}
          </Link>
        ) : (
          <span {...stylex.props(s.where)} />
        )}
        <span {...stylex.props(s.elapsed)}>{elapsed}</span>
        {it.conversationId && <StopButton conversationId={it.conversationId} />}
      </div>
      {it.activities.length > 0 && <span {...stylex.props(text.small)}>{it.activities.at(-1)}</span>}
      <span {...stylex.props(s.meta)}>{meta.join(" · ")}</span>
    </li>
  );
}

/** Polls /api/system while the tab is visible. */
function useSystem(): { view: SystemView | null; error: unknown } {
  const [view, setView] = useState<SystemView | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const poll = () =>
      api.system().then(
        (v) => {
          setView(v);
          setError(null);
        },
        (e: unknown) => setError(e),
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
    const onVisibility = () => (document.hidden ? stop() : start());
    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);
  return { view, error };
}

export function ClaudePanel() {
  useLang();
  const { view, error } = useSystem();
  const body = useRef<HTMLDivElement>(null);
  useOverlayScroll(body);
  const b = view?.backend;
  const f = view?.frontend;
  return (
    <aside aria-label={t("claudeMode.label")} {...stylex.props(s.panel, shadow.pop)}>
      <div {...stylex.props(s.head)}>
        <SquareTerminal size={18} aria-hidden="true" />
        <h2 {...stylex.props(s.title)}>{t("claudeMode.title")}</h2>
        <span
          role="img"
          aria-label={error ? t("claudeMode.stale") : t("claudeMode.live")}
          title={error ? t("claudeMode.stale") : t("claudeMode.live")}
          {...stylex.props(s.live, Boolean(error) && s.stale)}
        />
        <button type="button" aria-label={t("claudeMode.off")} title={t("claudeMode.off")} onClick={() => setClaudeMode(false)} {...stylex.props(btn.base, btn.icon, btn.iconSm)}>
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      <div ref={body} {...stylex.props(s.body)}>
        {Boolean(error) && (
          <p role="alert" {...stylex.props(text.error)}>
            {errorText(error)}
          </p>
        )}
        {b && f && view && (
          <>
            <section {...stylex.props(s.section)}>
              <h3 {...stylex.props(s.sectionTitle)}>{t("claudeMode.backend")}</h3>
              <Facts
                rows={[
                  [t("claudeMode.uptime"), <Uptime since={b.startedAt} />],
                  [t("claudeMode.process"), `PID ${b.pid} · Bun ${b.bun} · :${b.port}`],
                  [t("claudeMode.memory"), t("claudeMode.memoryValue", { rss: mb(b.rssMb), heap: mb(b.heapMb) })],
                  [t("claudeMode.cpu"), pct(b.cpuPercent)],
                  [t("claudeMode.database"), mb(b.dbMb)],
                  [t("claudeMode.models"), t("claudeMode.modelsValue", { model: b.model, critic: b.criticModel })],
                  [t("claudeMode.budget"), formatUsd(b.maxBudgetUsd)],
                ]}
              />
            </section>
            <section {...stylex.props(s.section)}>
              <h3 {...stylex.props(s.sectionTitle)}>{t("claudeMode.frontend")}</h3>
              <Facts
                rows={[
                  [t("claudeMode.build"), buildLabel(f.builtAt)],
                  [t("claudeMode.streams"), String(f.streams)],
                ]}
              />
            </section>
            <section {...stylex.props(s.section)}>
              <h3 {...stylex.props(s.sectionTitle)}>{t("claudeMode.instances", { count: view.instances.length })}</h3>
              {view.instances.length ? (
                <ul {...stylex.props(layout.plainList, s.instances)}>
                  {view.instances.map((it) => (
                    <Instance key={it.pid} instance={it} />
                  ))}
                </ul>
              ) : (
                <p {...stylex.props(text.small, text.muted)}>{t("claudeMode.noInstances")}</p>
              )}
            </section>
          </>
        )}
      </div>
    </aside>
  );
}
