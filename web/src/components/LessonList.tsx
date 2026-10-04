import * as stylex from "@stylexjs/stylex";
import { ChevronRight, Clapperboard } from "lucide-react";
import { Link } from "react-router";
import type { LessonSummary } from "@shared/api";
import type { MessageKey } from "@shared/i18n";
import { formatDate, levelLabel } from "../lib/format";
import { t, useLang } from "../lib/i18n";
import { bp, color, radius, space } from "../theme/tokens.stylex";
import { chip, text } from "../theme/ui";
import { StaleSources, readyLine } from "./LessonStatus";
import { LessonBadges } from "./meerkat/Crowns";
import { FOCUS_LABEL } from "./Practice";
import { Spinner } from "./ui";

type Learner = LessonSummary["learnerStatus"];

/** Authoring state: whether Claude has finished writing the lesson. `finished` is a finished generation. */
const AUTHORING: Record<LessonSummary["status"], { label: MessageKey; tone: stylex.StyleXStyles | null }> = {
  generating: { label: "lesson.generating", tone: chip.butter },
  ready: { label: "lesson.ready", tone: null },
  finished: { label: "lesson.ready", tone: null },
  failed: { label: "lesson.failed", tone: chip.danger },
};

/** The learner's own progress through the lesson. */
export const LEARNER: Record<Learner, { label: MessageKey; tone: stylex.StyleXStyles | null }> = {
  not_started: { label: "lesson.notStarted", tone: null },
  in_progress: { label: "lesson.inProgress", tone: chip.lilac },
  completed: { label: "lesson.completed", tone: chip.pistachio },
};

const s = stylex.create({
  list: { display: "grid", gap: space.sm, margin: 0, padding: 0, listStyle: "none" },
  item: {
    display: "grid",
    gap: space.sm,
    paddingBlock: 14,
    paddingInline: space.lg,
    borderRadius: radius.inner,
    backgroundColor: color.surface2,
  },
  row: {
    position: "relative",
    display: "flex",
    flexDirection: { default: "row", [bp.mobile]: "column" },
    justifyContent: "space-between",
    gap: { default: space.lg, [bp.mobile]: space.sm },
    borderRadius: radius.field,
    boxShadow: { default: "none", ":focus-within": `0 0 0 3px ${color.focus}` },
  },
  body: { display: "grid", gap: space.xxs, minWidth: 0 },
  link: {
    fontWeight: 700,
    color: { default: color.text, ":hover": color.accentText },
    textDecoration: "none",
    outline: "none",
    "::after": { content: '""', position: "absolute", inset: 0, borderRadius: radius.field },
  },
  ready: { fontSize: 14, fontWeight: 650, color: color.accentText },
  meta: {
    display: "flex",
    flexDirection: { default: "column", [bp.mobile]: "row" },
    flexWrap: "wrap",
    alignItems: { default: "flex-end", [bp.mobile]: "center" },
    gap: space.xs,
    flexShrink: 0,
  },
  chips: { display: "flex", flexWrap: "wrap", gap: space.xs, justifyContent: { default: "flex-end", [bp.mobile]: "flex-start" } },
  older: { position: "relative", zIndex: 1 },
  summary: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.xs,
    cursor: "pointer",
    listStyle: "none",
    fontSize: 13.5,
    fontWeight: 650,
    color: color.accentText,
    "::-webkit-details-marker": { display: "none" },
  },
  olderList: { display: "grid", gap: space.xs, marginTop: space.sm, padding: 0, listStyle: "none" },
  olderItem: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: `${space.xs} ${space.md}`,
    paddingBlock: space.sm,
    paddingInline: space.md,
    borderRadius: radius.small,
    backgroundColor: color.surface,
    fontSize: 14,
  },
  olderLink: { color: color.text, fontWeight: 600, textDecoration: { default: "none", ":hover": "underline" } },
});

/** The current (latest) lesson a superseded one leads to. */
function currentOf(lesson: LessonSummary, byId: Map<string, LessonSummary>): LessonSummary {
  let l = lesson;
  const seen = new Set<string>();
  while (l.supersededBy && !seen.has(l.id)) {
    seen.add(l.id);
    const next = byId.get(l.supersededBy);
    if (!next) break;
    l = next;
  }
  return l;
}

function AuthoringChip({ lesson }: { lesson: LessonSummary }) {
  useLang();
  const a = AUTHORING[lesson.status];
  return (
    <span {...stylex.props(chip.base, a.tone)}>
      {lesson.status === "generating" && <Spinner size={12} />}
      {t(a.label)}
    </span>
  );
}

export function LearnerChip({ status }: { status: Learner }) {
  useLang();
  const l = LEARNER[status];
  return <span {...stylex.props(chip.base, l.tone)}>{t(l.label)}</span>;
}

/** Current lessons, newest first; earlier versions of each sit in a collapsed disclosure under it. */
export function LessonList({ lessons }: { lessons: LessonSummary[] }) {
  useLang();
  const byId = new Map(lessons.map((l) => [l.id, l]));
  const current = lessons.filter((l) => l.supersededBy === null).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const earlier = new Map<string, LessonSummary[]>();
  for (const l of lessons) {
    if (l.supersededBy === null) continue;
    const head = currentOf(l, byId);
    earlier.set(head.id, [...(earlier.get(head.id) ?? []), l]);
  }

  return (
    <ul {...stylex.props(s.list)}>
      {current.map((l) => {
        const older = (earlier.get(l.id) ?? []).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        return (
          <li key={l.id} {...stylex.props(s.item)}>
            <div {...stylex.props(s.row)}>
              <div {...stylex.props(s.body)}>
                <Link to={`/lessons/${l.id}`} {...stylex.props(s.link)}>
                  {l.title}
                </Link>
                <p {...stylex.props(text.small, text.muted)}>{l.objective}</p>
                {l.status === "generating" && <p {...stylex.props(s.ready)}>{readyLine(l)}</p>}
              </div>
              <div {...stylex.props(s.meta)}>
                <div {...stylex.props(s.chips)}>
                  <AuthoringChip lesson={l} />
                  {l.status !== "failed" && <LearnerChip status={l.learnerStatus} />}
                  {l.video === "ready" && (
                    <span {...stylex.props(chip.base, chip.lilac)}>
                      <Clapperboard size={12} aria-hidden="true" /> {t("video.ready")}
                    </span>
                  )}
                  <LessonBadges lessonId={l.id} />
                </div>
                <span {...stylex.props(text.small, text.muted)}>
                  {l.practice ? t(FOCUS_LABEL[l.practice.focus]) : levelLabel(l.level)} · {formatDate(l.createdAt)}
                </span>
              </div>
            </div>
            <StaleSources lesson={l} inline />
            {older.length > 0 && (
              <details {...stylex.props(s.older)}>
                <summary {...stylex.props(s.summary)}>
                  <ChevronRight size={15} aria-hidden="true" />
                  {t("lesson.olderVersions", { count: older.length })}
                </summary>
                <ul aria-label={t("lesson.olderVersionsLabel", { lessons: t("count.lessons", { count: older.length }) })} {...stylex.props(s.olderList)}>
                  {older.map((o) => (
                    <li key={o.id} {...stylex.props(s.olderItem)}>
                      <Link to={`/lessons/${o.id}`} {...stylex.props(s.olderLink)}>
                        {o.title}
                      </Link>
                      <span {...stylex.props(text.small, text.muted)}>{formatDate(o.createdAt)}</span>
                      <LearnerChip status={o.learnerStatus} />
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </li>
        );
      })}
    </ul>
  );
}
