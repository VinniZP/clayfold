import * as stylex from "@stylexjs/stylex";
import { Crown } from "lucide-react";
import { useGame } from "../../lib/game";
import { t, useLang } from "../../lib/i18n";
import { radius } from "../../theme/tokens.stylex";
import { conditionTextFor } from "./conditions";
import { ItemArt } from "./items";
import { TIER_COLOR } from "./outfit";

const s = stylex.create({
  badges: { display: "inline-flex", alignItems: "center", gap: 4 },
  crown: { display: "inline-grid", placeItems: "center", width: 28, height: 28, borderRadius: radius.pill },
  reward: { display: "inline-grid", placeItems: "center", width: 30, height: 30, borderRadius: radius.pill, backgroundColor: "rgb(255 255 255 / 0.6)" },
});

/** A lesson's crown and its reward, in lesson lists. */
export function LessonBadges({ lessonId }: { lessonId: string }) {
  useLang();
  const { on, view, crowns } = useGame();
  if (!on) return null;
  const crown = crowns?.lessons[lessonId];
  const reward = view?.rewards.find((r) => r.condition.kind === "lesson" && r.condition.lessonId === lessonId);
  if (!crown && !reward) return null;
  return (
    <span {...stylex.props(s.badges)}>
      {crown && (
        <span
          title={t(`game.crown.${crown}`)}
          {...stylex.props(s.crown)}
          style={{ backgroundColor: crown === "gold" ? TIER_COLOR.legendary.soft : TIER_COLOR.rare.soft }}
        >
          <Crown
            size={16}
            color={crown === "gold" ? TIER_COLOR.legendary.ink : TIER_COLOR.rare.ink}
            fill={crown === "gold" ? TIER_COLOR.legendary.glow : "none"}
            aria-label={t(`game.crown.${crown}`)}
          />
        </span>
      )}
      {reward && (
        <span title={reward.unlockedAt ? reward.name : conditionTextFor(reward.condition)} {...stylex.props(s.reward)}>
          <ItemArt item={{ kind: "drawn", svg: reward.svg }} size={24} silhouette={!reward.unlockedAt} label={reward.unlockedAt ? reward.name : t("game.lessonReward")} />
        </span>
      )}
    </span>
  );
}

/** Local dates on which the daily goal was met, while the meerkat is on. */
export function useDayCrowns(): Set<string> | null {
  const { on, crowns } = useGame();
  return on && crowns ? new Set(crowns.days) : null;
}
