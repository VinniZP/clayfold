import * as stylex from "@stylexjs/stylex";
import { ArrowRight, BookOpen, ExternalLink, Sparkles, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import type { ConversationKind, LessonSummary, TopicDetail } from "@shared/api";
import type { MessageKey } from "@shared/i18n";
import { Chat } from "../components/Chat";
import { useHeader } from "../components/header";
import { GraphLegend, KnowledgeGraph } from "../components/KnowledgeGraph";
import { LessonList } from "../components/LessonList";
import { MaterialsSection } from "../components/Materials";
import { StaleSources, readyLine } from "../components/LessonStatus";
import { CourseResident } from "../components/meerkat/CourseGame";
import { OnboardingStepper } from "../components/OnboardingStepper";
import { GoalBanner, GoalView } from "./Goal";
import { NewTopicForm, TopicCard, toneAt, topicObject } from "../components/Topics";
import { CardHead, Empty, ErrorBox, PageLoading, Spinner } from "../components/ui";
import { api, errorText } from "../lib/api";
import { formatDate, masteryLabel } from "../lib/format";
import { t, useLang } from "../lib/i18n";
import { useStreamStatus, useTopicStream } from "../lib/stream";
import { useGlossaryScope } from "../lib/glossary";
import { useResource } from "../lib/useResource";
import { bp, color, radius } from "../theme/tokens.stylex";
import { banner, btn, card, chip, field, layout, text } from "../theme/ui";

const s = stylex.create({
  page: { display: "grid", gridTemplateColumns: "repeat(12, minmax(0, 1fr))", gap: 24, alignItems: "start" },
  full: { gridColumn: "1 / -1" },
  left: { gridColumn: { default: "span 7", [bp.tablet]: "1 / -1" }, display: "grid", gap: 24, minWidth: 0 },
  chatCard: {
    gridColumn: { default: "span 5", [bp.tablet]: "1 / -1" },
    position: { default: "sticky", [bp.tablet]: "relative" },
    top: 24,
    display: "flex",
    flexDirection: "column",
    height: { default: "calc(100vh - 120px)", [bp.tablet]: 640, [bp.mobile]: 560 },
    minHeight: { default: 520, [bp.mobile]: 0 },
  },
  courses: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 260px), 1fr))", gap: 16, margin: 0, padding: 0, listStyle: "none" },
  bannerGap: { marginBottom: 16 },
  errorGap: { marginBottom: 12 },
  detail: { display: "grid", gap: 10, marginTop: 14, paddingBlock: 18, paddingInline: 20, borderRadius: radius.inner, backgroundColor: color.surface2 },
  detailHead: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 },
  start: { justifySelf: "start" },
  mLearning: { backgroundColor: color.lilacSoft, color: color.accentText },
  mExit: { backgroundColor: color.warningSoft, color: color.warning },
  mMastered: { backgroundColor: color.primary, color: color.onPrimary },
  lessons: { display: "grid", gap: 8, margin: 0, padding: 0, listStyle: "none" },
  lesson: {
    position: "relative",
    display: "flex",
    flexDirection: { default: "row", [bp.mobile]: "column" },
    justifyContent: "space-between",
    gap: { default: 16, [bp.mobile]: 8 },
    paddingBlock: 14,
    paddingInline: 16,
    borderRadius: radius.inner,
    backgroundColor: { default: color.surface2, ":hover": color.surface3 },
    boxShadow: { default: "none", ":focus-within": `0 0 0 3px ${color.focus}` },
  },
  ready: { marginBlock: 4, fontSize: 14, fontWeight: 650, color: color.accentText },
  lessonLink: { fontWeight: 700, color: color.text, textDecoration: "none", outline: "none", "::after": { content: '""', position: "absolute", inset: 0, borderRadius: radius.inner } },
  lessonMeta: {
    display: "flex",
    flexDirection: { default: "column", [bp.mobile]: "row" },
    flexWrap: "wrap",
    alignItems: { default: "flex-end", [bp.mobile]: "center" },
    gap: 6,
    flexShrink: 0,
  },
  sources: { display: "grid", margin: 0, padding: 0, listStyle: "none" },
  source: { display: "grid", gap: 4, paddingBlock: 12, borderBottomWidth: 1, borderBottomStyle: "solid", borderBottomColor: color.border },
  convSelect: { height: 38, paddingBlock: 0, fontSize: 13.5, maxWidth: 260 },
  chatHead: { marginBottom: 12 },
  memoryLink: { marginTop: 12 },
});

const MASTERY_CHIP = { new: null, learning: s.mLearning, exit_passed: s.mExit, mastered: s.mMastered } as const;

const CONV_LABEL: Record<ConversationKind, MessageKey> = {
  onboard: "topic.conv.onboard",
  lesson: "topic.conv.lesson",
  tutor: "topic.conv.tutor",
  review: "topic.conv.review",
};

const STATUS: Record<LessonSummary["status"], { label: MessageKey; tone: stylex.StyleXStyles | null }> = {
  generating: { label: "lesson.generating", tone: chip.butter },
  ready: { label: "lesson.ready", tone: chip.lilac },
  finished: { label: "lesson.completed", tone: chip.pistachio },
  failed: { label: "lesson.failed", tone: chip.danger },
};

const PLACEMENT: Record<"known" | "partial" | "unknown", MessageKey> = {
  known: "topic.placement.known",
  partial: "topic.placement.partial",
  unknown: "topic.placement.unknown",
};

export function TopicsPage() {
  useLang();
  useHeader({ title: t("home.myCourses"), sub: t("topic.coursesSub"), art: "spheres" });
  const res = useResource(api.topics, "topics");
  return (
    <div {...stylex.props(s.page)}>
      <section aria-labelledby="new-topic-title" {...stylex.props(card.base, card.peach, s.full)}>
        <CardHead title={t("topic.newCourse")} id="new-topic-title" />
        <NewTopicForm />
      </section>
      <section aria-labelledby="all-topics" {...stylex.props(card.base, s.full)}>
        <CardHead title={t("home.allCourses")} id="all-topics" />
        {res.loading && !res.data ? (
          <PageLoading />
        ) : res.error ? (
          <ErrorBox error={res.error} onRetry={res.reload} />
        ) : res.data!.length === 0 ? (
          <Empty title={t("home.noCoursesTitle")}>{t("topic.noCoursesBody")}</Empty>
        ) : (
          <ul {...stylex.props(s.courses)}>
            {res.data!.map((t, i) => (
              <TopicCard key={t.id} topic={t} tone={toneAt(i)} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function pickConversation(detail: TopicDetail, requested: string | null) {
  if (requested && detail.conversations.some((c) => c.id === requested)) return requested;
  const sorted = [...detail.conversations].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (sorted.find((c) => c.kind === "onboard") ?? sorted[0])?.id ?? requested;
}

/** The lesson a lesson-author conversation writes; a fresh run may not be linked yet, so fall back to the lesson being generated. */
function lessonOf(detail: TopicDetail, convId: string) {
  const conv = detail.conversations.find((c) => c.id === convId);
  if (conv?.kind !== "lesson") return null;
  return conv.lessonId ?? detail.lessons.find((l) => l.status === "generating")?.id ?? null;
}

export function TopicPage() {
  useLang();
  const { topicId = "" } = useParams();
  useGlossaryScope(topicId);
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const detail = useResource(() => api.topic(topicId), topicId);
  const [selected, setSelected] = useState<string | null>(null);
  const [starting, setStarting] = useState<{ nodeId?: string; waiting: boolean } | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const streamStatus = useStreamStatus(topicId);

  useTopicStream(
    topicId,
    (e) => {
      if (
        e.type === "graph.updated" ||
        e.type === "plan.updated" ||
        e.type === "sources.updated" ||
        e.type === "onboarding.updated" ||
        e.type === "memory.updated" ||
        e.type === "lesson.finished" ||
        e.type === "conv.done"
      )
        void detail.reload();
      if (e.type === "lesson.planned") {
        if (starting?.waiting) navigate(`/lessons/${e.lessonId}`);
        else void detail.reload();
      }
    },
    () => void detail.reload(),
  );

  const d = detail.data;
  useHeader({
    title: d?.topic.title ?? t("topic.title"),
    sub: d
      ? d.topic.plan
        ? d.topic.plan.total
          ? t("topics.planOpened", { opened: d.topic.plan.opened, count: d.topic.plan.total })
          : t("topics.planBuilding")
        : t("topic.sub", { mastered: d.topic.nodesMastered, total: d.topic.nodesTotal })
      : undefined,
    back: { to: "/topics", label: t("home.allCourses") },
    art: d ? topicObject(d.topic.title) : undefined,
  });

  if (detail.loading && !d) return <PageLoading />;
  if (detail.error && !d)
    return (
      <div {...stylex.props(s.page)}>
        <section {...stylex.props(card.base, s.full)}>
          <ErrorBox error={detail.error} onRetry={detail.reload} title={t("topic.loadFailed")} />
        </section>
      </div>
    );
  if (!d) return null;

  const convId = pickConversation(d, params.get("c"));
  if (d.topic.kind === "goal") return <GoalView detail={d} convId={convId} reload={detail.reload} />;
  const node = d.nodes.find((n) => n.id === selected) ?? null;
  const prereqTitles = node ? node.prereqs.map((p) => d.nodes.find((n) => n.id === p)?.title ?? p) : [];

  const startLesson = async (nodeId?: string) => {
    setStarting({ nodeId, waiting: false });
    setStartError(null);
    try {
      const res = await api.startLesson(topicId, nodeId);
      if (res.lessonId) {
        navigate(`/lessons/${res.lessonId}`);
        return;
      }
      setStarting({ nodeId, waiting: true });
      setParams({ c: res.conversationId }, { replace: true });
    } catch (err) {
      setStartError(errorText(err));
      setStarting(null);
    }
  };

  const busy = starting !== null;

  return (
    <div {...stylex.props(s.page)}>
      <div {...stylex.props(s.left)}>
        {d.goal && <GoalBanner goal={d.goal} />}
        <CourseResident topicId={topicId} />
        {d.onboarding.some((p) => p.status !== "done") && <OnboardingStepper phases={d.onboarding} />}
        <section aria-labelledby="graph-title" {...stylex.props(card.base)}>
          <CardHead title={t("topic.graph")} id="graph-title">
            <button type="button" disabled={busy || d.nodes.length === 0} onClick={() => startLesson()} {...stylex.props(btn.base, btn.primary)}>
              {busy && !starting?.nodeId ? <Spinner /> : <Sparkles size={16} aria-hidden="true" />} {t("topic.nextLesson")}
            </button>
          </CardHead>
          {starting?.waiting && (
            <p role="status" {...stylex.props(banner.base, banner.lilac, s.bannerGap)}>
              <Spinner /> {t("topic.planning")}
            </p>
          )}
          {startError && (
            <p role="alert" {...stylex.props(text.error, s.errorGap)}>
              <TriangleAlert size={14} aria-hidden="true" /> {t("topic.startFailed", { error: startError })}
            </p>
          )}
          {d.nodes.length === 0 ? (
            <Empty title={t("topic.mapBuildingTitle")}>{t("topic.mapBuildingBody")}</Empty>
          ) : (
            <>
              <GraphLegend />
              <KnowledgeGraph title={d.topic.title} nodes={d.nodes} selected={selected} onSelect={(id) => setSelected((s) => (s === id ? null : id))} />
              {node ? (
                <div aria-live="polite" {...stylex.props(s.detail)}>
                  <div {...stylex.props(s.detailHead)}>
                    <h3 {...stylex.props(text.h3)}>{node.title}</h3>
                    <span {...stylex.props(chip.base, MASTERY_CHIP[node.mastery])}>{masteryLabel(node.mastery)}</span>
                  </div>
                  <p>{node.summary}</p>
                  <p {...stylex.props(text.small, text.muted)}>
                    {t(node.kind === "skill" ? "graph.skill" : "graph.knowledge")}
                    {prereqTitles.length > 0 && <> · {t("topic.buildsOn", { titles: prereqTitles.join(", ") })}</>}
                    {node.placement && <> · {t("topic.yourRating", { placement: t(PLACEMENT[node.placement]) })}</>}
                  </p>
                  <button type="button" disabled={busy} onClick={() => startLesson(node.id)} {...stylex.props(btn.base, btn.primary, btn.sm, s.start)}>
                    {starting?.nodeId === node.id ? <Spinner /> : <BookOpen size={14} aria-hidden="true" />} {t("topic.nodeLesson")}
                  </button>
                </div>
              ) : (
                <p {...stylex.props(text.small, text.muted)}>{t("topic.pickNode")}</p>
              )}
            </>
          )}
        </section>

        <section aria-labelledby="lessons-title" {...stylex.props(card.base)}>
          <CardHead title={t("topic.lessons")} id="lessons-title" />
          {d.lessons.length === 0 ? (
            <Empty title={t("topic.noLessonsTitle")}>{t("topic.noLessonsBody")}</Empty>
          ) : (
            <LessonList lessons={d.lessons} />
          )}
        </section>

        <MaterialsSection topicId={topicId} materials={d.materials} reload={detail.reload} />

        <section aria-labelledby="sources-title" {...stylex.props(card.base)}>
          <CardHead title={t("topic.sources")} id="sources-title" />
          {d.sources.length === 0 ? (
            <Empty title={t("topic.noSourcesTitle")}>{t("topic.noSourcesBody")}</Empty>
          ) : (
            <ul {...stylex.props(s.sources)}>
              {d.sources.map((src) => (
                <li key={src.id} {...stylex.props(s.source)}>
                  <a href={src.url} target="_blank" rel="noopener noreferrer" {...stylex.props(text.link)}>
                    {src.title} <ExternalLink size={13} aria-hidden="true" />
                  </a>
                  <p {...stylex.props(text.small, text.muted)}>
                    {src.kind}
                    {src.note && <> · {src.note}</>}
                  </p>
                  {src.status === "failed" && <span {...stylex.props(chip.base, chip.xs, chip.danger)}>{t("topic.downloadFailed")}</span>}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section aria-labelledby="chat-title" {...stylex.props(card.base, s.chatCard)}>
        <CardHead title={t("topic.conversation")} id="chat-title">
          {d.conversations.length > 1 && (
            <label>
              <span {...stylex.props(layout.srOnly)}>{t("topic.pickConversation")}</span>
              <select {...stylex.props(field.input, field.select, s.convSelect)} value={convId ?? ""} onChange={(e) => setParams({ c: e.target.value }, { replace: true })}>
                {[...d.conversations]
                  .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {t(CONV_LABEL[c.kind])} · {formatDate(c.createdAt)}
                    </option>
                  ))}
              </select>
            </label>
          )}
        </CardHead>
        {streamStatus === "reconnecting" && (
          <p role="status" {...stylex.props(banner.base, banner.butter, s.bannerGap)}>
            {t("topic.reconnecting")}
          </p>
        )}
        {convId ? (
          <Chat
            key={convId}
            conversationId={convId}
            topicId={topicId}
            lessonId={lessonOf(d, convId)}
            label={t("topic.chatLabel")}
            empty={<p {...stylex.props(text.muted)}>{t("topic.replySoon")}</p>}
          />
        ) : (
          <Empty title={t("topic.noConversations")} />
        )}
        <Link to={`/memory/${topicId}`} {...stylex.props(text.link, s.memoryLink)}>
          {t("topic.memoryLink")} <ArrowRight size={14} aria-hidden="true" />
        </Link>
      </section>
    </div>
  );
}
