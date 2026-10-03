import * as stylex from "@stylexjs/stylex";
import { Check } from "lucide-react";
import type { OnboardingPhase } from "@shared/api";
import type { MessageKey } from "@shared/i18n";
import { t, useLang } from "../lib/i18n";
import { bp, color, motion } from "../theme/tokens.stylex";
import { card, layout, text } from "../theme/ui";

const pulse = stylex.keyframes({
  "0%": { transform: "scale(0.7)", opacity: 0.7 },
  "100%": { transform: "scale(1.5)", opacity: 0 },
});

const STATUS_TEXT: Record<OnboardingPhase["status"], MessageKey> = { done: "onboarding.status.done", active: "onboarding.status.active", pending: "onboarding.status.pending" };

const s = stylex.create({
  head: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 18 },
  list: {
    display: "grid",
    gridTemplateColumns: { default: "repeat(5, minmax(0, 1fr))", [bp.mobile]: "minmax(0, 1fr)" },
    gap: { default: 8, [bp.mobile]: 16 },
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  item: {
    position: "relative",
    display: "grid",
    gridTemplateColumns: { default: "1fr", [bp.mobile]: "32px minmax(0, 1fr)" },
    gap: { default: 10, [bp.mobile]: 12 },
    alignContent: "start",
  },
  connector: {
    position: "absolute",
    top: { default: 16, [bp.mobile]: 38 },
    left: { default: 42, [bp.mobile]: 15 },
    right: { default: 6, [bp.mobile]: "auto" },
    bottom: { default: "auto", [bp.mobile]: -14 },
    height: { default: 0, [bp.mobile]: "auto" },
    borderTopWidth: { default: 2, [bp.mobile]: 0 },
    borderLeftWidth: { default: 0, [bp.mobile]: 2 },
    borderStyle: "solid",
    borderColor: color.border,
  },
  connectorDone: { borderColor: color.primary },
  mark: {
    position: "relative",
    display: "grid",
    placeItems: "center",
    width: 32,
    height: 32,
    borderRadius: "50%",
    borderWidth: 2,
    borderStyle: "dashed",
    borderColor: color.borderStrong,
    backgroundColor: color.surface,
    color: color.textMuted,
    fontSize: 13,
    fontWeight: 750,
    fontVariantNumeric: "tabular-nums",
  },
  markDone: { borderWidth: 0, backgroundColor: color.primary, color: color.onPrimary },
  markActive: {
    borderStyle: "solid",
    borderColor: color.accentText,
    backgroundColor: color.lilacSoft,
    color: color.accentText,
    "::after": {
      content: '""',
      position: "absolute",
      inset: -7,
      borderRadius: "50%",
      borderWidth: 2,
      borderStyle: "solid",
      borderColor: color.accentText,
      opacity: 0,
      animationName: pulse,
      animationDuration: "1.6s",
      animationTimingFunction: motion.ease,
      animationIterationCount: "infinite",
    },
  },
  body: { display: "grid", gap: 2, minWidth: 0 },
  label: { fontSize: 15, fontWeight: 700 },
  labelPending: { color: color.textMuted, fontWeight: 550 },
  detail: { fontSize: 13, color: color.textMuted, overflowWrap: "anywhere" },
  detailActive: { color: color.accentText, fontWeight: 650 },
});

export function OnboardingStepper({ phases }: { phases: OnboardingPhase[] }) {
  useLang();
  const done = phases.filter((p) => p.status === "done").length;
  return (
    <section aria-labelledby="onboarding-title" {...stylex.props(card.base)}>
      <div {...stylex.props(s.head)}>
        <h2 id="onboarding-title" {...stylex.props(text.h2)}>
          {t("onboarding.title")}
        </h2>
        <span {...stylex.props(text.small, text.muted, text.tnum)}>
          {t("common.xOfY", { x: done, y: phases.length })}
        </span>
      </div>
      <ol {...stylex.props(s.list)}>
        {phases.map((p, i) => (
          <li key={p.key} aria-current={p.status === "active" ? "step" : undefined} {...stylex.props(s.item)}>
            {i < phases.length - 1 && <span aria-hidden="true" {...stylex.props(s.connector, p.status === "done" && s.connectorDone)} />}
            <span aria-hidden="true" {...stylex.props(s.mark, p.status === "done" && s.markDone, p.status === "active" && s.markActive)}>
              {p.status === "done" ? <Check size={15} strokeWidth={3} /> : i + 1}
            </span>
            <span {...stylex.props(s.body)}>
              <span {...stylex.props(s.label, p.status === "pending" && s.labelPending)}>{p.label}</span>
              <span {...stylex.props(s.detail, p.status === "active" && s.detailActive)}>
                {p.detail ?? (p.status === "active" ? t("onboarding.inProgress") : p.status === "pending" ? t("onboarding.status.pending") : "")}
              </span>
              <span {...stylex.props(layout.srOnly)}>, {t(STATUS_TEXT[p.status])}</span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
