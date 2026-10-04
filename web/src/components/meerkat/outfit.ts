import type { GameView, HabitView, RewardView } from "@shared/api";
import { OUTFIT_ITEMS, OUTFIT_SLOTS, RANKS, REWARD_PREFIX, type OutfitItemId, type OutfitRef, type OutfitSlot, type Tier } from "@shared/game";
import { t } from "../../lib/i18n";
import type { SlotArt, WornArt } from "./items";

/** The art of each worn item; an item that is no longer unlocked is left off. */
export function wornArt(view: GameView): WornArt {
  const out: WornArt = {};
  for (const slot of OUTFIT_SLOTS) {
    const ref = view.outfit[slot];
    const art = ref ? artOf(view, ref) : null;
    if (art) out[slot] = art;
  }
  return out;
}

export function artOf(view: GameView, ref: OutfitRef): SlotArt | null {
  if (ref.startsWith(REWARD_PREFIX)) {
    const reward = view.rewards.find((r) => `${REWARD_PREFIX}${r.id}` === ref);
    return reward?.unlockedAt ? { kind: "drawn", svg: reward.svg } : null;
  }
  return ownedBuiltins(view).has(ref as OutfitItemId) ? { kind: "builtin", id: ref as OutfitItemId } : null;
}

/** Built-in items unlocked by habits and ranks. */
export function ownedBuiltins(view: GameView): Set<OutfitItemId> {
  const out = new Set<OutfitItemId>();
  for (const h of view.habits) if (h.unlockedAt) out.add(h.item);
  for (const r of RANKS.slice(1, view.rank.rank + 1)) if (r.item) out.add(r.item);
  return out;
}

/** Everything the wardrobe shows for a slot, unlocked first. */
export type WardrobeEntry = {
  ref: OutfitRef;
  slot: OutfitSlot;
  art: SlotArt;
  tier: Tier;
  unlocked: boolean;
  source: { kind: "reward"; reward: RewardView } | { kind: "habit"; habit: HabitView } | { kind: "rank"; rank: number };
};

export function wardrobe(view: GameView): WardrobeEntry[] {
  const out: WardrobeEntry[] = [];
  for (const r of view.rewards) {
    out.push({ ref: `${REWARD_PREFIX}${r.id}`, slot: r.slot, art: { kind: "drawn", svg: r.svg }, tier: r.tier, unlocked: !!r.unlockedAt, source: { kind: "reward", reward: r } });
  }
  for (const h of view.habits) {
    out.push({ ref: h.item, slot: OUTFIT_ITEMS[h.item], art: { kind: "builtin", id: h.item }, tier: h.tier, unlocked: !!h.unlockedAt, source: { kind: "habit", habit: h } });
  }
  RANKS.forEach((r, i) => {
    if (!r.item) return;
    out.push({ ref: r.item, slot: OUTFIT_ITEMS[r.item], art: { kind: "builtin", id: r.item }, tier: i >= 6 ? "legendary" : i >= 4 ? "epic" : "rare", unlocked: view.rank.rank >= i, source: { kind: "rank", rank: i } });
  });
  return out.sort((a, b) => Number(b.unlocked) - Number(a.unlocked));
}

export const TIER_COLOR: Record<Tier, { glow: string; soft: string; ink: string }> = {
  common: { glow: "#A3CC66", soft: "#ECF3D5", ink: "#4A7419" },
  rare: { glow: "#A99BFF", soft: "#E7E5FB", ink: "#5640AE" },
  epic: { glow: "#F29C76", soft: "#FFE0D3", ink: "#A23F22" },
  legendary: { glow: "#F6C453", soft: "#FBE6C4", ink: "#865000" },
};

type RankKey = `game.rank.${0 | 1 | 2 | 3 | 4 | 5 | 6 | 7}`;

export const rankName = (rank: number): string => t(`game.rank.${Math.min(Math.max(rank, 0), RANKS.length - 1)}` as RankKey);
