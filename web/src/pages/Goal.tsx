import * as stylex from "@stylexjs/stylex";
import { ArrowRight, Check, MessagesSquare, Play, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import type { GoalPlanEntryView, OnboardingPhase, TopicDetail } from "@shared/api";
import { Chat } from "../components/Chat";
import { StageTrophy } from "../components/meerkat/CourseGame";
import { PracticeTestCard } from "../components/PracticeTestCard";
import { Empty, Spinner } from "../components/ui";
import { api, errorText } from "../lib/api";
import { t, useLang } from "../lib/i18n";
import { bp, color, font, radius } from "../theme/tokens.stylex";
import { banner, btn, card, layout, text } from "../theme/ui";

const s = stylex.create({
  page: {
    display: "grid",
    gridTemplateColumns: { default: "minmax(0, 1fr) 340px", [bp.tablet]: "minmax(0, 1fr)" },
    gap: 24,
    alignItems: "start",
  },
  chatCard: {
    display: "flex",
    flexDirection: "column",
    height: { default: "calc(100vh - 200px)", [bp.tablet]: 640, [bp.mobile]: 560 },
    minHeight: { default: 560, [bp.mobile]: 0 },
  },
  rail: {
    position: { default: "sticky", [bp.tablet]: "static" },
    top: 24,
    display: "grid",
    gap: 22,
    maxHeight: { default: "calc(100vh - 200px)", [bp.tablet]: "none" },
    overflowY: "auto",
    overscrollBehavior: "contain",
  },
  railHead: { display: "grid", gap: 12 },
  phases: { display: "grid", gap: 10, margin: 0, padding: 0, listStyle: "none" },
  phase: { display: "flex", alignItems: "flex-start", gap: 10, fontSize: 14, color: color.textMuted },
  phaseActive: { color: color.accentText, fontWeight: 650 },
  phaseDone: { color: color.text },
  mark: { display: "inline-grid", placeItems: "center", width: 22, height: 22, borderRadius: "50%", borderWidth: 1.5, borderStyle: "dashed", borderColor: color.borderStrong, flexShrink: 0 },
  markActive: { borderStyle: "solid", borderColor: color.accentText },
  markDone: { borderStyle: "solid", borderColor: color.primary, backgroundColor: color.primary, color: color.onPrimary },
  dot: { width: 8, height: 8, borderRadius: "50%", backgroundColor: color.accentText },
  phaseText: { display: "grid", gap: 2, paddingTop: 2, minWidth: 0 },
  detail: { fontSize: 13, fontWeight: 400, color: color.textMuted, overflowWrap: "anywhere" },
  stages: { display: "grid", gap: 18 },
  stage: { display: "grid", gap: 8 },
  stageTitle: { fontSize: 13.5, fontWeight: 700, color: color.textMuted },
  entries: { display: "grid", gap: 6, margin: 0, padding: 0, listStyle: "none" },
  entry: {
    display: "grid",
    gridTemplateColumns: "22px minmax(0, 1fr)",
    columnGap: 10,
    rowGap: 8,
    paddingBlock: 12,
    paddingInline: 12,
    borderRadius: radius.inner,
    backgroundColor: color.surface2,
  },
  num: { fontFamily: font.display, fontSize: 16, fontWeight: 800, lineHeight: 1.3, color: color.textMuted, fontVariantNumeric: "tabular-nums" },
  body: { display: "grid", gap: 3, minWidth: 0 },
  title: { fontSize: 14.5, fontWeight: 650, lineHeight: 1.3 },
  why: {
    fontSize: 13,
    lineHeight: 1.4,
    color: color.textMuted,
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  },
  action: { gridColumn: "2", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 },
  progressText: { fontSize: 13, color: color.textMuted },
  notes: { display: "grid", gap: 10, paddingBlock: 14, paddingInline: 14, borderRadius: radius.inner, backgroundColor: color.lilacSoft },
  noteList: { display: "grid", gap: 8, margin: 0, padding: 0, listStyle: "none" },
  note: { display: "grid", gap: 2, fontSize: 13.5 },
  noteCourse: { fontSize: 12.5, fontWeight: 650, color: color.accentText },
  hint: { fontSize: 13, color: color.textMuted },
  discuss: { justifySelf: "start" },
});

function Phases({ phases }: { phases: OnboardingPhase[] }) {
  return (
    <ol aria-label={t("goal.onboardingTitle")} {...stylex.props(s.phases)}>
      {phases.map((p) => (
        <li key={p.key} aria-current={p.status === "active" ? "step" : undefined} {...stylex.props(s.phase, p.status === "active" && s.phaseActive, p.status === "done" && s.phaseDone)}>
          <span aria-hidden="true" {...stylex.props(s.mark, p.status === "active" && s.markActive, p.status === "done" && s.markDone)}>
            {p.status === "done" ? <Check size={13} strokeWidth={3} /> : p.status === "active" ? <span {...stylex.props(s.dot)} /> : null}
          </span>
          <span {...stylex.props(s.phaseText)}>
            <span>
              {p.label}
              <span {...stylex.props(layout.srOnly)}> · {t(`onboarding.status.${p.status}`)}</span>
            </span>
            {p.detail && <span {...stylex.props(s.detail)}>{p.detail}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}

function stagesOf(plan: GoalPlanEntryView[]) {
  const stages: { stage: string; entries: { entry: GoalPlanEntryView; n: number }[] }[] = [];
  plan.forEach((entry, i) => {
    const last = stages.at(-1);
    if (last?.stage === entry.stage) last.entries.push({ entry, n: i + 1 });
    else stages.push({ stage: entry.stage, entries: [{ entry, n: i + 1 }] });
  });
  return stages;
}

export function GoalView({ detail, convId, reload }: { detail: TopicDetail; convId: string | null; reload: () => Promise<unknown> }) {
  useLang();
  const navigate = useNavigate();
  const [opening, setOpening] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [discussing, setDiscussing] = useState(false);
  const goalId = detail.topic.id;

  const discuss = async () => {
    setDiscussing(true);
    setError(null);
    try {
      await api.discussGoalNotes(goalId);
      await reload();
    } catch (err) {
      setError(t("goal.discussFailed", { error: errorText(err) }));
    } finally {
      setDiscussing(false);
    }
  };

  const open = async (entryId: string) => {
    setOpening(entryId);
    setError(null);
    try {
      const res = await api.openPlanEntry(goalId, entryId);
      navigate(`/topics/${res.topicId}?c=${encodeURIComponent(res.conversationId)}`);
    } catch (err) {
      setError(t("goal.openFailed", { error: errorText(err) }));
      setOpening(null);
    }
  };

  return (
    <div {...stylex.props(s.page)}>
      <section aria-labelledby="chat-title" {...stylex.props(card.base, s.chatCard)}>
        <h2 id="chat-title" {...stylex.props(layout.srOnly)}>
          {t("topic.conversation")}
        </h2>
        {convId ? (
          <Chat
            key={convId}
            conversationId={convId}
            topicId={goalId}
            lessonId={null}
            label={t("topic.chatLabel")}
            empty={<p {...stylex.props(text.muted)}>{t("topic.replySoon")}</p>}
          />
        ) : (
          <Empty title={t("topic.noConversations")} />
        )}
      </section>

      <aside aria-labelledby="plan-title" {...stylex.props(card.base, s.rail)}>
        <div {...stylex.props(s.railHead)}>
          <h2 id="plan-title" {...stylex.props(text.h2)}>
            {t("goal.plan")}
          </h2>
          <Phases phases={detail.onboarding} />
        </div>
        {detail.goalNotes.length > 0 && (
          <section aria-labelledby="goal-notes-title" {...stylex.props(s.notes)}>
            <h3 id="goal-notes-title" {...stylex.props(text.h3)}>
              {t("goal.notes")}
            </h3>
            <p {...stylex.props(s.hint)}>{t("goal.notesBody")}</p>
            <ul {...stylex.props(s.noteList)}>
              {detail.goalNotes.map((n) => (
                <li key={n.id} {...stylex.props(s.note)}>
                  <span {...stylex.props(s.noteCourse)}>{n.topicTitle}</span>
                  <span>{n.text}</span>
                </li>
              ))}
            </ul>
            <button type="button" disabled={discussing || detail.topic.running} onClick={discuss} {...stylex.props(btn.base, btn.primary, btn.sm, s.discuss)}>
              {discussing ? <Spinner /> : <MessagesSquare size={14} aria-hidden="true" />} {t("goal.discuss")}
            </button>
          </section>
        )}
        {error && (
          <p role="alert" {...stylex.props(text.error)}>
            <TriangleAlert size={14} aria-hidden="true" /> {error}
          </p>
        )}
        {detail.plan.length === 0 ? (
          <p {...stylex.props(s.hint)}>{t("goal.planPending")}</p>
        ) : (
          <>
            <div {...stylex.props(s.stages)}>
              {stagesOf(detail.plan).map(({ stage, entries }) => (
                <section key={stage} aria-label={stage} {...stylex.props(s.stage)}>
                  <h3 {...stylex.props(s.stageTitle)}>{stage}</h3>
                  <StageTrophy goalId={detail.topic.id} stage={stage} />
                  <ol {...stylex.props(s.entries)}>
                    {entries.map(({ entry, n }) => (
                      <li key={entry.id} {...stylex.props(s.entry)}>
                        <span aria-hidden="true" {...stylex.props(s.num)}>
                          {n}
                        </span>
                        <div {...stylex.props(s.body)}>
                          <p {...stylex.props(s.title)}>{entry.topic?.title ?? entry.title}</p>
                          <p title={entry.why} {...stylex.props(s.why)}>
                            {entry.why}
                          </p>
                        </div>
                        <div {...stylex.props(s.action)}>
                          {entry.topic ? (
                            <>
                              <Link to={`/topics/${entry.topic.id}`} {...stylex.props(btn.base, btn.ghost, btn.sm)}>
                                {t("goal.toCourse")} <ArrowRight size={14} aria-hidden="true" />
                              </Link>
                              <span {...stylex.props(s.progressText)}>
                                {entry.topic.final?.passed
                                  ? t("final.chip", { percent: entry.topic.final.percent })
                                  : entry.topic.nodesTotal
                                    ? t("topics.masteredOf", { mastered: entry.topic.nodesMastered, count: entry.topic.nodesTotal })
                                    : t("topics.mapBuilding")}
                              </span>
                            </>
                          ) : (
                            <button type="button" disabled={opening !== null} onClick={() => open(entry.id)} {...stylex.props(btn.base, btn.primary, btn.sm)}>
                              {opening === entry.id ? <Spinner /> : <Play size={14} aria-hidden="true" />} {t("goal.open")}
                            </button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ol>
                </section>
              ))}
            </div>
            <p {...stylex.props(s.hint)}>{t("goal.changeHint")}</p>
          </>
        )}
        <PracticeTestCard key={goalId} scopeId={goalId} embedded />
      </aside>
    </div>
  );
}

export function GoalBanner({ goal }: { goal: NonNullable<TopicDetail["goal"]> }) {
  useLang();
  return (
    <p {...stylex.props(banner.base, banner.lilac)}>
      <span>
        {t("goal.partOf")}{" "}
        <Link to={`/topics/${goal.id}`} {...stylex.props(text.link)}>
          {goal.title}
        </Link>
        {goal.why && <>. {goal.why}</>}
      </span>
    </p>
  );
}
