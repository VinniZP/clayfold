import type { Database } from "bun:sqlite";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ItemState, NodeView } from "../../shared/api";
import type { PublicFigure, PublicItem, PublicStep } from "../../shared/schemas";
import { stripTermMarks } from "../../shared/terms";
import { paths } from "../config";
import { db } from "../db";
import { language, t } from "../i18n";
import { supersedingLesson, type LessonRow } from "../routes/lesson-summary";
import { lessonItemStates, lessonRevealedLines } from "../routes/progress";
import { publicStep, type StepRow } from "../routes/public";

// The course book is built from the public views the lesson page receives (publicStep, ItemState,
// revealed lines), so it never holds a key the learner has not been shown (L7).

type Topic = { id: string; title: string; goal_id: string | null };
type Note = { id: string; lesson_id: string | null; step_id: string | null; quote: string | null; text: string; created_at: string };

export function readMission(slug: string, workspaceOf: (slug: string) => string = paths.workspace): string | null {
  const file = join(workspaceOf(slug), "MISSION.md");
  return existsSync(file) ? readFileSync(file, "utf8") : null;
}

/** Drops the document's first H1 and moves its other headings `by` levels down, leaving code fences alone. */
export function nestHeadings(md: string, by: number): string {
  let fence = false;
  let titleDropped = false;
  const out: string[] = [];
  for (const line of md.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    const heading = fence ? null : /^(#{1,6})\s/.exec(line);
    if (heading && heading[1]!.length === 1 && !titleDropped) {
      titleDropped = true;
      continue;
    }
    out.push(heading ? `${"#".repeat(Math.min(6, heading[1]!.length + by))}${line.slice(heading[1]!.length)}` : line);
  }
  return out.join("\n").trim();
}

const plain = (md: string) => stripTermMarks(md).trim();
const italic = (text: string) => `_${text.replace(/[_*]/g, "\\$&")}_`;
const formatDate = (iso: string | Date) => new Intl.DateTimeFormat(language(), { dateStyle: "long" }).format(new Date(iso));

function figure(f: PublicFigure): string {
  const caption = f.caption ? `\n\n${italic(plain(f.caption))}` : "";
  switch (f.kind) {
    case "mermaid":
      return `\`\`\`mermaid\n${f.code.trim()}\n\`\`\`${caption}`;
    case "svg": {
      // A blank line would end the HTML block in the middle of the SVG.
      const svg = f.svg.replace(/<\?xml[^>]*\?>|<!DOCTYPE[^>]*>|<!--[\s\S]*?-->/gi, "").replace(/\n\s*\n/g, "\n").trim();
      return `${svg}${caption}`;
    }
    case "chart":
      return italic(t("book.chartNote", { alt: plain(f.alt) }));
    case "widget":
      return italic(t("book.widgetNote", { alt: plain(f.alt) }));
  }
}

function question(item: PublicItem, n: number, state: ItemState | undefined): string {
  const parts: string[] = [];
  let prompt = plain(item.prompt);
  if (item.format === "cloze" && item.text) prompt += `\n\n${plain(item.text).replace(/\{\{(\d+)\}\}/g, "\\_\\_\\_\\_ ($1)")}`;
  parts.push(`**${n}.** ${prompt}`);
  if (item.options) parts.push(item.options.map((o) => `- ${plain(o.text)}`).join("\n"));
  if (item.entries) parts.push(item.entries.map((e) => `- ${plain(e)}`).join("\n"));
  if (item.unit) parts.push(italic(t("book.unit", { unit: item.unit })));
  if (state?.correctAnswer !== undefined && state.solution !== undefined) {
    parts.push(`**${t("item.correctAnswer")}** ${plain(state.correctAnswer)}`);
    parts.push(`**${t("item.solution")}**\n\n${plain(state.solution)}`);
  } else {
    parts.push(italic(t(state && state.attempts > 0 ? "book.answerHiddenTried" : "book.answerHidden")));
  }
  return parts.join("\n\n");
}

type Bibliography = { number: (sourceId: string) => number };

function step(s: PublicStep, ctx: { states: Record<string, ItemState>; revealed: Map<number, string>; reflections: Note[]; refs: Bibliography }): string {
  const parts = [`#### ${t(`kind.${s.kind}`)}: ${plain(s.title)}`];
  const questions = (items: PublicItem[]) => items.map((item, i) => question(item, i + 1, ctx.states[item.id])).join("\n\n");
  const sources = (cites: { sourceId: string }[]) => {
    const numbers = [...new Set(cites.map((c) => ctx.refs.number(c.sourceId)))].sort((a, b) => a - b);
    return numbers.length ? italic(t("book.citesLine", { refs: numbers.map((n) => `[${n}]`).join(", ") })) : "";
  };
  switch (s.kind) {
    case "explain":
      parts.push(plain(s.body));
      if (s.figure) parts.push(figure(s.figure));
      parts.push(`**${t("book.checkQuestions")}**`, questions(s.checks), sources(s.cites));
      break;
    case "worked_example":
      parts.push(`**${t("book.problem")}** ${plain(s.problem)}`);
      if (s.figure) parts.push(figure(s.figure));
      parts.push(
        s.lines
          .map((line, i) => {
            const text = line.text ?? ctx.revealed.get(line.idx);
            return `${i + 1}. ${text !== undefined ? plain(text).replace(/\n/g, "\n   ") : italic(t("book.yourTurn", { prompt: plain(line.blankPrompt ?? "") }))}`;
          })
          .join("\n"),
        sources(s.cites),
      );
      break;
    case "activate":
    case "check":
      parts.push(questions(s.items));
      break;
    case "practice":
      parts.push(questions([s.item]));
      break;
    case "reflect":
      parts.push(`> ${plain(s.prompt)}`);
      for (const note of ctx.reflections) parts.push(`**${t("book.yourAnswer")}** ${note.text}`);
      break;
  }
  return parts.filter(Boolean).join("\n\n");
}

function courseMap(nodes: NodeView[]): string {
  const index = new Map(nodes.map((n, i) => [n.id, i]));
  const label = (text: string) => `"${text.replaceAll('"', "#quot;")}"`;
  const graph = [
    "```mermaid",
    "flowchart TD",
    ...nodes.map((n, i) => `  n${i}[${label(n.title)}]`),
    ...nodes.flatMap((n, i) => n.prereqs.filter((p) => index.has(p)).map((p) => `  n${index.get(p)} --> n${i}`)),
    "```",
  ].join("\n");
  const list = nodes
    .map((n) => {
      const facts = [t(n.kind === "skill" ? "graph.skill" : "graph.knowledge"), t(`mastery.${n.mastery}`)];
      const after = n.prereqs.map((p) => nodes[index.get(p) ?? -1]?.title).filter(Boolean);
      if (after.length) facts.push(t("topic.buildsOn", { titles: after.join(", ") }));
      return `- **${plain(n.title)}** · ${facts.join(" · ")}\n  ${plain(n.summary)}`;
    })
    .join("\n");
  return nodes.length > 1 ? `${graph}\n\n${list}` : list;
}

/** The topic as one Markdown document: mission, course map, finished lessons, glossary, the learner's notes and the sources they cite. */
export function courseBook(topicId: string, opts: { database?: Database; mission?: string | null; at?: Date } = {}): string {
  const database = opts.database ?? db();
  const topic = database.query<Topic, [string]>("SELECT id, title, goal_id FROM topics WHERE id = ?").get(topicId);
  if (!topic) throw new Error(`topic ${topicId} not found`);
  const out: string[] = [`# ${plain(topic.title)}`, italic(t("book.exported", { date: formatDate(opts.at ?? new Date()) }))];

  const goal = topic.goal_id
    ? database
        .query<{ title: string; why: string | null }, [string, string]>(
          "SELECT g.title, p.why FROM topics g LEFT JOIN goal_plan p ON p.goal_id = g.id AND p.topic_id = ? WHERE g.id = ?",
        )
        .get(topic.id, topic.goal_id)
    : null;
  if (goal) out.push(`> ${t("book.goal", { goal: plain(goal.title) })}${goal.why ? ` ${plain(goal.why)}` : ""}`);

  if (opts.mission?.trim()) out.push(`## ${t("book.mission")}`, nestHeadings(opts.mission, 1));

  const nodes = database
    .query<Omit<NodeView, "prereqs"> & { prereqs: string }, [string]>(
      "SELECT id, title, kind, summary, prereqs, placement, mastery FROM nodes WHERE topic_id = ? ORDER BY rowid",
    )
    .all(topic.id)
    .map((n): NodeView => ({ ...n, prereqs: JSON.parse(n.prereqs) as string[] }));
  if (nodes.length) out.push(`## ${t("book.map")}`, courseMap(nodes));

  const sources = database
    .query<{ id: string; url: string; title: string }, [string]>("SELECT id, url, title FROM sources WHERE topic_id = ? ORDER BY fetched_at, rowid")
    .all(topic.id);
  const cited: string[] = [];
  const refs: Bibliography = {
    number: (sourceId) => {
      if (!cited.includes(sourceId)) cited.push(sourceId);
      return cited.indexOf(sourceId) + 1;
    },
  };

  const notes = database
    .query<Note, [string]>("SELECT id, lesson_id, step_id, quote, text, created_at FROM notes WHERE topic_id = ? ORDER BY created_at, rowid")
    .all(topic.id);
  const shownNotes = new Set<string>();

  const lessons = database
    .query<LessonRow & { summary: string | null }, [string]>("SELECT * FROM lessons WHERE topic_id = ? AND status = 'finished' ORDER BY created_at, rowid")
    .all(topic.id)
    .filter((l) => supersedingLesson(l, database) === null);
  out.push(`## ${t("book.lessons")}`);
  if (lessons.length === 0) out.push(italic(t("book.noLessons")));
  lessons.forEach((lesson, i) => {
    out.push(`### ${i + 1}. ${plain(lesson.title)}`, italic(plain(lesson.objective)));
    if (lesson.summary) out.push(plain(lesson.summary));
    const states = lessonItemStates(lesson.id, database);
    const revealedByStep = lessonRevealedLines(lesson.id, database);
    const rows = database.query<StepRow, [string]>("SELECT * FROM steps WHERE lesson_id = ? AND status = 'published' ORDER BY idx").all(lesson.id);
    for (const row of rows) {
      const reflections = notes.filter((n) => n.step_id === row.id && row.kind === "reflect");
      for (const n of reflections) shownNotes.add(n.id);
      const revealed = new Map((revealedByStep[row.id] ?? []).map((l) => [l.idx, l.text]));
      out.push(step(publicStep(row, database), { states, revealed, reflections, refs }));
    }
  });

  const glossary = database
    .query<{ term: string; definition: string; original: string | null }, [string]>(
      "SELECT term, definition, original FROM glossary_terms WHERE topic_id = ? ORDER BY term COLLATE NOCASE",
    )
    .all(topic.id);
  if (glossary.length) {
    out.push(
      `## ${t("book.glossary")}`,
      glossary.map((g) => `- **${plain(g.term)}**${g.original ? ` (${plain(g.original)})` : ""}: ${plain(g.definition)}`).join("\n"),
    );
  }

  const lessonTitle = new Map(database.query<{ id: string; title: string }, [string]>("SELECT id, title FROM lessons WHERE topic_id = ?").all(topic.id).map((l) => [l.id, l.title]));
  const ownNotes = notes.filter((n) => !shownNotes.has(n.id));
  if (ownNotes.length) {
    out.push(
      `## ${t("book.notes")}`,
      ownNotes
        .map((n) => {
          const where = [n.lesson_id ? lessonTitle.get(n.lesson_id) : null, formatDate(n.created_at)].filter(Boolean).join(", ");
          return [n.quote ? `> ${n.quote.replace(/\n/g, "\n> ")}` : null, n.text, italic(where)].filter(Boolean).join("\n\n");
        })
        .join("\n\n---\n\n"),
    );
  }

  if (cited.length) {
    const byId = new Map(sources.map((s) => [s.id, s]));
    out.push(
      `## ${t("book.sources")}`,
      cited
        .map((id, i) => {
          const s = byId.get(id);
          return `${i + 1}. ${s ? `[${s.title.replace(/[[\]]/g, "\\$&")}](<${s.url}>)` : id}`;
        })
        .join("\n"),
    );
  }
  return `${out.join("\n\n")}\n`;
}
