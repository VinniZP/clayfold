import * as stylex from "@stylexjs/stylex";
import { ClipboardPaste, ExternalLink, FileCode, FileText, Globe, Link2, Lock, Plus, TriangleAlert, Upload, X } from "lucide-react";
import { useId, useState, type DragEvent, type KeyboardEvent, type ReactNode } from "react";
import { MATERIAL_EXTENSIONS, MATERIAL_LIMITS, type MaterialKind, type MaterialView } from "@shared/api";
import type { MessageKey } from "@shared/i18n";
import { api, errorText, type MaterialDraft } from "../lib/api";
import { formatBytes, formatNumber } from "../lib/format";
import { t, useLang } from "../lib/i18n";
import { color, motion, radius, space } from "../theme/tokens.stylex";
import { btn, card, chip, field, layout, text } from "../theme/ui";
import { CardHead, Spinner } from "./ui";

const MB = 1024 * 1024;
const ACCEPT = Object.keys(MATERIAL_EXTENSIONS).join(",");

const s = stylex.create({
  panel: { display: "grid", gap: space.md },
  tabs: { display: "flex", flexWrap: "wrap", gap: 6 },
  tab: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    height: 34,
    paddingInline: 14,
    borderWidth: 0,
    borderRadius: radius.pill,
    backgroundColor: { default: color.surface2, ":hover": color.surface3 },
    color: color.textMuted,
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
  },
  tabOn: { backgroundColor: { default: color.primary, ":hover": color.primary }, color: color.onPrimary },
  drop: {
    display: "grid",
    justifyItems: "center",
    gap: space.xs,
    paddingBlock: 26,
    paddingInline: space.lg,
    borderWidth: 2,
    borderStyle: "dashed",
    borderColor: { default: color.borderStrong, ":hover": color.focus, ":focus-within": color.focus },
    borderRadius: radius.inner,
    backgroundColor: { default: color.surface, ":hover": color.lilacSoft },
    color: color.text,
    textAlign: "center",
    cursor: "pointer",
    boxShadow: { default: null, ":focus-within": `0 0 0 3px ${color.lilacSoft}` },
    transitionProperty: "background-color, border-color",
    transitionDuration: motion.fast,
  },
  dropOn: { borderColor: color.focus, backgroundColor: color.lilacSoft },
  dropIcon: { color: color.accentText },
  add: { justifySelf: "start" },
  list: { display: "grid", gap: space.sm },
  row: {
    display: "grid",
    gridTemplateColumns: "auto minmax(0, 1fr) auto",
    alignItems: "center",
    gap: space.md,
    paddingBlock: 10,
    paddingInline: 14,
    borderRadius: radius.small,
    backgroundColor: color.surface2,
  },
  rowIcon: {
    display: "grid",
    placeItems: "center",
    width: 36,
    height: 36,
    borderRadius: radius.small,
    backgroundColor: color.surface,
    color: color.accentText,
  },
  rowText: { display: "grid", gap: 2, minWidth: 0 },
  rowTitle: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 650 },
  rowLink: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" },
  rowMeta: { fontSize: 13, color: color.textMuted, fontVariantNumeric: "tabular-nums" },
  locked: { display: "grid", placeItems: "center", width: 32, height: 32, color: color.textMuted },
  section: { display: "grid", gap: space.lg },
});

const KIND_ICON: Record<MaterialKind, typeof FileText> = { text: ClipboardPaste, markdown: FileCode, html: FileCode, pdf: FileText, link: Globe };

const materialKindLabel = (kind: MaterialKind) => t(`material.kind.${kind}`);

const extensionOf = (name: string) => (name.match(/\.[^.]+$/)?.[0] ?? "").toLowerCase();

function draftKind(d: MaterialDraft): MaterialKind {
  if (d.kind === "file") return MATERIAL_EXTENSIONS[extensionOf(d.file.name)] ?? "text";
  return d.kind === "text" ? "text" : "link";
}

const draftTitle = (d: MaterialDraft) => (d.kind === "file" ? d.file.name : d.kind === "text" ? d.title : d.url);

const draftBytes = (d: MaterialDraft) => (d.kind === "file" ? d.file.size : d.kind === "text" ? new Blob([d.text]).size : null);

/** The checks the server repeats, run before upload so a wrong file fails at once. */
function draftError(d: MaterialDraft): string | null {
  const name = draftTitle(d);
  if (d.kind === "link") {
    try {
      const url = new URL(d.url);
      return url.protocol === "http:" || url.protocol === "https:" ? null : t("material.error.badLink", { name });
    } catch {
      return t("material.error.badLink", { name });
    }
  }
  if (d.kind === "file" && !MATERIAL_EXTENSIONS[extensionOf(d.file.name)]) return t("material.error.unsupported", { name });
  if ((draftBytes(d) ?? 0) > MATERIAL_LIMITS.bytes) return t("material.error.tooLarge", { name, limit: MATERIAL_LIMITS.bytes / MB });
  return null;
}

type Tab = "files" | "text" | "link";
const TABS: { key: Tab; label: MessageKey; icon: ReactNode }[] = [
  { key: "files", label: "material.tab.files", icon: <Upload size={15} aria-hidden="true" /> },
  { key: "text", label: "material.tab.text", icon: <ClipboardPaste size={15} aria-hidden="true" /> },
  { key: "link", label: "material.tab.link", icon: <Link2 size={15} aria-hidden="true" /> },
];

/** Files, pasted text and links; `room` is how many more materials the caller can take in one request. */
export function AttachPanel({ onAdd, room = MATERIAL_LIMITS.perRequest, disabled }: { onAdd: (drafts: MaterialDraft[]) => void; room?: number; disabled?: boolean }) {
  useLang();
  const id = useId();
  const [tab, setTab] = useState<Tab>("files");
  const [dragging, setDragging] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  const take = (drafts: MaterialDraft[]): boolean => {
    if (drafts.length === 0) return false;
    const problem = drafts.map(draftError).find(Boolean) ?? (drafts.length > room ? t("material.error.tooMany", { count: MATERIAL_LIMITS.perRequest }) : null);
    setError(problem);
    if (problem) return false;
    onAdd(drafts);
    return true;
  };
  const addFiles = (files: FileList | null) => take([...(files ?? [])].map((file): MaterialDraft => ({ kind: "file", file })));
  const addText = () => {
    if (!title.trim() || !body.trim()) return setError(t("material.error.emptyText"));
    if (take([{ kind: "text", title: title.trim(), text: body }])) {
      setTitle("");
      setBody("");
    }
  };
  const addLink = () => {
    if (url.trim() && take([{ kind: "link", url: url.trim() }])) setUrl("");
  };
  // The panel can sit inside another form, where Enter would submit that form.
  const onEnter = (add?: () => void) => (e: KeyboardEvent) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    add?.();
  };
  const dragProps = {
    onDragEnter: (e: DragEvent) => {
      e.preventDefault();
      if (!disabled) setDragging(true);
    },
    onDragOver: (e: DragEvent) => e.preventDefault(),
    onDragLeave: (e: DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      setDragging(false);
      if (!disabled) addFiles(e.dataTransfer.files);
    },
  };

  return (
    <div {...stylex.props(s.panel)}>
      <div role="tablist" aria-label={t("material.panel")} {...stylex.props(s.tabs)}>
        {TABS.map((x) => (
          <button
            key={x.key}
            type="button"
            role="tab"
            id={`${id}-tab-${x.key}`}
            aria-selected={tab === x.key}
            aria-controls={`${id}-panel`}
            onClick={() => {
              setTab(x.key);
              setError(null);
            }}
            {...stylex.props(s.tab, tab === x.key && s.tabOn)}
          >
            {x.icon} {t(x.label)}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-tab-${tab}`} {...stylex.props(s.panel)}>
        {tab === "files" && (
          <label {...dragProps} {...stylex.props(s.drop, dragging && s.dropOn)}>
            <input
              type="file"
              multiple
              accept={ACCEPT}
              disabled={disabled}
              onChange={(e) => {
                addFiles(e.target.files);
                e.target.value = "";
              }}
              {...stylex.props(layout.srOnly)}
            />
            <Upload size={24} aria-hidden="true" {...stylex.props(s.dropIcon)} />
            <span {...stylex.props(text.strong)}>{t(dragging ? "material.dropActive" : "material.drop")}</span>
            <span {...stylex.props(text.small, text.muted)}>{t("material.dropHint", { limit: MATERIAL_LIMITS.bytes / MB })}</span>
          </label>
        )}
        {tab === "text" && (
          <>
            <label {...stylex.props(field.stack)}>
              <span {...stylex.props(field.label)}>{t("material.textTitle")}</span>
              <input
                value={title}
                maxLength={200}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={onEnter()}
                placeholder={t("material.textTitlePlaceholder")}
                {...stylex.props(field.input)}
              />
            </label>
            <label {...stylex.props(field.stack)}>
              <span {...stylex.props(field.label)}>{t("material.textBody")}</span>
              <textarea value={body} rows={6} onChange={(e) => setBody(e.target.value)} placeholder={t("material.textPlaceholder")} {...stylex.props(field.input, field.textarea)} />
            </label>
            <button type="button" disabled={disabled || !title.trim() || !body.trim()} onClick={addText} {...stylex.props(btn.base, btn.soft, btn.sm, s.add)}>
              <Plus size={15} aria-hidden="true" /> {t("material.addText")}
            </button>
          </>
        )}
        {tab === "link" && (
          <>
            <label {...stylex.props(field.stack)}>
              <span {...stylex.props(field.label)}>{t("material.link")}</span>
              <input
                type="url"
                inputMode="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={onEnter(addLink)}
                placeholder={t("material.linkPlaceholder")}
                {...stylex.props(field.input)}
              />
              <span {...stylex.props(text.xs, text.muted)}>{t("material.linkHint")}</span>
            </label>
            <button type="button" disabled={disabled || !url.trim()} onClick={addLink} {...stylex.props(btn.base, btn.soft, btn.sm, s.add)}>
              <Plus size={15} aria-hidden="true" /> {t("material.addLink")}
            </button>
          </>
        )}
      </div>
      {error && (
        <p role="alert" {...stylex.props(text.error)}>
          <TriangleAlert size={14} aria-hidden="true" /> {error}
        </p>
      )}
    </div>
  );
}

function Row({ kind, title, href, meta, action }: { kind: MaterialKind; title: string; href?: string | null; meta: string; action?: ReactNode }) {
  const Icon = KIND_ICON[kind];
  return (
    <li {...stylex.props(s.row)}>
      <span aria-hidden="true" {...stylex.props(s.rowIcon)}>
        <Icon size={18} />
      </span>
      <span {...stylex.props(s.rowText)}>
        {href ? (
          <a href={href} target="_blank" rel="noopener noreferrer" title={title} {...stylex.props(text.link, s.rowLink)}>
            {title} <ExternalLink size={13} aria-hidden="true" />
          </a>
        ) : (
          <span title={title} {...stylex.props(s.rowTitle)}>
            {title}
          </span>
        )}
        <span {...stylex.props(s.rowMeta)}>{meta}</span>
      </span>
      {action}
    </li>
  );
}

const joinMeta = (...parts: (string | null)[]) => parts.filter(Boolean).join(" · ");

function RemoveButton({ title, onClick, disabled }: { title: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" aria-label={t("material.remove", { title })} title={t("material.remove", { title })} disabled={disabled} onClick={onClick} {...stylex.props(btn.base, btn.icon, btn.iconSm)}>
      <X size={16} aria-hidden="true" />
    </button>
  );
}

/** Materials picked for a topic that does not exist yet. */
export function DraftList({ drafts, onRemove, busy }: { drafts: MaterialDraft[]; onRemove: (d: MaterialDraft) => void; busy?: boolean }) {
  useLang();
  if (drafts.length === 0) return null;
  return (
    <ul {...stylex.props(layout.plainList, s.list)}>
      {drafts.map((d, i) => {
        const bytes = draftBytes(d);
        return (
          <Row
            key={`${i}-${draftTitle(d)}`}
            kind={draftKind(d)}
            title={draftTitle(d)}
            meta={busy ? t("material.reading") : joinMeta(materialKindLabel(draftKind(d)), bytes === null ? null : formatBytes(bytes))}
            action={busy ? <Spinner /> : <RemoveButton title={draftTitle(d)} onClick={() => onRemove(d)} />}
          />
        );
      })}
    </ul>
  );
}

/** The topic's materials, with the attach panel; `reload` refetches the topic. */
export function MaterialsSection({ topicId, materials, reload }: { topicId: string; materials: MaterialView[]; reload: () => Promise<void> }) {
  useLang();
  const [pending, setPending] = useState<MaterialDraft[]>([]);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const add = async (drafts: MaterialDraft[]) => {
    setError(null);
    setPending((p) => [...p, ...drafts]);
    try {
      await api.addMaterials(topicId, drafts);
      await reload();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setPending((p) => p.filter((d) => !drafts.includes(d)));
    }
  };
  const remove = async (m: MaterialView) => {
    setError(null);
    setRemoving(m.id);
    try {
      await api.removeMaterial(topicId, m.id);
      await reload();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setRemoving(null);
    }
  };

  return (
    <section aria-labelledby="materials-title" {...stylex.props(card.base, s.section)}>
      <div>
        <CardHead title={t("material.title")} id="materials-title">
          {materials.length > 0 && <span {...stylex.props(chip.base, chip.lilac)}>{t("material.count", { count: materials.length })}</span>}
        </CardHead>
        <p {...stylex.props(text.small, text.muted)}>{materials.length > 0 ? t("material.later") : t("material.intro")}</p>
      </div>
      {(materials.length > 0 || pending.length > 0) && (
        <ul aria-busy={pending.length > 0} {...stylex.props(layout.plainList, s.list)}>
          {materials.map((m) => (
            <Row
              key={m.id}
              kind={m.kind}
              title={m.title}
              href={m.url}
              meta={joinMeta(
                materialKindLabel(m.kind),
                m.bytes === null ? null : formatBytes(m.bytes),
                t("material.chars", { count: m.chars, n: formatNumber(m.chars) }),
              )}
              action={
                m.cited ? (
                  <span role="img" aria-label={t("material.removeCited")} title={t("material.removeCited")} {...stylex.props(s.locked)}>
                    <Lock size={15} aria-hidden="true" />
                  </span>
                ) : removing === m.id ? (
                  <Spinner />
                ) : (
                  <RemoveButton title={m.title} disabled={removing !== null} onClick={() => remove(m)} />
                )
              }
            />
          ))}
          {pending.map((d, i) => (
            <Row key={`pending-${i}`} kind={draftKind(d)} title={draftTitle(d)} meta={t("material.reading")} action={<Spinner />} />
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" {...stylex.props(text.error)}>
          <TriangleAlert size={14} aria-hidden="true" /> {error}
        </p>
      )}
      <AttachPanel onAdd={add} />
    </section>
  );
}
