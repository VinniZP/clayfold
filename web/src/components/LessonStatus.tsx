import * as stylex from "@stylexjs/stylex";
import { RefreshCw } from "lucide-react";
import { useRef, useState } from "react";
import { useNavigate } from "react-router";
import type { LessonSummary } from "@shared/api";
import { api, errorText } from "../lib/api";
import { t, useLang } from "../lib/i18n";
import { useOverlayScroll } from "../lib/overlayScroll";
import { color, font, radius } from "../theme/tokens.stylex";
import { btn, layout, shadow, text } from "../theme/ui";
import { Spinner } from "./ui";

const s = stylex.create({
  notice: {
    position: "relative",
    zIndex: 1,
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "8px 12px",
    paddingBlock: 10,
    paddingInline: 14,
    borderRadius: radius.field,
    backgroundColor: color.surface2,
    fontSize: 14,
    color: color.textMuted,
  },
  noticeInline: { paddingBlock: 0, paddingInline: 0, marginTop: 8, backgroundColor: "transparent" },
  noticeText: { flexGrow: 1, flexBasis: "16rem" },
  dialog: {
    width: "min(460px, calc(100vw - 32px))",
    padding: 0,
    borderWidth: 0,
    borderRadius: radius.card,
    backgroundColor: color.surface,
    color: color.text,
    "::backdrop": { backgroundColor: color.scrim },
  },
  dialogBody: { display: "grid", gap: 14, padding: 26 },
  dialogTitle: { fontFamily: font.display, fontSize: 22, fontWeight: 800 },
});

/** "8 of 10 steps ready, you can start" for a lesson that is still being written. */
export function readyLine(l: Pick<LessonSummary, "stepsReady" | "stepsTotal">): string {
  if (l.stepsTotal === 0) return t("lesson.planning");
  if (l.stepsReady === 0) return t("lesson.writingSteps", { total: l.stepsTotal });
  return t("lesson.stepsReady", { ready: l.stepsReady, total: l.stepsTotal });
}

/** Quiet notice for a lesson planned before newer sources arrived, with a confirmed rebuild. */
export function StaleSources({ lesson, inline }: { lesson: Pick<LessonSummary, "id" | "topicId" | "sourcesStale">; inline?: boolean }) {
  useLang();
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  useOverlayScroll(dialog, lesson.sourcesStale);
  if (!lesson.sourcesStale) return null;

  const rebuild = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.rebuildLesson(lesson.id);
      dialog.current?.close();
      navigate(res.lessonId ? `/lessons/${res.lessonId}` : `/topics/${lesson.topicId}?c=${encodeURIComponent(res.conversationId)}`);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div {...stylex.props(s.notice, inline && s.noticeInline)}>
      <span {...stylex.props(s.noticeText)}>{t("lesson.stale")}</span>
      <button type="button" onClick={() => dialog.current?.showModal()} {...stylex.props(btn.base, btn.ghost, btn.sm)}>
        <RefreshCw size={14} aria-hidden="true" /> {t("lesson.rebuild")}
      </button>
      <dialog ref={dialog} aria-labelledby={`rebuild-${lesson.id}`} {...stylex.props(s.dialog, shadow.pop)}>
        <div {...stylex.props(s.dialogBody)}>
          <h2 id={`rebuild-${lesson.id}`} {...stylex.props(s.dialogTitle)}>
            {t("lesson.rebuildTitle")}
          </h2>
          <p>{t("lesson.rebuildBody")}</p>
          <p {...stylex.props(text.muted)}>{t("lesson.rebuildKeeps")}</p>
          {error && (
            <p role="alert" {...stylex.props(text.error)}>
              {error}
            </p>
          )}
          <div {...stylex.props(layout.actions)}>
            <button type="button" disabled={busy} onClick={rebuild} {...stylex.props(btn.base, btn.primary)}>
              {busy && <Spinner />} {t("lesson.rebuildConfirm")}
            </button>
            <button type="button" onClick={() => dialog.current?.close()} {...stylex.props(btn.base, btn.ghost)}>
              {t("common.cancel")}
            </button>
          </div>
        </div>
      </dialog>
    </div>
  );
}
