import * as stylex from "@stylexjs/stylex";
import { Download, Printer } from "lucide-react";
import { marked } from "marked";
import { useMemo } from "react";
import { useParams } from "react-router";
import { FigureView } from "../components/Figure";
import { useHeader } from "../components/header";
import { ErrorBox, Markdown, PageLoading } from "../components/ui";
import { api, saveFile } from "../lib/api";
import { t, useLang } from "../lib/i18n";
import { printPage } from "../lib/print";
import { useResource } from "../lib/useResource";
import { btn, card, layout } from "../theme/ui";

const s = stylex.create({
  page: { display: "grid", gap: 20 },
  doc: { display: "grid", gap: 20, fontSize: 16 },
});

type Part = { kind: "markdown"; src: string } | { kind: "mermaid"; code: string };

/** Mermaid blocks of the book become diagrams; the rest stays Markdown. */
function split(src: string): Part[] {
  const parts: Part[] = [];
  for (const token of marked.lexer(src)) {
    const last = parts.at(-1);
    if (token.type === "code" && token.lang === "mermaid") parts.push({ kind: "mermaid", code: token.text });
    else if (last?.kind === "markdown") last.src += token.raw;
    else parts.push({ kind: "markdown", src: token.raw });
  }
  return parts;
}

/** The topic's course book as the server builds it for download, readable and printable in the app. */
export function BookPage() {
  useLang();
  const { topicId = "" } = useParams();
  const topics = useResource(api.topics, "topics");
  const book = useResource(async () => {
    const file = await api.courseBook(topicId);
    return { file, text: await file.blob.text() };
  }, topicId);
  const topic = topics.data?.find((x) => x.id === topicId);
  useHeader({ title: t("book.title"), sub: topic?.title, back: { to: `/topics/${topicId}`, label: t("lesson.backToCourse") }, art: "tutor-reading" });
  const parts = useMemo(() => (book.data ? split(book.data.text) : []), [book.data]);

  if (book.loading && !book.data) return <PageLoading />;
  if (book.error && !book.data)
    return (
      <section {...stylex.props(card.base)}>
        <ErrorBox error={book.error} onRetry={book.reload} title={t("book.loadFailed")} />
      </section>
    );
  if (!book.data) return null;
  const file = book.data.file;
  const doc = stylex.props(card.base, s.doc);
  return (
    <div {...stylex.props(s.page)}>
      <div data-print="hide" {...stylex.props(layout.actions)}>
        <button type="button" onClick={() => saveFile(file)} {...stylex.props(btn.base, btn.primary)}>
          <Download size={16} aria-hidden="true" /> {t("book.download")}
        </button>
        <button type="button" onClick={() => void printPage()} {...stylex.props(btn.base, btn.ghost)}>
          <Printer size={16} aria-hidden="true" /> {t("book.print")}
        </button>
      </div>
      <article data-print="sheet" className={`book ${doc.className ?? ""}`} style={doc.style}>
        {parts.map((part, i) =>
          part.kind === "mermaid" ? (
            <FigureView key={i} figure={{ kind: "mermaid", code: part.code, alt: t("book.figure"), teaches: t("book.figure") }} />
          ) : (
            <Markdown key={i} src={part.src} />
          ),
        )}
      </article>
    </div>
  );
}
