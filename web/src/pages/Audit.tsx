import * as stylex from "@stylexjs/stylex";
import { Check, CircleCheck, CircleX, RefreshCw, TriangleAlert } from "lucide-react";
import { useId, useRef, useState } from "react";
import type { AuditEntry, AuditVerdict } from "@shared/api";
import { useHeader } from "../components/header";
import { CardHead, Empty, ErrorBox, Markdown, PageLoading, Spinner } from "../components/ui";
import { api, errorText } from "../lib/api";
import { t, useLang } from "../lib/i18n";
import { useOverlayScroll } from "../lib/overlayScroll";
import { useResource } from "../lib/useResource";
import { bp, color, font } from "../theme/tokens.stylex";
import { btn, card, chip, field, layout, text } from "../theme/ui";

const s = stylex.create({
  page: { display: "grid", gap: 24 },
  item: { display: "grid", gap: 10 },
  options: { display: "grid", gap: 8, margin: 0, padding: 0, listStyle: "none" },
  option: { display: "grid", gap: 2, paddingBlock: 11, paddingInline: 16, borderRadius: 16, backgroundColor: color.surface2 },
  optionKey: { backgroundColor: color.pistachioSoft },
  summary: { cursor: "pointer", fontWeight: 650, color: color.accentText },
  json: { maxHeight: 320, marginTop: 8, padding: 12, overflow: "auto", borderRadius: 14, backgroundColor: color.surface2, fontFamily: font.mono, fontSize: 12.5 },
  list: { display: "grid", gap: 24, margin: 0, padding: 0, listStyle: "none" },
  card: { display: "grid", gap: 18 },
  head: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 14 },
  thead: { display: { default: "table-header-group", [bp.mobile]: "none" } },
  th: { paddingBlock: 6, paddingInline: 10, textAlign: "left", fontSize: 12.5, fontWeight: 600, color: color.textMuted, borderBottomWidth: 1, borderBottomStyle: "solid", borderBottomColor: color.border },
  tr: {
    display: { default: "table-row", [bp.mobile]: "grid" },
    gridTemplateColumns: "auto 1fr",
    gap: "4px 12px",
    paddingBlock: { default: 0, [bp.mobile]: 10 },
    borderBottomWidth: { default: 0, [bp.mobile]: 1 },
    borderBottomStyle: "solid",
    borderBottomColor: color.border,
  },
  td: {
    paddingBlock: { default: 9, [bp.mobile]: 0 },
    paddingInline: { default: 10, [bp.mobile]: 0 },
    borderBottomWidth: { default: 1, [bp.mobile]: 0 },
    borderBottomStyle: "solid",
    borderBottomColor: color.border,
    verticalAlign: "top",
  },
  tdWide: { gridColumn: "1 / -1" },
  pass: { color: color.success, fontWeight: 650, whiteSpace: "nowrap" },
  fail: { color: color.danger, fontWeight: 650, whiteSpace: "nowrap" },
  icon: { display: "inline", verticalAlign: -3, marginRight: 4 },
  verdict: { display: "grid", gap: 8, maxWidth: "66ch" },
});

type AuthoredOption = { text?: string; feedback?: string; misconception?: string };
type AuthoredItem = {
  format?: string;
  prompt?: string;
  bloom?: string;
  options?: AuthoredOption[];
  correct?: number | number[];
  sequence?: string[];
  text?: string;
  blanks?: string[][];
  answer?: number;
  tolerance?: number;
  unit?: string;
  referenceAnswer?: string;
  rubric?: string[];
  solution?: string;
  hints?: string[];
};

function isCorrect(item: AuthoredItem, i: number) {
  return Array.isArray(item.correct) ? item.correct.includes(i) : item.correct === i;
}

function AuthoredView({ raw }: { raw: unknown }) {
  useLang();
  const item = (raw && typeof raw === "object" ? raw : {}) as AuthoredItem;
  const pre = useRef<HTMLPreElement>(null);
  useOverlayScroll(pre);
  return (
    <div {...stylex.props(s.item)}>
      {item.prompt && <Markdown src={item.prompt} />}
      <p {...stylex.props(text.small, text.muted)}>
        {item.format && t("audit.format", { format: item.format })}
        {item.bloom && <> · Bloom: {item.bloom}</>}
      </p>
      {item.options && (
        <ol {...stylex.props(s.options)}>
          {item.options.map((o, i) => (
            <li key={i} {...stylex.props(s.option, isCorrect(item, i) && s.optionKey)}>
              <p>
                {isCorrect(item, i) && <span {...stylex.props(chip.base, chip.xs, chip.pistachio)}>{t("audit.key")}</span>} {o.text}
              </p>
              {o.misconception && <p {...stylex.props(text.small, text.muted)}>{t("audit.misconception", { text: o.misconception })}</p>}
              {o.feedback && <p {...stylex.props(text.small)}>{t("audit.feedback", { text: o.feedback })}</p>}
            </li>
          ))}
        </ol>
      )}
      {item.sequence && (
        <p>
          {t("audit.correctOrder")} <strong>{item.sequence.join(" → ")}</strong>
        </p>
      )}
      {item.text && <p>{t("audit.text", { text: item.text })}</p>}
      {item.blanks && <p>{t("audit.blanks", { answers: item.blanks.map((b) => b.join(" / ")).join("; ") })}</p>}
      {item.answer !== undefined && (
        <p>
          {t("audit.answer")} <strong {...stylex.props(text.tnum)}>{item.answer}</strong>
          {item.unit && ` ${item.unit}`}
          {item.tolerance !== undefined && ` ± ${item.tolerance}`}
        </p>
      )}
      {item.referenceAnswer && <p>{t("audit.reference", { text: item.referenceAnswer })}</p>}
      {item.rubric && (
        <ul {...stylex.props(text.small)}>
          {item.rubric.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      )}
      {item.solution && (
        <details>
          <summary>{t("item.solution")}</summary>
          <Markdown src={item.solution} />
        </details>
      )}
      <details>
        <summary>{t("audit.rawItem")}</summary>
        <pre ref={pre} {...stylex.props(s.json)}>{JSON.stringify(raw, null, 2)}</pre>
      </details>
    </div>
  );
}

function AuditCard({ entry }: { entry: AuditEntry }) {
  useLang();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<AuditVerdict["verdict"] | null>(null);
  const [sent, setSent] = useState<AuditVerdict["verdict"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const noteId = useId();
  const failed = entry.gate.filter((g) => !g.pass).length;

  const send = async (verdict: AuditVerdict["verdict"]) => {
    setBusy(verdict);
    setError(null);
    try {
      await api.audit(entry.itemId, { verdict, note: note.trim() || undefined });
      setSent(verdict);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <li {...stylex.props(card.base, s.card)}>
      <div {...stylex.props(s.head)}>
        <h2 {...stylex.props(text.h2)}>{entry.topicTitle}</h2>
        <span {...stylex.props(chip.base, failed ? chip.danger : chip.pistachio)}>
          {failed ? t("audit.gateIssues", { count: failed }) : t("audit.gatesPassed")}
        </span>
      </div>
      <AuthoredView raw={entry.item} />
      <table {...stylex.props(s.table)}>
        <caption {...stylex.props(layout.srOnly)}>{t("audit.verdicts")}</caption>
        <thead {...stylex.props(s.thead)}>
          <tr>
            <th scope="col" {...stylex.props(s.th)}>{t("audit.stage")}</th>
            <th scope="col" {...stylex.props(s.th)}>{t("audit.rule")}</th>
            <th scope="col" {...stylex.props(s.th)}>{t("audit.result")}</th>
            <th scope="col" {...stylex.props(s.th)}>{t("audit.comment")}</th>
          </tr>
        </thead>
        <tbody>
          {entry.gate.map((g, i) => (
            <tr key={i} {...stylex.props(s.tr)}>
              <td {...stylex.props(s.td)}>{g.stage}</td>
              <td {...stylex.props(s.td)}>
                <code>{g.rule}</code>
              </td>
              <td {...stylex.props(s.td, g.pass ? s.pass : s.fail)}>
                {g.pass ? <CircleCheck size={16} aria-hidden="true" {...stylex.props(s.icon)} /> : <CircleX size={16} aria-hidden="true" {...stylex.props(s.icon)} />}
                {t(g.pass ? "audit.ok" : "audit.failed")}
              </td>
              <td {...stylex.props(s.td, s.tdWide)}>{g.message}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {sent ? (
        <p role="status" {...stylex.props(text.saved)}>
          <Check size={16} aria-hidden="true" /> {t("audit.marked", { verdict: t(sent === "ok" ? "audit.ok" : "audit.missedDefect") })}
        </p>
      ) : (
        <div {...stylex.props(s.verdict)}>
          <label htmlFor={noteId} {...stylex.props(field.label)}>
            {t("audit.note")}
          </label>
          <textarea id={noteId} rows={2} value={note} onChange={(e) => setNote(e.target.value)} {...stylex.props(field.input, field.textarea)} />
          <div {...stylex.props(layout.actions)}>
            <button type="button" {...stylex.props(btn.base, btn.primary)} disabled={busy !== null} onClick={() => send("ok")}>
              {busy === "ok" ? <Spinner /> : <Check size={16} aria-hidden="true" />} {t("audit.ok")}
            </button>
            <button type="button" {...stylex.props(btn.base, btn.danger)} disabled={busy !== null} onClick={() => send("missed_defect")}>
              {busy === "missed_defect" ? <Spinner /> : <TriangleAlert size={16} aria-hidden="true" />} {t("audit.missedDefect")}
            </button>
          </div>
          {error && (
            <p role="alert" {...stylex.props(text.error)}>
              {error}
            </p>
          )}
        </div>
      )}
    </li>
  );
}

export function AuditPage() {
  useLang();
  useHeader({ title: t("audit.title"), sub: t("audit.sub"), art: "search-magnifier" });
  const [round, setRound] = useState(0);
  const sample = useResource(() => api.auditSample(10), `audit:${round}`);
  return (
    <div {...stylex.props(s.page)}>
      <section {...stylex.props(card.base, card.lilac)}>
        <CardHead title={t("audit.howTo")}>
          <button type="button" {...stylex.props(btn.base, btn.primary, btn.sm)} onClick={() => setRound((r) => r + 1)}>
            <RefreshCw size={14} aria-hidden="true" /> {t("audit.newSample")}
          </button>
        </CardHead>
        <p {...stylex.props(text.small)}>
          {t("audit.instructions")}
        </p>
      </section>
      {sample.loading && !sample.data ? (
        <PageLoading />
      ) : sample.error ? (
        <section {...stylex.props(card.base)}>
          <ErrorBox error={sample.error} onRetry={sample.reload} />
        </section>
      ) : sample.data!.length === 0 ? (
        <section {...stylex.props(card.base)}>
          <Empty title={t("audit.emptyTitle")} art="search-magnifier">{t("audit.emptyBody")}</Empty>
        </section>
      ) : (
        <ul {...stylex.props(s.list)}>
          {sample.data!.map((e) => (
            <AuditCard key={e.itemId} entry={e} />
          ))}
        </ul>
      )}
    </div>
  );
}
