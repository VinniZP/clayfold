import * as stylex from "@stylexjs/stylex";
import { Search } from "lucide-react";
import { useId, useState } from "react";
import { api, errorText } from "../lib/api";
import { t, useLang } from "../lib/i18n";
import { space } from "../theme/tokens.stylex";
import { btn, field, layout, text } from "../theme/ui";
import { Spinner } from "./ui";

const s = stylex.create({
  panel: { display: "grid", gap: space.sm },
  row: { display: "flex", flexWrap: "wrap", gap: 8 },
  input: { flex: "1 1 240px" },
});

/**
 * Starts a source search for the course: Claude looks for sources for the map's thinly covered topics, the
 * learner's focus first. `onStarted` gets the new conversation, which shows the search as it runs.
 */
export function FindSources({ topicId, onStarted }: { topicId: string; onStarted: (conversationId: string) => void }) {
  useLang();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [focus, setFocus] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.refreshSources(topicId, focus.trim() || undefined);
      setFocus("");
      setOpen(false);
      onStarted(res.conversationId);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} {...stylex.props(btn.base, btn.ghost, btn.sm)}>
        <Search size={14} aria-hidden="true" /> {t("topic.sources.find")}
      </button>
    );
  }

  return (
    <form
      {...stylex.props(s.panel)}
      onSubmit={(e) => {
        e.preventDefault();
        void start();
      }}
    >
      <label htmlFor={id} {...stylex.props(field.label)}>
        {t("topic.sources.focusLabel")}
      </label>
      <div {...stylex.props(s.row)}>
        <input
          id={id}
          value={focus}
          maxLength={500}
          placeholder={t("topic.sources.focusPlaceholder")}
          onChange={(e) => setFocus(e.target.value)}
          {...stylex.props(field.input, s.input)}
        />
        <button type="submit" disabled={busy} {...stylex.props(btn.base, btn.primary)}>
          {busy && <Spinner />} {t("topic.sources.start")}
        </button>
        <button type="button" disabled={busy} onClick={() => setOpen(false)} {...stylex.props(btn.base, btn.ghost)}>
          {t("common.cancel")}
        </button>
      </div>
      <p {...stylex.props(text.xs, text.muted)}>{t("topic.sources.findHint")}</p>
      {error && (
        <p role="alert" {...stylex.props(text.error)}>
          {error}
        </p>
      )}
      <span {...stylex.props(layout.srOnly)} aria-live="polite">
        {busy ? t("topic.sources.starting") : ""}
      </span>
    </form>
  );
}
