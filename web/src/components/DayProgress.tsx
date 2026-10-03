import * as stylex from "@stylexjs/stylex";
import { Snowflake } from "lucide-react";
import type { TodayView } from "@shared/api";
import { api } from "../lib/api";
import type { MessageKey } from "@shared/i18n";
import { dayKey, formatDate } from "../lib/format";
import { t, useLang } from "../lib/i18n";
import { useResource } from "../lib/useResource";
import { color, font, radius } from "../theme/tokens.stylex";
import { chip, layout, text } from "../theme/ui";
import { Clay, Progress, Skeleton } from "./ui";

const s = stylex.create({
  box: { display: "grid", gap: 16, paddingBlock: 18, paddingInline: 22, borderRadius: radius.inner, backgroundColor: color.surface2 },
  streak: { display: "flex", alignItems: "center", gap: 14 },
  streakNum: { fontFamily: font.display, fontSize: 28, fontWeight: 800, lineHeight: 1.1, fontVariantNumeric: "tabular-nums" },
  goal: { display: "grid", gap: 8 },
  goalDone: { backgroundColor: color.success },
  list: { display: "grid", gap: 4, margin: 0, paddingLeft: 18 },
});

const days = (n: number) => t("count.days", { count: n });

const NEAR_DAYS: MessageKey[] = ["day.today", "day.tomorrow", "day.dayAfterTomorrow"];

/** "today", "tomorrow", "the day after tomorrow" or a date, for a YYYY-MM-DD local day. */
function dayLabel(date: string): string {
  const d = new Date();
  for (const label of NEAR_DAYS) {
    if (dayKey(d) === date) return t(label);
    d.setDate(d.getDate() + 1);
  }
  return formatDate(`${date}T12:00:00`);
}

/** Streak, daily goal, nodes advanced today and the next review day, shown when a session ends. */
export function DayProgress() {
  useLang();
  const res = useResource(api.today, "today");
  if (!res.data) return res.loading ? <Skeleton lines={3} /> : null;
  const { streak, goal, advanced, nextReview }: TodayView = res.data;
  const done = Math.min(goal.done, goal.minutes);
  const exitPassed = advanced.filter((n) => n.mastery === "exit_passed");
  const mastered = advanced.filter((n) => n.mastery === "mastered");
  const lastFrozen = streak.frozen.at(-1);

  return (
    <section aria-label={t("day.summary")} {...stylex.props(s.box)}>
      <div {...stylex.props(s.streak)}>
        <Clay name="streak-flame" size={56} />
        <div>
          <p {...stylex.props(s.streakNum)}>{t("streak.days", { days: days(streak.days) })}</p>
          <p {...stylex.props(text.small, text.muted)}>
            {streak.activeToday ? t("streak.activeToday") : t("streak.keepGoing")}
            {streak.best > streak.days && ` ${t("streak.best", { days: days(streak.best) })}`}
          </p>
        </div>
      </div>

      <div {...stylex.props(layout.row)}>
        <span {...stylex.props(chip.base, chip.lilac)}>
          <Snowflake size={14} aria-hidden="true" /> {t("count.freezes", { count: streak.freezes })}
        </span>
        <span {...stylex.props(text.small, text.muted)}>
          {streak.nextFreezeIn === null
            ? t("streak.freezeCap")
            : t("streak.nextFreeze", { days: days(streak.nextFreezeIn) })}
        </span>
      </div>
      {lastFrozen && <p {...stylex.props(text.small)}>{t("streak.frozenOn", { date: formatDate(`${lastFrozen}T12:00:00`) })}</p>}

      <div {...stylex.props(s.goal)}>
        <p {...stylex.props(text.strong, text.tnum)}>
          {t(goal.done >= goal.minutes ? "day.goalReached" : "day.goalProgress", { done: Math.round(done), total: goal.minutes })}
        </p>
        <Progress value={done} max={goal.minutes} label={t("day.goal")} fill={goal.done >= goal.minutes ? s.goalDone : undefined} />
      </div>

      {(exitPassed.length > 0 || mastered.length > 0) && (
        <div>
          <p {...stylex.props(text.strong)}>{t("day.advanced")}</p>
          <ul {...stylex.props(s.list)}>
            {mastered.map((n) => (
              <li key={`${n.topicId}/${n.nodeId}`}>
                {n.title}: <strong>{t("mastery.mastered")}</strong>
              </li>
            ))}
            {exitPassed.map((n) => (
              <li key={`${n.topicId}/${n.nodeId}`}>
                {t("day.exitPassed", { title: n.title })}
              </li>
            ))}
          </ul>
        </div>
      )}

      {nextReview && (
        <p>
          {t("day.nextReview")} <strong>{dayLabel(nextReview.date)}</strong>, {t("count.cards", { count: nextReview.cards })}.
        </p>
      )}
    </section>
  );
}
