import * as stylex from "@stylexjs/stylex";
import { ArrowRight, Crown } from "lucide-react";
import { Link } from "react-router";
import type { GameNudge, GameView } from "@shared/api";
import { RANKS, type OutfitItemId } from "@shared/game";
import { useGame } from "../../lib/game";
import { t, useLang } from "../../lib/i18n";
import { bp, font, radius } from "../../theme/tokens.stylex";
import { btn, text } from "../../theme/ui";
import { ItemArt, type SlotArt } from "./items";
import { Meerkat } from "./Meerkat";
import { rankName, TIER_COLOR, wornArt } from "./outfit";

const s = stylex.create({
  card: {
    position: "relative",
    display: "grid",
    gridTemplateColumns: { default: "150px minmax(0, 1fr)", [bp.phone]: "110px minmax(0, 1fr)" },
    gap: 16,
    alignItems: "end",
    paddingTop: 24,
    paddingInline: 22,
    paddingBottom: 18,
    borderRadius: radius.card,
    overflow: "hidden",
    backgroundImage: "linear-gradient(180deg, #FFE9CF 0%, #FFD6BE 62%, #F2C69B 62%, #E9B987 100%)",
    color: "#32253F",
  },
  sun: { position: "absolute", top: 18, right: 26, width: 54, height: 54, borderRadius: "50%", backgroundColor: "#FFF3C9", boxShadow: "0 0 40px 14px rgb(255 243 201 / 0.8)" },
  hills: { position: "absolute", left: 0, right: 0, bottom: 0, width: "100%", height: 110, pointerEvents: "none" },
  kat: { position: "relative", alignSelf: "end", marginBottom: -6 },
  body: { position: "relative", display: "grid", gap: 12, paddingBottom: 6 },
  bubble: {
    position: "relative",
    paddingBlock: 12,
    paddingInline: 16,
    borderRadius: 20,
    backgroundColor: "#FFF9F3",
    boxShadow: "0 8px 20px -12px rgb(120 72 48 / 0.5)",
    fontSize: 15,
    fontWeight: 550,
    lineHeight: 1.4,
    "::before": {
      content: '""',
      position: "absolute",
      left: -8,
      bottom: 18,
      width: 18,
      height: 18,
      backgroundColor: "#FFF9F3",
      transform: "rotate(45deg)",
      borderRadius: 4,
    },
  },
  cta: { justifySelf: "start" },
  rankRow: { display: "grid", gap: 6 },
  rankLine: { display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "baseline", columnGap: 8, rowGap: 2, fontSize: 13, fontWeight: 650 },
  rankName: { fontFamily: font.display, fontSize: 17, fontWeight: 800 },
  bar: { height: 10, borderRadius: radius.pill, backgroundColor: "rgb(50 37 63 / 0.12)", overflow: "hidden" },
  fill: { height: "100%", borderRadius: radius.pill, backgroundImage: "linear-gradient(90deg, #A99BFF, #F29C76, #F6C453)" },
  foot: { position: "relative", gridColumn: "1 / -1", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, justifyContent: "space-between" },
  next: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    paddingBlock: 6,
    paddingLeft: 6,
    paddingRight: 14,
    borderRadius: radius.pill,
    backgroundColor: "rgb(255 249 243 / 0.85)",
    color: "#32253F",
    textDecoration: "none",
    fontSize: 13,
    fontWeight: 600,
    maxWidth: "100%",
  },
  nextArt: { flexShrink: 0, borderRadius: "50%", backgroundColor: "#FFF3E6" },
  nextText: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  crowns: { display: "flex", gap: 6 },
  crown: { display: "inline-flex", alignItems: "center", gap: 4, paddingBlock: 4, paddingInline: 10, borderRadius: radius.pill, backgroundColor: "rgb(255 249 243 / 0.85)", fontSize: 13, fontWeight: 750 },
  link: { color: "#32253F" },
});

export function nudgeText(n: GameNudge): string {
  switch (n.kind) {
    case "continue":
      return t("game.nudge.continue", { title: n.title });
    case "review":
      return t("game.nudge.review", { cards: t("count.cards", { count: n.count }) });
    case "start":
      return t("game.nudge.start", { title: n.title });
    case "new":
      return t("game.nudge.new");
  }
}

export const nudgeLink = (n: GameNudge): string => (n.kind === "review" ? "/review" : n.kind === "new" ? "/topics" : `/lessons/${n.lessonId}`);

/** The locked reward or habit closest to unlocking. */
export function closestReward(view: GameView): { art: SlotArt; name: string; done: number; total: number } | null {
  const options = [
    ...view.rewards.filter((r) => !r.unlockedAt).map((r) => ({ art: { kind: "drawn", svg: r.svg } as SlotArt, name: r.name, done: r.done, total: r.total })),
    ...view.habits
      .filter((h) => !h.unlockedAt)
      .map((h) => ({ art: { kind: "builtin", id: h.item } as SlotArt, name: t(`game.item.${h.item}`), done: h.done, total: h.target })),
  ];
  return options.sort((a, b) => b.done / b.total - a.done / a.total)[0] ?? null;
}

export function RankBar({ view }: { view: GameView }) {
  useLang();
  const { rank, points, next } = view.rank;
  const base = RANKS[rank]!.points;
  const share = next === null ? 1 : (points - base) / (next - base);
  const nextItem = RANKS[rank + 1]?.item as OutfitItemId | undefined;
  return (
    <div {...stylex.props(s.rankRow)}>
      <div {...stylex.props(s.rankLine)}>
        <span {...stylex.props(s.rankName)}>{rankName(rank)}</span>
        <span {...stylex.props(text.tnum)}>
          {next === null ? t("game.rankMax", { points }) : t("game.rankNext", { points, next, item: t(`game.item.${nextItem!}`) })}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={t("game.rankProgress")}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(share * 100)}
        {...stylex.props(s.bar)}
      >
        <div {...stylex.props(s.fill)} style={{ width: `${Math.max(4, share * 100)}%` }} />
      </div>
    </div>
  );
}

export function Savanna() {
  return (
    <svg viewBox="0 0 400 110" preserveAspectRatio="none" aria-hidden="true" {...stylex.props(s.hills)}>
      <path d="M0 60 C60 40 110 52 170 46 C240 38 300 56 400 40 L400 110 L0 110 Z" fill="#EFC08E" />
      <path d="M0 80 C80 64 150 78 230 70 C300 64 350 76 400 70 L400 110 L0 110 Z" fill="#E4AF7A" />
      <g fill="#A3CC66" opacity={0.9}>
        <path d="M300 70 l4 -14 3 14 Z" />
        <path d="M306 70 l5 -18 3 18 Z" />
        <path d="M352 74 l3 -12 3 12 Z" />
        <path d="M20 84 l3 -11 3 11 Z" />
      </g>
    </svg>
  );
}

/** The meerkat on Home: what to learn next, the rank, and the reward closest to unlocking. */
export function MeerkatCard() {
  useLang();
  const { on, view } = useGame();
  if (!on || !view) return null;
  const next = closestReward(view);
  return (
    <section aria-label={t("game.title")} {...stylex.props(s.card)}>
      <div aria-hidden="true" {...stylex.props(s.sun)} />
      <Savanna />
      <div {...stylex.props(s.kat)}>
        <Meerkat worn={wornArt(view)} pose={view.nudge.kind === "review" ? "guard" : "idle"} size={150} label={t("game.meerkatLabel")} />
      </div>
      <div {...stylex.props(s.body)}>
        <p {...stylex.props(s.bubble)}>{nudgeText(view.nudge)}</p>
        <Link to={nudgeLink(view.nudge)} {...stylex.props(btn.base, btn.primary, btn.sm, s.cta)}>
          {t(`game.nudgeGo.${view.nudge.kind}`)} <ArrowRight size={16} aria-hidden="true" />
        </Link>
        <RankBar view={view} />
      </div>
      <div {...stylex.props(s.foot)}>
        {next ? (
          <Link to="/meerkat" {...stylex.props(s.next)}>
            <span {...stylex.props(s.nextArt)}>
              <ItemArt item={next.art} size={34} silhouette />
            </span>
            <span {...stylex.props(s.nextText, text.tnum)}>{t("game.nextReward", { name: next.name, done: next.done, total: next.total })}</span>
          </Link>
        ) : (
          <Link to="/meerkat" {...stylex.props(s.next)}>
            {t("game.openBurrow")}
          </Link>
        )}
        <div {...stylex.props(s.crowns)}>
          <span title={t("game.crown.silver")} {...stylex.props(s.crown, text.tnum)}>
            <Crown size={15} color={TIER_COLOR.rare.ink} aria-hidden="true" /> {view.crowns.silver + view.crowns.gold}
          </span>
          <span title={t("game.crown.gold")} {...stylex.props(s.crown, text.tnum)}>
            <Crown size={15} color={TIER_COLOR.legendary.glow} fill={TIER_COLOR.legendary.glow} aria-hidden="true" /> {view.crowns.gold}
          </span>
        </div>
      </div>
    </section>
  );
}

