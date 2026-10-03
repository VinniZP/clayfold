import * as stylex from "@stylexjs/stylex";
import { Ban, Check, Flag, Pause, Pencil } from "lucide-react";
import { useId, useState } from "react";
import type { CardView } from "@shared/api";
import { api, errorText } from "../lib/api";
import type { MessageKey } from "@shared/i18n";
import { t, useLang } from "../lib/i18n";
import { useTopicStream } from "../lib/stream";
import { useResource } from "../lib/useResource";
import { color, radius } from "../theme/tokens.stylex";
import { btn, chip, field, layout, text } from "../theme/ui";
import { Empty, ErrorBox, Markdown, Skeleton, Spinner } from "./ui";

const s = stylex.create({
  list: { display: "grid", gap: 10, marginTop: 10, padding: 0, listStyle: "none" },
  card: { display: "grid", gap: 12, padding: 18, borderRadius: radius.inner, backgroundColor: color.surface2 },
  settled: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, color: color.textMuted },
  face: { display: "grid", gap: 6 },
  front: { fontWeight: 650, fontSize: 16 },
  back: { color: color.textMuted },
  form: { display: "grid", gap: 10 },
  tool: { display: "grid", gap: 8, padding: 14, borderRadius: 16, backgroundColor: color.surface },
});

type Outcome = "accepted" | "suspended" | "rejected" | "reported";
const OUTCOME: Record<Outcome, MessageKey> = {
  accepted: "cards.accepted",
  suspended: "cards.suspended",
  rejected: "cards.rejected",
  reported: "cards.reported",
};

function ProposedCard({ card, onDone }: { card: CardView; onDone: (o: Outcome) => void }) {
  useLang();
  const [mode, setMode] = useState<"view" | "edit" | "report">("view");
  const [front, setFront] = useState(card.front);
  const [back, setBack] = useState(card.back);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const id = useId();

  const run = async (key: string, fn: () => Promise<unknown>, outcome: Outcome) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      onDone(outcome);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <li {...stylex.props(s.card)}>
      {mode === "edit" ? (
        <form
          {...stylex.props(s.form)}
          onSubmit={(e) => {
            e.preventDefault();
            void run(
              "save",
              async () => {
                await api.editCard(card.id, front.trim(), back.trim());
                await api.cardAction(card.id, "accept");
              },
              "accepted",
            );
          }}
        >
          <label {...stylex.props(field.stack)}>
            <span {...stylex.props(field.label)}>{t("cards.question")}</span>
            <textarea rows={2} value={front} onChange={(e) => setFront(e.target.value)} {...stylex.props(field.input, field.textarea)} />
          </label>
          <label {...stylex.props(field.stack)}>
            <span {...stylex.props(field.label)}>{t("item.answerLabel")}</span>
            <textarea rows={2} value={back} onChange={(e) => setBack(e.target.value)} {...stylex.props(field.input, field.textarea)} />
          </label>
          <div {...stylex.props(layout.actions)}>
            <button type="submit" {...stylex.props(btn.base, btn.primary, btn.sm)} disabled={!front.trim() || !back.trim() || busy !== null}>
              {busy === "save" && <Spinner />} {t("cards.saveAccept")}
            </button>
            <button type="button" onClick={() => setMode("view")} {...stylex.props(btn.base, btn.ghost, btn.sm)}>
              {t("common.cancel")}
            </button>
          </div>
        </form>
      ) : (
        <div {...stylex.props(s.face)}>
          <p {...stylex.props(s.front)}>
            <Markdown src={card.front} inline />
          </p>
          <p {...stylex.props(s.back)}>
            <Markdown src={card.back} inline />
          </p>
        </div>
      )}
      {mode === "report" && (
        <form
          {...stylex.props(s.tool)}
          onSubmit={(e) => {
            e.preventDefault();
            void run("report", () => api.report({ targetType: "card", targetId: card.id, text: note.trim() }), "reported");
          }}
        >
          <label htmlFor={id} {...stylex.props(field.label)}>
            {t("cards.whatsWrong")}
          </label>
          <textarea id={id} rows={2} value={note} onChange={(e) => setNote(e.target.value)} {...stylex.props(field.input, field.textarea)} />
          <div {...stylex.props(layout.actions)}>
            <button type="submit" {...stylex.props(btn.base, btn.primary, btn.sm)} disabled={!note.trim() || busy !== null}>
              {busy === "report" && <Spinner />} {t("cards.send")}
            </button>
            <button type="button" onClick={() => setMode("view")} {...stylex.props(btn.base, btn.ghost, btn.sm)}>
              {t("common.cancel")}
            </button>
          </div>
        </form>
      )}
      {mode === "view" && (
        <div {...stylex.props(layout.actions)}>
          <button type="button" {...stylex.props(btn.base, btn.primary, btn.sm)} disabled={busy !== null} onClick={() => run("accept", () => api.cardAction(card.id, "accept"), "accepted")}>
            {busy === "accept" ? <Spinner /> : <Check size={14} aria-hidden="true" />} {t("cards.accept")}
          </button>
          <button type="button" onClick={() => setMode("edit")} {...stylex.props(btn.base, btn.soft, btn.sm)}>
            <Pencil size={14} aria-hidden="true" /> {t("cards.edit")}
          </button>
          <button type="button" {...stylex.props(btn.base, btn.ghost, btn.sm)} disabled={busy !== null} onClick={() => run("suspend", () => api.cardAction(card.id, "suspend"), "suspended")}>
            {busy === "suspend" ? <Spinner /> : <Pause size={14} aria-hidden="true" />} {t("cards.suspend")}
          </button>
          <button type="button" {...stylex.props(btn.base, btn.ghost, btn.sm)} disabled={busy !== null} onClick={() => run("reject", () => api.cardAction(card.id, "reject"), "rejected")}>
            {busy === "reject" ? <Spinner /> : <Ban size={14} aria-hidden="true" />} {t("cards.reject")}
          </button>
          <button type="button" onClick={() => setMode("report")} {...stylex.props(btn.base, btn.ghost, btn.sm)}>
            <Flag size={14} aria-hidden="true" /> {t("cards.report")}
          </button>
        </div>
      )}
      {error && (
        <p role="alert" {...stylex.props(text.error)}>
          {error}
        </p>
      )}
    </li>
  );
}

export function ProposedCards({ topicId }: { topicId: string }) {
  useLang();
  const cards = useResource(() => api.cards(topicId, "proposed"), topicId);
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});
  useTopicStream(
    topicId,
    (e) => {
      if (e.type === "cards.proposed") void cards.reload();
    },
    () => void cards.reload(),
  );

  if (cards.loading && !cards.data) return <Skeleton lines={3} />;
  if (cards.error) return <ErrorBox error={cards.error} onRetry={cards.reload} title={t("cards.loadFailed")} />;
  const list = cards.data ?? [];
  if (list.length === 0)
    return (
      <Empty title={t("cards.emptyTitle")} art="cards-stack">{t("cards.emptyBody")}</Empty>
    );
  const pending = list.filter((c) => !outcomes[c.id]).length;
  return (
    <div>
      <p aria-live="polite" {...stylex.props(text.muted)}>
        {pending > 0 ? t("cards.pending", { cards: t("count.cards", { count: pending }) }) : t("cards.allDone")}
      </p>
      <ul {...stylex.props(s.list)}>
        {list.map((c) =>
          outcomes[c.id] ? (
            <li key={c.id} {...stylex.props(s.card, s.settled)}>
              <p {...stylex.props(s.front)}>
                <Markdown src={c.front} inline />
              </p>
              <p {...stylex.props(chip.base)}>{t(OUTCOME[outcomes[c.id]!])}</p>
            </li>
          ) : (
            <ProposedCard key={c.id} card={c} onDone={(o) => setOutcomes((m) => ({ ...m, [c.id]: o }))} />
          ),
        )}
      </ul>
    </div>
  );
}
