import * as stylex from "@stylexjs/stylex";
import { ArrowRight, Check, CircleDashed, Flag, RotateCcw, TriangleAlert, X } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import type { TeachbackDebrief, TeachbackIdea, TeachbackView } from "@shared/api";
import type { MessageKey } from "@shared/i18n";
import { Chat } from "../components/Chat";
import { useHeader } from "../components/header";
import { CardHead, ErrorBox, Markdown, PageLoading, Spinner } from "../components/ui";
import { api, errorText } from "../lib/api";
import { t, useLang } from "../lib/i18n";
import { useGlossaryScope } from "../lib/glossary";
import { useTopicStream } from "../lib/stream";
import { useResource } from "../lib/useResource";
import { bp, color, font, radius } from "../theme/tokens.stylex";
import { banner, btn, card, chip, layout, text } from "../theme/ui";

const s = stylex.create({
  page: { display: "grid", gridTemplateColumns: "repeat(12, minmax(0, 1fr))", gap: 24, alignItems: "start" },
  chatCard: {
    gridColumn: { default: "span 7", [bp.tablet]: "1 / -1" },
    display: "flex",
    flexDirection: "column",
    gap: 16,
    height: { default: "calc(100vh - 120px)", [bp.tablet]: 640, [bp.mobile]: 560 },
    minHeight: { default: 520, [bp.mobile]: 0 },
  },
  side: { gridColumn: { default: "span 5", [bp.tablet]: "1 / -1" }, display: "grid", gap: 18, alignContent: "start" },
  persona: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 14 },
  monogram: {
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
    width: 56,
    height: 56,
    borderRadius: "50%",
    backgroundColor: color.butter,
    color: color.onButter,
    fontFamily: font.display,
    fontSize: 24,
    fontWeight: 800,
  },
  who: { display: "grid", gap: 2, flexGrow: 1, flexBasis: "14rem", minWidth: 0 },
  name: { fontFamily: font.display, fontSize: 22, fontWeight: 800, letterSpacing: "-0.01em" },
  steps: { display: "grid", gap: 8, margin: 0, paddingLeft: 20 },
  score: { display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 10, paddingBlock: 16, paddingInline: 20, borderRadius: radius.inner, backgroundColor: color.pistachioSoft },
  scoreNum: { fontFamily: font.display, fontSize: 40, fontWeight: 800, lineHeight: 1, fontVariantNumeric: "tabular-nums" },
  ideas: { display: "grid", gap: 10 },
  idea: { display: "grid", gap: 8, paddingBlock: 14, paddingInline: 16, borderRadius: radius.inner, backgroundColor: color.surface2 },
  ideaHead: { display: "flex", alignItems: "flex-start", gap: 10 },
  ideaIcon: { flexShrink: 0, marginTop: 3 },
  covered: { color: color.success },
  missing: { color: color.warning },
  wrong: { color: color.danger },
  ideaTitle: { flexGrow: 1, minWidth: 0, fontWeight: 650 },
  quote: { margin: 0, paddingBlock: 8, paddingInline: 12, borderRadius: 12, backgroundColor: color.surface, fontStyle: "italic", color: color.textMuted, fontSize: 14 },
  label: { fontSize: 12.5, fontWeight: 700, color: color.textMuted },
  next: { display: "grid", gap: 6 },
  start: { justifySelf: "start" },
});

const VERDICT: Record<TeachbackIdea["verdict"], { label: MessageKey; tone: stylex.StyleXStyles; icon: typeof Check; chip: stylex.StyleXStyles }> = {
  covered: { label: "teachback.verdict.covered", tone: s.covered, icon: Check, chip: chip.pistachio },
  missing: { label: "teachback.verdict.missing", tone: s.missing, icon: CircleDashed, chip: chip.butter },
  wrong: { label: "teachback.verdict.wrong", tone: s.wrong, icon: X, chip: chip.danger },
};

const stepLink = (lessonId: string, idx: number) => `/lessons/${encodeURIComponent(lessonId)}?step=${idx + 1}`;

function Debrief({ view, debrief }: { view: TeachbackView; debrief: TeachbackDebrief }) {
  useLang();
  const covered = debrief.ideas.filter((i) => i.verdict === "covered").length;
  return (
    <>
      <div {...stylex.props(s.score)}>
        <span {...stylex.props(s.scoreNum)}>
          {covered}/{debrief.ideas.length}
        </span>
        <span>{t("teachback.score")}</span>
      </div>
      <Markdown src={debrief.summary} />
      <ul aria-label={t("teachback.ideas")} {...stylex.props(layout.plainList, s.ideas)}>
        {debrief.ideas.map((idea) => {
          const v = VERDICT[idea.verdict];
          const Icon = v.icon;
          return (
            <li key={idea.stepId} {...stylex.props(s.idea)}>
              <div {...stylex.props(s.ideaHead)}>
                <Icon size={16} aria-hidden="true" {...stylex.props(s.ideaIcon, v.tone)} />
                <Link to={stepLink(view.lessonId, idea.stepIdx)} {...stylex.props(text.link, s.ideaTitle)}>
                  {idea.title}
                </Link>
                <span {...stylex.props(chip.base, chip.xs, v.chip)}>{t(v.label)}</span>
              </div>
              {idea.evidence && (
                <blockquote {...stylex.props(s.quote)}>
                  <span {...stylex.props(layout.srOnly)}>{t("teachback.youSaid")} </span>
                  {idea.evidence}
                </blockquote>
              )}
              {idea.correction && (
                <div>
                  <p {...stylex.props(s.label)}>{t("teachback.lessonSays")}</p>
                  <Markdown src={idea.correction} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <section aria-labelledby="tb-next" {...stylex.props(s.next)}>
        <h3 id="tb-next" {...stylex.props(text.h3)}>
          {t("teachback.next")}
        </h3>
        {debrief.next.length === 0 ? (
          <p {...stylex.props(text.muted)}>{t("teachback.allCovered")}</p>
        ) : (
          <ul {...stylex.props(layout.plainList, s.next)}>
            {debrief.next.map((a) => (
              <li key={`${a.kind}-${a.stepId}`}>
                <Link to={stepLink(view.lessonId, a.stepIdx)} {...stylex.props(text.link)}>
                  {t(a.kind === "reread" ? "teachback.reread" : "teachback.practice", { title: a.title })} <ArrowRight size={14} aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

export function TeachBackPage() {
  useLang();
  const { teachbackId = "" } = useParams();
  const navigate = useNavigate();
  const res = useResource(() => api.teachback(teachbackId), teachbackId);
  const [chat, setChat] = useState({ running: false, userMessages: 0 });
  const [busy, setBusy] = useState<"finish" | "again" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const v = res.data;
  useGlossaryScope(v?.topicId ?? null);

  useTopicStream(
    v?.topicId,
    (e) => {
      if (e.type === "teachback.updated" && e.teachbackId === teachbackId) void res.reload();
    },
    () => void res.reload(),
  );

  useHeader({
    title: v ? t("teachback.pageTitle", { node: v.nodeTitle }) : t("teachback.title"),
    sub: v ? t("teachback.sub", { lesson: v.lessonTitle }) : undefined,
    back: v ? { to: `/topics/${encodeURIComponent(v.topicId)}`, label: t("teachback.toCourse") } : undefined,
  });

  if (res.loading && !v) return <PageLoading />;
  if (!v)
    return (
      <section {...stylex.props(card.base)}>
        <ErrorBox error={res.error} onRetry={res.reload} title={t("teachback.loadFailed")} />
      </section>
    );

  const act = async (kind: "finish" | "again") => {
    setBusy(kind);
    setActionError(null);
    try {
      if (kind === "finish") {
        const next = await api.finishTeachback(v.id);
        res.setData(() => next);
      }
      else navigate(`/teach-back/${(await api.startTeachback(v.topicId, v.nodeId, v.lessonId)).id}`);
    } catch (err) {
      setActionError(errorText(err));
    } finally {
      setBusy(null);
    }
  };
  const persona = t("teachback.persona");

  return (
    <div {...stylex.props(s.page)}>
      <section aria-label={t("teachback.chatLabel", { name: persona })} {...stylex.props(card.base, s.chatCard)}>
        <div {...stylex.props(s.persona)}>
          <span aria-hidden="true" {...stylex.props(s.monogram)}>
            {persona.slice(0, 1)}
          </span>
          <div {...stylex.props(s.who)}>
            <h2 {...stylex.props(s.name)}>{persona}</h2>
            <p {...stylex.props(text.small, text.muted)}>{t("teachback.who")}</p>
          </div>
          {v.status === "talking" && (
            <button
              type="button"
              disabled={busy !== null || chat.running || chat.userMessages === 0}
              title={chat.userMessages === 0 ? t("teachback.nothingSaid") : undefined}
              onClick={() => void act("finish")}
              {...stylex.props(btn.base, btn.primary, btn.sm)}
            >
              {busy === "finish" ? <Spinner /> : <Flag size={14} aria-hidden="true" />} {t("teachback.finish")}
            </button>
          )}
        </div>
        <Chat
          key={v.conversationId}
          conversationId={v.conversationId}
          topicId={v.topicId}
          label={t("teachback.chatLabel", { name: persona })}
          placeholder={t("teachback.placeholder")}
          persona={{ initial: persona.slice(0, 1) }}
          closed={v.status === "talking" ? null : t("teachback.closedNote")}
          onStatus={setChat}
          empty={<p {...stylex.props(text.muted)}>{t("teachback.opening", { name: persona })}</p>}
        />
      </section>

      <section aria-labelledby="tb-side" aria-live="polite" {...stylex.props(card.base, s.side)}>
        <CardHead title={t(v.status === "done" ? "teachback.debrief" : "teachback.howTitle")} id="tb-side" />
        {actionError && (
          <p role="alert" {...stylex.props(text.error)}>
            <TriangleAlert size={14} aria-hidden="true" /> {actionError}
          </p>
        )}
        {v.status === "talking" && (
          <ol {...stylex.props(s.steps)}>
            <li>{t("teachback.how1", { name: persona })}</li>
            <li>{t("teachback.how2", { name: persona })}</li>
            <li>{t("teachback.how3")}</li>
          </ol>
        )}
        {v.status === "debriefing" && (
          <p role="status" {...stylex.props(banner.base, banner.lilac)}>
            <Spinner /> {t("teachback.debriefing")}
          </p>
        )}
        {v.status === "failed" && (
          <div role="alert" {...stylex.props(banner.base, banner.danger)}>
            <TriangleAlert size={16} aria-hidden="true" />
            <span>{v.error}</span>
            <button type="button" disabled={busy !== null} onClick={() => void act("finish")} {...stylex.props(btn.base, btn.danger, btn.sm)}>
              {busy === "finish" ? <Spinner /> : <RotateCcw size={14} aria-hidden="true" />} {t("teachback.retry")}
            </button>
          </div>
        )}
        {v.status === "done" && v.debrief && <Debrief view={v} debrief={v.debrief} />}
        <p {...stylex.props(text.small, text.muted)}>{t("teachback.noMastery")}</p>
        {v.status === "done" && (
          <button type="button" disabled={busy !== null} onClick={() => void act("again")} {...stylex.props(btn.base, btn.ghost, s.start)}>
            {busy === "again" ? <Spinner /> : <RotateCcw size={16} aria-hidden="true" />} {t("teachback.again")}
          </button>
        )}
      </section>
    </div>
  );
}
