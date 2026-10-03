import * as stylex from "@stylexjs/stylex";
import { Maximize, Minus, Plus } from "lucide-react";
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { NodeView } from "@shared/api";
import { masteryLabel } from "../lib/format";
import { t, useLang } from "../lib/i18n";
import { bp, color, font, motion, radius } from "../theme/tokens.stylex";
import { btn } from "../theme/ui";

type Mastery = NodeView["mastery"];

const W = 176;
const H = 64;
const GAP_X = 56;
const GAP_Y = 14;
const PAD = 24;
const MIN_K = 0.2;
const MAX_K = 2.5;
/** The first view of a large map zooms out no further than this, so titles stay readable. */
const READABLE_K = 0.7;

const s = stylex.create({
  viewport: {
    position: "relative",
    height: { default: 460, [bp.mobile]: 400, [bp.phone]: 360 },
    overflow: "hidden",
    borderRadius: radius.inner,
    backgroundColor: color.surface2,
    backgroundImage: `radial-gradient(${color.border} 1.2px, transparent 1.6px)`,
    backgroundSize: "22px 22px",
    touchAction: "none",
    userSelect: "none",
    cursor: "grab",
  },
  grabbing: { cursor: "grabbing" },
  world: { position: "absolute", top: 0, left: 0, transformOrigin: "0 0" },
  worldAt: (transform: string) => ({ transform }),
  animate: {
    transitionProperty: "transform",
    transitionDuration: { default: motion.base, [bp.reduce]: "0s" },
    transitionTimingFunction: motion.ease,
  },
  edges: { position: "absolute", top: 0, left: 0, overflow: "visible", pointerEvents: "none" },
  edge: { fill: "none", stroke: color.borderStrong, strokeWidth: 1.5, transitionProperty: "opacity", transitionDuration: motion.fast },
  edgeHot: { stroke: color.fig1, strokeWidth: 2.5 },
  edgeCross: { strokeDasharray: "6 5" },
  at: (x: number, y: number) => ({ transform: `translate(${x}px, ${y}px)` }),
  root: {
    position: "absolute",
    top: 0,
    left: 0,
    width: W,
    height: H,
    display: "flex",
    alignItems: "center",
    paddingInline: 16,
    borderRadius: 18,
    backgroundColor: color.lilac,
    color: color.onLilac,
    fontFamily: font.display,
    fontSize: 15,
    fontWeight: 700,
    lineHeight: 1.2,
  },
  node: {
    position: "absolute",
    top: 0,
    left: 0,
    width: W,
    height: H,
    display: "grid",
    alignContent: "center",
    gap: 4,
    margin: 0,
    paddingInline: 14,
    borderWidth: 1.5,
    borderStyle: "solid",
    borderColor: { default: color.borderStrong, ":hover": color.primary },
    borderRadius: 16,
    backgroundColor: color.surface,
    color: color.text,
    fontFamily: font.body,
    textAlign: "left",
    cursor: "pointer",
    outline: { default: "none", ":focus-visible": `3px solid ${color.focus}` },
    outlineOffset: 2,
    transitionProperty: "border-color, background-color, box-shadow, opacity",
    transitionDuration: motion.fast,
  },
  nodeLearning: { backgroundColor: color.lilacSoft, borderColor: { default: color.fig1, ":hover": color.primary } },
  nodeExit: { backgroundColor: color.butter, borderColor: { default: color.onButter, ":hover": color.primary } },
  nodeMastered: { backgroundColor: color.primary, color: color.onPrimary, borderColor: color.primary },
  nodeSelected: { borderColor: { default: color.accentText, ":hover": color.accentText }, boxShadow: `0 0 0 2px ${color.accentText}` },
  dim: { opacity: 0.38 },
  title: {
    fontSize: 13,
    fontWeight: 650,
    lineHeight: 1.2,
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  },
  clamp3: { WebkitLineClamp: 3 },
  meta: { display: "flex", alignItems: "center", gap: 5, fontSize: 11.5, opacity: 0.9 },
  toggle: {
    position: "absolute",
    top: 0,
    left: 0,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: 22,
    height: 22,
    margin: 0,
    paddingInline: 5,
    borderWidth: 1.5,
    borderStyle: "solid",
    borderColor: color.borderStrong,
    borderRadius: radius.pill,
    backgroundColor: { default: color.surface, ":hover": color.lilacSoft },
    color: color.text,
    fontFamily: font.body,
    fontSize: 11,
    fontWeight: 700,
    cursor: "pointer",
    outline: { default: "none", ":focus-visible": `3px solid ${color.focus}` },
    outlineOffset: 1,
  },
  controls: { position: "absolute", right: 10, bottom: 10, display: "grid", gap: 6, cursor: "auto" },
  control: { backgroundColor: { default: color.surface, ":hover": color.lilacSoft }, boxShadow: `0 1px 3px ${color.shadowStrong}` },
  dot: { display: "inline-block", flexShrink: 0, width: 9, height: 9, borderRadius: "50%", borderWidth: 1.5, borderStyle: "solid", borderColor: color.borderStrong },
  dotLearning: { backgroundColor: color.fig1, borderColor: color.fig1 },
  dotExit: { backgroundColor: color.onButter, borderColor: color.onButter },
  dotMastered: { backgroundColor: color.primary, borderColor: color.primary },
  dotOnDark: { backgroundColor: color.onPrimary, borderColor: color.onPrimary },
  legend: { display: "flex", flexWrap: "wrap", gap: "6px 16px", marginBlock: "0 12px", padding: 0, listStyle: "none", fontSize: 13, color: color.textMuted },
  legendItem: { display: "flex", alignItems: "center", gap: 6 },
});

const NODE: Record<Mastery, stylex.StyleXStyles | null> = { new: null, learning: s.nodeLearning, exit_passed: s.nodeExit, mastered: s.nodeMastered };
const DOT: Record<Mastery, stylex.StyleXStyles | null> = { new: null, learning: s.dotLearning, exit_passed: s.dotExit, mastered: s.dotMastered };

/** Id of the topic itself, the centre of the map. */
const ROOT = "";

/**
 * A mind map is a tree, the graph is not: each node hangs under its prerequisite with the longest chain,
 * and its other prerequisites are drawn as dashed links when the node is selected.
 */
function buildTree(nodes: NodeView[]) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const depthOf = new Map<string, number>();
  const visiting = new Set<string>();
  const depth = (id: string): number => {
    const known = depthOf.get(id);
    if (known !== undefined) return known;
    if (visiting.has(id)) return 0; // cycle guard
    visiting.add(id);
    const prereqs = byId.get(id)?.prereqs.filter((p) => byId.has(p)) ?? [];
    const d = prereqs.length ? 1 + Math.max(...prereqs.map(depth)) : 0;
    visiting.delete(id);
    depthOf.set(id, d);
    return d;
  };

  const parent = new Map<string, string>();
  const children = new Map<string, string[]>([[ROOT, []]]);
  for (const n of nodes) {
    const d = depth(n.id);
    // A strictly shallower parent keeps the tree acyclic even if the graph is not.
    const p = n.prereqs.filter((id) => byId.has(id) && depth(id) < d).reduce<string>((best, id) => (best === ROOT || depth(id) > depth(best) ? id : best), ROOT);
    parent.set(n.id, p);
    if (!children.has(p)) children.set(p, []);
    children.get(p)!.push(n.id);
  }
  return { byId, parent, children };
}

type Tree = ReturnType<typeof buildTree>;

/** Columns by tree depth; leaves take consecutive rows and a parent sits midway between its first and last child. */
function layout({ children }: Tree, collapsed: Set<string>) {
  const pos = new Map<string, { x: number; y: number }>();
  let next = PAD;
  const place = (id: string, col: number): number => {
    const kids = collapsed.has(id) ? [] : (children.get(id) ?? []);
    let y: number;
    if (kids.length === 0) {
      y = next;
      next += H + GAP_Y;
    } else {
      const ys = kids.map((k) => place(k, col + 1));
      y = (ys[0]! + ys[ys.length - 1]!) / 2;
    }
    pos.set(id, { x: PAD + col * (W + GAP_X), y });
    return y;
  };
  place(ROOT, 0);
  const width = Math.max(...[...pos.values()].map((p) => p.x)) + W + PAD;
  return { pos, width, height: next - GAP_Y + PAD };
}

function subtreeSize(children: Map<string, string[]>, id: string): number {
  return (children.get(id) ?? []).reduce((sum, k) => sum + 1 + subtreeSize(children, k), 0);
}

type View = { x: number; y: number; k: number };
type Point = { x: number; y: number };

const clampK = (k: number) => Math.min(MAX_K, Math.max(MIN_K, k));

/** Scales by `factor` keeping the screen point `at` over the same spot of the map. */
function zoomed(v: View, factor: number, at: Point): View {
  const k = clampK(v.k * factor);
  return { k, x: at.x - ((at.x - v.x) * k) / v.k, y: at.y - ((at.y - v.y) * k) / v.k };
}

function fitted(map: { width: number; height: number; rootY: number }, size: { w: number; h: number }, minK: number): View {
  const k = Math.max(minK, Math.min(1, size.w / map.width, size.h / map.height));
  const x = map.width * k <= size.w ? (size.w - map.width * k) / 2 : 0;
  const y = map.height * k <= size.h ? (size.h - map.height * k) / 2 : size.h / 2 - (map.rootY + H / 2) * k;
  return { x, y, k };
}

const curve = (x1: number, y1: number, x2: number, y2: number) => {
  const mx = (x1 + x2) / 2;
  return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
};

export function KnowledgeGraph({
  title,
  nodes,
  selected,
  onSelect,
}: {
  title: string;
  nodes: NodeView[];
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  useLang();
  const tree = useMemo(() => buildTree(nodes), [nodes]);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const map = useMemo(() => layout(tree, collapsed), [tree, collapsed]);

  const viewport = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  const [animate, setAnimate] = useState(false);
  const [dragging, setDragging] = useState(false);
  const gesture = useRef({ pointers: new Map<number, Point>(), origin: { x: 0, y: 0 }, moved: false, pinch: null as null | { view: View; dist: number; mid: Point } });

  useLayoutEffect(() => {
    const el = viewport.current!;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Fit the map once per set of nodes; mastery updates keep the learner's zoom.
  const idsKey = nodes.map((n) => n.id).join("\n");
  const fittedFor = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!size.w || fittedFor.current === idsKey) return;
    fittedFor.current = idsKey;
    setAnimate(false);
    setView(fitted({ ...map, rootY: map.pos.get(ROOT)!.y }, size, READABLE_K));
  }, [size, idsKey, map]);

  // Collapsing re-flows the tree; keep the toggled node where the learner's finger was.
  const anchor = useRef<{ id: string } & Point>(null);
  useLayoutEffect(() => {
    const a = anchor.current;
    const p = a && map.pos.get(a.id);
    anchor.current = null;
    if (p) setView((v) => ({ ...v, x: v.x - (p.x - a.x) * v.k, y: v.y - (p.y - a.y) * v.k }));
  }, [map]);

  // Wheel and Safari gesture listeners must be non-passive to stop the page from zooming.
  useEffect(() => {
    const el = viewport.current!;
    const local = (e: { clientX: number; clientY: number }) => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setAnimate(false);
      // Trackpad pinch sends small deltas; a mouse wheel notch sends ~100, so cap the step.
      const dy = Math.max(-30, Math.min(30, e.deltaMode === 1 ? e.deltaY * 20 : e.deltaY));
      setView((v) => zoomed(v, Math.exp(-dy * 0.01), local(e)));
    };
    let lastScale = 1;
    const onGesture = (e: Event) => {
      e.preventDefault();
      if (gesture.current.pointers.size > 1) return; // touch pinch is handled by pointer events
      const g = e as Event & { scale: number; clientX: number; clientY: number };
      if (e.type === "gesturestart") lastScale = 1;
      setAnimate(false);
      setView((v) => zoomed(v, g.scale / lastScale, local(g)));
      lastScale = g.scale;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("gesturestart", onGesture);
    el.addEventListener("gesturechange", onGesture);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("gesturestart", onGesture);
      el.removeEventListener("gesturechange", onGesture);
    };
  }, []);

  const localPoint = (e: React.PointerEvent) => {
    const r = viewport.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const startPinch = () => {
    const [a, b] = [...gesture.current.pointers.values()];
    gesture.current.pinch = { view, dist: Math.hypot(a!.x - b!.x, a!.y - b!.y), mid: { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 } };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const g = gesture.current;
    const p = localPoint(e);
    g.pointers.set(e.pointerId, p);
    if (g.pointers.size === 1) {
      g.origin = p;
      g.moved = false;
    } else if (g.pointers.size === 2) startPinch();
    setAnimate(false);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    const prev = g.pointers.get(e.pointerId);
    if (!prev) return;
    const p = localPoint(e);
    g.pointers.set(e.pointerId, p);
    if (g.pinch && g.pointers.size >= 2) {
      const [a, b] = [...g.pointers.values()];
      const dist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      const mid = { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 };
      const { view: v0, dist: d0, mid: m0 } = g.pinch;
      const k = clampK((v0.k * dist) / d0);
      setView({ k, x: mid.x - ((m0.x - v0.x) * k) / v0.k, y: mid.y - ((m0.y - v0.y) * k) / v0.k });
      g.moved = true;
      return;
    }
    // A short wobble is still a click on a node.
    if (!g.moved && Math.hypot(p.x - g.origin.x, p.y - g.origin.y) < 4) return;
    if (!g.moved) {
      g.moved = true;
      e.currentTarget.setPointerCapture(e.pointerId);
      setDragging(true);
    }
    setView((v) => ({ ...v, x: v.x + p.x - prev.x, y: v.y + p.y - prev.y }));
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    g.pointers.delete(e.pointerId);
    if (g.pointers.size < 2) g.pinch = null;
    if (g.pointers.size === 0) setDragging(false);
  };

  /** A click that ends a drag or pinch is not a tap; keyboard clicks (detail 0) always are. */
  const tapped = (e: React.MouseEvent) => e.detail === 0 || !gesture.current.moved;

  const zoomBy = (factor: number) => {
    setAnimate(true);
    setView((v) => zoomed(v, factor, { x: size.w / 2, y: size.h / 2 }));
  };

  const toggle = (id: string) => {
    const p = map.pos.get(id)!;
    anchor.current = { id, ...p };
    setCollapsed((c) => {
      const n = new Set(c);
      if (!n.delete(id)) n.add(id);
      return n;
    });
  };

  /** Pans a node that keyboard focus reached off-screen into the middle of the map. */
  const reveal = (id: string, el: HTMLElement) => {
    const p = map.pos.get(id);
    if (!p || !el.matches(":focus-visible")) return;
    const left = view.x + p.x * view.k;
    const top = view.y + p.y * view.k;
    if (left >= 0 && top >= 0 && left + W * view.k <= size.w && top + H * view.k <= size.h) return;
    setAnimate(true);
    setView((v) => ({ ...v, x: size.w / 2 - (p.x + W / 2) * v.k, y: size.h / 2 - (p.y + H / 2) * v.k }));
  };

  // The selected node and everything it rests on, transitively.
  const chain = useMemo(() => {
    const out = new Set<string>();
    const walk = (id: string) => {
      if (out.has(id) || !tree.byId.has(id)) return;
      out.add(id);
      tree.byId.get(id)!.prereqs.forEach(walk);
    };
    if (selected) walk(selected);
    return out;
  }, [tree, selected]);

  const edges: { key: string; d: string; hot: boolean; cross: boolean }[] = [];
  for (const [id, p] of map.pos) {
    if (id === ROOT) continue;
    const parent = tree.parent.get(id)!;
    const q = map.pos.get(parent)!;
    edges.push({ key: `${parent}>${id}`, d: curve(q.x + W, q.y + H / 2, p.x, p.y + H / 2), hot: chain.has(id), cross: false });
    if (!chain.has(id)) continue;
    for (const pre of tree.byId.get(id)!.prereqs) {
      const r = map.pos.get(pre);
      if (pre !== parent && r && tree.byId.has(pre)) edges.push({ key: `${pre}~${id}`, d: curve(r.x + W, r.y + H / 2, p.x, p.y + H / 2), hot: true, cross: true });
    }
  }
  const root = map.pos.get(ROOT)!;

  return (
    <div
      ref={viewport}
      role="group"
      aria-label={t("graph.label")}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      {...stylex.props(s.viewport, dragging && s.grabbing)}
    >
      <div {...stylex.props(s.world, s.worldAt(`translate(${view.x}px, ${view.y}px) scale(${view.k})`), animate && s.animate)}>
        <svg width={map.width} height={map.height} aria-hidden="true" {...stylex.props(s.edges)}>
          {edges.map((e) => (
            <path key={e.key} d={e.d} {...stylex.props(s.edge, e.hot && s.edgeHot, e.cross && s.edgeCross, selected !== null && !e.hot && s.dim)} />
          ))}
        </svg>
        <div {...stylex.props(s.root, s.at(root.x, root.y))}>
          <span {...stylex.props(s.title, s.clamp3)}>{title}</span>
        </div>
        {[...map.pos].map(([id, { x, y }]) => {
          const node = tree.byId.get(id);
          if (!node) return null;
          const prereqTitles = node.prereqs.map((p) => tree.byId.get(p)?.title).filter(Boolean);
          const label = `${node.title}. ${t(node.kind === "skill" ? "graph.skill" : "graph.knowledge")}, ${masteryLabel(node.mastery)}${
            prereqTitles.length ? `. ${t("graph.buildsOn", { titles: prereqTitles.join(", ") })}` : ""
          }`;
          const dark = node.mastery === "mastered";
          const hidden = collapsed.has(id) ? subtreeSize(tree.children, id) : 0;
          const hasKids = (tree.children.get(id)?.length ?? 0) > 0;
          return (
            <Fragment key={id}>
              <button
                type="button"
                aria-pressed={selected === id}
                aria-label={label}
                onClick={(e) => tapped(e) && onSelect(id)}
                onFocus={(e) => reveal(id, e.currentTarget)}
                {...stylex.props(s.node, s.at(x, y), NODE[node.mastery], selected === id && s.nodeSelected, selected !== null && !chain.has(id) && s.dim)}
              >
                <span {...stylex.props(s.title)}>{node.title}</span>
                <span {...stylex.props(s.meta)}>
                  <i {...stylex.props(s.dot, DOT[node.mastery], dark && s.dotOnDark)} />
                  {masteryLabel(node.mastery)}
                </span>
              </button>
              {hasKids && (
                <button
                  type="button"
                  aria-expanded={!hidden}
                  aria-label={hidden ? t("graph.expandBranch", { title: node.title, hidden }) : t("graph.collapseBranch", { title: node.title })}
                  title={t(hidden ? "graph.expand" : "graph.collapse")}
                  onClick={(e) => tapped(e) && toggle(id)}
                  {...stylex.props(s.toggle, s.at(x + W - 11, y + H / 2 - 11))}
                >
                  {hidden ? `+${hidden}` : <Minus size={12} aria-hidden="true" />}
                </button>
              )}
            </Fragment>
          );
        })}
      </div>
      <div onPointerDown={(e) => e.stopPropagation()} {...stylex.props(s.controls)}>
        <button type="button" aria-label={t("graph.zoomIn")} title={t("graph.zoomIn")} onClick={() => zoomBy(1.25)} {...stylex.props(btn.base, btn.icon, btn.iconSm, s.control)}>
          <Plus size={16} aria-hidden="true" />
        </button>
        <button type="button" aria-label={t("graph.zoomOut")} title={t("graph.zoomOut")} onClick={() => zoomBy(0.8)} {...stylex.props(btn.base, btn.icon, btn.iconSm, s.control)}>
          <Minus size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label={t("graph.fit")}
          title={t("graph.fit")}
          onClick={() => {
            setAnimate(true);
            setView(fitted({ ...map, rootY: root.y }, size, MIN_K));
          }}
          {...stylex.props(btn.base, btn.icon, btn.iconSm, s.control)}
        >
          <Maximize size={15} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

export function GraphLegend() {
  useLang();
  return (
    <ul aria-label={t("graph.legend")} {...stylex.props(s.legend)}>
      {(["new", "learning", "exit_passed", "mastered"] as const).map((m) => (
        <li key={m} {...stylex.props(s.legendItem)}>
          <i aria-hidden="true" {...stylex.props(s.dot, DOT[m])} />
          {masteryLabel(m)}
        </li>
      ))}
    </ul>
  );
}
