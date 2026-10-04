import * as stylex from "@stylexjs/stylex";
import { FileText, NotebookPen } from "lucide-react";
import { useEffect, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router";
import type { MemoryFile, NoteView } from "@shared/api";
import type { MessageKey } from "@shared/i18n";
import { useHeader } from "../components/header";
import { CardHead, Empty, ErrorBox, Markdown, PageLoading } from "../components/ui";
import { api } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { t, useLang } from "../lib/i18n";
import { useTopicStream } from "../lib/stream";
import { useResource } from "../lib/useResource";
import { bp, color, radius, reading } from "../theme/tokens.stylex";
import { card, field, readable, text } from "../theme/ui";

const s = stylex.create({
  page: { display: "grid", gridTemplateColumns: "repeat(12, minmax(0, 1fr))", gap: 24, alignItems: "start" },
  full: { gridColumn: "1 / -1" },
  nav: { gridColumn: { default: "span 3", [bp.tablet]: "1 / -1" }, position: { default: "sticky", [bp.tablet]: "relative" }, top: 24, display: "grid", gap: 16 },
  body: { gridColumn: { default: "span 9", [bp.tablet]: "1 / -1" }, minHeight: 440 },
  files: { display: "grid", gap: 4, margin: 0, padding: 0, listStyle: "none" },
  file: {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    width: "100%",
    paddingBlock: 11,
    paddingInline: 14,
    borderWidth: 0,
    borderRadius: 16,
    backgroundColor: { default: "transparent", ":hover": color.surface2 },
    color: color.textMuted,
    textAlign: "left",
    fontWeight: 550,
  },
  fileOn: { backgroundColor: { default: color.primary, ":hover": color.primary }, color: color.onPrimary, fontWeight: 650 },
  fileIcon: { flexShrink: 0, marginTop: 3 },
  path: { display: "block", fontSize: 12, fontWeight: 450, opacity: 0.8, overflowWrap: "anywhere" },
  notes: { display: "grid", gap: 12, margin: 0, padding: 0, listStyle: "none" },
  note: { display: "grid", gap: 6, paddingBlock: 14, paddingInline: 18, borderRadius: radius.inner, backgroundColor: color.surface2 },
  quote: { paddingBlock: 8, paddingInline: 12, borderRadius: 12, backgroundColor: color.surface, fontStyle: "italic", color: color.textMuted, fontSize: 14 },
  meta: { marginBottom: 16 },
  doc: { fontSize: `calc(16px * ${reading.scale})` },
  select: { height: 44, paddingBlock: 0 },
});

const ORDER = ["MISSION.md", "GLOSSARY.md", "NOTES.md", "RESOURCES.md"];
const TITLES: Record<string, MessageKey> = {
  "MISSION.md": "memory.file.mission",
  "GLOSSARY.md": "memory.file.glossary",
  "NOTES.md": "memory.file.notes",
  "RESOURCES.md": "memory.file.resources",
};
const NOTES_TAB = "__notes";

function fileTitle(path: string) {
  const name = path.split("/").pop() ?? path;
  if (TITLES[name]) return t(TITLES[name]);
  return name.replace(/\.md$/, "");
}

function sortFiles(files: MemoryFile[]) {
  const rank = (p: string) => {
    const i = ORDER.indexOf(p.split("/").pop() ?? p);
    return i === -1 ? ORDER.length : i;
  };
  return [...files].sort((a, b) => rank(a.path) - rank(b.path) || a.path.localeCompare(b.path));
}

export function MemoryIndex() {
  useLang();
  useHeader({ title: t("memory.title"), sub: t("memory.sub"), art: "tutor-reading" });
  const topics = useResource(api.topics, "topics");
  if (topics.loading && !topics.data) return <PageLoading />;
  if (topics.error)
    return (
      <div {...stylex.props(s.page)}>
        <section {...stylex.props(card.base, s.full)}>
          <ErrorBox error={topics.error} onRetry={topics.reload} />
        </section>
      </div>
    );
  const first = topics.data?.[0];
  if (first) return <Navigate to={`/memory/${first.id}`} replace />;
  return (
    <div {...stylex.props(s.page)}>
      <section {...stylex.props(card.base, s.full)}>
        <Empty title={t("memory.emptyTitle")}>{t("memory.emptyBody")}</Empty>
      </section>
    </div>
  );
}

export function MemoryPage() {
  useLang();
  const { topicId = "" } = useParams();
  const topics = useResource(api.topics, "topics");
  const files = useResource(() => api.memory(topicId), topicId);
  const notes = useResource<NoteView[]>(() => api.notes(topicId), topicId);
  const [tab, setTab] = useState<string | null>(null);
  const navigate = useNavigate();

  useTopicStream(
    topicId,
    (e) => {
      if (e.type === "memory.updated") void files.reload();
    },
    () => {
      void files.reload();
      void notes.reload();
    },
  );

  const topic = topics.data?.find((t) => t.id === topicId);
  useHeader({ title: t("memory.title"), sub: topic?.title ?? t("memory.sub"), art: "tutor-reading" });

  const sorted = files.data ? sortFiles(files.data) : [];
  const firstPath = sorted[0]?.path;
  useEffect(() => {
    if (tab === null && firstPath) setTab(firstPath);
  }, [tab, firstPath]);
  useEffect(() => setTab(null), [topicId]);

  const active = sorted.find((f) => f.path === tab);

  return (
    <div {...stylex.props(s.page)}>
      <aside aria-label={t("memory.files")} {...stylex.props(card.base, s.nav)}>
        {(topics.data?.length ?? 0) > 1 && (
          <label {...stylex.props(field.stack)}>
            <span {...stylex.props(field.label)}>{t("memory.course")}</span>
            <select {...stylex.props(field.input, field.select, s.select)} value={topicId} onChange={(e) => navigate(`/memory/${e.target.value}`)}>
              {topics.data!.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
          </label>
        )}
        {files.loading && !files.data ? (
          <PageLoading />
        ) : files.error ? (
          <ErrorBox error={files.error} onRetry={files.reload} />
        ) : (
          <ul role="tablist" aria-orientation="vertical" {...stylex.props(s.files)}>
            {sorted.map((f) => (
              <li key={f.path}>
                <button type="button" role="tab" aria-selected={tab === f.path} onClick={() => setTab(f.path)} {...stylex.props(s.file, tab === f.path && s.fileOn)}>
                  <FileText size={16} aria-hidden="true" {...stylex.props(s.fileIcon)} />
                  <span>
                    {fileTitle(f.path)}
                    {f.path.includes("/") && <span {...stylex.props(s.path)}>{f.path}</span>}
                  </span>
                </button>
              </li>
            ))}
            <li>
              <button type="button" role="tab" aria-selected={tab === NOTES_TAB} onClick={() => setTab(NOTES_TAB)} {...stylex.props(s.file, tab === NOTES_TAB && s.fileOn)}>
                <NotebookPen size={16} aria-hidden="true" {...stylex.props(s.fileIcon)} />
                <span>{t("memory.myNotes")}</span>
              </button>
            </li>
          </ul>
        )}
      </aside>

      <section {...stylex.props(card.base, s.body)} role="tabpanel" aria-label={tab === NOTES_TAB ? t("memory.myNotes") : active ? fileTitle(active.path) : t("memory.file")}>
        {tab === NOTES_TAB ? (
          <>
            <CardHead title={t("memory.myNotes")} />
            {notes.loading && !notes.data ? (
              <PageLoading />
            ) : notes.error ? (
              <ErrorBox error={notes.error} onRetry={notes.reload} />
            ) : notes.data!.length === 0 ? (
              <Empty title={t("memory.noNotesTitle")}>{t("memory.noNotesBody")}</Empty>
            ) : (
              <ul {...stylex.props(s.notes, readable.surface)}>
                {[...notes.data!]
                  .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                  .map((n) => (
                    <li key={n.id} {...stylex.props(s.note)}>
                      {n.quote && <blockquote {...stylex.props(s.quote)}>{n.quote}</blockquote>}
                      <p>{n.text}</p>
                      <p {...stylex.props(text.xs, text.muted)}>{formatDateTime(n.createdAt)}</p>
                    </li>
                  ))}
              </ul>
            )}
          </>
        ) : active ? (
          <>
            <p {...stylex.props(s.meta, text.small, text.muted)}>
              <code>{active.path}</code> · {t("memory.updated", { date: formatDateTime(active.updatedAt) })}
            </p>
            <Markdown src={active.content || t("memory.emptyFile")} xstyle={[readable.surface, s.doc]} />
          </>
        ) : files.data && sorted.length === 0 ? (
          <Empty title={t("memory.noFilesTitle")}>{t("memory.noFilesBody")}</Empty>
        ) : null}
      </section>
    </div>
  );
}
