import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import type { OutfitItemId, OutfitSlot } from "@shared/game";
import { bp } from "../../theme/tokens.stylex";

// Built-in wearables, each drawn on the 100 x 100 box of its slot (the same frame Claude draws rewards on):
// head - brim at y 78, centred at x 50; face - eyes at (34,50) and (66,50); neck - neck at y 30;
// back - behind a body spanning x 25-75, y 10-95; paw - an object centred at (50,50).

export const CLAY = {
  ink: "#32253F",
  cream: "#FFF9F3",
  butter: "#FBE6C4",
  butterDeep: "#F2CF8E",
  gold: "#F6C453",
  lilac: "#CBC9F5",
  lilacDeep: "#A99BFF",
  peach: "#FFC9B4",
  peachDeep: "#F29C76",
  pistachio: "#D9E9AD",
  pistachioDeep: "#A3CC66",
  steel: "#D8D3EE",
  shade: "rgb(50 37 63 / 0.14)",
  shine: "rgb(255 255 255 / 0.55)",
};

const spin = stylex.keyframes({ from: { transform: "rotate(0deg)" }, to: { transform: "rotate(360deg)" } });
const flicker = stylex.keyframes({
  "0%": { transform: "scaleY(1)", opacity: 0.95 },
  "50%": { transform: "scaleY(1.25)", opacity: 0.7 },
  "100%": { transform: "scaleY(1)", opacity: 0.95 },
});
const blinkLights = stylex.keyframes({ "0%": { opacity: 1 }, "50%": { opacity: 0.35 }, "100%": { opacity: 1 } });

const s = stylex.create({
  propeller: {
    transformBox: "fill-box",
    transformOrigin: "center",
    animationName: { default: spin, [bp.reduce]: "none" },
    animationDuration: "1.1s",
    animationTimingFunction: "linear",
    animationIterationCount: "infinite",
  },
  flame: {
    transformBox: "fill-box",
    transformOrigin: "top",
    animationName: { default: flicker, [bp.reduce]: "none" },
    animationDuration: "0.35s",
    animationIterationCount: "infinite",
  },
  lights: {
    animationName: { default: blinkLights, [bp.reduce]: "none" },
    animationDuration: "1.4s",
    animationIterationCount: "infinite",
  },
});

const Shine = ({ cx, cy, rx, ry }: { cx: number; cy: number; rx: number; ry: number }) => <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill={CLAY.shine} />;

const ITEMS: Record<OutfitItemId, ReactNode> = {
  propeller: (
    <g>
      <path d="M18 80 C18 46 82 46 82 80 Z" fill={CLAY.lilac} />
      <path d="M50 50 C40 52 36 66 36 80 L50 80 Z" fill={CLAY.butter} />
      <path d="M50 50 C62 52 66 66 66 80 L82 80 C82 62 70 50 50 50 Z" fill={CLAY.pistachio} />
      <path d="M14 80 Q50 72 86 80 Q84 86 50 86 Q16 86 14 80 Z" fill={CLAY.lilacDeep} />
      <Shine cx={34} cy={62} rx={6} ry={4} />
      <rect x={48} y={34} width={4} height={18} rx={2} fill={CLAY.ink} />
      <g {...stylex.props(s.propeller)}>
        <ellipse cx={36} cy={34} rx={14} ry={4.5} fill={CLAY.peach} />
        <ellipse cx={64} cy={34} rx={14} ry={4.5} fill={CLAY.peachDeep} />
        <circle cx={50} cy={34} r={4} fill={CLAY.butterDeep} />
      </g>
    </g>
  ),
  wizard: (
    <g>
      <path d="M30 78 L50 10 Q58 2 66 8 Q72 14 64 18 Q60 14 58 18 L72 78 Z" fill={CLAY.lilac} />
      <path d="M58 18 L72 78 L62 78 Z" fill={CLAY.shade} />
      <path d="M50 40 l3 7 7 1 -5 5 1 7 -6 -3 -6 3 1 -7 -5 -5 7 -1 Z" fill={CLAY.butter} />
      <path d="M10 78 Q50 66 90 78 Q88 90 50 90 Q12 90 10 78 Z" fill={CLAY.lilacDeep} />
      <Shine cx={44} cy={34} rx={3} ry={8} />
    </g>
  ),
  viking: (
    <g>
      <path d="M24 66 C8 62 4 44 12 30 C16 44 24 52 34 56 Z" fill={CLAY.cream} />
      <path d="M76 66 C92 62 96 44 88 30 C84 44 76 52 66 56 Z" fill={CLAY.cream} />
      <path d="M20 80 C20 44 80 44 80 80 Z" fill={CLAY.steel} />
      <rect x={18} y={70} width={64} height={12} rx={6} fill={CLAY.butterDeep} />
      <rect x={47} y={46} width={6} height={26} rx={3} fill={CLAY.butterDeep} />
      {[26, 38, 62, 74].map((x) => (
        <circle key={x} cx={x} cy={76} r={2.2} fill={CLAY.cream} />
      ))}
      <Shine cx={34} cy={58} rx={6} ry={5} />
    </g>
  ),
  teacozy: (
    <g>
      <path d="M12 80 C10 38 90 38 88 80 Z" fill={CLAY.peach} />
      {[24, 38, 52, 66].map((y, i) => (
        <path key={y} d={`M${16 + i * 1} ${y + 16} Q50 ${y + 8} ${84 - i * 1} ${y + 16}`} stroke={CLAY.cream} strokeWidth={4} strokeLinecap="round" fill="none" opacity={0.85} />
      ))}
      <path d="M12 80 Q50 74 88 80 Q86 88 50 88 Q14 88 12 80 Z" fill={CLAY.peachDeep} />
      <circle cx={50} cy={32} r={10} fill={CLAY.butter} />
      <path d="M84 70 Q96 76 92 90" stroke={CLAY.ink} strokeWidth={1.5} fill="none" />
      <rect x={86} y={88} width={12} height={9} rx={2} fill={CLAY.pistachio} />
      <Shine cx={30} cy={56} rx={6} ry={4} />
    </g>
  ),
  ufo: (
    <g>
      <path d="M30 64 C30 36 70 36 70 64 Z" fill="#E7E5FB" opacity={0.92} />
      <circle cx={50} cy={52} r={6} fill={CLAY.pistachioDeep} />
      <circle cx={48} cy={50} r={1.6} fill={CLAY.ink} />
      <circle cx={53} cy={50} r={1.6} fill={CLAY.ink} />
      <ellipse cx={50} cy={72} rx={44} ry={12} fill={CLAY.steel} />
      <ellipse cx={50} cy={68} rx={30} ry={6} fill={CLAY.lilac} />
      <g {...stylex.props(s.lights)}>
        {[14, 32, 50, 68, 86].map((x) => (
          <circle key={x} cx={x} cy={74 + (x === 14 || x === 86 ? -2 : 1)} r={3} fill={CLAY.gold} />
        ))}
      </g>
      <Shine cx={40} cy={46} rx={5} ry={7} />
    </g>
  ),
  bucket: (
    <g>
      <path d="M26 74 C24 42 76 42 74 74 Z" fill={CLAY.pistachio} />
      <rect x={25} y={64} width={50} height={9} rx={4} fill={CLAY.pistachioDeep} />
      <path d="M8 78 Q50 62 92 78 Q90 92 50 92 Q10 92 8 78 Z" fill={CLAY.pistachio} />
      <path d="M8 78 Q50 88 92 78 Q90 92 50 92 Q10 92 8 78 Z" fill={CLAY.shade} />
      <Shine cx={38} cy={52} rx={7} ry={4} />
    </g>
  ),
  glasses: (
    <g fill="none" stroke={CLAY.ink} strokeWidth={4.5}>
      <circle cx={34} cy={50} r={14} fill="rgb(255 255 255 / 0.28)" />
      <circle cx={66} cy={50} r={14} fill="rgb(255 255 255 / 0.28)" />
      <path d="M48 48 Q50 44 52 48" strokeLinecap="round" />
      <path d="M20 48 L6 44 M80 48 L94 44" strokeLinecap="round" />
      <path d="M27 44 l6 -4" stroke={CLAY.shine} strokeWidth={3} strokeLinecap="round" />
    </g>
  ),
  monocle: (
    <g>
      <circle cx={66} cy={50} r={15} fill="rgb(255 255 255 / 0.3)" stroke={CLAY.butterDeep} strokeWidth={5} />
      <path d="M74 62 Q80 76 74 90" stroke={CLAY.butterDeep} strokeWidth={2} fill="none" />
      {[68, 74, 80, 86].map((y, i) => (
        <circle key={y} cx={i % 2 ? 77 : 75} cy={y} r={2.6} fill={CLAY.butter} />
      ))}
      <path d="M58 44 l6 -4" stroke={CLAY.shine} strokeWidth={3} strokeLinecap="round" />
    </g>
  ),
  goggles: (
    <g>
      <rect x={2} y={42} width={96} height={14} rx={7} fill={CLAY.peachDeep} />
      <circle cx={34} cy={50} r={17} fill={CLAY.cream} />
      <circle cx={66} cy={50} r={17} fill={CLAY.cream} />
      <circle cx={34} cy={50} r={12} fill="#3E2A45" />
      <circle cx={66} cy={50} r={12} fill="#3E2A45" />
      <ellipse cx={30} cy={45} rx={4} ry={3} fill={CLAY.shine} />
      <ellipse cx={62} cy={45} rx={4} ry={3} fill={CLAY.shine} />
      <rect x={46} y={46} width={8} height={8} rx={3} fill={CLAY.peach} />
    </g>
  ),
  mustache: (
    <g>
      <path
        d="M50 62 C44 56 34 56 28 62 C22 68 14 66 12 58 C10 70 22 78 34 72 C42 68 48 66 50 66 C52 66 58 68 66 72 C78 78 90 70 88 58 C86 66 78 68 72 62 C66 56 56 56 50 62 Z"
        fill="#5B3A44"
      />
      <path d="M30 63 C36 60 42 60 46 63" stroke={CLAY.shine} strokeWidth={2} strokeLinecap="round" fill="none" />
    </g>
  ),
  bowtie: (
    <g>
      <path d="M50 34 L22 20 Q16 34 22 48 Z" fill={CLAY.lilacDeep} />
      <path d="M50 34 L78 20 Q84 34 78 48 Z" fill={CLAY.lilacDeep} />
      <path d="M50 34 L22 42 Q20 46 22 48 Z" fill={CLAY.shade} />
      <rect x={43} y={26} width={14} height={16} rx={6} fill={CLAY.peach} />
      <Shine cx={30} cy={28} rx={4} ry={3} />
    </g>
  ),
  scarf: (
    <g>
      <path d="M58 34 Q64 60 58 86 L72 88 Q78 60 70 34 Z" fill={CLAY.lilac} />
      {[46, 62, 78].map((y) => (
        <path key={y} d={`M${61 + (y - 46) / 10} ${y} L${74 - (y - 46) / 12} ${y + 2}`} stroke={CLAY.butter} strokeWidth={7} />
      ))}
      <path d="M20 30 Q50 44 80 30 Q82 40 78 44 Q50 56 22 44 Q18 40 20 30 Z" fill={CLAY.lilac} />
      {[30, 50, 70].map((x) => (
        <rect key={x} x={x - 4} y={34} width={8} height={14} rx={3} fill={CLAY.butter} />
      ))}
      <Shine cx={32} cy={36} rx={5} ry={2.5} />
    </g>
  ),
  cape: (
    <g>
      <path d="M30 12 Q50 6 70 12 L90 90 Q80 84 72 92 Q62 84 50 92 Q38 84 28 92 Q20 84 10 90 Z" fill={CLAY.peach} />
      <path d="M70 12 L90 90 Q80 84 72 92 L58 20 Z" fill={CLAY.shade} />
      <path d="M30 12 Q50 22 70 12 Q60 6 50 6 Q40 6 30 12 Z" fill={CLAY.lilacDeep} />
    </g>
  ),
  backpack: (
    <g>
      <rect x={14} y={22} width={72} height={64} rx={20} fill={CLAY.pistachio} />
      <rect x={14} y={62} width={72} height={24} rx={12} fill={CLAY.shade} />
      <rect x={6} y={44} width={14} height={30} rx={7} fill={CLAY.pistachioDeep} />
      <rect x={80} y={44} width={14} height={30} rx={7} fill={CLAY.pistachioDeep} />
      <path d="M38 22 Q50 6 62 22" stroke={CLAY.pistachioDeep} strokeWidth={6} fill="none" strokeLinecap="round" />
      <Shine cx={28} cy={34} rx={6} ry={4} />
    </g>
  ),
  jetpack: (
    <g>
      <rect x={12} y={20} width={26} height={60} rx={13} fill={CLAY.steel} />
      <rect x={62} y={20} width={26} height={60} rx={13} fill={CLAY.steel} />
      <rect x={30} y={30} width={40} height={30} rx={8} fill={CLAY.lilacDeep} />
      <rect x={12} y={30} width={26} height={8} fill={CLAY.peachDeep} />
      <rect x={62} y={30} width={26} height={8} fill={CLAY.peachDeep} />
      <g {...stylex.props(s.flame)}>
        <path d="M16 80 Q25 104 34 80 Z" fill={CLAY.gold} />
        <path d="M66 80 Q75 104 84 80 Z" fill={CLAY.gold} />
        <path d="M20 80 Q25 94 30 80 Z" fill={CLAY.peachDeep} />
        <path d="M70 80 Q75 94 80 80 Z" fill={CLAY.peachDeep} />
      </g>
      <Shine cx={20} cy={34} rx={3} ry={8} />
      <Shine cx={70} cy={34} rx={3} ry={8} />
    </g>
  ),
  duck: (
    <g>
      <ellipse cx={50} cy={66} rx={30} ry={20} fill={CLAY.gold} />
      <circle cx={42} cy={38} r={16} fill={CLAY.gold} />
      <path d="M26 38 Q14 40 18 46 Q24 46 30 44 Z" fill={CLAY.peachDeep} />
      <circle cx={38} cy={34} r={2.6} fill={CLAY.ink} />
      <path d="M58 60 Q72 56 76 66 Q66 70 58 66 Z" fill={CLAY.butterDeep} />
      <Shine cx={46} cy={30} rx={5} ry={3} />
      <Shine cx={40} cy={60} rx={8} ry={4} />
    </g>
  ),
  walkie: (
    <g>
      <rect x={62} y={8} width={7} height={24} rx={3.5} fill={CLAY.ink} />
      <rect x={30} y={24} width={42} height={66} rx={12} fill={CLAY.lilacDeep} />
      <rect x={70} y={44} width={6} height={18} rx={3} fill={CLAY.lilac} />
      <rect x={37} y={34} width={28} height={24} rx={6} fill={CLAY.cream} />
      {[40, 46, 52].map((y) => (
        <rect key={y} x={42} y={y} width={18} height={3} rx={1.5} fill={CLAY.ink} />
      ))}
      <circle cx={43} cy={74} r={5} fill={CLAY.cream} />
      <circle cx={59} cy={74} r={5} fill={CLAY.cream} />
      <Shine cx={38} cy={30} rx={4} ry={2.5} />
    </g>
  ),
  binoculars: (
    <g>
      <rect x={18} y={30} width={26} height={50} rx={12} fill={CLAY.ink} />
      <rect x={56} y={30} width={26} height={50} rx={12} fill={CLAY.ink} />
      <rect x={40} y={40} width={20} height={14} rx={5} fill={CLAY.lilacDeep} />
      <circle cx={31} cy={76} r={10} fill={CLAY.lilac} />
      <circle cx={69} cy={76} r={10} fill={CLAY.lilac} />
      <circle cx={31} cy={76} r={6} fill="#E7E5FB" />
      <circle cx={69} cy={76} r={6} fill="#E7E5FB" />
      <Shine cx={24} cy={40} rx={2.5} ry={7} />
    </g>
  ),
};

export const builtinItem = (id: OutfitItemId): ReactNode => ITEMS[id];

export const svgDataUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

/** A Claude-drawn item in its slot box. Drawn as an image: the browser runs no script and loads nothing from it. */
export function DrawnItem({ svg, silhouette }: { svg: string; silhouette?: boolean }) {
  return <image href={svgDataUrl(svg)} x={0} y={0} width={100} height={100} style={silhouette ? { filter: "brightness(0)", opacity: 0.22 } : undefined} />;
}

/** One item on its own, e.g. in the wardrobe. */
export function ItemArt({
  item,
  size,
  silhouette,
  label,
}: {
  item: { kind: "builtin"; id: OutfitItemId } | { kind: "drawn"; svg: string };
  size: number;
  silhouette?: boolean;
  label?: string;
}) {
  const art = item.kind === "builtin" ? ITEMS[item.id] : <DrawnItem svg={item.svg} silhouette={silhouette} />;
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      {item.kind === "builtin" && silhouette ? <g style={{ filter: "brightness(0)", opacity: 0.22 }}>{art}</g> : art}
    </svg>
  );
}

export type SlotArt = { kind: "builtin"; id: OutfitItemId } | { kind: "drawn"; svg: string };
export type WornArt = Partial<Record<OutfitSlot, SlotArt>>;
