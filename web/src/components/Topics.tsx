import * as stylex from "@stylexjs/stylex";
import { ArrowRight, Flag, Repeat2, Search, Sparkles } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import type { TopicSummary } from "@shared/api";
import { CONTENT_RULES, TOPIC_ART } from "@shared/i18n";
import { api, errorText } from "../lib/api";
import { t, useLang } from "../lib/i18n";
import { bp, color, font, motion, radius, space } from "../theme/tokens.stylex";
import { btn, chip, layout, text } from "../theme/ui";
import { CLAY_TOPICS, Clay, Progress, Spinner, type ClayName } from "./ui";

const pulse = stylex.keyframes({
  "0%": { transform: "scale(0.6)", opacity: 0.7 },
  "100%": { transform: "scale(1.8)", opacity: 0 },
});

const s = stylex.create({
  form: { display: "grid", gap: 8 },
  kinds: { display: "flex", flexWrap: "wrap", gap: 6 },
  kind: { height: 34, paddingInline: 14, borderWidth: 0, borderRadius: radius.pill, backgroundColor: color.surface, color: color.textMuted, fontSize: 14, fontWeight: 600, cursor: "pointer" },
  kindOn: { backgroundColor: color.primary, color: color.onPrimary },
  row: { display: "flex", gap: 12, flexDirection: { default: "row", [bp.phone]: "column" } },
  inputWrap: { position: "relative", flexGrow: 1, minWidth: 0 },
  inputIcon: { position: "absolute", left: 22, top: "50%", transform: "translateY(-50%)", color: color.textMuted, pointerEvents: "none" },
  input: {
    width: "100%",
    height: 60,
    paddingInline: "56px 22px",
    borderWidth: 1.5,
    borderStyle: "solid",
    borderColor: { default: "transparent", ":hover": color.borderStrong, ":focus-visible": color.focus },
    borderRadius: radius.pill,
    backgroundColor: color.surface,
    color: color.text,
    fontSize: 17,
    outline: { default: null, ":focus-visible": "none" },
    boxShadow: { default: `0 6px 20px -12px ${color.shadowStrong}`, ":focus-visible": `0 0 0 4px ${color.lilacSoft}` },
  },
  inputSmall: { height: 48, fontSize: 15, borderColor: { default: color.border, ":hover": color.borderStrong, ":focus-visible": color.focus }, boxShadow: { default: "none", ":focus-visible": `0 0 0 4px ${color.lilacSoft}` } },
  submit: { height: 60, paddingInline: 30, fontSize: 17, borderRadius: 22 },
  submitSmall: { height: 48, fontSize: 15 },
  card: {
    position: "relative",
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) 96px",
    gridTemplateRows: "auto 1fr",
    gridTemplateAreas: '"title title" "body art"',
    columnGap: space.md,
    rowGap: space.md,
    minHeight: 208,
    padding: space.xl,
    borderRadius: radius.card,
    transitionProperty: "transform, box-shadow",
    transitionDuration: motion.base,
    transitionTimingFunction: motion.ease,
    transform: { default: null, ":hover": "translateY(-2px)" },
    boxShadow: { default: "none", ":hover": `0 18px 36px -24px ${color.shadowStrong}`, ":focus-within": `0 0 0 3px ${color.focus}` },
  },
  lilac: { backgroundColor: color.lilac },
  pistachio: { backgroundColor: color.pistachio },
  butter: { backgroundColor: color.butter },
  peach: { backgroundColor: color.peach },
  body: { gridArea: "body", display: "flex", flexDirection: "column", gap: space.md, minWidth: 0 },
  title: {
    gridArea: "title",
    overflowWrap: "anywhere",
    hyphens: "auto",
    fontFamily: font.display,
    fontSize: 22,
    fontWeight: 700,
    lineHeight: 1.2,
    letterSpacing: "-0.01em",
    minHeight: "2.4em",
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  },
  titleLink: { color: color.text, textDecoration: "none", outline: "none", "::after": { content: '""', position: "absolute", inset: 0, borderRadius: radius.card } },
  chips: { position: "relative", zIndex: 1, display: "flex", flexWrap: "wrap", alignItems: "flex-start", gap: space.sm, minHeight: 26 },
  bottom: { display: "grid", gap: space.sm, marginTop: "auto" },
  status: { fontSize: 14, lineHeight: 1.4, fontWeight: 500, color: color.text, fontVariantNumeric: "tabular-nums" },
  fillLilac: { backgroundColor: color.onLilac },
  fillPistachio: { backgroundColor: color.onPistachio },
  fillButter: { backgroundColor: color.onButter },
  fillPeach: { backgroundColor: color.onPeach },
  art: { gridArea: "art", alignSelf: "end", justifySelf: "end", pointerEvents: "none" },
  chipOnCard: { backgroundColor: color.surface, color: color.text, paddingInline: space.md, gap: space.sm },
  dot: {
    position: "relative",
    flexShrink: 0,
    width: 8,
    height: 8,
    marginInline: 2,
    borderRadius: "50%",
    backgroundColor: color.accentText,
    "::after": {
      content: '""',
      position: "absolute",
      inset: -3,
      borderRadius: "50%",
      borderWidth: 2,
      borderStyle: "solid",
      borderColor: color.accentText,
      opacity: 0,
      animationName: pulse,
      animationDuration: "1.6s",
      animationIterationCount: "infinite",
    },
  },
});

const TONES = ["lilac", "pistachio", "butter", "peach"] as const;
type Tone = (typeof TONES)[number];
const BG: Record<Tone, stylex.StyleXStyles> = { lilac: s.lilac, pistachio: s.pistachio, butter: s.butter, peach: s.peach };
const FILL: Record<Tone, stylex.StyleXStyles> = { lilac: s.fillLilac, pistachio: s.fillPistachio, butter: s.fillButter, peach: s.fillPeach };

/** Pastel for the n-th card, so neighbours differ. */
export function toneAt(n: number): Tone {
  return TONES[n % TONES.length]!;
}

/** Clay object for a topic card: a keyword match on the title, else a stable hash of it. */
export function topicObject(title: string): ClayName {
  const rules = Object.values(CONTENT_RULES);
  const art = TOPIC_ART.find((a) => rules.some((r) => r.topicArt[a]?.test(title)));
  if (art) return `topic-${art}`;
  let h = 0;
  for (const ch of title) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return CLAY_TOPICS[h % CLAY_TOPICS.length]!;
}

/** A new `focusKey` moves focus to the input. */
export function NewTopicForm({ big, focusKey }: { big?: boolean; focusKey?: string }) {
  useLang();
  const [kind, setKind] = useState<TopicSummary["kind"]>("topic");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (focusKey) input.current?.focus();
  }, [focusKey]);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!value.trim()) return;
        setBusy(true);
        setError(null);
        try {
          const res = await api.createTopic(value.trim(), kind);
          navigate(`/topics/${res.topicId}?c=${encodeURIComponent(res.conversationId)}`);
        } catch (err) {
          setError(errorText(err));
          setBusy(false);
        }
      }}
      {...stylex.props(s.form)}
    >
      <div role="group" aria-label={t("topics.kindLabel")} {...stylex.props(s.kinds)}>
        {(["topic", "goal"] as const).map((k) => (
          <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)} {...stylex.props(s.kind, kind === k && s.kindOn)}>
            {t(k === "goal" ? "topics.kind.goal" : "topics.kind.topic")}
          </button>
        ))}
      </div>
      <label htmlFor={id} {...stylex.props(layout.srOnly)}>
        {t(kind === "goal" ? "topics.goalPrompt" : "topics.prompt")}
      </label>
      <div {...stylex.props(s.row)}>
        <div {...stylex.props(s.inputWrap)}>
          <Search size={20} aria-hidden="true" {...stylex.props(s.inputIcon)} />
          <input
            ref={input}
            id={id}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={t(kind === "goal" ? "topics.goalPlaceholder" : "topics.placeholder")}
            autoComplete="off"
            {...stylex.props(s.input, !big && s.inputSmall)}
          />
        </div>
        <button type="submit" disabled={!value.trim() || busy} {...stylex.props(btn.base, btn.primary, s.submit, !big && s.submitSmall)}>
          {busy ? <Spinner /> : <Sparkles size={19} aria-hidden="true" />} {t(kind === "goal" ? "topics.createGoal" : "topics.create")}
        </button>
      </div>
      {error && (
        <p role="alert" {...stylex.props(text.error)}>
          {error}
        </p>
      )}
    </form>
  );
}

export function TopicCard({ topic, tone }: { topic: TopicSummary; tone: Tone }) {
  useLang();
  return (
    <li {...stylex.props(s.card, BG[tone])}>
      <h3 {...stylex.props(s.title)}>
        <Link to={`/topics/${topic.id}`} {...stylex.props(s.titleLink)}>
          {topic.title}
        </Link>
      </h3>
      <div {...stylex.props(s.body)}>
        <div {...stylex.props(s.chips)}>
          {topic.kind === "goal" && (
            <span {...stylex.props(chip.base, s.chipOnCard)}>
              <Flag size={13} aria-hidden="true" /> {t("topics.kind.goal")}
            </span>
          )}
          {topic.running && (
            <span {...stylex.props(chip.base, s.chipOnCard)}>
              <span aria-hidden="true" {...stylex.props(s.dot)} /> {t("topics.working")}
            </span>
          )}
          {topic.dueCards > 0 && (
            <span {...stylex.props(chip.base, s.chipOnCard)}>
              <Repeat2 size={13} aria-hidden="true" /> {t("count.cards", { count: topic.dueCards })}
            </span>
          )}
        </div>
        {topic.plan ? (
          <div {...stylex.props(s.bottom)}>
            <p {...stylex.props(s.status)}>
              {topic.plan.total ? t("topics.planOpened", { opened: topic.plan.opened, count: topic.plan.total }) : t("topics.planBuilding")}
            </p>
            <Progress value={topic.plan.opened} max={topic.plan.total} label={t("topics.planOpened", { opened: topic.plan.opened, count: topic.plan.total })} onCard fill={FILL[tone]} />
          </div>
        ) : (
          <div {...stylex.props(s.bottom)}>
            <p {...stylex.props(s.status)}>
              {topic.nodesTotal ? t("topics.masteredOf", { mastered: topic.nodesMastered, count: topic.nodesTotal }) : t("topics.mapBuilding")}
            </p>
            <Progress value={topic.nodesMastered} max={topic.nodesTotal} label={t("topics.masteredLabel", { mastered: topic.nodesMastered, total: topic.nodesTotal })} onCard fill={FILL[tone]} />
          </div>
        )}
      </div>
      <Clay name={topicObject(topic.title)} size={96} xstyle={s.art} />
    </li>
  );
}

export function MoreLink({ to, children }: { to: string; children: string }) {
  return (
    <Link to={to} {...stylex.props(text.link)}>
      {children} <ArrowRight size={15} aria-hidden="true" />
    </Link>
  );
}
