import { Window } from "happy-dom";
import type { Figure } from "../../shared/schemas";
import type { RuleId, Violation } from "../../shared/rules";

type Mermaid = { parse(code: string): Promise<unknown> };
let mermaidLoad: Promise<Mermaid> | null = null;

/**
 * Mermaid's bundled DOMPurify binds to `window` when its module is first evaluated and fails
 * (`addHook is not a function`) without one; parsing itself needs no DOM. The globals exist
 * only for the duration of that import.
 */
function loadMermaid(): Promise<Mermaid> {
  mermaidLoad ??= (async () => {
    const g = globalThis as Record<string, unknown>;
    const had = { window: "window" in g, document: "document" in g };
    const win = new Window();
    if (!had.window) g.window = win;
    if (!had.document) g.document = win.document;
    try {
      return (await import("mermaid")).default as unknown as Mermaid;
    } finally {
      if (!had.window) delete g.window;
      if (!had.document) delete g.document;
    }
  })();
  return mermaidLoad;
}

export async function checkMermaid(code: string, path: string): Promise<Violation[]> {
  const mermaid = await loadMermaid();
  try {
    await mermaid.parse(code);
    return [];
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).split("\n").slice(0, 3).join(" ");
    return [{ rule: "V6", message: `mermaid code does not parse: ${msg}`, path: `${path}.code` }];
  }
}

// Element allowlist of DOMPurify's `svg` + `svgFilters` profiles (dompurify 3.4, purify.es.mjs), lowercased.
// The browser sanitizes with that profile; an element outside it disappears from the rendered figure.
const SVG_ALLOWED = new Set(
  [
    "svg", "a", "altglyph", "altglyphdef", "altglyphitem", "animatecolor", "animatemotion", "animatetransform",
    "circle", "clippath", "defs", "desc", "ellipse", "filter", "font", "g", "glyph", "glyphref", "hkern", "image",
    "line", "lineargradient", "marker", "mask", "metadata", "mpath", "path", "pattern", "polygon", "polyline",
    "radialgradient", "rect", "stop", "style", "switch", "symbol", "text", "textpath", "title", "tref", "tspan",
    "view", "vkern", "feblend", "fecolormatrix", "fecomponenttransfer", "fecomposite", "feconvolvematrix",
    "fediffuselighting", "fedisplacementmap", "fedistantlight", "fedropshadow", "feflood", "fefunca", "fefuncb",
    "fefuncg", "fefuncr", "fegaussianblur", "feimage", "femerge", "femergenode", "femorphology", "feoffset",
    "fepointlight", "fespecularlighting", "fespotlight", "fetile", "feturbulence",
  ],
);

/**
 * Structural and safety checks on an SVG figure. DOMPurify itself is not run here: under happy-dom 20 it
 * reads nodeName through Node.prototype (empty for elements) and drops the root, and under linkedom it is
 * unsupported and returns its input; the allowlist above reproduces its element decisions instead.
 * A figure needs labels (V2); a meerkat drawing is checked under G2 and needs none.
 */
export function checkSvg(svg: string, path: string, opts: { rule: RuleId; labels: boolean } = { rule: "V6", labels: true }): Violation[] {
  const p = `${path}.svg`;
  const v = (message: string): Violation => ({ rule: opts.rule, message, path: p });
  const win = new Window();
  try {
    const doc = new win.DOMParser().parseFromString(svg, "image/svg+xml");
    const root = doc.documentElement;
    if (!root || doc.getElementsByTagName("parsererror").length > 0) {
      const err = doc.getElementsByTagName("parsererror")[0]?.textContent?.replace(/\s+/g, " ").trim();
      return [v(`svg is not well-formed XML${err ? `: ${err.slice(0, 200)}` : ""}`)];
    }
    if (root.localName !== "svg") return [v(`root element is <${root.localName}>, expected <svg>`)];
    const out: Violation[] = [];
    if (!root.getAttribute("viewBox")) out.push(v("root <svg> has no viewBox (needed to scale to the column)"));
    const all = [root, ...Array.from(root.querySelectorAll("*"))];
    if (opts.labels && !all.some((el) => el.localName === "text")) out.push(v("svg has no <text> element; label the parts inside the figure (V2)"));
    const removed = new Set<string>();
    for (const el of all) {
      const name = el.localName.toLowerCase();
      if (name === "script" || name === "foreignobject") out.push(v(`<${el.localName}> is not allowed`));
      else if (!SVG_ALLOWED.has(name)) removed.add(el.localName);
      for (const attr of Array.from(el.attributes)) {
        const an = attr.name.toLowerCase();
        if (an.startsWith("on")) out.push(v(`event handler attribute ${attr.name} on <${el.localName}> is not allowed`));
        const value = attr.value ?? "";
        if ((an === "href" || an === "xlink:href") && !value.trim().startsWith("#")) {
          out.push(v(`<${el.localName}> ${attr.name}="${value.slice(0, 80)}": only same-document "#id" references are allowed`));
        }
      }
    }
    if (removed.size > 0) {
      out.push(v(`the sanitizer removes these elements, so they would not render: ${[...removed].map((n) => `<${n}>`).join(", ")}`));
    }
    return out;
  } finally {
    void win.happyDOM.close();
  }
}

type VegaLite = { compile(spec: unknown, opts?: unknown): unknown };
let vegaLite: Promise<VegaLite> | null = null;

export async function checkChart(spec: Record<string, unknown>, path: string): Promise<Violation[]> {
  const p = `${path}.spec`;
  const out: Violation[] = [];
  let inline = false;
  const walk = (node: unknown, at: string) => {
    if (Array.isArray(node)) return node.forEach((x, i) => walk(x, `${at}.${i}`));
    if (!node || typeof node !== "object") return;
    const obj = node as Record<string, unknown>;
    if (at.endsWith(".data") && "url" in obj) {
      out.push({ rule: "V6", message: `data source at ${at} loads a url; put the values inline`, path: at });
    }
    if ("values" in obj || "sequence" in obj) inline = true;
    for (const [k, val] of Object.entries(obj)) walk(val, `${at}.${k}`);
  };
  walk(spec, p);
  if (!inline && !("datasets" in spec)) out.push({ rule: "V6", message: "chart has no inline data values", path: p });
  if (out.length > 0) return out;
  vegaLite ??= import("vega-lite") as Promise<VegaLite>;
  const vl = await vegaLite;
  const silent = { level: () => silent, error: () => silent, warn: () => silent, info: () => silent, debug: () => silent };
  try {
    vl.compile(spec, { logger: silent });
  } catch (e) {
    out.push({ rule: "V6", message: `Vega-Lite spec does not compile: ${e instanceof Error ? e.message : String(e)}`, path: p });
  }
  return out;
}

const WIDGET_FORBIDDEN: [RegExp, string][] = [
  [/\bfetch\s*\(/, "fetch("],
  [/\bXMLHttpRequest\b/, "XMLHttpRequest"],
  [/\bWebSocket\b/, "WebSocket"],
  [/\bimport\s*\(/, "import("],
  [/\beval\s*\(/, "eval("],
  [/\bnew\s+Function\b/, "new Function"],
];

export function checkWidget(html: string, path: string): Violation[] {
  const p = `${path}.html`;
  const out: Violation[] = [];
  if (Buffer.byteLength(html, "utf8") > 60 * 1024) out.push({ rule: "V6", message: "widget html exceeds 60 KB", path: p });
  // XML namespace identifiers (xmlns="http://www.w3.org/2000/svg") are names, not network loads.
  const url = html.match(/https?:\/\/(?!www\.w3\.org\/)[^\s"'<>)]*/i);
  if (url) out.push({ rule: "V6", message: `widget references ${url[0].slice(0, 80)}; widgets run without network, inline everything`, path: p });
  for (const [re, name] of WIDGET_FORBIDDEN) {
    if (re.test(html)) out.push({ rule: "V6", message: `widget uses ${name}, which is not allowed`, path: p });
  }
  return out;
}

export async function checkFigure(figure: Figure, path: string): Promise<Violation[]> {
  switch (figure.kind) {
    case "mermaid":
      return checkMermaid(figure.code, path);
    case "svg":
      return checkSvg(figure.svg, path);
    case "chart":
      return checkChart(figure.spec, path);
    case "widget":
      return checkWidget(figure.html, path);
  }
}
