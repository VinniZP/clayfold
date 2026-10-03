import * as stylex from "@stylexjs/stylex";
import { bp, color, font, motion, radius, space } from "./tokens.stylex";

// Shared style primitives: buttons, cards, fields, chips, banners and text helpers.

const shadowCard = `0 1px 2px ${color.shadow}, 0 18px 40px -26px ${color.shadowStrong}`;

export const btn = stylex.create({
  base: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 46,
    paddingInline: 22,
    borderWidth: 1.5,
    borderStyle: "solid",
    borderColor: "transparent",
    borderRadius: radius.pill,
    fontFamily: font.body,
    fontSize: 15,
    fontWeight: 650,
    lineHeight: 1,
    whiteSpace: "nowrap",
    textDecoration: "none",
    cursor: { default: "pointer", ":disabled": "not-allowed" },
    opacity: { default: 1, ":disabled": 0.45 },
    transitionProperty: "background-color, border-color, color, transform",
    transitionDuration: motion.fast,
    transitionTimingFunction: motion.ease,
    transform: { default: null, ":active": "translateY(1px)" },
  },
  primary: {
    backgroundColor: { default: color.primary, ":hover": color.primaryHover, ":disabled": color.primary },
    color: color.onPrimary,
  },
  soft: {
    backgroundColor: { default: color.lilacSoft, ":hover": color.lilac, ":disabled": color.lilacSoft },
    color: color.text,
  },
  outline: {
    backgroundColor: { default: "transparent", ":hover": color.lilacSoft, ":disabled": "transparent" },
    borderColor: color.primary,
    color: color.text,
  },
  ghost: {
    backgroundColor: { default: "transparent", ":hover": color.surface2, ":disabled": "transparent" },
    borderColor: color.border,
    color: color.text,
  },
  plain: {
    backgroundColor: "transparent",
    color: color.text,
    textDecoration: { default: "none", ":hover": "underline" },
    textUnderlineOffset: 4,
  },
  danger: {
    backgroundColor: { default: color.dangerSoft, ":hover": color.surface2 },
    borderColor: color.danger,
    color: color.danger,
  },
  sm: { height: 36, paddingInline: 15, fontSize: 14, gap: 6 },
  lg: { height: 56, paddingInline: 28, fontSize: 16 },
  block: { width: "100%" },
  icon: {
    width: 44,
    height: 44,
    paddingInline: 0,
    flexShrink: 0,
    borderRadius: "50%",
    backgroundColor: { default: color.surface2, ":hover": color.lilacSoft },
    color: color.text,
  },
  iconSm: { width: 32, height: 32 },
  iconSolid: {
    backgroundColor: { default: color.primary, ":hover": color.primaryHover, ":disabled": color.primary },
    color: color.onPrimary,
  },
});

export const card = stylex.create({
  base: {
    position: "relative",
    minWidth: 0,
    padding: { default: 28, [bp.mobile]: 20 },
    borderRadius: radius.card,
    backgroundColor: color.surface,
    boxShadow: shadowCard,
  },
  flat: { boxShadow: "none" },
  lilac: { backgroundColor: color.lilacSoft, boxShadow: "none" },
  peach: { backgroundColor: color.peachSoft, boxShadow: "none" },
  pistachio: { backgroundColor: color.pistachioSoft, boxShadow: "none" },
});

export const shadow = stylex.create({
  card: { boxShadow: shadowCard },
  pop: { boxShadow: `0 4px 10px ${color.shadow}, 0 24px 48px -16px ${color.shadowStrong}` },
});

export const field = stylex.create({
  input: {
    width: "100%",
    paddingBlock: 11,
    paddingInline: 16,
    borderWidth: 1.5,
    borderStyle: "solid",
    borderColor: { default: color.borderStrong, ":focus-visible": color.focus },
    borderRadius: radius.field,
    backgroundColor: { default: color.surface, ":disabled": color.surface2 },
    color: color.text,
    fontSize: 15,
    lineHeight: 1.45,
    outline: { default: null, ":focus-visible": "none" },
    boxShadow: { default: null, ":focus-visible": `0 0 0 3px ${color.lilacSoft}` },
    transitionProperty: "border-color, box-shadow",
    transitionDuration: motion.fast,
  },
  textarea: { resize: "vertical" },
  select: {
    appearance: "none",
    paddingRight: 38,
    backgroundImage: "linear-gradient(45deg, transparent 50%, currentColor 50%), linear-gradient(135deg, currentColor 50%, transparent 50%)",
    backgroundPosition: "calc(100% - 20px) 50%, calc(100% - 15px) 50%",
    backgroundSize: "5px 5px",
    backgroundRepeat: "no-repeat",
  },
  label: { fontSize: 13.5, fontWeight: 600, color: color.textMuted },
  stack: { display: "grid", gap: 6 },
  inline: { display: "flex", alignItems: "center", gap: 10 },
});

export const chip = stylex.create({
  base: {
    display: "inline-flex",
    alignItems: "center",
    // In a grid cell, keep the chip at content width.
    justifySelf: "start",
    flexGrow: 0,
    flexShrink: 0,
    height: "auto",
    gap: space.xs,
    width: "fit-content",
    paddingBlock: space.xxs,
    paddingInline: space.md,
    lineHeight: 1.4,
    borderRadius: radius.pill,
    backgroundColor: color.surface2,
    color: color.textMuted,
    fontSize: 12.5,
    fontWeight: 650,
    whiteSpace: "nowrap",
  },
  xs: { paddingBlock: 2, paddingInline: space.sm, fontSize: 11.5 },
  lilac: { backgroundColor: color.lilacSoft, color: color.accentText },
  butter: { backgroundColor: color.warningSoft, color: color.warning },
  pistachio: { backgroundColor: color.successSoft, color: color.success },
  danger: { backgroundColor: color.dangerSoft, color: color.danger },
  solid: { backgroundColor: color.primary, color: color.onPrimary },
});

export const banner = stylex.create({
  base: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    paddingBlock: 13,
    paddingInline: 18,
    borderRadius: radius.inner,
    fontSize: 14.5,
    fontWeight: 500,
  },
  butter: { backgroundColor: color.butter, color: color.text },
  lilac: { backgroundColor: color.lilacSoft, color: color.text },
  ink: { backgroundColor: color.primary, color: color.onPrimary },
  danger: { backgroundColor: color.dangerSoft, color: color.danger },
});

export const text = stylex.create({
  display: { fontFamily: font.display, fontWeight: 800, letterSpacing: "-0.02em", lineHeight: 1.08, textWrap: "balance" },
  h2: { fontFamily: font.display, fontSize: 20, fontWeight: 700, letterSpacing: "-0.01em", lineHeight: 1.2 },
  h3: { fontFamily: font.display, fontSize: 17, fontWeight: 700, lineHeight: 1.25 },
  muted: { color: color.textMuted },
  small: { fontSize: 13.5 },
  xs: { fontSize: 12.5 },
  strong: { fontWeight: 650 },
  tnum: { fontVariantNumeric: "tabular-nums" },
  link: {
    color: color.accentText,
    fontWeight: 600,
    textDecoration: { default: "none", ":hover": "underline" },
    textUnderlineOffset: 3,
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
  },
  error: { display: "flex", alignItems: "center", gap: 6, color: color.danger, fontSize: 14, fontWeight: 500 },
  saved: { display: "inline-flex", alignItems: "center", gap: 6, color: color.success, fontSize: 14, fontWeight: 600 },
});

export const layout = stylex.create({
  srOnly: {
    position: "absolute",
    width: 1,
    height: 1,
    padding: 0,
    margin: -1,
    overflow: "hidden",
    clip: "rect(0 0 0 0)",
    whiteSpace: "nowrap",
    borderWidth: 0,
  },
  row: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
  stack: { display: "grid", gap: 16, alignContent: "start" },
  between: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 },
  actions: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 },
  plainList: { listStyle: "none", margin: 0, padding: 0 },
});
