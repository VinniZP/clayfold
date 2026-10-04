import * as stylex from "@stylexjs/stylex";
import { MessagesSquare, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { api, errorText } from "../lib/api";
import { t, useLang } from "../lib/i18n";
import { btn, layout, text } from "../theme/ui";
import { Spinner } from "./ui";

/** Starts a teach-back on the node (L20) and opens it. */
export function TeachBackButton({ topicId, nodeId, lessonId, primary = false }: { topicId: string; nodeId: string; lessonId?: string; primary?: boolean }) {
  useLang();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const view = await api.startTeachback(topicId, nodeId, lessonId);
      navigate(`/teach-back/${encodeURIComponent(view.id)}`);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };
  return (
    <div {...stylex.props(layout.actions)}>
      <button type="button" disabled={busy} onClick={() => void start()} {...stylex.props(btn.base, primary ? btn.primary : btn.soft, btn.sm)}>
        {busy ? <Spinner /> : <MessagesSquare size={14} aria-hidden="true" />} {t("teachback.title")}
      </button>
      {error && (
        <p role="alert" {...stylex.props(text.error)}>
          <TriangleAlert size={14} aria-hidden="true" /> {t("teachback.startFailed", { error })}
        </p>
      )}
    </div>
  );
}
