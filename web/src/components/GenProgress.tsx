import * as stylex from "@stylexjs/stylex";
import { CircleStop } from "lucide-react";
import type { LessonView } from "@shared/api";
import { useElapsed } from "../lib/elapsed";
import { t, useLang } from "../lib/i18n";
import { color, font, radius } from "../theme/tokens.stylex";
import { btn, text } from "../theme/ui";
import { Progress, Spinner } from "./ui";

const s = stylex.create({
  box: { display: "grid", gap: 10, paddingBlock: 16, paddingInline: 18, borderRadius: radius.inner, backgroundColor: color.lilacSoft },
  head: { display: "flex", alignItems: "center", gap: 10, color: color.accentText },
  stop: { marginInlineStart: "auto" },
  title: { fontFamily: font.display, fontSize: 17, fontWeight: 700, color: color.text },
  now: { fontSize: 14 },
  note: { paddingBlock: 9, paddingInline: 14, borderRadius: 14, backgroundColor: color.butter, fontSize: 14 },
});

type StepState = LessonView["stepStatus"][number];

export type Rejection = { idx: number; message: string };

/**
 * Lesson-generation status: how many steps passed the gates, which one is being checked now, the latest rework.
 * A practice set also says that Claude is writing it and offers to stop the run.
 */
export function GenProgress({
  outline,
  status,
  checkingSince,
  rejection,
  practice,
}: {
  outline: { title: string }[];
  status: StepState[];
  checkingSince: Record<number, number>;
  rejection: Rejection | null;
  practice?: { onStop: () => void; stopping: boolean };
}) {
  useLang();
  const total = outline.length;
  const checked = status.filter((s) => s === "published" || s === "dropped").length;
  const checking = status.findIndex((s) => s === "checking");
  const writing = checking === -1 ? status.findIndex((s) => s === "pending") : -1;
  const elapsed = useElapsed(checking >= 0 ? (checkingSince[checking] ?? null) : null);
  const current = checking >= 0 ? checking : writing;

  return (
    <div {...stylex.props(s.box)}>
      <div {...stylex.props(s.head)}>
        <Spinner size={18} />
        <p aria-live="polite" {...stylex.props(s.title, text.tnum)}>
          {t(practice ? "gen.practiceProgress" : "gen.progress", { checked, total })}
        </p>
        {practice && (
          <button type="button" disabled={practice.stopping} onClick={practice.onStop} {...stylex.props(btn.base, btn.ghost, btn.sm, s.stop)}>
            {practice.stopping ? <Spinner /> : <CircleStop size={14} aria-hidden="true" />} {t("practice.stop")}
          </button>
        )}
      </div>
      <Progress value={checked} max={total} label={t("gen.checkedLabel")} onCard />
      {current >= 0 && (
        <p {...stylex.props(s.now)}>
          <span aria-live="polite">
            {t(checking >= 0 ? "gen.checking" : "gen.writing", { n: current + 1, title: outline[current]?.title ?? "" })}
          </span>
          {elapsed && (
            <span aria-hidden="true" {...stylex.props(text.tnum, text.muted)}>
              {" "}
              · {elapsed}
            </span>
          )}
        </p>
      )}
      {rejection && (
        <p role="status" {...stylex.props(s.note)}>
          {t("gen.rejected", { n: rejection.idx + 1, message: rejection.message })}
        </p>
      )}
      <p {...stylex.props(text.small, text.muted)}>
        {practice && <>{t("practice.writing")} </>}
        {t("gen.readyStepsOpen")}
      </p>
    </div>
  );
}
