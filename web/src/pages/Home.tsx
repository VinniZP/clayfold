import * as stylex from "@stylexjs/stylex";
import { ArrowRight, Play } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import type { ActivityDay, CalibrationView, GoalMinutes, ReviewSession, TodayView, TopicDetail, TopicSummary, WeakSpot } from "@shared/api";
import { ActivityCalendar, buildCalendar, CALENDAR_WEEKS, RibbonLegend } from "../components/ActivityCalendar";
import { Calibration } from "../components/Calibration";
import { Gauge, HatchedBars, Rings, WeekDots } from "../components/Charts";
import { readyLine } from "../components/LessonStatus";
import { useHeader } from "../components/header";
import { MeerkatCard } from "../components/meerkat/MeerkatCard";
import { MoreLink, NewTopicForm, TopicCard, toneAt, topicObject } from "../components/Topics";
import { CardHead, Clay, Empty, ErrorBox, Markdown, PageLoading } from "../components/ui";
import { api, errorText } from "../lib/api";
import { dateFormat, dayKey } from "../lib/format";
import { t, useLang } from "../lib/i18n";
import { useResource } from "../lib/useResource";
import { bp, color, font, radius } from "../theme/tokens.stylex";
import { btn, card, chip, layout, text } from "../theme/ui";

const s = stylex.create({
  page: { display: "grid", gridTemplateColumns: "repeat(12, minmax(0, 1fr))", gap: 24, alignItems: "start" },
  hero: {
    gridColumn: "1 / -1",
    position: "relative",
    display: "grid",
    gap: 14,
    paddingBlock: { default: 40, [bp.mobile]: 26 },
    paddingInline: { default: 40, [bp.mobile]: 22 },
    paddingRight: { default: 380, [bp.tablet]: 40, [bp.mobile]: 22 },
    borderRadius: radius.card,
    backgroundColor: color.peach,
    minHeight: { default: 280, [bp.mobile]: 0 },
  },
  heroTitle: { fontSize: { default: 50, [bp.tablet]: 42, [bp.mobile]: 32 } },
  heroSub: { maxWidth: "52ch", fontSize: 17, color: color.text },
  heroArt: { position: "absolute", right: 12, top: -36, display: { default: "block", [bp.tablet]: "none" }, pointerEvents: "none" },
  main: { gridColumn: { default: "span 8", [bp.tablet]: "1 / -1" }, display: "grid", gap: 24, minWidth: 0 },
  side: { gridColumn: { default: "span 4", [bp.tablet]: "1 / -1" }, display: "grid", gap: 24, minWidth: 0, alignContent: "start" },
  sectionHead: { display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, marginBottom: 16 },
  sectionTitle: { fontFamily: font.display, fontSize: { default: 30, [bp.mobile]: 24 }, fontWeight: 800, letterSpacing: "-0.02em" },
  courses: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 250px), 1fr))", gap: 16, margin: 0, padding: 0, listStyle: "none" },
  continue: {
    position: "relative",
    display: "grid",
    gap: 10,
    paddingBlock: 30,
    paddingInline: 32,
    paddingRight: { default: 260, [bp.mobile]: 22 },
    borderRadius: radius.card,
    backgroundColor: color.lilac,
    overflow: "hidden",
  },
  continueKicker: { fontSize: 15, fontWeight: 600 },
  continueTitle: { fontSize: { default: 34, [bp.mobile]: 26 } },
  continueText: { maxWidth: "52ch", fontSize: 16 },
  continueBtn: { justifySelf: "start", marginTop: 8 },
  continueArt: { position: "absolute", right: 20, bottom: 0, display: { default: "block", [bp.mobile]: "none" }, pointerEvents: "none" },
  stats: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 260px), 1fr))", gap: 24, alignItems: "stretch" },
  review: { display: "grid", gap: 16 },
  reviewTop: { display: "flex", alignItems: "center", gap: 14 },
  reviewNum: { fontFamily: font.display, fontSize: 56, fontWeight: 800, lineHeight: 1, letterSpacing: "-0.04em", fontVariantNumeric: "tabular-nums" },
  reviewWord: { fontSize: 18, fontWeight: 600 },
  dueList: { display: "grid", margin: 0, padding: 0, listStyle: "none" },
  dueItem: { paddingBlock: 9, borderBottomWidth: 1, borderBottomStyle: "solid", borderBottomColor: color.border, fontSize: 14 },
  weakList: { display: "grid", gap: 10, margin: 0, padding: 0, listStyle: "none" },
  weakItem: { display: "grid", gridTemplateColumns: "44px minmax(0, 1fr)", gap: 12, alignItems: "start" },
  weakIcon: { borderRadius: 14, backgroundColor: color.peachSoft },
  weakTitle: { fontWeight: 650 },
  weakMeta: { fontSize: 13, color: color.textMuted },
  weakLink: { color: color.text, textDecoration: { default: "none", ":hover": "underline" } },
  gaugeCaption: { textAlign: "center", marginTop: 6, fontSize: 13.5, color: color.textMuted },
  statRow: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginTop: 16 },
  stat: { display: "grid", gap: 2, paddingBlock: 10, paddingInline: 12, borderRadius: 16, backgroundColor: color.surface2 },
  statNum: { fontFamily: font.display, fontSize: 24, fontWeight: 800, fontVariantNumeric: "tabular-nums" },
  note: { marginTop: 14 },
  calendars: { gridColumn: "1 / -1", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 340px), 1fr))", gap: 24 },
  calendar: { display: "grid", gap: 4, alignContent: "start" },
  calendarFoot: { display: "grid", gap: 8, marginTop: 14 },
  wide: { gridColumn: "1 / -1" },
  goalPick: { display: "flex", alignItems: "center", justifyContent: "center", flexWrap: "wrap", gap: 6, marginTop: 16 },
  goalBtn: { height: 32, paddingInline: 12, borderWidth: 0, borderRadius: radius.pill, backgroundColor: color.surface2, color: color.textMuted, fontSize: 13.5, fontWeight: 600 },
  goalOn: { backgroundColor: color.primary, color: color.onPrimary },
});

const GOALS: GoalMinutes[] = [5, 10, 20];

type Dashboard = {
  topics: TopicSummary[];
  details: TopicDetail[];
  review: ReviewSession | null;
  activity: ActivityDay[] | null;
  weak: WeakSpot[] | null;
  today: TodayView | null;
  calibration: CalibrationView | null;
};

const ACTIVITY_DAYS = 70;

async function loadDashboard(): Promise<Dashboard> {
  const [topics, activity, weak, review, today, calibration] = await Promise.all([
    api.topics(),
    api.activity(ACTIVITY_DAYS).catch(() => null),
    api.weak(5).catch(() => null),
    api.review().catch(() => null),
    api.today().catch(() => null),
    api.calibration().catch(() => null),
  ]);
  const details = await Promise.all(topics.map((t) => api.topic(t.id).catch(() => null)));
  return { topics, details: details.filter((d): d is TopicDetail => d !== null), review, activity, weak, today, calibration };
}

const WEEK = [0, 1, 2, 3, 4, 5, 6];

const weekdayLabel = (d: Date) => dateFormat({ weekday: "short" }).format(d).replace(/^./, (c) => c.toUpperCase());

function startOfWeek(d: Date): Date {
  const s = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  s.setDate(s.getDate() - ((s.getDay() + 6) % 7));
  return s;
}

/** A day counts as active when the learner answered an item or reviewed a card. */
function summarize(days: ActivityDay[]) {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const active = (key: string) => {
    const d = byDate.get(key);
    return !!d && d.attempts + d.reviews > 0;
  };
  const today = new Date();
  const todayKey = dayKey(today);
  const week0 = startOfWeek(today);
  const week = WEEK.map((i) => {
    const d = new Date(week0);
    d.setDate(week0.getDate() + i);
    return { label: weekdayLabel(d), value: Math.round(byDate.get(dayKey(d))?.minutes ?? 0) };
  });
  const todayIdx = (today.getDay() + 6) % 7;

  const activeSince = (from: Date) => {
    let n = 0;
    for (const d = new Date(from); d <= today; d.setDate(d.getDate() + 1)) if (active(dayKey(d))) n++;
    return n;
  };
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const weekActive = WEEK.map((i) => {
    const d = new Date(week0);
    d.setDate(week0.getDate() + i);
    return { label: weekdayLabel(d), active: active(dayKey(d)) };
  });
  return {
    weekActiveDays: weekActive,
    week,
    todayIdx,
    weekMinutes: week.reduce((s, d) => s + d.value, 0),
    monthActive: activeSince(monthStart),
    monthDays: today.getDate(),
    weekActive: activeSince(week0),
    weekDays: todayIdx + 1,
    todayActive: active(todayKey),
    anyActive: days.some((d) => d.attempts + d.reviews > 0),
  };
}

export function Home() {
  useLang();
  useHeader({ title: t("home.title"), sub: t("home.sub") });
  const res = useResource(loadDashboard, "home");
  const [goalError, setGoalError] = useState<string | null>(null);

  const hero = (
    <section aria-labelledby="hero-title" {...stylex.props(s.hero)}>
      <h2 id="hero-title" {...stylex.props(text.display, s.heroTitle)}>
        {t("topics.prompt")}
      </h2>
      <p {...stylex.props(s.heroSub)}>{t("home.heroSub")}</p>
      <NewTopicForm big />
      <Clay name="hero-knot" size={340} xstyle={s.heroArt} eager />
    </section>
  );

  if (res.loading && !res.data) return <PageLoading />;
  if (res.error)
    return (
      <div {...stylex.props(s.page)}>
        {hero}
        <section {...stylex.props(card.base, s.main)}>
          <ErrorBox error={res.error} onRetry={res.reload} />
        </section>
      </div>
    );

  const { topics, details, review, weak, activity, today, calibration } = res.data!;
  const setGoal = async (minutes: GoalMinutes) => {
    setGoalError(null);
    try {
      const t = await api.setGoal(minutes);
      res.setData((d) => d && { ...d, today: t });
    } catch (err) {
      setGoalError(errorText(err));
    }
  };
  const act = activity ? summarize(activity) : null;
  const topicTitle = (id: string) => topics.find((t) => t.id === id)?.title ?? "";
  const goals = topics.filter((t) => t.kind === "goal");
  const courses = topics.filter((t) => t.kind === "topic");
  const nodes = details.flatMap((d) => d.nodes);
  const mastered = nodes.filter((n) => n.mastery === "mastered").length;
  const exitPassed = nodes.filter((n) => n.mastery === "exit_passed").length;
  const learning = nodes.filter((n) => n.mastery === "learning").length;
  // The lesson to continue: a current version the learner has not completed, started ones first.
  const recentLesson = details
    .flatMap((d) => d.lessons.map((l) => ({ ...l, topicTitle: d.topic.title })))
    .filter((l) => l.supersededBy === null && l.status !== "failed" && l.learnerStatus !== "completed")
    .sort((a, b) => Number(b.learnerStatus === "in_progress") - Number(a.learnerStatus === "in_progress") || b.createdAt.localeCompare(a.createdAt))[0];
  const dueCards = review?.cards ?? [];
  const dueItems = review?.items ?? [];
  const dueTotal = dueCards.length + dueItems.length;
  const minutes = (n: number) => t("count.minutes", { count: n });
  const calendar = activity ? buildCalendar(activity, today) : null;
  const studyDays = calendar?.filter((d) => d.active).length ?? 0;
  const calendarLabel = t("home.calendarLabel", { weeks: CALENDAR_WEEKS, days: t("count.days", { count: studyDays }) });
  const streakLine = today
    ? today.streak.days > 0
      ? t("home.streakLine", { days: t("count.days", { count: today.streak.days }), best: today.streak.best, calendar: calendarLabel })
      : t("home.noStreakLine", { calendar: calendarLabel })
    : null;

  return (
    <div {...stylex.props(s.page)}>
      {hero}

      <div {...stylex.props(s.main)}>
        {goals.length > 0 && (
          <section aria-labelledby="goals-title">
            <div {...stylex.props(s.sectionHead)}>
              <h2 id="goals-title" {...stylex.props(s.sectionTitle)}>
                {t("home.myGoals")}
              </h2>
            </div>
            <ul {...stylex.props(s.courses)}>
              {goals.map((g, i) => (
                <TopicCard key={g.id} topic={g} tone={toneAt(i + 2)} />
              ))}
            </ul>
          </section>
        )}

        <section aria-labelledby="courses-title">
          <div {...stylex.props(s.sectionHead)}>
            <h2 id="courses-title" {...stylex.props(s.sectionTitle)}>
              {t("home.myCourses")}
            </h2>
            {courses.length > 0 && <MoreLink to="/topics">{t("home.allCourses")}</MoreLink>}
          </div>
          {courses.length === 0 ? (
            <Empty title={t("home.noCoursesTitle")}>{t("home.noCoursesBody")}</Empty>
          ) : (
            <ul {...stylex.props(s.courses)}>
              {courses.slice(0, 6).map((t, i) => (
                <TopicCard key={t.id} topic={t} tone={toneAt(i)} />
              ))}
            </ul>
          )}
        </section>

        {recentLesson && (
          <section aria-label={t("home.continueLesson")} {...stylex.props(s.continue)}>
            <p {...stylex.props(s.continueKicker)}>
              {t(recentLesson.learnerStatus === "in_progress" ? "home.continueLesson" : "home.nextLesson")} · {recentLesson.topicTitle}
            </p>
            <h2 {...stylex.props(text.display, s.continueTitle)}>{recentLesson.title}</h2>
            <p {...stylex.props(s.continueText)}>{recentLesson.objective}</p>
            {recentLesson.status === "generating" && <p {...stylex.props(text.strong)}>{readyLine(recentLesson)}</p>}
            <Link to={`/lessons/${recentLesson.id}`} {...stylex.props(btn.base, btn.primary, btn.lg, s.continueBtn)}>
              {t(recentLesson.learnerStatus === "in_progress" ? "home.continue" : "home.start")} <ArrowRight size={18} aria-hidden="true" />
            </Link>
            <Clay name="spheres" size={220} xstyle={s.continueArt} />
          </section>
        )}

        <div {...stylex.props(s.stats)}>
          <section aria-labelledby="week-title" {...stylex.props(card.base)}>
            <CardHead title={t("home.weekTime")} id="week-title">
              {act && <span {...stylex.props(text.small, text.muted, text.tnum)}>{minutes(act.weekMinutes)}</span>}
            </CardHead>
            {!act ? (
              <ErrorBox error={new Error(t("home.statsUnavailable"))} onRetry={res.reload} title={t("home.loadFailed")} />
            ) : act.weekMinutes === 0 ? (
              <Empty title={t("home.weekEmptyTitle")}>{t("home.weekEmptyBody")}</Empty>
            ) : (
              <HatchedBars data={act.week} highlight={act.todayIdx} unit={minutes} />
            )}
          </section>

          <section aria-labelledby="gauge-title" {...stylex.props(card.base)}>
            <CardHead title={t("home.progress")} id="gauge-title" />
            {nodes.length === 0 ? (
              <Empty title={t("home.noMapTitle")}>{t("home.noMapBody")}</Empty>
            ) : (
              <>
                <Gauge value={mastered / nodes.length} caption={t("home.gaugeCaption")} />
                <p {...stylex.props(s.gaugeCaption, text.tnum)}>
                  {t("home.masteredOf", { mastered, count: nodes.length })}
                </p>
                <ul {...stylex.props(layout.plainList, s.statRow)}>
                  <li {...stylex.props(s.stat)}>
                    <span {...stylex.props(s.statNum)}>{learning}</span>
                    <span {...stylex.props(text.xs, text.muted)}>{t("mastery.learning")}</span>
                  </li>
                  <li {...stylex.props(s.stat)}>
                    <span {...stylex.props(s.statNum)}>{exitPassed}</span>
                    <span {...stylex.props(text.xs, text.muted)}>{t("mastery.exit_passed")}</span>
                  </li>
                  <li {...stylex.props(s.stat)}>
                    <span {...stylex.props(s.statNum)}>{mastered}</span>
                    <span {...stylex.props(text.xs, text.muted)}>{t("mastery.mastered")}</span>
                  </li>
                </ul>
              </>
            )}
          </section>

          <section aria-labelledby="track-title" {...stylex.props(card.base)}>
            <CardHead title={t("home.tracking")} id="track-title" />
            {act ? (
              <Rings
                rings={[
                  { label: t("home.month"), value: act.monthActive / act.monthDays, detail: t("home.daysOf", { done: act.monthActive, total: act.monthDays }), tone: 1 },
                  { label: t("home.week"), value: act.weekActive / act.weekDays, detail: t("home.daysOf", { done: act.weekActive, total: act.weekDays }), tone: 2 },
                  today
                    ? { label: t("day.goal"), value: Math.min(1, today.goal.done / today.goal.minutes), detail: t("home.minutesOf", { done: Math.round(today.goal.done), total: today.goal.minutes }), tone: 3 }
                    : { label: t("common.today"), value: act.todayActive ? 1 : 0, detail: t(act.todayActive ? "home.studied" : "home.notYet"), tone: 3 },
                ]}
              />
            ) : (
              <Empty title={t("home.noData")} art={null} />
            )}
            {today && (
              <div role="group" aria-label={t("home.goalMinutes")} {...stylex.props(s.goalPick)}>
                {GOALS.map((m) => (
                  <button key={m} type="button" aria-pressed={today.goal.minutes === m} onClick={() => void setGoal(m)} {...stylex.props(s.goalBtn, today.goal.minutes === m && s.goalOn)}>
                    {t("calendar.minutes", { count: m })}
                  </button>
                ))}
              </div>
            )}
            {goalError && (
              <p role="alert" {...stylex.props(text.error, s.note)}>
                {goalError}
              </p>
            )}
          </section>

          <div {...stylex.props(s.calendars)}>
            {(["ribbon", "clay"] as const).map((variant) => (
              <section key={variant} aria-labelledby={`cal-${variant}`} {...stylex.props(card.base, s.calendar)}>
                <CardHead title={t("home.studyDays")} id={`cal-${variant}`}>
                  <span {...stylex.props(chip.base, chip.xs, chip.lilac)}>{t(variant === "ribbon" ? "home.ribbon" : "home.clay")}</span>
                </CardHead>
                {act?.anyActive && calendar ? (
                  <>
                    <ActivityCalendar days={calendar} variant={variant} goal={today?.goal.minutes ?? 10} label={calendarLabel} />
                    <div {...stylex.props(s.calendarFoot)}>
                      {streakLine && <p {...stylex.props(text.small)}>{streakLine}</p>}
                      {variant === "ribbon" ? (
                        <RibbonLegend />
                      ) : (
                        <p {...stylex.props(text.xs, text.muted)}>{t("home.clayLegend")}</p>
                      )}
                    </div>
                  </>
                ) : (
                  <Empty title={t("home.calendarEmptyTitle")}>{t("home.calendarEmptyBody")}</Empty>
                )}
              </section>
            ))}
          </div>

          <section aria-labelledby="calibration-title" {...stylex.props(card.base, s.wide)}>
            <CardHead title={t("calibration.title")} id="calibration-title" />
            {calibration ? (
              <Calibration view={calibration} />
            ) : (
              <ErrorBox error={new Error(t("home.statsUnavailable"))} onRetry={res.reload} title={t("home.loadFailed")} />
            )}
          </section>
        </div>
      </div>

      <div {...stylex.props(s.side)}>
        <MeerkatCard />
        <section aria-labelledby="due-title" {...stylex.props(card.base, s.review)}>
          <h2 id="due-title" {...stylex.props(text.h2)}>
            {t("home.reviewToday")}
          </h2>
          {review === null ? (
            <ErrorBox error={new Error(t("home.reviewUnavailable"))} onRetry={res.reload} title={t("home.loadFailed")} />
          ) : dueTotal === 0 ? (
            <Empty title={t("home.allDoneTitle")} art="cards-stack">
              {t("home.allDoneBody")}
            </Empty>
          ) : (
            <>
              <div {...stylex.props(s.reviewTop)}>
                <Clay name="cards-stack" size={108} />
                <p>
                  <span {...stylex.props(s.reviewNum)}>{dueTotal}</span>
                  <br />
                  <span {...stylex.props(s.reviewWord)}>{t("word.cards", { count: dueTotal })}</span>
                </p>
              </div>
              <ul {...stylex.props(s.dueList)}>
                {dueCards.slice(0, 3).map((c) => (
                  <li key={c.id} {...stylex.props(s.dueItem)}>
                    {c.front}
                  </li>
                ))}
                {dueItems.length > 0 && (
                  <li {...stylex.props(s.dueItem, text.muted)}>{t("home.dueItems", { tasks: t("count.tasks", { count: dueItems.length }) })}</li>
                )}
              </ul>
              <Link to="/review" {...stylex.props(btn.base, btn.primary, btn.lg, btn.block)}>
                <Play size={18} aria-hidden="true" fill="currentColor" /> {t("home.review")}
              </Link>
            </>
          )}
          {act && <WeekDots days={act.weekActiveDays} label={t("home.weekStudied", { days: t("count.days", { count: act.weekActive }) })} />}
        </section>

        <section aria-labelledby="weak-title" {...stylex.props(card.base)}>
          <CardHead title={t("home.weakSpots")} id="weak-title" />
          {weak === null ? (
            <ErrorBox error={new Error(t("home.listUnavailable"))} onRetry={res.reload} title={t("home.loadFailed")} />
          ) : weak.length === 0 ? (
            <Empty title={t("home.noWeakTitle")}>{t("home.noWeakBody")}</Empty>
          ) : (
            <ul {...stylex.props(s.weakList)}>
              {weak.map((w) =>
                w.kind === "item" ? (
                  <li key={`i-${w.itemId}`} {...stylex.props(s.weakItem)}>
                    <Clay name={topicObject(topicTitle(w.topicId))} size={44} xstyle={s.weakIcon} />
                    <div>
                      <p {...stylex.props(s.weakTitle)}>
                        {w.lessonId ? (
                          <Link to={`/lessons/${w.lessonId}`} {...stylex.props(s.weakLink)}>
                            <Markdown src={w.prompt} inline />
                          </Link>
                        ) : (
                          <Markdown src={w.prompt} inline />
                        )}
                      </p>
                      {w.lastMisconception && <p {...stylex.props(text.small)}>{t("home.looksLike", { text: w.lastMisconception })}</p>}
                      <p {...stylex.props(s.weakMeta)}>
                        {topicTitle(w.topicId)} · {t("home.weakItem")} · <span {...stylex.props(text.tnum)}>{t("count.mistakes", { count: w.wrongAttempts })}</span>
                      </p>
                    </div>
                  </li>
                ) : (
                  <li key={`c-${w.cardId}`} {...stylex.props(s.weakItem)}>
                    <Clay name="cards-stack" size={44} xstyle={s.weakIcon} />
                    <div>
                      <p {...stylex.props(s.weakTitle)}>{w.front}</p>
                      <p {...stylex.props(s.weakMeta)}>
                        {topicTitle(w.topicId)} · {t("home.weakCard")} · <span {...stylex.props(text.tnum)}>{t("home.lapses", { count: w.lapses })}</span>
                      </p>
                      {w.lapses >= 8 && <span {...stylex.props(chip.base, chip.xs, chip.danger)}>{t("home.rewrite")}</span>}
                    </div>
                  </li>
                ),
              )}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
