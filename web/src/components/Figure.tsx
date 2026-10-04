import * as stylex from "@stylexjs/stylex";
import { TriangleAlert } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { PublicFigure } from "@shared/schemas";
import { FIG_TOKENS, tokens } from "../lib/color";
import { t, useLang } from "../lib/i18n";
import { sanitizeSvg } from "../lib/markdown";
import { trackRender } from "../lib/print";
import { useOverlayScroll } from "../lib/overlayScroll";
import { useTheme, type Theme } from "../lib/theme";
import { color, radius } from "../theme/tokens.stylex";
import { layout } from "../theme/ui";

const s = stylex.create({
  error: { display: "flex", gap: 12, alignItems: "flex-start", paddingBlock: 14, paddingInline: 16, borderRadius: radius.inner, backgroundColor: color.dangerSoft },
  errorIcon: { flexShrink: 0, marginTop: 2, color: color.danger },
  errorTitle: { fontWeight: 650, color: color.danger },
  errorText: { fontSize: 14 },
  summary: { marginTop: 6, cursor: "pointer", fontSize: 13.5, fontWeight: 600 },
  pre: { marginTop: 8, padding: 10, maxHeight: 200, overflow: "auto", borderRadius: 10, backgroundColor: color.surface, fontSize: 12.5 },
  figure: { display: "grid", gap: 8 },
  body: {
    padding: 18,
    borderRadius: radius.inner,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: color.border,
    backgroundColor: color.surface,
    color: color.text,
    overflowX: "auto",
  },
  widget: { display: "block", width: "100%", borderWidth: 0 },
  widgetHeight: (h: number) => ({ height: h }),
  caption: { maxWidth: "70ch", fontSize: 13.5, color: color.textMuted },
});

function FigureError({ title, error, code }: { title: string; error: string; code?: string }) {
  useLang();
  const pre = useRef<HTMLPreElement>(null);
  useOverlayScroll(pre);
  return (
    <div role="alert" {...stylex.props(s.error)}>
      <TriangleAlert size={18} aria-hidden="true" {...stylex.props(s.errorIcon)} />
      <div>
        <p {...stylex.props(s.errorTitle)}>{title}</p>
        <p {...stylex.props(s.errorText)}>{error}</p>
        {code && (
          <details>
            <summary {...stylex.props(s.summary)}>{t("figure.source")}</summary>
            <pre ref={pre} {...stylex.props(s.pre)}>
              {code}
            </pre>
          </details>
        )}
      </div>
    </div>
  );
}

let mermaidSeq = 0;
let mermaidQueue: Promise<unknown> = Promise.resolve();

function MermaidFigure({ code, theme }: { code: string; theme: Theme }) {
  useLang();
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Mermaid keeps global configuration, so renders run one at a time.
    mermaidQueue = mermaidQueue.then(async () => {
      if (cancelled) return;
      try {
        const { default: mermaid } = await import("mermaid");
        const t = tokens(["surface", "surface-2", "text", "text-muted", "primary", "lilac-soft", "border-strong", "peach-soft", "pistachio-soft", ...FIG_TOKENS], ref.current);
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: "base",
          fontFamily: getComputedStyle(document.body).fontFamily,
          themeVariables: {
            darkMode: theme === "dark",
            background: t.surface,
            primaryColor: t["lilac-soft"],
            primaryTextColor: t.text,
            primaryBorderColor: t["fig-1"],
            secondaryColor: t["peach-soft"],
            secondaryTextColor: t.text,
            secondaryBorderColor: t["fig-2"],
            tertiaryColor: t["pistachio-soft"],
            tertiaryTextColor: t.text,
            tertiaryBorderColor: t["fig-3"],
            lineColor: t["text-muted"],
            textColor: t.text,
            mainBkg: t["lilac-soft"],
            nodeBorder: t["fig-1"],
            clusterBkg: t["surface-2"],
            clusterBorder: t["border-strong"],
            edgeLabelBackground: t.surface,
            noteBkgColor: t["peach-soft"],
            noteTextColor: t.text,
            noteBorderColor: t["fig-2"],
            actorBkg: t["lilac-soft"],
            actorBorder: t["fig-1"],
            actorTextColor: t.text,
            signalColor: t.text,
            signalTextColor: t.text,
            fontSize: "15px",
          },
        });
        const { svg } = await mermaid.render(`mmd-${++mermaidSeq}`, code);
        if (cancelled || !ref.current) return;
        ref.current.innerHTML = svg;
        setError(null);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
        // A failed render can leave its scratch element in the body.
        document.querySelectorAll(`[id^="dmmd-"]`).forEach((n) => n.remove());
      }
    });
    trackRender(mermaidQueue);
    return () => {
      cancelled = true;
    };
  }, [code, theme]);

  if (error) return <FigureError title={t("figure.diagramFailed")} error={error} code={code} />;
  return <div ref={ref} className="figure-render is-mermaid" aria-hidden="true" />;
}

function ChartFigure({ spec, theme }: { spec: Record<string, unknown>; theme: Theme }) {
  useLang();
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let finalize: (() => void) | undefined;
    trackRender((async () => {
      try {
        const { default: embed } = await import("vega-embed");
        const t = tokens(["text", "text-muted", "border", "border-strong", ...FIG_TOKENS], ref.current);
        const font = getComputedStyle(document.body).fontFamily;
        const figs = FIG_TOKENS.map((k) => t[k]);
        if (cancelled || !ref.current) return;
        const result = await embed(ref.current, spec as never, {
          actions: false,
          renderer: "svg",
          config: {
            background: "transparent",
            font,
            view: { stroke: "transparent" },
            axis: {
              labelColor: t["text-muted"],
              titleColor: t.text,
              gridColor: t.border,
              domainColor: t["border-strong"],
              tickColor: t["border-strong"],
              labelFontSize: 12,
              titleFontSize: 13,
              titleFontWeight: 600,
            },
            legend: { labelColor: t["text-muted"], titleColor: t.text },
            title: { color: t.text, subtitleColor: t["text-muted"], fontWeight: 600 },
            text: { color: t.text },
            mark: { color: figs[0] },
            range: { category: figs },
          },
        });
        finalize = () => result.finalize();
        if (cancelled) finalize();
        else setError(null);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })());
    return () => {
      cancelled = true;
      finalize?.();
    };
  }, [spec, theme]);

  if (error) return <FigureError title={t("figure.chartFailed")} error={error} code={JSON.stringify(spec, null, 2)} />;
  return <div ref={ref} className="figure-render is-chart" aria-hidden="true" />;
}

const WIDGET_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:";

function widgetDoc(html: string, channel: string, theme: Theme, from: Element | null): string {
  const t = tokens(["text", "text-muted", "surface", "surface-2", "border", "border-strong", "primary", "on-primary", "focus", "lilac-soft", ...FIG_TOKENS], from);
  const vars = Object.entries(t)
    .map(([k, v]) => `--${k}:${v};`)
    .join("");
  const reporter = `<script>(function(){var c=${JSON.stringify(channel)};function s(){parent.postMessage({clayfoldWidget:c,height:Math.ceil(document.body.getBoundingClientRect().height)},"*")}new ResizeObserver(s).observe(document.body);addEventListener("load",s);s()})()</script>`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${WIDGET_CSP}"><style>:root{${vars}color-scheme:${theme}}html,body{margin:0;background:transparent;}body{display:flow-root;color:var(--text);font:15px/1.5 system-ui,sans-serif}*:focus-visible{outline:2px solid var(--focus);outline-offset:2px}</style></head><body>${html}${reporter}</body></html>`;
}

function WidgetFigure({ html, title, theme }: { html: string; title: string; theme: Theme }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const channel = useId();
  const [height, setHeight] = useState(240);
  const [doc, setDoc] = useState("");

  useEffect(() => setDoc(widgetDoc(html, channel, theme, frame.current)), [html, channel, theme]);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return;
      const data = e.data as { clayfoldWidget?: string; height?: number } | null;
      if (data?.clayfoldWidget === channel && typeof data.height === "number") setHeight(Math.min(1400, Math.max(80, data.height)));
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [channel]);

  return <iframe ref={frame} sandbox="allow-scripts" srcDoc={doc} title={title} {...stylex.props(s.widget, s.widgetHeight(height))} />;
}

/** `theme` pins the figure's palette, as in a video that keeps its own; otherwise it follows the app. */
export function FigureView({ figure, theme: pinned }: { figure: PublicFigure; theme?: Theme }) {
  const appTheme = useTheme();
  const theme = pinned ?? appTheme;
  const body = (() => {
    switch (figure.kind) {
      case "mermaid":
        return <MermaidFigure code={figure.code} theme={theme} />;
      case "svg":
        return <div className="figure-render is-svg" aria-hidden="true" dangerouslySetInnerHTML={{ __html: sanitizeSvg(figure.svg) }} />;
      case "chart":
        return <ChartFigure spec={figure.spec} theme={theme} />;
      case "widget":
        return <WidgetFigure html={figure.html} title={figure.alt} theme={theme} />;
    }
  })();
  const isWidget = figure.kind === "widget";
  const scroller = useRef<HTMLDivElement>(null);
  useOverlayScroll(scroller);
  return (
    <figure {...stylex.props(s.figure)}>
      <div ref={scroller} role={isWidget ? undefined : "img"} aria-label={isWidget ? undefined : figure.alt} {...stylex.props(s.body)}>
        {body}
      </div>
      {isWidget && <p {...stylex.props(layout.srOnly)}>{figure.alt}</p>}
      {figure.caption && <figcaption {...stylex.props(s.caption)}>{figure.caption}</figcaption>}
    </figure>
  );
}
