import * as stylex from "@stylexjs/stylex";
import { Crown, Lock, Shirt } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import type { BurrowRoom, GameView, RewardView } from "@shared/api";
import { OUTFIT_SLOTS, type OutfitSlot } from "@shared/game";
import { useHeader } from "../components/header";
import { conditionTextFor } from "../components/meerkat/conditions";
import { ItemArt, svgDataUrl, type SlotArt } from "../components/meerkat/items";
import { Meerkat } from "../components/meerkat/Meerkat";
import { RankBar, Savanna } from "../components/meerkat/MeerkatCard";
import { rankName, TIER_COLOR, wardrobe, wornArt, type WardrobeEntry } from "../components/meerkat/outfit";
import { CardHead, Empty, PageLoading } from "../components/ui";
import { api, errorText } from "../lib/api";
import { setGameView, useGame } from "../lib/game";
import { t, useLang } from "../lib/i18n";
import { bp, color, font, radius } from "../theme/tokens.stylex";
import { btn, card, layout, text } from "../theme/ui";

const s = stylex.create({
  page: { display: "grid", gap: 24 },
  top: { display: "grid", gridTemplateColumns: { default: "minmax(280px, 380px) minmax(0, 1fr)", [bp.tablet]: "minmax(0, 1fr)" }, gap: 24, alignItems: "start" },
  stage: {
    position: "relative",
    display: "grid",
    justifyItems: "center",
    gap: 14,
    paddingTop: 36,
    paddingInline: 24,
    paddingBottom: 22,
    borderRadius: radius.card,
    overflow: "hidden",
    backgroundImage: "linear-gradient(180deg, #FFE9CF 0%, #FFD6BE 66%, #E9B987 66%, #E4AF7A 100%)",
    color: "#32253F",
  },
  stageKat: { position: "relative" },
  stats: { position: "relative", display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, width: "100%" },
  stat: { display: "grid", justifyItems: "center", gap: 2, paddingBlock: 8, borderRadius: 16, backgroundColor: "rgb(255 249 243 / 0.85)" },
  statNum: { fontFamily: font.display, fontSize: 22, fontWeight: 800, fontVariantNumeric: "tabular-nums", display: "inline-flex", alignItems: "center", gap: 4 },
  statLabel: { fontSize: 12, fontWeight: 600, textAlign: "center" },
  rank: { position: "relative", width: "100%", paddingBlock: 12, paddingInline: 14, borderRadius: 18, backgroundColor: "rgb(255 249 243 / 0.85)" },
  tabs: { display: "flex", flexWrap: "wrap", gap: 6 },
  tab: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    height: 36,
    paddingInline: 14,
    borderWidth: 0,
    borderRadius: radius.pill,
    backgroundColor: { default: color.surface2, ":hover": color.lilacSoft },
    color: color.text,
    fontSize: 14,
    fontWeight: 650,
    cursor: "pointer",
  },
  tabOn: { backgroundColor: { default: color.primary, ":hover": color.primary }, color: color.onPrimary },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(132px, 1fr))", gap: 12, marginTop: 16 },
  item: {
    width: "100%",
    height: "100%",
    position: "relative",
    display: "grid",
    justifyItems: "center",
    alignContent: "start",
    gap: 6,
    paddingBlock: 12,
    paddingInline: 10,
    borderWidth: 2,
    borderStyle: "solid",
    borderColor: "transparent",
    borderRadius: 20,
    backgroundColor: color.surface2,
    color: color.text,
    textAlign: "center",
    cursor: "pointer",
    transitionProperty: "transform, border-color",
    transitionDuration: "160ms",
    transform: { default: null, ":hover": "translateY(-3px)" },
  },
  itemLocked: { cursor: "default", transform: "none" },
  itemOn: { borderColor: color.primary },
  itemName: { fontSize: 13, fontWeight: 650, lineHeight: 1.25 },
  itemHow: { fontSize: 11.5, color: color.textMuted, lineHeight: 1.3 },
  tierDot: { position: "absolute", top: 8, right: 8, width: 10, height: 10, borderRadius: "50%" },
  lock: { position: "absolute", top: 8, left: 8, color: color.textMuted },
  mini: { height: 5, width: "80%", borderRadius: radius.pill, backgroundColor: color.surface3, overflow: "hidden" },
  miniFill: { height: "100%", backgroundColor: color.primary },
  burrow: {
    position: "relative",
    display: "grid",
    gap: 28,
    paddingTop: 30,
    paddingBottom: 34,
    paddingInline: { default: 28, [bp.mobile]: 14 },
    borderRadius: radius.card,
    overflow: "hidden",
    backgroundColor: "#9C6B4A",
    backgroundImage:
      "radial-gradient(circle at 12% 18%, rgb(255 255 255 / 0.08) 0 6px, transparent 7px), radial-gradient(circle at 78% 42%, rgb(0 0 0 / 0.10) 0 9px, transparent 10px), radial-gradient(circle at 34% 74%, rgb(255 255 255 / 0.07) 0 5px, transparent 6px), radial-gradient(circle at 88% 86%, rgb(0 0 0 / 0.08) 0 7px, transparent 8px), linear-gradient(180deg, #B98458 0%, #8E5E40 55%, #6F4630 100%)",
    color: "#FFF6E6",
  },
  spine: { position: "absolute", top: 0, bottom: 0, left: "50%", width: 34, marginLeft: -17, borderRadius: 17, backgroundColor: "#5B3A28", opacity: 0.7, display: { default: "block", [bp.mobile]: "none" } },
  burrowHead: { position: "relative", display: "grid", gap: 4, textAlign: "center" },
  burrowTitle: { fontFamily: font.display, fontSize: 26, fontWeight: 800 },
  rooms: { position: "relative", display: "grid", gap: 22 },
  roomRow: { display: "flex", justifyContent: { default: "flex-start", [bp.mobile]: "center" } },
  roomRight: { justifyContent: { default: "flex-end", [bp.mobile]: "center" } },
  room: {
    position: "relative",
    display: "grid",
    gridTemplateColumns: "96px minmax(0, 1fr)",
    gap: 14,
    alignItems: "center",
    width: { default: "calc(50% - 30px)", [bp.mobile]: "100%" },
    minHeight: 150,
    paddingBlock: 16,
    paddingInline: 18,
    borderRadius: "60px 60px 40px 40px / 50px 50px 30px 30px",
    backgroundColor: "#3B2619",
    boxShadow: "inset 0 10px 24px rgb(0 0 0 / 0.45), inset 0 -4px 0 rgb(255 255 255 / 0.05)",
  },
  tunnel: { position: "absolute", top: "50%", width: 34, height: 28, marginTop: -14, backgroundColor: "#5B3A28", opacity: 0.85, display: { default: "block", [bp.mobile]: "none" } },
  tunnelLeft: { left: "100%", borderRadius: "0 14px 14px 0" },
  tunnelRight: { right: "100%", borderRadius: "14px 0 0 14px" },
  resident: { position: "relative", width: 96, height: 96, objectFit: "contain", filter: "drop-shadow(0 6px 8px rgb(0 0 0 / 0.4))" },
  residentLocked: { filter: "brightness(0) opacity(0.45)" },
  noResident: { position: "relative", width: 96, height: 96, display: "grid", placeItems: "center", borderRadius: "50%", backgroundColor: "rgb(255 255 255 / 0.06)", fontFamily: font.display, fontSize: 34, fontWeight: 800, color: "rgb(255 246 230 / 0.45)" },
  roomBody: { position: "relative", display: "grid", gap: 6, minWidth: 0 },
  roomTitle: { fontFamily: font.display, fontSize: 17, fontWeight: 750, color: "#FFF6E6", textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis" },
  roomMeta: { fontSize: 12.5, color: "rgb(255 246 230 / 0.75)" },
  shelf: { display: "flex", flexWrap: "wrap", gap: 4, paddingTop: 6, borderTopWidth: 4, borderTopStyle: "solid", borderTopColor: "#7A5235" },
  shelfItem: { display: "grid", placeItems: "center", width: 40, height: 40, borderRadius: 12, backgroundColor: "rgb(255 246 230 / 0.55)" },
  hall: { position: "relative", display: "grid", gap: 14, paddingBlock: 18, paddingInline: 20, borderRadius: 30, backgroundColor: "#2E1D13", boxShadow: "inset 0 10px 24px rgb(0 0 0 / 0.5)" },
  hallGoal: { display: "grid", gap: 10 },
  trophies: { display: "flex", flexWrap: "wrap", gap: 12 },
  trophy: { display: "grid", justifyItems: "center", gap: 4, width: 108, textAlign: "center", fontSize: 12, color: "#FFF6E6" },
  pedestal: { display: "grid", placeItems: "center", width: 84, height: 84, borderRadius: "50%", backgroundImage: "radial-gradient(circle, rgb(255 246 230 / 0.6), rgb(246 196 83 / 0.25) 70%)" },
  habits: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 260px), 1fr))", gap: 10, margin: 0, padding: 0, listStyle: "none" },
  habit: { display: "grid", gridTemplateColumns: "48px minmax(0, 1fr)", gap: 12, alignItems: "center", paddingBlock: 10, paddingInline: 12, borderRadius: 18, backgroundColor: color.surface2 },
  habitBar: { height: 6, borderRadius: radius.pill, backgroundColor: color.surface3, overflow: "hidden", marginTop: 6 },
  error: { marginTop: 10 },
  intro: { maxWidth: "70ch" },
});

const progressOf = (e: WardrobeEntry): { done: number; total: number } | null =>
  e.source.kind === "reward" ? { done: e.source.reward.done, total: e.source.reward.total } : e.source.kind === "habit" ? { done: e.source.habit.done, total: e.source.habit.target } : null;

function howToGet(e: WardrobeEntry): string {
  switch (e.source.kind) {
    case "habit":
      return t(`game.habit.${e.source.habit.id}.desc`, { count: e.source.habit.target });
    case "rank":
      return t("game.howRank", { rank: rankName(e.source.rank) });
    case "reward":
      return conditionText(e.source.reward);
  }
}

const conditionText = (r: RewardView) => conditionTextFor(r.condition);

const nameOf = (e: WardrobeEntry) => (e.source.kind === "reward" ? e.source.reward.name : e.art.kind === "builtin" ? t(`game.item.${e.art.id}`) : "");

function Wardrobe({ view }: { view: GameView }) {
  useLang();
  const [slot, setSlot] = useState<OutfitSlot>("head");
  const [preview, setPreview] = useState<SlotArt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const entries = wardrobe(view).filter((e) => e.slot === slot);
  const worn = view.outfit[slot];
  const art = { ...wornArt(view), ...(preview ? { [slot]: preview } : {}) };

  const wear = async (e: WardrobeEntry) => {
    if (!e.unlocked) return;
    setBusy(true);
    setError(null);
    try {
      setGameView(await api.wear(slot, worn === e.ref ? null : e.ref));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div {...stylex.props(s.top)}>
      <div {...stylex.props(s.stage)}>
        <Savanna />
        <div {...stylex.props(s.stageKat)}>
          <Meerkat worn={art} pose={preview ? "cheer" : "idle"} size={230} react={preview ? { kind: "hop", n: 1 } : undefined} label={t("game.meerkatLabel")} />
        </div>
        <div {...stylex.props(s.stats)}>
          <div {...stylex.props(s.stat)}>
            <span {...stylex.props(s.statNum)}>
              <Crown size={18} color={TIER_COLOR.rare.ink} aria-hidden="true" /> {view.crowns.silver + view.crowns.gold}
            </span>
            <span {...stylex.props(s.statLabel)}>{t("game.stat.crowns")}</span>
          </div>
          <div {...stylex.props(s.stat)}>
            <span {...stylex.props(s.statNum)}>
              <Crown size={18} color={TIER_COLOR.legendary.glow} fill={TIER_COLOR.legendary.glow} aria-hidden="true" /> {view.crowns.gold}
            </span>
            <span {...stylex.props(s.statLabel)}>{t("game.stat.gold")}</span>
          </div>
          <div {...stylex.props(s.stat)}>
            <span {...stylex.props(s.statNum)}>{view.crowns.days}</span>
            <span {...stylex.props(s.statLabel)}>{t("game.stat.days")}</span>
          </div>
        </div>
        <div {...stylex.props(s.rank)}>
          <RankBar view={view} />
        </div>
      </div>

      <section aria-labelledby="wardrobe-title" {...stylex.props(card.base)}>
        <CardHead id="wardrobe-title" title={t("game.wardrobe")} />
        <div role="tablist" aria-label={t("game.slots")} {...stylex.props(s.tabs)}>
          {OUTFIT_SLOTS.map((sl) => (
            <button key={sl} type="button" role="tab" aria-selected={slot === sl} onClick={() => setSlot(sl)} {...stylex.props(s.tab, slot === sl && s.tabOn)}>
              {t(`game.slot.${sl}`)}
            </button>
          ))}
        </div>
        {entries.length === 0 ? (
          <Empty title={t("game.slotEmpty")} art={null} />
        ) : (
          <ul {...stylex.props(layout.plainList, s.grid)}>
            {entries.map((e) => {
              const p = progressOf(e);
              return (
                <li key={e.ref}>
                  <button
                    type="button"
                    disabled={busy || !e.unlocked}
                    aria-pressed={worn === e.ref}
                    onClick={() => void wear(e)}
                    onPointerEnter={() => e.unlocked && setPreview(e.art)}
                    onPointerLeave={() => setPreview(null)}
                    onFocus={() => e.unlocked && setPreview(e.art)}
                    onBlur={() => setPreview(null)}
                    {...stylex.props(s.item, !e.unlocked && s.itemLocked, worn === e.ref && s.itemOn)}
                  >
                    <span {...stylex.props(s.tierDot)} style={{ backgroundColor: TIER_COLOR[e.tier].glow }} title={t(`game.tier.${e.tier}`)} />
                    {!e.unlocked && <Lock size={14} aria-hidden="true" {...stylex.props(s.lock)} />}
                    <ItemArt item={e.art} size={76} silhouette={!e.unlocked} />
                    <span {...stylex.props(s.itemName)}>{e.unlocked ? nameOf(e) : t("game.locked")}</span>
                    <span {...stylex.props(s.itemHow)}>{e.unlocked ? (worn === e.ref ? t("game.wearing") : t("game.tapToWear")) : howToGet(e)}</span>
                    {!e.unlocked && p && (
                      <span {...stylex.props(s.mini)} aria-label={t("game.progress", { done: p.done, total: p.total })}>
                        <span {...stylex.props(s.miniFill)} style={{ display: "block", width: `${(p.done / p.total) * 100}%` }} />
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {error && (
          <p role="alert" {...stylex.props(text.error, s.error)}>
            {error}
          </p>
        )}
      </section>
    </div>
  );
}

function Room({ room, rewards, right }: { room: BurrowRoom; rewards: RewardView[]; right: boolean }) {
  useLang();
  const r = room.resident;
  const dug = room.total > 0 ? room.passed / room.total : 0;
  return (
    <li {...stylex.props(s.roomRow, right && s.roomRight)}>
      {/* A chamber glows brighter as more of its course passes the exit check. */}
      <div {...stylex.props(s.room)} style={{ backgroundImage: `radial-gradient(ellipse at 30% 20%, rgb(246 196 83 / ${(0.08 + dug * 0.42).toFixed(2)}), transparent 70%)` }}>
        <span aria-hidden="true" {...stylex.props(s.tunnel, right ? s.tunnelRight : s.tunnelLeft)} />
        {r ? (
          <img
            src={svgDataUrl(r.svg)}
            alt={r.befriendedAt ? r.name : t("game.residentWaiting")}
            title={r.befriendedAt ? `${r.name}: ${r.bio}` : t("game.residentHint")}
            {...stylex.props(s.resident, !r.befriendedAt && s.residentLocked)}
          />
        ) : (
          <span aria-hidden="true" {...stylex.props(s.noResident)}>
            ?
          </span>
        )}
        <div {...stylex.props(s.roomBody)}>
          <Link to={`/topics/${room.topicId}`} {...stylex.props(s.roomTitle)}>
            {room.title}
          </Link>
          <span {...stylex.props(s.roomMeta, text.tnum)}>
            {r?.befriendedAt ? t("game.livesHere", { name: r.name, species: r.species }) : r ? t("game.residentHint") : t("game.noResident")}
          </span>
          <span {...stylex.props(s.roomMeta, text.tnum)}>{t("game.roomDug", { passed: room.passed, total: room.total })}</span>
          {rewards.length > 0 && (
            <div {...stylex.props(s.shelf)} aria-label={t("game.shelf")}>
              {rewards.map((rw) => (
                <span key={rw.id} title={rw.unlockedAt ? rw.name : conditionText(rw)} {...stylex.props(s.shelfItem)}>
                  <ItemArt item={{ kind: "drawn", svg: rw.svg }} size={34} silhouette={!rw.unlockedAt} label={rw.unlockedAt ? rw.name : undefined} />
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

function Burrow({ view }: { view: GameView }) {
  useLang();
  const goals = [...new Map(view.rewards.filter((r) => r.source === "stage").map((r) => [r.topicId, r.topicTitle])).entries()];
  return (
    <section aria-labelledby="burrow-title" {...stylex.props(s.burrow)}>
      <div aria-hidden="true" {...stylex.props(s.spine)} />
      <div {...stylex.props(s.burrowHead)}>
        <h2 id="burrow-title" {...stylex.props(s.burrowTitle)}>
          {t("game.burrow")}
        </h2>
        <p {...stylex.props(text.small)}>{t("game.burrowSub")}</p>
      </div>
      {view.rooms.length === 0 ? (
        <p {...stylex.props(text.small)}>{t("game.burrowEmpty")}</p>
      ) : (
        <ul {...stylex.props(layout.plainList, s.rooms)}>
          {view.rooms.map((room, i) => (
            <Room key={room.topicId} room={room} rewards={view.rewards.filter((r) => r.topicId === room.topicId)} right={i % 2 === 1} />
          ))}
        </ul>
      )}
      {goals.length > 0 && (
        <div {...stylex.props(s.hall)}>
          <h3 {...stylex.props(text.h3)}>{t("game.trophyHall")}</h3>
          {goals.map(([goalId, title]) => (
            <div key={goalId} {...stylex.props(s.hallGoal)}>
              <Link to={`/topics/${goalId}`} {...stylex.props(s.roomTitle)}>
                {title}
              </Link>
              <ul {...stylex.props(layout.plainList, s.trophies)}>
                {view.rewards
                  .filter((r) => r.topicId === goalId && r.source === "stage")
                  .map((r) => (
                    <li key={r.id} {...stylex.props(s.trophy)}>
                      <span {...stylex.props(s.pedestal)}>
                        <ItemArt item={{ kind: "drawn", svg: r.svg }} size={70} silhouette={!r.unlockedAt} label={r.unlockedAt ? r.name : undefined} />
                      </span>
                      <span {...stylex.props(text.strong)}>{r.unlockedAt ? r.name : r.condition.kind === "stage" ? r.condition.stage : ""}</span>
                      <span {...stylex.props(text.tnum)}>{t("game.coursesDone", { done: r.done, total: r.total })}</span>
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function Habits({ view }: { view: GameView }) {
  useLang();
  return (
    <section aria-labelledby="habits-title" {...stylex.props(card.base)}>
      <CardHead id="habits-title" title={t("game.habits")} />
      <ul {...stylex.props(s.habits)}>
        {view.habits.map((h) => (
          <li key={h.id} {...stylex.props(s.habit)}>
            <ItemArt item={{ kind: "builtin", id: h.item }} size={48} silhouette={!h.unlockedAt} />
            <div>
              <p {...stylex.props(text.strong, text.small)}>{t(`game.habit.${h.id}`)}</p>
              <p {...stylex.props(text.xs, text.muted)}>{t(`game.habit.${h.id}.desc`, { count: h.target })}</p>
              <div {...stylex.props(s.habitBar)}>
                <div style={{ height: "100%", width: `${(h.done / h.target) * 100}%`, backgroundColor: TIER_COLOR[h.tier].glow }} />
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function MeerkatPage() {
  useLang();
  useHeader({ title: t("game.title"), sub: t("game.sub") });
  const { on, view } = useGame();
  if (!on) {
    return (
      <section {...stylex.props(card.base)}>
        <Empty title={t("game.offTitle")} art={null} action={<Link to="/settings" {...stylex.props(btn.base, btn.primary)}>{t("game.turnOn")}</Link>}>
          {t("game.offBody")}
        </Empty>
      </section>
    );
  }
  if (!view) return <PageLoading />;
  return (
    <div {...stylex.props(s.page)}>
      <Wardrobe view={view} />
      <Burrow view={view} />
      <Habits view={view} />
      <p {...stylex.props(text.small, text.muted, s.intro)}>
        <Shirt size={14} aria-hidden="true" /> {t("game.rules")}
      </p>
    </div>
  );
}

