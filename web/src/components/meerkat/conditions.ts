import type { RewardCondition } from "@shared/game";
import { t } from "../../lib/i18n";

/** What earns a reward, in the learner's words. */
export function conditionTextFor(c: RewardCondition): string {
  switch (c.kind) {
    case "lesson":
      return t(`game.how.lesson.${c.earnedBy}`);
    case "nodes":
      return t(`game.how.nodes.${c.mastery}`, { count: c.nodeIds.length });
    case "stage":
      return t("game.how.stage", { stage: c.stage });
  }
}
