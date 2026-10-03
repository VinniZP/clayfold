import * as stylex from "@stylexjs/stylex";
import { Link } from "react-router";
import { useGame } from "../../lib/game";
import { t, useLang } from "../../lib/i18n";
import { font, radius } from "../../theme/tokens.stylex";
import { text } from "../../theme/ui";
import { conditionTextFor } from "./conditions";
import { ItemArt, svgDataUrl } from "./items";
import { TIER_COLOR } from "./outfit";

const s = stylex.create({
  resident: {
    display: "grid",
    gridTemplateColumns: "88px minmax(0, 1fr)",
    gap: 16,
    alignItems: "center",
    paddingBlock: 16,
    paddingInline: 20,
    borderRadius: radius.card,
    backgroundImage: "linear-gradient(135deg, #6F4630, #9C6B4A)",
    color: "#FFF6E6",
  },
  img: { width: 88, height: 88, objectFit: "contain", filter: "drop-shadow(0 6px 8px rgb(0 0 0 / 0.35))" },
  locked: { filter: "brightness(0) opacity(0.5)" },
  name: { fontFamily: font.display, fontSize: 18, fontWeight: 800 },
  quote: { fontSize: 14.5, fontStyle: "italic" },
  milestones: { display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 },
  milestone: { display: "inline-flex", alignItems: "center", gap: 6, paddingBlock: 3, paddingLeft: 3, paddingRight: 10, borderRadius: radius.pill, backgroundColor: "rgb(255 249 243 / 0.14)", fontSize: 12.5 },
  art: { display: "grid", placeItems: "center", width: 28, height: 28, borderRadius: "50%", backgroundColor: "rgb(255 249 243 / 0.85)" },
  link: { color: "#FFF6E6", fontWeight: 650 },
  trophy: { display: "flex", alignItems: "center", gap: 10, paddingBlock: 6, paddingInline: 10, borderRadius: radius.inner, borderWidth: 2, borderStyle: "dashed", color: "#32253F" },
  dim: { opacity: 0.72 },
  trophyArt: { display: "grid", placeItems: "center", width: 54, height: 54, borderRadius: "50%", backgroundColor: "rgb(255 255 255 / 0.7)" },
  trophyName: { fontWeight: 700, fontSize: 14 },
});

/** The course's resident and its milestones, on the course page. */
export function CourseResident({ topicId }: { topicId: string }) {
  useLang();
  const { on, view } = useGame();
  if (!on || !view) return null;
  const room = view.rooms.find((r) => r.topicId === topicId);
  const milestones = view.rewards.filter((r) => r.topicId === topicId && r.source === "course");
  const resident = room?.resident;
  if (!resident && milestones.length === 0) return null;
  const friend = !!resident?.befriendedAt;
  return (
    <section aria-label={t("game.residentCard")} {...stylex.props(s.resident)}>
      {resident ? (
        <img src={svgDataUrl(resident.svg)} alt={friend ? resident.name : t("game.residentWaiting")} {...stylex.props(s.img, !friend && s.locked)} />
      ) : (
        <span />
      )}
      <div>
        {resident && (
          <>
            <p {...stylex.props(s.name)}>{friend ? `${resident.name} · ${resident.species}` : t("game.residentWaiting")}</p>
            <p {...stylex.props(s.quote)}>{friend ? t("game.quote", { text: resident.lines.greet[0]! }) : t("game.residentHint")}</p>
          </>
        )}
        {milestones.length > 0 && (
          <div {...stylex.props(s.milestones)}>
            {milestones.map((m) => (
              <span key={m.id} title={m.unlockedAt ? m.description : conditionTextFor(m.condition)} {...stylex.props(s.milestone, text.tnum)}>
                <span {...stylex.props(s.art)}>
                  <ItemArt item={{ kind: "drawn", svg: m.svg }} size={22} silhouette={!m.unlockedAt} />
                </span>
                {m.unlockedAt ? m.name : t("game.progress", { done: m.done, total: m.total })}
              </span>
            ))}
          </div>
        )}
        <p {...stylex.props(text.xs)}>
          <Link to="/meerkat" {...stylex.props(s.link)}>
            {t("game.openBurrow")}
          </Link>
        </p>
      </div>
    </section>
  );
}

/** A stage's trophy beside the stage on a goal's plan: a silhouette until every course of the stage is complete. */
export function StageTrophy({ goalId, stage }: { goalId: string; stage: string }) {
  useLang();
  const { on, view } = useGame();
  if (!on || !view) return null;
  const trophy = view.rewards.find((r) => r.topicId === goalId && r.condition.kind === "stage" && r.condition.stage === stage);
  if (!trophy) return null;
  const tier = TIER_COLOR[trophy.tier];
  return (
    <div {...stylex.props(s.trophy)} style={{ borderColor: tier.glow, backgroundColor: tier.soft }}>
      <span {...stylex.props(s.trophyArt)}>
        <ItemArt item={{ kind: "drawn", svg: trophy.svg }} size={46} silhouette={!trophy.unlockedAt} label={trophy.unlockedAt ? trophy.name : undefined} />
      </span>
      <div>
        <p {...stylex.props(s.trophyName)}>{trophy.unlockedAt ? trophy.name : t("game.stageTrophy")}</p>
        <p {...stylex.props(text.xs, s.dim, text.tnum)}>
          {trophy.unlockedAt ? trophy.description : t("game.coursesDone", { done: trophy.done, total: trophy.total })}
        </p>
      </div>
    </div>
  );
}
