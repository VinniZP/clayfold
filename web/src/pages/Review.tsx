import * as stylex from "@stylexjs/stylex";
import { ArrowRight, Eye } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import type { ReviewCard, ReviewRating, ReviewSession } from "@shared/api";
import type { MessageKey } from "@shared/i18n";
import type { PublicItem } from "@shared/schemas";
import { DayProgress } from "../components/DayProgress";
import { useHeader } from "../components/header";
import { ItemView, type ItemResult } from "../components/ItemView";
import { CardHead, Empty, ErrorBox, Markdown, PageLoading, Progress, Spinner } from "../components/ui";
import { api, errorText } from "../lib/api";
import { gameProgress } from "../lib/game";
import { t, useLang } from "../lib/i18n";
import { useResource } from "../lib/useResource";
import { bp, color, font, radius } from "../theme/tokens.stylex";
import { btn, card, chip, field, layout, text } from "../theme/ui";

const st = stylex.create({
  page: { display: "grid", gridTemplateColumns: "repeat(12, minmax(0, 1fr))", gap: 24, alignItems: "start" },
  main: { gridColumn: { default: "span 8", [bp.tablet]: "1 / -1" }, minWidth: 0, minHeight: 440, display: "grid", gap: 18, alignContent: "start" },
  side: { gridColumn: { default: "span 4", [bp.tablet]: "1 / -1" }, minWidth: 0, display: "grid", gap: 12, alignContent: "start" },
  full: { gridColumn: "1 / -1" },
  flash: { display: "grid", justifyItems: "center", gap: 20, paddingBlock: "24px 8px", textAlign: "center" },
  front: { maxWidth: "30ch", fontFamily: font.display, fontSize: { default: 30, [bp.mobile]: 23 }, fontWeight: 800, lineHeight: 1.2, letterSpacing: "-0.02em", textWrap: "balance" },
  back: { width: "100%", maxWidth: "56ch", paddingBlock: 22, paddingInline: 26, borderRadius: radius.card, backgroundColor: color.pistachioSoft, fontSize: 19, outline: "none" },
  rates: { display: "grid", gridTemplateColumns: { default: "repeat(4, minmax(0, 1fr))", [bp.phone]: "repeat(2, minmax(0, 1fr))" }, gap: 8, width: "100%", maxWidth: 600 },
  rate: { height: 54, borderRadius: 18, borderColor: { default: "transparent", ":hover": "currentColor" } },
  again: { backgroundColor: color.dangerSoft, color: color.danger },
  hard: { backgroundColor: color.warningSoft, color: color.warning },
  good: { backgroundColor: color.successSoft, color: color.success },
  easy: { backgroundColor: color.lilacSoft, color: color.accentText },
  kbd: { display: "inline-grid", placeItems: "center", minWidth: 22, height: 22, paddingInline: 4, borderRadius: 7, backgroundColor: color.surface, color: color.text, fontSize: 12, fontFamily: font.mono },
  progress: { display: "flex", alignItems: "center", gap: 14 },
  grow: { flexGrow: 1 },
  item: { display: "grid", gap: 16 },
  nav: { display: "flex", justifyContent: "flex-end", paddingTop: 16, borderTopWidth: 1, borderTopStyle: "solid", borderTopColor: color.border },
  stats: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, margin: 0, padding: 0, listStyle: "none" },
  stat: { display: "grid", gap: 2, paddingBlock: 12, paddingInline: 14, borderRadius: 16, backgroundColor: color.surface2 },
  statNum: { fontFamily: font.display, fontSize: 26, fontWeight: 800, fontVariantNumeric: "tabular-nums" },
  summary: { display: "grid", gap: 16 },
  rateSummary: { display: "grid", gridTemplateColumns: { default: "repeat(4, 1fr)", [bp.phone]: "repeat(2, 1fr)" }, gap: 8, margin: 0, padding: 0, listStyle: "none" },
  rateCell: { display: "grid", gap: 2, paddingBlock: 12, paddingInline: 14, borderRadius: 16 },
  select: { width: "auto", minWidth: 0, maxWidth: "100%", height: 40, paddingBlock: 0, fontSize: 14 },
});

type Entry = { kind: "card"; card: ReviewCard } | { kind: "item"; item: PublicItem };

const RATINGS: { rating: ReviewRating; label: MessageKey; key: string; tone: "again" | "hard" | "good" | "easy" }[] = [
  { rating: 1, label: "review.again", key: "1", tone: "again" },
  { rating: 2, label: "review.hard", key: "2", tone: "hard" },
  { rating: 3, label: "review.good", key: "3", tone: "good" },
  { rating: 4, label: "review.easy", key: "4", tone: "easy" },
];

function CardReview({ card, onRated }: { card: ReviewCard; onRated: (r: ReviewRating) => void }) {
  useLang();
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState<ReviewRating | null>(null);
  const revealedAt = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const revealRef = useRef<HTMLButtonElement>(null);
  const backRef = useRef<HTMLDivElement>(null);

  const rate = async (rating: ReviewRating) => {
    setBusy(rating);
    setError(null);
    try {
      await api.reviewCard(card.id, rating, revealedAt.current ? Date.now() - revealedAt.current : undefined);
      gameProgress({ kind: "progress" });
      onRated(rating);
    } catch (err) {
      setError(errorText(err));
      setBusy(null);
    }
  };

  useEffect(() => {
    revealRef.current?.focus();
  }, [card.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select")) return;
      if (!shown && (e.key === " " || e.key === "Enter") && t.tagName !== "BUTTON") {
        e.preventDefault();
        setShown(true);
      } else if (shown && busy === null) {
        const r = RATINGS.find((x) => x.key === e.key);
        if (r) void rate(r.rating);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    if (!shown) return;
    revealedAt.current = Date.now();
    backRef.current?.focus();
  }, [shown]);

  return (
    <div {...stylex.props(st.flash)}>
      <p {...stylex.props(st.front)}>
        <Markdown src={card.front} inline />
      </p>
      {!shown ? (
        <button ref={revealRef} type="button" onClick={() => setShown(true)} {...stylex.props(btn.base, btn.primary, btn.lg)}>
          <Eye size={18} aria-hidden="true" /> {t("review.showAnswer")}
        </button>
      ) : (
        <>
          <div ref={backRef} tabIndex={-1} aria-live="polite" {...stylex.props(st.back)}>
            <Markdown src={card.back} inline />
          </div>
          <p {...stylex.props(text.small, text.muted)}>{t("review.howEasy")}</p>
          <div role="group" aria-label={t("review.rating")} {...stylex.props(st.rates)}>
            {RATINGS.map((r) => (
              <button key={r.rating} type="button" disabled={busy !== null} onClick={() => rate(r.rating)} {...stylex.props(btn.base, st.rate, st[r.tone])}>
                {busy === r.rating ? <Spinner /> : <kbd {...stylex.props(st.kbd)}>{r.key}</kbd>} {t(r.label)}
              </button>
            ))}
          </div>
        </>
      )}
      {error && (
        <p role="alert" {...stylex.props(text.error)}>
          {error}
        </p>
      )}
    </div>
  );
}

export function ReviewPage() {
  useLang();
  useHeader({ title: t("review.title"), sub: t("review.sub"), art: "cards-stack" });
  const [params, setParams] = useSearchParams();
  const topicId = params.get("topicId") ?? "";
  const topics = useResource(api.topics, "topics");
  const session = useResource<ReviewSession>(() => api.review(topicId || undefined), `review:${topicId}`);
  const [pos, setPos] = useState(0);
  const [ratings, setRatings] = useState<ReviewRating[]>([]);
  const [itemResults, setItemResults] = useState<Record<string, ItemResult>>({});

  useEffect(() => {
    setPos(0);
    setRatings([]);
    setItemResults({});
  }, [session.data]);

  const filter = (
    <label {...stylex.props(field.inline)}>
      <span {...stylex.props(field.label)}>{t("memory.course")}</span>
      <select {...stylex.props(field.input, field.select, st.select)} value={topicId} onChange={(e) => setParams(e.target.value ? { topicId: e.target.value } : {})}>
        <option value="">{t("home.allCourses")}</option>
        {(topics.data ?? []).map((t) => (
          <option key={t.id} value={t.id}>
            {t.title}
          </option>
        ))}
      </select>
    </label>
  );

  if (session.loading && !session.data) return <PageLoading />;
  if (session.error)
    return (
      <div {...stylex.props(st.page)}>
        <section {...stylex.props(card.base, st.full)}>
          <ErrorBox error={session.error} onRetry={session.reload} />
        </section>
      </div>
    );

  const s = session.data!;
  const queue: Entry[] = [...s.cards.map((card) => ({ kind: "card" as const, card })), ...s.items.map((item) => ({ kind: "item" as const, item }))];
  const entry = queue[pos];
  const finished = queue.length > 0 && pos >= queue.length;

  return (
    <div {...stylex.props(st.page)}>
      <section aria-labelledby="review-title" {...stylex.props(card.base, st.main)}>
        <CardHead title={t(finished ? "review.sessionDone" : "review.session")} id="review-title">
          {filter}
        </CardHead>
        {queue.length === 0 ? (
          <Empty
            title={t("review.allDoneTitle")}
            art="cards-stack"
            action={
              <Link to="/topics" {...stylex.props(btn.base, btn.primary)}>
                {t("review.toCourses")} <ArrowRight size={16} aria-hidden="true" />
              </Link>
            }
          >
            {t("review.allDoneBody")}
          </Empty>
        ) : finished ? (
          <Summary ratings={ratings} items={s.items} results={itemResults} onRestart={() => void session.reload()} />
        ) : (
          <>
            <div {...stylex.props(st.progress)}>
              <span {...stylex.props(text.small, text.muted, text.tnum)}>
                {t("common.xOfY", { x: pos + 1, y: queue.length })}
              </span>
              <div {...stylex.props(st.grow)}>
                <Progress value={pos} max={queue.length} label={t("review.sessionProgress")} />
              </div>
            </div>
            {entry?.kind === "card" ? (
              <CardReview
                key={entry.card.id}
                card={entry.card}
                onRated={(r) => {
                  setRatings((x) => [...x, r]);
                  setPos((p) => p + 1);
                }}
              />
            ) : entry?.kind === "item" ? (
              <div {...stylex.props(st.item)}>
                <p {...stylex.props(chip.base, chip.lilac)}>{t("review.delayedRecall")}</p>
                <ItemView
                  key={entry.item.id}
                  item={entry.item}
                  mode="review"
                  context="review"
                  onResult={(id, r) => setItemResults((m) => ({ ...m, [id]: r }))}
                />
                <div {...stylex.props(st.nav)}>
                  <button type="button" {...stylex.props(btn.base, btn.primary)} disabled={!itemResults[entry.item.id]} onClick={() => setPos((p) => p + 1)}>
                    {t("lesson.next")} <ArrowRight size={16} aria-hidden="true" />
                  </button>
                </div>
              </div>
            ) : null}
          </>
        )}
      </section>

      <section aria-labelledby="review-about" {...stylex.props(card.base, st.side)}>
        <CardHead title={t("review.howItWorks")} id="review-about" />
        <p {...stylex.props(text.small)}>
          {t("review.fsrs")}
        </p>
        <p {...stylex.props(text.small, text.muted)}>
          {t("review.delayedExplain")}
        </p>
        <ul {...stylex.props(st.stats)}>
          <li {...stylex.props(st.stat)}>
            <span {...stylex.props(st.statNum)}>{s.cards.length}</span>
            <span {...stylex.props(text.muted, text.small)}>{t("word.cards", { count: s.cards.length })}</span>
          </li>
          <li {...stylex.props(st.stat)}>
            <span {...stylex.props(st.statNum)}>{s.items.length}</span>
            <span {...stylex.props(text.muted, text.small)}>{t("word.tasks", { count: s.items.length })}</span>
          </li>
        </ul>
      </section>
    </div>
  );
}

function Summary({
  ratings,
  items,
  results,
  onRestart,
}: {
  ratings: ReviewRating[];
  items: PublicItem[];
  results: Record<string, ItemResult>;
  onRestart: () => void;
}) {
  useLang();
  const by = (r: ReviewRating) => ratings.filter((x) => x === r).length;
  const correct = items.filter((i) => results[i.id]?.response.correct === true).length;
  return (
    <div role="status" {...stylex.props(st.summary)}>
      {ratings.length > 0 && (
        <>
          <p>{t("review.ratings", { count: ratings.length })}</p>
          <ul {...stylex.props(st.rateSummary)}>
            {RATINGS.map((r) => (
              <li key={r.rating} {...stylex.props(st.rateCell, st[r.tone])}>
                <span {...stylex.props(st.statNum)}>{by(r.rating)}</span>
                <span {...stylex.props(text.small)}>{t(r.label)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {items.length > 0 && (
        <p>
          {t("review.delayedCorrect")} <strong {...stylex.props(text.tnum)}>{t("common.xOfY", { x: correct, y: items.length })}</strong>
        </p>
      )}
      <DayProgress />
      <div {...stylex.props(layout.actions)}>
        <button type="button" onClick={onRestart} {...stylex.props(btn.base, btn.primary)}>
          {t("review.checkNew")}
        </button>
        <Link to="/" {...stylex.props(btn.base, btn.ghost)}>
          {t("notFound.home")}
        </Link>
      </div>
    </div>
  );
}
