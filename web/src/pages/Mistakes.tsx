import * as stylex from "@stylexjs/stylex";
import { ArrowRight, CircleCheck, Lightbulb, Play, RotateCcw, X } from "lucide-react";
import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import type { AttemptResponse, MistakeEntry, MistakePattern, MistakeSolution, RetryResponse } from "@shared/api";
import type { Answer } from "@shared/schemas";
import { DayProgress } from "../components/DayProgress";
import { useHeader } from "../components/header";
import { ItemPrompt } from "../components/ItemPrompt";
import { ItemView } from "../components/ItemView";
import { CardHead, Empty, ErrorBox, Markdown, PageLoading, Progress, Spinner } from "../components/ui";
import { api, errorText } from "../lib/api";
import { formatDate, formatDateTime } from "../lib/format";
import { t, useLang } from "../lib/i18n";
import { useResource } from "../lib/useResource";
import { bp, color, font, radius } from "../theme/tokens.stylex";
import { banner, btn, card, chip, field, layout, text } from "../theme/ui";

const s = stylex.create({
  page: { display: "grid", gridTemplateColumns: "repeat(12, minmax(0, 1fr))", gap: 24, alignItems: "start" },
  main: { gridColumn: { default: "span 8", [bp.tablet]: "1 / -1" }, minWidth: 0, display: "grid", gap: 24, alignContent: "start" },
  side: { gridColumn: { default: "span 4", [bp.tablet]: "1 / -1" }, minWidth: 0, display: "grid", gap: 12, alignContent: "start" },
  full: { gridColumn: "1 / -1" },
  notebook: { display: "grid", gap: 20, alignContent: "start", minHeight: 320 },
  select: { width: "auto", minWidth: 0, maxWidth: "100%", height: 40, paddingBlock: 0, fontSize: 14 },
  toolbar: { display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12 },
  pills: { display: "flex", flexWrap: "wrap", gap: 6 },
  pill: { height: 34, paddingInline: 14, borderWidth: 0, borderRadius: radius.pill, backgroundColor: color.surface2, color: color.textMuted, fontSize: 13.5, fontWeight: 600, cursor: "pointer" },
  pillOn: { backgroundColor: color.primary, color: color.onPrimary },
  groups: { display: "grid", gap: 28 },
  group: { display: "grid", gap: 14 },
  node: { display: "grid", gap: 10 },
  nodeTitle: { fontSize: 13.5, fontWeight: 650, color: color.textMuted },
  entries: { display: "grid", gap: 12 },
  entry: { display: "grid", gap: 14, minWidth: 0, paddingBlock: 18, paddingInline: { default: 20, [bp.mobile]: 16 }, borderRadius: radius.inner, backgroundColor: color.surface2 },
  entryHead: { display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8 },
  yours: { display: "flex", alignItems: "baseline", flexWrap: "wrap", gap: 6, color: color.danger, fontWeight: 600 },
  yoursIcon: { alignSelf: "center", flexShrink: 0 },
  misconception: { display: "flex", alignItems: "baseline", gap: 8, fontSize: 14.5 },
  solution: { display: "grid", gap: 8, maxWidth: "68ch", paddingBlock: 14, paddingInline: 16, borderRadius: radius.field, backgroundColor: color.surface },
  outcomeResolved: { backgroundColor: color.successSoft, color: color.text },
  patterns: { display: "grid", gap: 10 },
  pattern: { display: "grid", gap: 4, paddingBlock: 14, paddingInline: 18, borderRadius: radius.inner, backgroundColor: color.surface },
  patternTitle: { fontWeight: 700 },
  stats: { display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8, margin: 0, padding: 0, listStyle: "none" },
  stat: { display: "grid", gap: 2, paddingBlock: 12, paddingInline: 14, borderRadius: 16, backgroundColor: color.surface2 },
  statNum: { fontFamily: font.display, fontSize: 26, fontWeight: 800, fontVariantNumeric: "tabular-nums" },
  progress: { display: "flex", alignItems: "center", gap: 14 },
  grow: { flexGrow: 1 },
  nav: { display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 8, paddingTop: 16, borderTopWidth: 1, borderTopStyle: "solid", borderTopColor: color.border },
  summary: { display: "grid", gap: 16 },
});

type Status = "open" | "resolved";

/** Round-robin across nodes, newest first within each, so consecutive retries come from different nodes. */
function interleaveByNode(entries: MistakeEntry[]): MistakeEntry[] {
  const byNode = new Map<string, MistakeEntry[]>();
  for (const e of entries) byNode.set(`${e.topicId}/${e.nodeId}`, [...(byNode.get(`${e.topicId}/${e.nodeId}`) ?? []), e]);
  const lists = [...byNode.values()];
  const out: MistakeEntry[] = [];
  for (let i = 0; out.length < entries.length; i++) for (const l of lists) if (l[i]) out.push(l[i]!);
  return out;
}

/** Topics, then nodes, in the order of their newest entry. */
function groupEntries(entries: MistakeEntry[]) {
  const topics = new Map<string, { title: string; nodes: Map<string, { title: string; entries: MistakeEntry[] }> }>();
  for (const e of entries) {
    const topic = topics.get(e.topicId) ?? { title: e.topicTitle, nodes: new Map() };
    topics.set(e.topicId, topic);
    const node = topic.nodes.get(e.nodeId) ?? { title: e.nodeTitle, entries: [] };
    topic.nodes.set(e.nodeId, node);
    node.entries.push(e);
  }
  return [...topics].map(([id, topic]) => ({ id, title: topic.title, nodes: [...topic.nodes].map(([nodeId, node]) => ({ id: nodeId, ...node })) }));
}

const isReady = (e: MistakeEntry) => !e.resolvedAt && Date.parse(e.readyAt) <= Date.now();

export function MistakesPage() {
  useLang();
  useHeader({ title: t("mistakes.title"), sub: t("mistakes.sub"), art: "search-magnifier" });
  const [params, setParams] = useSearchParams();
  const topicId = params.get("topicId") ?? "";
  const status: Status = params.get("status") === "resolved" ? "resolved" : "open";
  const view = useResource(api.mistakes, "mistakes");
  const [session, setSession] = useState<MistakeEntry[] | null>(null);
  // Entries retried on this visit stay listed under the filter they were found in, with their outcome.
  const [kept, setKept] = useState<Set<string>>(() => new Set());

  const setParam = (key: string, value: string) => {
    setKept(new Set());
    setParams((p) => {
      const next = new URLSearchParams(p);
      if (value) next.set(key, value);
      else next.delete(key);
      return next;
    });
  };

  if (view.loading && !view.data) return <PageLoading />;
  if (view.error && !view.data)
    return (
      <div {...stylex.props(s.page)}>
        <section {...stylex.props(card.base, s.full)}>
          <ErrorBox error={view.error} onRetry={view.reload} />
        </section>
      </div>
    );

  const { entries, patterns } = view.data!;
  const inTopic = entries.filter((e) => !topicId || e.topicId === topicId);
  const open = inTopic.filter((e) => !e.resolvedAt);
  const shown = inTopic.filter((e) => kept.has(e.itemId) || (status === "resolved" ? !!e.resolvedAt : !e.resolvedAt));
  const topics = [...new Map(entries.map((e) => [e.topicId, e.topicTitle])).entries()];
  const shownPatterns = patterns.filter((p) => !topicId || p.topicId === topicId);

  const applyRetry = (r: RetryResponse) =>
    view.setData((d) => d && { ...d, entries: d.entries.map((e) => (e.itemId === r.entry.itemId ? r.entry : e)) });
  const onRetried = (r: RetryResponse) => {
    setKept((k) => new Set(k).add(r.entry.itemId));
    applyRetry(r);
    void view.reload();
  };
  const endSession = () => {
    setSession(null);
    void view.reload();
  };

  return (
    <div {...stylex.props(s.page)}>
      <div {...stylex.props(s.main)}>
        {!session && shownPatterns.length > 0 && <Patterns patterns={shownPatterns} />}

        <section aria-labelledby="notebook-title" {...stylex.props(card.base, s.notebook)}>
          {session ? (
            <Session queue={session} onRetried={applyRetry} onExit={endSession} />
          ) : (
            <>
              <CardHead title={t("mistakes.notebook")} id="notebook-title">
                {topics.length > 1 && (
                  <label {...stylex.props(field.inline)}>
                    <span {...stylex.props(field.label)}>{t("memory.course")}</span>
                    <select {...stylex.props(field.input, field.select, s.select)} value={topicId} onChange={(e) => setParam("topicId", e.target.value)}>
                      <option value="">{t("home.allCourses")}</option>
                      {topics.map(([id, title]) => (
                        <option key={id} value={id}>
                          {title}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </CardHead>
              {entries.length === 0 ? (
                <Empty title={t("mistakes.emptyTitle")}>{t("mistakes.emptyBody")}</Empty>
              ) : (
                <>
                  <div {...stylex.props(s.toolbar)}>
                    <div role="group" aria-label={t("mistakes.status")} {...stylex.props(s.pills)}>
                      {(["open", "resolved"] as const).map((st) => (
                        <button key={st} type="button" aria-pressed={status === st} onClick={() => setParam("status", st === "open" ? "" : st)} {...stylex.props(s.pill, status === st && s.pillOn)}>
                          {t(`mistakes.${st}`)} <span {...stylex.props(text.tnum)}>{inTopic.filter((e) => (st === "open" ? !e.resolvedAt : !!e.resolvedAt)).length}</span>
                        </button>
                      ))}
                    </div>
                    {open.length > 0 && (
                      <button type="button" onClick={() => setSession(interleaveByNode(open))} {...stylex.props(btn.base, btn.primary, btn.sm)}>
                        <Play size={15} fill="currentColor" aria-hidden="true" /> {t("mistakes.retryAll")}
                      </button>
                    )}
                  </div>
                  {shown.length === 0 ? (
                    <Empty title={t(status === "open" ? "mistakes.noneOpenTitle" : "mistakes.noneResolvedTitle")}>
                      {t(status === "open" ? "mistakes.noneOpenBody" : "mistakes.noneResolvedBody")}
                    </Empty>
                  ) : (
                    <div {...stylex.props(s.groups)}>
                      {groupEntries(shown).map((topic) => (
                        <section key={topic.id} aria-label={topic.title} {...stylex.props(s.group)}>
                          <h3 {...stylex.props(text.h3)}>{topic.title}</h3>
                          {topic.nodes.map((node) => (
                            <div key={node.id} {...stylex.props(s.node)}>
                              <h4 {...stylex.props(s.nodeTitle)}>{node.title}</h4>
                              <ul {...stylex.props(layout.plainList, s.entries)}>
                                {node.entries.map((e) => (
                                  <EntryCard key={e.itemId} entry={e} onRetried={onRetried} />
                                ))}
                              </ul>
                            </div>
                          ))}
                        </section>
                      ))}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </section>
      </div>

      <section aria-labelledby="mistakes-about" {...stylex.props(card.base, s.side)}>
        <CardHead title={t("review.howItWorks")} id="mistakes-about" />
        <p {...stylex.props(text.small)}>{t("mistakes.explain")}</p>
        <p {...stylex.props(text.small, text.muted)}>{t("mistakes.explainStats")}</p>
        <ul {...stylex.props(s.stats)}>
          {(
            [
              ["mistakes.statOpen", open.length],
              ["mistakes.statReady", open.filter(isReady).length],
              ["mistakes.statResolved", inTopic.length - open.length],
            ] as const
          ).map(([label, n]) => (
            <li key={label} {...stylex.props(s.stat)}>
              <span {...stylex.props(s.statNum)}>{n}</span>
              <span {...stylex.props(text.muted, text.xs)}>{t(label)}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Patterns({ patterns }: { patterns: MistakePattern[] }) {
  useLang();
  return (
    <section aria-labelledby="patterns-title" {...stylex.props(card.base, card.peach, s.patterns)}>
      <CardHead title={t("mistakes.patterns")} id="patterns-title" />
      <p {...stylex.props(text.small)}>{t("mistakes.patternsIntro")}</p>
      <ul {...stylex.props(layout.plainList, s.patterns)}>
        {patterns.map((p) => (
          <li key={`${p.itemId}:${p.option}`} {...stylex.props(s.pattern)}>
            <p {...stylex.props(s.patternTitle)}>{p.misconception ?? t("mistakes.patternUnnamed")}</p>
            <p {...stylex.props(text.small)}>{t("mistakes.patternChose", { option: p.option, count: p.times })}</p>
            <p {...stylex.props(text.xs, text.muted)}>{p.nodeTitle}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function StatusChip({ entry }: { entry: MistakeEntry }) {
  useLang();
  if (entry.resolvedAt) return <span {...stylex.props(chip.base, chip.xs, chip.pistachio)}>{t("mistakes.resolvedOn", { date: formatDate(entry.resolvedAt) })}</span>;
  if (isReady(entry)) return <span {...stylex.props(chip.base, chip.xs, chip.lilac)}>{t("mistakes.ready")}</span>;
  return <span {...stylex.props(chip.base, chip.xs, chip.butter)}>{t("mistakes.readyFrom", { date: formatDateTime(entry.readyAt) })}</span>;
}

type SolutionState = { status: "closed" } | { status: "loading" } | { status: "open"; data: MistakeSolution } | { status: "error"; error: string };

function EntryCard({ entry, onRetried }: { entry: MistakeEntry; onRetried: (r: RetryResponse) => void }) {
  useLang();
  const [retrying, setRetrying] = useState(false);
  const [solution, setSolution] = useState<SolutionState>({ status: "closed" });
  const solutionOpen = solution.status !== "closed";

  const toggleSolution = async () => {
    if (solutionOpen) return setSolution({ status: "closed" });
    setSolution({ status: "loading" });
    try {
      setSolution({ status: "open", data: await api.mistakeSolution(entry.itemId) });
    } catch (err) {
      setSolution({ status: "error", error: errorText(err) });
    }
  };

  return (
    <li {...stylex.props(s.entry)}>
      <div {...stylex.props(s.entryHead)}>
        <span {...stylex.props(text.xs, text.muted)}>
          {t("mistakes.madeOn", { date: formatDate(entry.at) })}
          {entry.retries > 0 && <> · {t("mistakes.retries", { count: entry.retries })}</>}
        </span>
        <StatusChip entry={entry} />
      </div>

      {retrying ? (
        <RetryItem entry={entry} onRetried={onRetried} />
      ) : (
        <>
          <ItemPrompt src={entry.item.prompt} />
          <p {...stylex.props(s.yours)}>
            <X size={16} strokeWidth={3} aria-hidden="true" {...stylex.props(s.yoursIcon)} />
            {entry.answer === null ? (
              t("mistakes.gaveUpNoAnswer")
            ) : (
              <>
                {t("mistakes.yourAnswer")} <Markdown src={entry.answer} inline />
              </>
            )}
            {entry.gaveUp && entry.answer !== null && <span {...stylex.props(chip.base, chip.xs, chip.danger)}>{t("mistakes.gaveUp")}</span>}
          </p>
          {entry.misconception && (
            <p {...stylex.props(s.misconception)}>
              <Lightbulb size={16} aria-hidden="true" />
              {t("home.looksLike", { text: entry.misconception })}
            </p>
          )}
          {solution.status === "open" && (
            <div {...stylex.props(s.solution)}>
              <p>
                {t("item.correctAnswer")} <strong>{solution.data.correctAnswer}</strong>
              </p>
              <Markdown src={solution.data.solution} />
            </div>
          )}
          {solution.status === "error" && (
            <p role="alert" {...stylex.props(text.error)}>
              {solution.error}
            </p>
          )}
        </>
      )}

      <div {...stylex.props(layout.actions)}>
        {retrying ? (
          <button type="button" onClick={() => setRetrying(false)} {...stylex.props(btn.base, btn.ghost, btn.sm)}>
            {t("mistakes.closeRetry")}
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={() => {
                setSolution({ status: "closed" });
                setRetrying(true);
              }}
              {...stylex.props(btn.base, btn.primary, btn.sm)}
            >
              <RotateCcw size={15} aria-hidden="true" /> {t("mistakes.retry")}
            </button>
            <button type="button" aria-expanded={solutionOpen} onClick={() => void toggleSolution()} {...stylex.props(btn.base, btn.ghost, btn.sm)}>
              {solution.status === "loading" && <Spinner />}
              {t(solutionOpen ? "mistakes.hideSolution" : "mistakes.showSolution")}
            </button>
          </>
        )}
        {entry.lessonId && (
          <Link to={`/lessons/${entry.lessonId}${entry.stepIdx === null ? "" : `?step=${entry.stepIdx + 1}`}`} {...stylex.props(text.link, text.small)}>
            {entry.lessonTitle}
            {entry.stepIdx !== null && ` · ${t("mistakes.step", { n: entry.stepIdx + 1 })}`}
            <ArrowRight size={14} aria-hidden="true" />
          </Link>
        )}
      </div>
    </li>
  );
}

/** An unaided answer (no hints, no tutor, no give-up) recorded as a retry, then what it did to the entry. */
function RetryItem({ entry, onRetried }: { entry: MistakeEntry; onRetried: (r: RetryResponse) => void }) {
  const [result, setResult] = useState<RetryResponse | null>(null);
  const send = async (answer: Answer, durationMs: number): Promise<AttemptResponse> => {
    const res = await api.retryMistake(entry.itemId, { answer, durationMs });
    setResult(res);
    onRetried(res);
    return { correct: res.correct, confidence: null, feedback: res.feedback, solution: res.solution, correctAnswer: res.correctAnswer, attemptNo: res.entry.retries, offerTutor: false };
  };
  return (
    <>
      <ItemView item={entry.item} mode="retry" send={send} />
      {result && <Outcome result={result} />}
    </>
  );
}

function Outcome({ result }: { result: RetryResponse }) {
  useLang();
  const { entry } = result;
  if (entry.resolvedAt)
    return (
      <p role="status" {...stylex.props(banner.base, s.outcomeResolved)}>
        <CircleCheck size={18} aria-hidden="true" /> {t("mistakes.resultResolved")}
      </p>
    );
  return (
    <p role="status" {...stylex.props(banner.base, banner.lilac)}>
      {t(result.correct ? "mistakes.resultEarly" : "mistakes.resultWrong", { date: formatDateTime(entry.readyAt) })}
    </p>
  );
}

function Session({ queue, onRetried, onExit }: { queue: MistakeEntry[]; onRetried: (r: RetryResponse) => void; onExit: () => void }) {
  useLang();
  const [pos, setPos] = useState(0);
  const [results, setResults] = useState<Record<string, RetryResponse>>({});
  const entry = queue[pos];

  if (!entry) {
    const done = Object.values(results);
    const resolved = done.filter((r) => r.entry.resolvedAt).length;
    const early = done.filter((r) => r.correct && !r.entry.resolvedAt).length;
    return (
      <div role="status" {...stylex.props(s.summary)}>
        <CardHead title={t("mistakes.sessionDone")} id="notebook-title" />
        <p>
          {t("mistakes.sessionCorrect")}{" "}
          <strong {...stylex.props(text.tnum)}>{t("common.xOfY", { x: done.filter((r) => r.correct).length, y: done.length })}</strong>
        </p>
        <p>{t("mistakes.sessionResolved", { count: resolved })}</p>
        {early > 0 && <p {...stylex.props(text.muted)}>{t("mistakes.sessionEarly", { count: early })}</p>}
        <DayProgress />
        <div {...stylex.props(layout.actions)}>
          <button type="button" onClick={onExit} {...stylex.props(btn.base, btn.primary)}>
            {t("mistakes.backToList")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <CardHead title={t("mistakes.session")} id="notebook-title" />
      <div {...stylex.props(s.progress)}>
        <span {...stylex.props(text.small, text.muted, text.tnum)}>{t("common.xOfY", { x: pos + 1, y: queue.length })}</span>
        <div {...stylex.props(s.grow)}>
          <Progress value={pos} max={queue.length} label={t("mistakes.sessionProgress")} />
        </div>
      </div>
      <p {...stylex.props(chip.base, chip.lilac)}>
        {entry.topicTitle} · {entry.nodeTitle}
      </p>
      <RetryItem
        key={entry.itemId}
        entry={entry}
        onRetried={(r) => {
          setResults((m) => ({ ...m, [entry.itemId]: r }));
          onRetried(r);
        }}
      />
      <div {...stylex.props(s.nav)}>
        <button type="button" onClick={() => (Object.keys(results).length ? setPos(queue.length) : onExit())} {...stylex.props(btn.base, btn.ghost)}>
          {t("mistakes.endSession")}
        </button>
        <button type="button" disabled={!results[entry.itemId]} onClick={() => setPos((p) => p + 1)} {...stylex.props(btn.base, btn.primary)}>
          {t("lesson.next")} <ArrowRight size={16} aria-hidden="true" />
        </button>
      </div>
    </>
  );
}
