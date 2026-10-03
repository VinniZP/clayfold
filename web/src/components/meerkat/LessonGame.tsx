import * as stylex from "@stylexjs/stylex";
import { Crown, Swords, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ResidentView } from "@shared/api";
import { api } from "../../lib/api";
import { useGame, useGameEvents, type GameEvent } from "../../lib/game";
import { t, useLang } from "../../lib/i18n";
import { bp, color, font, radius } from "../../theme/tokens.stylex";
import { btn, text } from "../../theme/ui";
import { conditionTextFor } from "./conditions";
import { ItemArt, svgDataUrl } from "./items";
import { Meerkat, type Pose } from "./Meerkat";
import { TIER_COLOR, wornArt } from "./outfit";

/** Away from the lesson this long, the companion greets the learner back with the step they left. */
const WELCOME_BACK_MS = 60_000;
const BUBBLE_MS = 4200;

const pick = <T,>(list: readonly T[], n: number): T => list[n % list.length]!;
const CHEER = ["game.cheer.1", "game.cheer.2", "game.cheer.3", "game.cheer.4"] as const;
const SUPPORT = ["game.support.1", "game.support.2", "game.support.3", "game.support.4"] as const;

const bob = stylex.keyframes({ "0%": { transform: "translateY(0)" }, "50%": { transform: "translateY(-6px)" }, "100%": { transform: "translateY(0)" } });
const appear = stylex.keyframes({ from: { opacity: 0, transform: "translateY(8px) scale(0.96)" }, to: { opacity: 1, transform: "translateY(0) scale(1)" } });
const shimmer = stylex.keyframes({ "0%": { backgroundPosition: "0% 50%" }, "100%": { backgroundPosition: "200% 50%" } });

const s = stylex.create({
  companion: {
    position: "fixed",
    left: { default: 112, [bp.mobile]: 8 },
    bottom: { default: 16, [bp.mobile]: 8 },
    zIndex: 40,
    display: "flex",
    alignItems: "flex-end",
    gap: 6,
    pointerEvents: "none",
  },
  figure: { pointerEvents: "auto", cursor: "pointer", borderWidth: 0, padding: 0, backgroundColor: "transparent" },
  resident: {
    width: { default: 84, [bp.mobile]: 60 },
    height: { default: 84, [bp.mobile]: 60 },
    objectFit: "contain",
    filter: "drop-shadow(0 6px 8px rgb(50 37 63 / 0.25))",
    animationName: { default: bob, [bp.reduce]: "none" },
    animationDuration: "2.8s",
    animationIterationCount: "infinite",
    animationTimingFunction: "ease-in-out",
  },
  bubble: {
    pointerEvents: "auto",
    maxWidth: 260,
    marginBottom: 46,
    paddingBlock: 10,
    paddingInline: 14,
    borderRadius: 18,
    borderBottomLeftRadius: 4,
    backgroundColor: color.surface,
    color: color.text,
    boxShadow: `0 10px 30px -12px ${color.shadowStrong}`,
    fontSize: 14,
    fontWeight: 550,
    lineHeight: 1.4,
    animationName: { default: appear, [bp.reduce]: "none" },
    animationDuration: "0.25s",
  },
  who: { display: "block", fontSize: 11.5, fontWeight: 750, color: color.textMuted, marginBottom: 2 },
  hide: { pointerEvents: "auto", alignSelf: "flex-start", width: 26, height: 26, minWidth: 0 },
  challenge: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    marginBottom: 14,
    paddingBlock: 12,
    paddingInline: 16,
    borderRadius: radius.inner,
    backgroundImage: "linear-gradient(110deg, #FBE6C4, #F6C453, #FFC9B4, #FBE6C4)",
    backgroundSize: "200% 100%",
    animationName: { default: shimmer, [bp.reduce]: "none" },
    animationDuration: "6s",
    animationIterationCount: "infinite",
    animationTimingFunction: "linear",
    color: "#32253F",
  },
  challengeTitle: { fontFamily: font.display, fontSize: 17, fontWeight: 800 },
  reward: {
    display: "grid",
    gridTemplateColumns: "72px minmax(0, 1fr)",
    gap: 14,
    alignItems: "center",
    marginBottom: 14,
    paddingBlock: 12,
    paddingInline: 14,
    borderRadius: radius.inner,
    borderWidth: 2,
    borderStyle: "dashed",
    color: "#32253F",
  },
  rewardArt: { display: "grid", placeItems: "center", width: 72, height: 72, borderRadius: "50%" },
  rewardName: { fontFamily: font.display, fontSize: 16, fontWeight: 800 },
  dim: { opacity: 0.72 },
  crownRow: { display: "flex", alignItems: "center", gap: 10, fontSize: 15, fontWeight: 650 },
});

/** The course's resident once befriended, otherwise the meerkat. */
function useCompanion(topicId: string | null): ResidentView | null {
  const { view } = useGame();
  const resident = view?.rooms.find((r) => r.topicId === topicId)?.resident ?? null;
  return resident?.befriendedAt ? resident : null;
}

/**
 * A small companion in the corner of a lesson: it reacts to answers for a few seconds and greets the learner
 * back after a long absence with where they stopped. It never speaks during the exit check about results.
 */
export function LessonCompanion({ topicId, step, total }: { topicId: string | null; step: number; total: number }) {
  useLang();
  const { on, view } = useGame();
  const resident = useCompanion(topicId);
  const [line, setLine] = useState<string | null>(null);
  const [pose, setPose] = useState<Pose>("idle");
  const [react, setReact] = useState<{ kind: "hop" | "tilt"; n: number } | undefined>();
  const [hidden, setHidden] = useState(false);
  const count = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const awaySince = useRef<number | null>(null);
  const stepRef = useRef({ step, total });
  stepRef.current = { step, total };

  const say = useCallback((text: string, nextPose: Pose) => {
    setLine(text);
    setPose(nextPose);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setLine(null);
      setPose("idle");
    }, BUBBLE_MS);
  }, []);

  const onEvent = useCallback(
    (e: GameEvent) => {
      if (e.kind !== "answer") return;
      const n = ++count.current;
      setReact({ kind: e.correct ? "hop" : "tilt", n });
      const lines = resident ? (e.correct ? resident.lines.cheer : resident.lines.support) : null;
      say(lines ? pick(lines, n) : t(pick(e.correct ? CHEER : SUPPORT, n)), e.correct ? "cheer" : "think");
    },
    [resident, say],
  );
  useGameEvents(onEvent);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        awaySince.current = Date.now();
        return;
      }
      const away = awaySince.current ? Date.now() - awaySince.current : 0;
      awaySince.current = null;
      if (away < WELCOME_BACK_MS) return;
      const { step: at, total: of } = stepRef.current;
      const back = t("game.welcomeBack", { minutes: Math.round(away / 60_000), step: at + 1, total: of });
      say(resident ? `${pick(resident.lines.nudge, count.current)} ${back}` : back, "guard");
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [resident, say]);

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  // Keeps the companion in the content area's corner, clear of the navigation rail.
  const [left, setLeft] = useState<number | null>(null);
  useLayoutEffect(() => {
    const place = () => {
      const main = document.getElementById("main");
      setLeft(main ? main.getBoundingClientRect().left + 16 : null);
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, []);

  if (!on || !view || hidden) return null;
  const name = resident?.name ?? t("game.meerkatName");
  return (
    <div {...stylex.props(s.companion)} style={left === null ? undefined : { left }}>
      <button type="button" aria-label={t("game.companionPoke", { name })} onClick={() => say(t("game.poke"), "guard")} {...stylex.props(s.figure)}>
        {resident ? (
          <img src={svgDataUrl(resident.svg)} alt="" {...stylex.props(s.resident)} />
        ) : (
          <Meerkat worn={wornArt(view)} pose={pose} size={64} react={react} />
        )}
      </button>
      {line && (
        <p role="status" {...stylex.props(s.bubble)}>
          <span {...stylex.props(s.who)}>{name}</span>
          {line}
        </p>
      )}
      <button type="button" aria-label={t("game.hideCompanion")} onClick={() => setHidden(true)} {...stylex.props(btn.base, btn.icon, btn.iconSm, s.hide)}>
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}

export function ChallengeBanner() {
  useLang();
  const { on } = useGame();
  if (!on) return null;
  return (
    <div role="note" {...stylex.props(s.challenge)}>
      <Swords size={22} aria-hidden="true" />
      <div>
        <p {...stylex.props(s.challengeTitle)}>{t("game.challenge")}</p>
        <p {...stylex.props(text.small)}>{t("game.challengeBody")}</p>
      </div>
    </div>
  );
}

/** The lesson's reward: a silhouette with what earns it, or the item once earned, and the lesson's crown. */
export function LessonReward({ lessonId, end }: { lessonId: string; end?: boolean }) {
  useLang();
  const { on, view, crowns } = useGame();
  if (!on || !view) return null;
  const reward = view.rewards.find((r) => r.condition.kind === "lesson" && r.condition.lessonId === lessonId);
  const crown = crowns?.lessons[lessonId];
  if (!reward && !(end && crown)) return null;
  const tier = TIER_COLOR[reward?.tier ?? "rare"];
  return (
    <div {...stylex.props(s.reward)} style={{ borderColor: tier.glow, backgroundColor: tier.soft }}>
      <span {...stylex.props(s.rewardArt)} style={{ backgroundColor: "rgb(255 255 255 / 0.6)" }}>
        {reward ? <ItemArt item={{ kind: "drawn", svg: reward.svg }} size={60} silhouette={!reward.unlockedAt} label={reward.unlockedAt ? reward.name : undefined} /> : <Crown size={36} aria-hidden="true" />}
      </span>
      <div>
        {reward && (
          <>
            <p {...stylex.props(text.xs, s.dim)}>{t(reward.unlockedAt ? "game.lessonRewardEarned" : "game.lessonReward")}</p>
            <p {...stylex.props(s.rewardName)}>{reward.unlockedAt ? reward.name : t("game.mystery")}</p>
            <p {...stylex.props(text.small)}>{reward.unlockedAt ? reward.description : conditionTextFor(reward.condition)}</p>
          </>
        )}
        {end && crown && (
          <p {...stylex.props(s.crownRow)}>
            <Crown size={20} color={crown === "gold" ? TIER_COLOR.legendary.glow : TIER_COLOR.rare.ink} fill={crown === "gold" ? TIER_COLOR.legendary.glow : "none"} aria-hidden="true" />
            {t(`game.crown.${crown}`)}
          </p>
        )}
      </div>
    </div>
  );
}

/** Sends how long the learner was away from the lesson page at most, once they reach its end with the exit check done. */
export function useLessonFocus(lessonId: string, completed: boolean): void {
  const { on } = useGame();
  const longest = useRef(0);
  const since = useRef<number | null>(null);
  const sent = useRef(false);
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") since.current = Date.now();
      else if (since.current) {
        longest.current = Math.max(longest.current, Date.now() - since.current);
        since.current = null;
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);
  useEffect(() => {
    if (!on || !completed || sent.current) return;
    sent.current = true;
    void api.gameFocus(lessonId, longest.current).catch(() => {});
  }, [on, completed, lessonId]);
}

