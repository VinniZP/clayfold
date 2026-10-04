import * as stylex from "@stylexjs/stylex";
import { ArrowRight, Check, Circle, GraduationCap, Lock, Play, RotateCcw } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { FINAL_PASS_SHARE, type FinalExamView, type PracticeTestSummary } from "@shared/api";
import { api, errorText } from "../lib/api";
import { formatDate } from "../lib/format";
import { t, useLang } from "../lib/i18n";
import { useResource } from "../lib/useResource";
import { color, radius } from "../theme/tokens.stylex";
import { banner, btn, card, layout, text } from "../theme/ui";
import { PracticeButton } from "./Practice";
import { CardHead, ErrorBox, Progress, Skeleton, Spinner } from "./ui";

const s = stylex.create({
  body: { display: "grid", gap: 14 },
  locked: { display: "grid", gap: 10, paddingBlock: 14, paddingInline: 16, borderRadius: radius.inner, backgroundColor: color.surface2 },
  lockedHead: { display: "flex", alignItems: "center", gap: 8, fontWeight: 700 },
  passed: { display: "flex", alignItems: "center", gap: 10, paddingBlock: 12, paddingInline: 14, borderRadius: radius.inner, backgroundColor: color.successSoft, fontWeight: 650 },
  weak: { display: "grid", gap: 6, margin: 0, padding: 0, listStyle: "none" },
  weakRow: { display: "flex", alignItems: "center", gap: 10, paddingBlock: 8, paddingInline: 12, borderRadius: radius.field, backgroundColor: color.surface2 },
  weakTitle: { flexGrow: 1, minWidth: 0 },
  done: { color: color.success },
  todo: { color: color.textMuted },
  start: { justifySelf: "start" },
  invite: { display: "grid", gap: 12, paddingBlock: 16, paddingInline: 18, borderRadius: radius.inner, backgroundColor: color.pistachioSoft },
});

const PASS_PERCENT = Math.round(FINAL_PASS_SHARE * 100);
const percent = (x: PracticeTestSummary) => (x.questions ? Math.round(((x.correct ?? 0) / x.questions) * 100) : 0);

function StartButton({ topicId, label, primary, disabled }: { topicId: string; label: string; primary: boolean; disabled: boolean }) {
  useLang();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const view = await api.startFinal(topicId);
      navigate(`/tests/${view.test.id}`);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };
  return (
    <>
      {error && (
        <p role="alert" {...stylex.props(text.error)}>
          {error}
        </p>
      )}
      <button type="button" disabled={busy || disabled} onClick={start} {...stylex.props(btn.base, primary ? btn.primary : btn.ghost, s.start)}>
        {busy ? <Spinner /> : primary ? <Play size={16} aria-hidden="true" /> : <RotateCcw size={15} aria-hidden="true" />} {label}
      </button>
    </>
  );
}

function WeakNodes({ topicId, nodes }: { topicId: string; nodes: FinalExamView["weakNodes"] }) {
  useLang();
  return (
    <section aria-labelledby="final-weak" {...stylex.props(layout.stack)}>
      <h3 id="final-weak" {...stylex.props(text.h3)}>
        {t("final.retakeTitle")}
      </h3>
      <p {...stylex.props(text.small, text.muted)}>{t("final.retakeBody")}</p>
      <ul {...stylex.props(s.weak)}>
        {nodes.map((n) => (
          <li key={n.nodeId} {...stylex.props(s.weakRow)}>
            {n.practised ? (
              <Check size={16} aria-label={t("final.practised")} {...stylex.props(s.done)} />
            ) : (
              <Circle size={16} aria-label={t("final.notPractised")} {...stylex.props(s.todo)} />
            )}
            <span {...stylex.props(s.weakTitle)}>{n.title}</span>
            {n.lessonId && (
              <Link to={`/lessons/${n.lessonId}`} {...stylex.props(text.link, text.small)}>
                {t("final.toLesson")} <ArrowRight size={14} aria-hidden="true" />
              </Link>
            )}
          </li>
        ))}
      </ul>
      <PracticeButton from={{ courseId: topicId }} label={t("practiceSet.courseWeak")} small xstyle={s.start} />
    </section>
  );
}

function Body({ topicId, f }: { topicId: string; f: FinalExamView }) {
  useLang();
  if (f.nodesPassed < f.nodesTotal || f.nodesTotal === 0)
    return (
      <div {...stylex.props(s.locked)}>
        <p {...stylex.props(s.lockedHead)}>
          <Lock size={16} aria-hidden="true" /> {t("final.lockedTitle")}
        </p>
        <p {...stylex.props(text.small, text.muted)}>{t("final.lockedBody", { passed: f.nodesPassed, total: f.nodesTotal })}</p>
        <Progress value={f.nodesPassed} max={f.nodesTotal} label={t("final.lockedBody", { passed: f.nodesPassed, total: f.nodesTotal })} />
      </div>
    );

  const grading = f.latest?.status === "grading";
  return (
    <div {...stylex.props(s.body)}>
      <p {...stylex.props(text.small, text.muted)}>{t("final.about", { count: f.questions, pass: PASS_PERCENT })}</p>
      {f.passed && f.best && (
        <p {...stylex.props(s.passed)}>
          <GraduationCap size={20} aria-hidden="true" /> {t("final.passedOn", { percent: percent(f.best), date: formatDate(f.best.submittedAt ?? f.best.createdAt) })}
        </p>
      )}
      {!f.passed && f.best && <p {...stylex.props(banner.base, banner.butter)}>{t("final.best", { percent: percent(f.best), pass: PASS_PERCENT })}</p>}
      {f.open ? (
        f.open.kind === "final" ? (
          <>
            <p {...stylex.props(banner.base, banner.lilac)}>{t("practice.inProgress", { answered: f.open.answered, total: f.open.questions })}</p>
            <Link to={`/tests/${f.open.id}`} {...stylex.props(btn.base, btn.primary, s.start)}>
              {t("practice.resume")} <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </>
        ) : (
          <p {...stylex.props(banner.base, banner.lilac)}>
            <span>{t("final.practiceOpen")}</span>{" "}
            <Link to={`/tests/${f.open.id}`} {...stylex.props(text.link)}>
              {t("practice.resume")}
            </Link>
          </p>
        )
      ) : grading && f.latest ? (
        <p {...stylex.props(banner.base, banner.lilac)}>
          <Spinner /> <span>{t("final.gradingNow")}</span>{" "}
          <Link to={`/tests/${f.latest.id}`} {...stylex.props(text.link)}>
            {t("practice.resume")}
          </Link>
        </p>
      ) : (
        <>
          {!f.passed && f.weakNodes.length > 0 && <WeakNodes topicId={topicId} nodes={f.weakNodes} />}
          {(f.canStart || !f.passed) && (
            <StartButton topicId={topicId} label={t(!f.best ? "final.start" : f.passed ? "final.improve" : "final.retake")} primary={!f.passed} disabled={!f.canStart} />
          )}
        </>
      )}
    </div>
  );
}

/** The topic's final exam (L21): locked until every node passed its exit check, then taken and retaken here. */
export function FinalExamCard({ topicId }: { topicId: string }) {
  useLang();
  const res = useResource(() => api.finalExam(topicId), `final:${topicId}`);
  return (
    <section aria-labelledby={`final-${topicId}`} {...stylex.props(card.base)}>
      <CardHead title={t("final.title")} id={`final-${topicId}`}>
        <GraduationCap size={20} aria-hidden="true" />
      </CardHead>
      {res.data ? <Body topicId={topicId} f={res.data} /> : res.error ? <ErrorBox error={res.error} onRetry={res.reload} /> : <Skeleton lines={2} />}
    </section>
  );
}

/** Shown at a lesson's end once the course is complete and its final not yet taken. */
export function FinalInvite({ topicId }: { topicId: string }) {
  useLang();
  const res = useResource(() => api.finalExam(topicId), `final:${topicId}`);
  const f = res.data;
  if (!f || f.nodesTotal === 0 || f.nodesPassed < f.nodesTotal || f.latest || !f.canStart) return null;
  return (
    <section aria-labelledby="final-invite" {...stylex.props(s.invite)}>
      <h3 id="final-invite" {...stylex.props(s.lockedHead)}>
        <GraduationCap size={18} aria-hidden="true" /> {t("final.readyTitle")}
      </h3>
      <p {...stylex.props(text.small)}>{t("final.readyBody")}</p>
      <StartButton topicId={topicId} label={t("final.start")} primary disabled={false} />
    </section>
  );
}
