import * as stylex from "@stylexjs/stylex";
import { useEffect, useMemo, useRef, useState } from "react";
import type { GameView, ResidentView } from "@shared/api";
import { OUTFIT_ITEMS, RANKS, REWARD_PREFIX, type OutfitRef, type OutfitSlot, type Tier } from "@shared/game";
import { api } from "../../lib/api";
import { setGameView, useCelebrationsHeld, useGame } from "../../lib/game";
import { t, useLang } from "../../lib/i18n";
import { bp, color, font, radius } from "../../theme/tokens.stylex";
import { btn, text } from "../../theme/ui";
import { ItemArt, svgDataUrl, type SlotArt } from "./items";
import { Meerkat } from "./Meerkat";
import { rankName, TIER_COLOR, wornArt } from "./outfit";

type Unlock =
  | { kind: "item"; key: string; tier: Tier; slot: OutfitSlot; ref: OutfitRef; art: SlotArt; name: string; description: string; from: string; mark: Parameters<typeof api.gameSeen>[0] }
  | { kind: "friend"; key: string; topicTitle: string; resident: ResidentView; mark: Parameters<typeof api.gameSeen>[0] };

function unseen(view: GameView): Unlock[] {
  const out: Unlock[] = [];
  for (const h of view.habits) {
    if (!h.unlockedAt || h.seen) continue;
    out.push({
      kind: "item",
      key: `h-${h.id}`,
      tier: h.tier,
      slot: OUTFIT_ITEMS[h.item],
      ref: h.item,
      art: { kind: "builtin", id: h.item },
      name: t(`game.item.${h.item}`),
      description: t(`game.habit.${h.id}.desc`, { count: h.target }),
      from: t(`game.habit.${h.id}`),
      mark: { habits: [h.id] },
    });
  }
  for (const r of view.rewards) {
    if (!r.unlockedAt || r.seen) continue;
    out.push({
      kind: "item",
      key: `r-${r.id}`,
      tier: r.tier,
      slot: r.slot,
      ref: `${REWARD_PREFIX}${r.id}`,
      art: { kind: "drawn", svg: r.svg },
      name: r.name,
      description: r.description,
      from: t(`game.source.${r.source}`, { title: r.topicTitle }),
      mark: { rewards: [r.id] },
    });
  }
  if (!view.rank.seen && view.rank.rank > 0) {
    const item = RANKS[view.rank.rank]!.item!;
    out.push({
      kind: "item",
      key: `rank-${view.rank.rank}`,
      tier: view.rank.rank >= 6 ? "legendary" : view.rank.rank >= 4 ? "epic" : "rare",
      slot: OUTFIT_ITEMS[item],
      ref: item,
      art: { kind: "builtin", id: item },
      name: t(`game.item.${item}`),
      description: t("game.rankUpBody", { rank: rankName(view.rank.rank) }),
      from: t("game.rankUp"),
      mark: { ranks: Array.from({ length: view.rank.rank }, (_, i) => i + 1) },
    });
  }
  for (const room of view.rooms) {
    if (!room.resident?.befriendedAt || room.resident.seen) continue;
    out.push({ kind: "friend", key: `f-${room.topicId}`, topicTitle: room.title, resident: room.resident, mark: { residents: [room.topicId] } });
  }
  return out;
}

const rays = stylex.keyframes({ from: { transform: "rotate(0deg)" }, to: { transform: "rotate(360deg)" } });
const pop = stylex.keyframes({
  "0%": { transform: "scale(0.2) rotate(-12deg)", opacity: 0 },
  "60%": { transform: "scale(1.15) rotate(4deg)", opacity: 1 },
  "100%": { transform: "scale(1) rotate(0deg)", opacity: 1 },
});
const rise = stylex.keyframes({ from: { transform: "translateY(16px)", opacity: 0 }, to: { transform: "translateY(0)", opacity: 1 } });
const fall = stylex.keyframes({
  "0%": { transform: "translate(0, -20px) rotate(0deg)", opacity: 1 },
  "100%": { transform: "translate(var(--dx), 420px) rotate(540deg)", opacity: 0 },
});

const s = stylex.create({
  dialog: {
    width: "min(560px, calc(100vw - 32px))",
    maxHeight: "calc(100dvh - 32px)",
    padding: 0,
    borderWidth: 0,
    borderRadius: radius.frame,
    backgroundColor: color.surface,
    color: color.text,
    overflow: "hidden",
    "::backdrop": { backgroundColor: "rgb(30 20 40 / 0.62)", backdropFilter: "blur(4px)" },
  },
  inner: { position: "relative", display: "grid", justifyItems: "center", gap: 10, paddingBlock: 30, paddingInline: { default: 32, [bp.phone]: 20 }, textAlign: "center" },
  stage: { position: "relative", width: 260, height: 220, display: "grid", placeItems: "center" },
  rays: {
    position: "absolute",
    inset: -60,
    borderRadius: "50%",
    animationName: { default: rays, [bp.reduce]: "none" },
    animationDuration: "14s",
    animationTimingFunction: "linear",
    animationIterationCount: "infinite",
    opacity: 0.55,
  },
  halo: { position: "absolute", width: 200, height: 200, borderRadius: "50%", filter: "blur(18px)", opacity: 0.8 },
  item: {
    position: "relative",
    animationName: { default: pop, [bp.reduce]: "none" },
    animationDuration: "0.75s",
    animationTimingFunction: "cubic-bezier(0.3, 0.7, 0.3, 1.2)",
    animationFillMode: "both",
    filter: "drop-shadow(0 14px 18px rgb(50 37 63 / 0.25))",
  },
  tier: { paddingBlock: 4, paddingInline: 12, borderRadius: radius.pill, fontSize: 12.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" },
  title: { fontFamily: font.display, fontSize: { default: 32, [bp.phone]: 26 }, fontWeight: 800, letterSpacing: "-0.02em", lineHeight: 1.1 },
  desc: { maxWidth: "40ch", fontSize: 16 },
  from: { fontSize: 13.5, color: color.textMuted },
  late: { animationName: { default: rise, [bp.reduce]: "none" }, animationDuration: "0.5s", animationDelay: "0.35s", animationFillMode: "both" },
  preview: { display: "flex", alignItems: "center", gap: 14, paddingTop: 10, paddingBottom: 4, paddingInline: 18, borderRadius: radius.inner, backgroundImage: "linear-gradient(180deg, #FFE9CF, #F2C69B)", color: "#32253F" },
  actions: { display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 8, marginTop: 8 },
  count: { position: "absolute", top: 16, right: 20, fontSize: 13, fontWeight: 700, color: color.textMuted },
  confetti: { position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" },
  piece: {
    position: "absolute",
    top: 0,
    width: 9,
    height: 14,
    borderRadius: 3,
    animationName: { default: fall, [bp.reduce]: "none" },
    animationTimingFunction: "cubic-bezier(0.2, 0.6, 0.4, 1)",
    animationFillMode: "both",
    opacity: { default: 1, [bp.reduce]: 0 },
  },
  friend: { width: 190, height: 190, objectFit: "contain" },
});

const CONFETTI = ["#F6C453", "#A99BFF", "#F29C76", "#A3CC66", "#CBC9F5", "#FFC9B4"];

function Confetti({ seed }: { seed: string }) {
  const pieces = useMemo(
    () =>
      Array.from({ length: 34 }, (_, i) => {
        const r = (Math.sin(i * 91.7 + seed.length * 13.1) + 1) / 2;
        const q = (Math.cos(i * 37.3 + seed.length) + 1) / 2;
        return { left: `${Math.round(r * 100)}%`, dx: `${Math.round((q - 0.5) * 160)}px`, delay: `${(i % 9) * 0.06}s`, duration: `${1.6 + q * 1.2}s`, color: CONFETTI[i % CONFETTI.length]! };
      }),
    [seed],
  );
  return (
    <div aria-hidden="true" {...stylex.props(s.confetti)}>
      {pieces.map((p, i) => (
        <span
          key={i}
          {...stylex.props(s.piece)}
          style={{ left: p.left, backgroundColor: p.color, animationDelay: p.delay, animationDuration: p.duration, ["--dx" as string]: p.dx }}
        />
      ))}
    </div>
  );
}

/**
 * Shows each unlock the learner has not seen, one at a time, and lets them put the item on. Waits while a
 * lesson holds celebrations, so a new item never interrupts an exercise.
 */
export function Celebrations() {
  useLang();
  const { on, view } = useGame();
  const held = useCelebrationsHeld();
  const dialog = useRef<HTMLDialogElement>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const queue = useMemo(() => (view ? unseen(view).filter((u) => !dismissed.has(u.key)) : []), [view, dismissed]);
  const current = !held && on ? queue[0] : undefined;

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (current && !d.open) d.showModal();
    if (!current && d.open) d.close();
  }, [current]);

  const done = (items: Unlock[]) => {
    setDismissed((prev) => new Set([...prev, ...items.map((u) => u.key)]));
    const marks = items.reduce<Parameters<typeof api.gameSeen>[0]>(
      (all, u) => ({
        rewards: [...(all.rewards ?? []), ...(u.mark.rewards ?? [])],
        habits: [...(all.habits ?? []), ...(u.mark.habits ?? [])],
        ranks: [...(all.ranks ?? []), ...(u.mark.ranks ?? [])],
        residents: [...(all.residents ?? []), ...(u.mark.residents ?? [])],
      }),
      {},
    );
    void api.gameSeen(marks).catch(() => {});
  };

  const wear = async (u: Extract<Unlock, { kind: "item" }>) => {
    setBusy(true);
    try {
      setGameView(await api.wear(u.slot, u.ref));
    } catch {
      // The item stays in the wardrobe; wearing it from there reports the error.
    } finally {
      setBusy(false);
      done([u]);
    }
  };

  const tier = current?.kind === "item" ? TIER_COLOR[current.tier] : TIER_COLOR.rare;
  const preview = view && current?.kind === "item" ? { ...wornArt(view), [current.slot]: current.art } : null;

  return (
    <dialog ref={dialog} aria-labelledby="celebration-title" onCancel={(e) => (e.preventDefault(), current && done([current]))} {...stylex.props(s.dialog)}>
      {current && (
        <div key={current.key} {...stylex.props(s.inner)}>
          <Confetti seed={current.key} />
          {queue.length > 1 && <span {...stylex.props(s.count, text.tnum)}>{t("game.queue", { count: queue.length - 1 })}</span>}
          <div {...stylex.props(s.stage)}>
            <div {...stylex.props(s.rays)} style={{ background: `repeating-conic-gradient(${tier.soft} 0 10deg, transparent 10deg 20deg)` }} />
            <div {...stylex.props(s.halo)} style={{ backgroundColor: tier.glow }} />
            <div {...stylex.props(s.item)}>
              {current.kind === "item" ? (
                <ItemArt item={current.art} size={180} label={current.name} />
              ) : (
                <img src={svgDataUrl(current.resident.svg)} alt={current.resident.name} {...stylex.props(s.friend)} />
              )}
            </div>
          </div>
          {current.kind === "item" ? (
            <>
              <span {...stylex.props(s.tier)} style={{ backgroundColor: tier.soft, color: tier.ink }}>
                {t(`game.tier.${current.tier}`)}
              </span>
              <h2 id="celebration-title" {...stylex.props(s.title)}>
                {current.name}
              </h2>
              <p {...stylex.props(s.desc)}>{current.description}</p>
              <p {...stylex.props(s.from)}>{current.from}</p>
              {preview && (
                <div {...stylex.props(s.preview, s.late)}>
                  <Meerkat worn={preview} pose="cheer" size={104} react={{ kind: "hop", n: 1 }} />
                  <span {...stylex.props(text.small, text.strong)}>{t("game.tryOn")}</span>
                </div>
              )}
              <div {...stylex.props(s.actions, s.late)}>
                <button type="button" disabled={busy} onClick={() => void wear(current)} {...stylex.props(btn.base, btn.primary)}>
                  {t("game.wear")}
                </button>
                <button type="button" onClick={() => done([current])} {...stylex.props(btn.base, btn.ghost)}>
                  {queue.length > 1 ? t("game.next") : t("game.later")}
                </button>
                {queue.length > 2 && (
                  <button type="button" onClick={() => done(queue)} {...stylex.props(btn.base, btn.plain, btn.sm)}>
                    {t("game.skipAll")}
                  </button>
                )}
              </div>
            </>
          ) : (
            <>
              <span {...stylex.props(s.tier)} style={{ backgroundColor: tier.soft, color: tier.ink }}>
                {t("game.newFriend")}
              </span>
              <h2 id="celebration-title" {...stylex.props(s.title)}>
                {current.resident.name}
              </h2>
              <p {...stylex.props(s.desc)}>{t("game.quote", { text: current.resident.lines.greet[0]! })}</p>
              <p {...stylex.props(s.from)}>{t("game.friendFrom", { species: current.resident.species, title: current.topicTitle })}</p>
              <div {...stylex.props(s.actions, s.late)}>
                <button type="button" onClick={() => done([current])} {...stylex.props(btn.base, btn.primary)}>
                  {queue.length > 1 ? t("game.next") : t("game.hello")}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </dialog>
  );
}
