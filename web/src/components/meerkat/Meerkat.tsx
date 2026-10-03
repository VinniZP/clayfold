import * as stylex from "@stylexjs/stylex";
import { useId } from "react";
import type { OutfitSlot } from "@shared/game";
import { bp } from "../../theme/tokens.stylex";
import { builtinItem, CLAY, DrawnItem, type SlotArt, type WornArt } from "./items";

export type Pose = "idle" | "cheer" | "think" | "guard";

// Canvas 200 x 280 (viewBox y from -40, so hats have room). Each slot's 100 x 100 box is placed over the body.
const SLOT_BOX: Record<Exclude<OutfitSlot, "paw">, string> = {
  head: "translate(45 -50) scale(1.1)",
  face: "translate(34.4 6.5) scale(1.31)",
  neck: "translate(42 71) scale(1.16)",
  back: "translate(27.5 83.5) scale(1.45)",
};

/** Where the held paw is in each pose; the paw item is centred there. */
const PAW: Record<Pose, { x: number; y: number }> = {
  idle: { x: 136, y: 144 },
  cheer: { x: 150, y: 66 },
  think: { x: 98, y: 150 },
  guard: { x: 138, y: 150 },
};

const FUR = { light: "#FFF1D6", base: "#F5DDB0", shade: "#E2C38E" };
const BELLY = "#FFF6E6";
const PATCH = "#3E2A45";
const PAWS = { light: "#D9D4FB", base: "#B9B2F2", shade: "#9C93E6" };

const breathe = stylex.keyframes({ "0%": { transform: "scaleY(1)" }, "50%": { transform: "scaleY(1.018)" }, "100%": { transform: "scaleY(1)" } });
const blink = stylex.keyframes({ "0%": { transform: "scaleY(1)" }, "94%": { transform: "scaleY(1)" }, "97%": { transform: "scaleY(0.1)" }, "100%": { transform: "scaleY(1)" } });
const sway = stylex.keyframes({ "0%": { transform: "rotate(0deg)" }, "50%": { transform: "rotate(7deg)" }, "100%": { transform: "rotate(0deg)" } });
const hop = stylex.keyframes({
  "0%": { transform: "translateY(0) scale(1, 1)" },
  "20%": { transform: "translateY(0) scale(1.06, 0.92)" },
  "45%": { transform: "translateY(-22px) scale(0.96, 1.05)" },
  "70%": { transform: "translateY(0) scale(1.04, 0.95)" },
  "100%": { transform: "translateY(0) scale(1, 1)" },
});
const tilt = stylex.keyframes({ "0%": { transform: "rotate(0deg)" }, "30%": { transform: "rotate(-9deg)" }, "70%": { transform: "rotate(-6deg)" }, "100%": { transform: "rotate(0deg)" } });
const look = stylex.keyframes({ "0%": { transform: "translateX(0)" }, "40%": { transform: "translateX(-3px)" }, "60%": { transform: "translateX(3px)" }, "100%": { transform: "translateX(0)" } });

const s = stylex.create({
  svg: { display: "block", overflow: "visible" },
  body: {
    transformBox: "fill-box",
    transformOrigin: "bottom",
    animationName: { default: breathe, [bp.reduce]: "none" },
    animationDuration: "3.2s",
    animationTimingFunction: "ease-in-out",
    animationIterationCount: "infinite",
  },
  eyes: {
    transformBox: "fill-box",
    transformOrigin: "center",
    animationName: { default: blink, [bp.reduce]: "none" },
    animationDuration: "4.6s",
    animationIterationCount: "infinite",
  },
  tail: {
    transformOrigin: "126px 200px",
    animationName: { default: sway, [bp.reduce]: "none" },
    animationDuration: "2.6s",
    animationTimingFunction: "ease-in-out",
    animationIterationCount: "infinite",
  },
  hop: {
    transformBox: "fill-box",
    transformOrigin: "bottom",
    animationName: { default: hop, [bp.reduce]: "none" },
    animationDuration: "0.7s",
    animationTimingFunction: "cubic-bezier(0.3, 0.7, 0.4, 1)",
  },
  tilt: {
    transformOrigin: "100px 110px",
    animationName: { default: tilt, [bp.reduce]: "none" },
    animationDuration: "1.1s",
    animationTimingFunction: "ease-in-out",
  },
  look: {
    animationName: { default: look, [bp.reduce]: "none" },
    animationDuration: "3.4s",
    animationIterationCount: "infinite",
    animationTimingFunction: "ease-in-out",
  },
});

function Arm({ d, paw, fur, pawFill }: { d: string; paw: { x: number; y: number }; fur: string; pawFill: string }) {
  return (
    <g>
      <path d={d} stroke={fur} strokeWidth={17} strokeLinecap="round" fill="none" />
      <circle cx={paw.x} cy={paw.y} r={9.5} fill={pawFill} />
      <ellipse cx={paw.x - 2.5} cy={paw.y - 3} rx={3.5} ry={2.2} fill="rgb(255 255 255 / 0.45)" />
    </g>
  );
}

function Slot({ art, transform }: { art: SlotArt | undefined; transform: string }) {
  if (!art) return null;
  return <g transform={transform}>{art.kind === "builtin" ? builtinItem(art.id) : <DrawnItem svg={art.svg} />}</g>;
}

/**
 * The meerkat in a pose, wearing `worn`. `react` restarts a reaction each time it changes:
 * a hop for good news, a head tilt for a miss.
 */
export function Meerkat({
  worn = {},
  pose = "idle",
  size = 160,
  react,
  label,
}: {
  worn?: WornArt;
  pose?: Pose;
  size?: number;
  react?: { kind: "hop" | "tilt"; n: number };
  label?: string;
}) {
  const uid = useId().replace(/:/g, "");
  const fur = `url(#fur-${uid})`;
  const pawFill = `url(#paw-${uid})`;
  const paw = PAW[pose];
  const happy = pose === "cheer" || pose === "idle";
  const arms = {
    idle: worn.paw
      ? [
          { d: "M74 124 Q80 140 96 142", paw: { x: 96, y: 142 } },
          { d: "M126 124 Q136 138 134 152", paw: { x: 134, y: 154 } },
        ]
      : [
          { d: "M74 124 Q80 140 94 140", paw: { x: 94, y: 140 } },
          { d: "M126 124 Q120 140 106 140", paw: { x: 106, y: 140 } },
        ],
    cheer: [
      { d: "M72 124 Q58 104 54 84", paw: { x: 54, y: 82 } },
      { d: "M128 124 Q142 104 146 84", paw: { x: 146, y: 80 } },
    ],
    think: [
      { d: "M74 126 Q82 150 98 152", paw: { x: 98, y: 152 } },
      { d: "M128 124 Q122 110 112 104", paw: { x: 112, y: 104 } },
    ],
    // The other arm shades the eyes and is drawn over the head.
    guard: [{ d: "M128 124 Q138 146 134 160", paw: { x: 134, y: 160 } }],
  }[pose];

  return (
    <svg
      viewBox="0 -40 200 280"
      width={size}
      height={(size * 280) / 200}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      {...stylex.props(s.svg)}
    >
      <defs>
        <radialGradient id={`fur-${uid}`} cx="0.35" cy="0.3" r="0.85">
          <stop offset="0" stopColor={FUR.light} />
          <stop offset="0.6" stopColor={FUR.base} />
          <stop offset="1" stopColor={FUR.shade} />
        </radialGradient>
        <radialGradient id={`paw-${uid}`} cx="0.35" cy="0.3" r="0.8">
          <stop offset="0" stopColor={PAWS.light} />
          <stop offset="0.6" stopColor={PAWS.base} />
          <stop offset="1" stopColor={PAWS.shade} />
        </radialGradient>
        <radialGradient id={`belly-${uid}`} cx="0.4" cy="0.3" r="0.8">
          <stop offset="0" stopColor="#FFFFFF" />
          <stop offset="1" stopColor={BELLY} />
        </radialGradient>
      </defs>

      <ellipse cx={100} cy={233} rx={56} ry={7} fill="rgb(50 37 63 / 0.13)" />

      <g key={react ? `${react.kind}-${react.n}` : "still"} {...stylex.props(react?.kind === "hop" && s.hop)}>
        <Slot art={worn.back} transform={SLOT_BOX.back} />

        <g {...stylex.props(s.tail)}>
          <path d="M124 204 C150 200 170 182 166 148" stroke={fur} strokeWidth={15} strokeLinecap="round" fill="none" />
          <path d="M168 164 C168 156 167 150 166 146" stroke={pawFill} strokeWidth={15} strokeLinecap="round" fill="none" />
        </g>

        <ellipse cx={82} cy={225} rx={16} ry={8.5} fill={pawFill} />
        <ellipse cx={118} cy={225} rx={16} ry={8.5} fill={pawFill} />

        <g {...stylex.props(s.body)}>
          <path d="M100 98 C128 98 142 130 142 168 C142 204 126 224 100 224 C74 224 58 204 58 168 C58 130 72 98 100 98 Z" fill={fur} />
          <path d="M100 116 C117 116 124 140 124 168 C124 196 114 214 100 214 C86 214 76 196 76 168 C76 140 83 116 100 116 Z" fill={`url(#belly-${uid})`} />
        </g>

        <Slot art={worn.neck} transform={SLOT_BOX.neck} />

        {worn.paw && (pose === "idle" || pose === "cheer" || pose === "guard") && (
          <Slot art={worn.paw} transform={`translate(${paw.x - 35} ${paw.y - 35}) scale(0.7)`} />
        )}
        {arms.map((a, i) => (
          <Arm key={i} d={a.d} paw={a.paw} fur={fur} pawFill={pawFill} />
        ))}
        {worn.paw && pose === "think" && <Slot art={worn.paw} transform={`translate(${paw.x - 30} ${paw.y - 24}) scale(0.6)`} />}

        <g {...stylex.props(react?.kind === "tilt" && s.tilt)}>
          <circle cx={58} cy={58} r={14} fill={fur} />
          <circle cx={142} cy={58} r={14} fill={fur} />
          <circle cx={59} cy={59} r={7.5} fill="#F6B49A" />
          <circle cx={141} cy={59} r={7.5} fill="#F6B49A" />
          <ellipse cx={100} cy={66} rx={46} ry={42} fill={fur} />
          <ellipse cx={100} cy={80} rx={39} ry={24} fill={BELLY} opacity={0.85} />
          <ellipse cx={79} cy={71} rx={15.5} ry={13.5} fill={PATCH} transform="rotate(-14 79 71)" />
          <ellipse cx={121} cy={71} rx={15.5} ry={13.5} fill={PATCH} transform="rotate(14 121 71)" />
          <g {...stylex.props(pose === "guard" && s.look)}>
            <g {...stylex.props(s.eyes)}>
              {happy ? (
                <>
                  <path d="M72 74 Q79 65 86 74" stroke={BELLY} strokeWidth={3.4} strokeLinecap="round" fill="none" />
                  <path d="M114 74 Q121 65 128 74" stroke={BELLY} strokeWidth={3.4} strokeLinecap="round" fill="none" />
                </>
              ) : (
                <>
                  <circle cx={80} cy={72} r={5.5} fill="#160D1B" />
                  <circle cx={120} cy={72} r={5.5} fill="#160D1B" />
                  <circle cx={82} cy={70} r={1.9} fill="#FFFFFF" />
                  <circle cx={122} cy={70} r={1.9} fill="#FFFFFF" />
                </>
              )}
            </g>
          </g>
          <ellipse cx={66} cy={88} rx={6} ry={3.5} fill={CLAY.peach} opacity={0.6} />
          <ellipse cx={134} cy={88} rx={6} ry={3.5} fill={CLAY.peach} opacity={0.6} />
          <ellipse cx={100} cy={91} rx={18} ry={12} fill={BELLY} />
          <ellipse cx={100} cy={85} rx={6.5} ry={4.6} fill={PAWS.base} />
          <ellipse cx={98.5} cy={83.8} rx={2.2} ry={1.3} fill="rgb(255 255 255 / 0.6)" />
          {pose === "cheer" ? (
            <path d="M93 93 Q100 104 107 93 Z" fill="#6B3A4A" />
          ) : pose === "think" ? (
            <path d="M95 96 Q100 94 105 96" stroke={PATCH} strokeWidth={2.2} strokeLinecap="round" fill="none" />
          ) : (
            <path d="M94 94 Q100 99 106 94" stroke={PATCH} strokeWidth={2.2} strokeLinecap="round" fill="none" />
          )}
          <ellipse cx={86} cy={40} rx={12} ry={6} fill="rgb(255 255 255 / 0.35)" transform="rotate(-20 86 40)" />
          <Slot art={worn.face} transform={SLOT_BOX.face} />
          <Slot art={worn.head} transform={SLOT_BOX.head} />
        </g>
        {pose === "guard" && <Arm d="M72 122 Q58 92 70 58" paw={{ x: 72, y: 54 }} fur={fur} pawFill={pawFill} />}
      </g>
    </svg>
  );
}
