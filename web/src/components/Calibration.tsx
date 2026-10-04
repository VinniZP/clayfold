import * as stylex from "@stylexjs/stylex";
import type { CalibrationLevel, CalibrationView, Confidence } from "@shared/api";
import { useConfidenceEnabled } from "../lib/confidence";
import { t, useLang } from "../lib/i18n";
import { color } from "../theme/tokens.stylex";
import { ShareBars, type ShareRow } from "./Charts";
import { Empty } from "./ui";

/** Rated answers a level needs before its share is read as a pattern. */
const MIN_RATED = 5;
const TOPICS_SHOWN = 5;

const s = stylex.create({
  body: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 300px), 1fr))", gap: 28, alignItems: "start" },
  overall: { display: "grid", gap: 16 },
  takeaway: { fontSize: 16, fontWeight: 600, maxWidth: "48ch", textWrap: "pretty" },
  topics: { display: "grid", gap: 18, margin: 0, padding: 0, listStyle: "none" },
  topic: { display: "grid", gap: 8 },
  topicTitle: { fontSize: 14, fontWeight: 650, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  legend: { gridColumn: "1 / -1", fontSize: 12.5, color: color.textMuted },
  heading: { marginBottom: 10, fontSize: 12.5, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: color.textMuted },
});

const pct = (l: CalibrationLevel) => Math.round((l.correct / l.attempts) * 100);

function rows(levels: CalibrationLevel[]): ShareRow[] {
  return levels.map((l) => ({
    label: t(`confidence.${l.confidence}`),
    share: l.attempts ? l.correct / l.attempts : null,
    detail: l.attempts ? `${t("calibration.ofAnswers", { count: l.attempts })}${l.attempts < MIN_RATED ? ` · ${t("calibration.few")}` : ""}` : t("calibration.noAnswers"),
    few: l.attempts < MIN_RATED,
  }));
}

/** One sentence on the two most telling levels with enough answers. */
function takeaway(levels: CalibrationLevel[]): string {
  const at = (c: Confidence) => levels.find((l) => l.confidence === c && l.attempts >= MIN_RATED);
  const sure = at("sure");
  const unsure = at("unsure");
  const guess = at("guess");
  if (sure && guess) return t("calibration.sureGuess", { sure: pct(sure), guess: pct(guess) });
  if (sure && unsure) return t("calibration.sureUnsure", { sure: pct(sure), unsure: pct(unsure) });
  if (unsure && guess) return t("calibration.unsureGuess", { unsure: pct(unsure), guess: pct(guess) });
  if (sure) return t("calibration.onlySure", { pct: pct(sure) });
  if (unsure) return t("calibration.onlyUnsure", { pct: pct(unsure) });
  if (guess) return t("calibration.onlyGuess", { pct: pct(guess) });
  return t("calibration.lowData");
}

/** How often the learner is right at each confidence level (L23), overall and per course. */
export function Calibration({ view }: { view: CalibrationView }) {
  useLang();
  const enabled = useConfidenceEnabled();
  if (view.overall.every((l) => l.attempts === 0)) {
    return <Empty title={t("calibration.emptyTitle")}>{t(enabled ? "calibration.emptyBody" : "calibration.emptyOff")}</Empty>;
  }
  const topics = view.topics.length > 1 ? view.topics.slice(0, TOPICS_SHOWN) : [];
  const anyFew = [view.overall, ...topics.map((topic) => topic.levels)].some((levels) => levels.some((l) => l.attempts > 0 && l.attempts < MIN_RATED));
  return (
    <div {...stylex.props(s.body)}>
      <div {...stylex.props(s.overall)}>
        <p {...stylex.props(s.takeaway)}>{takeaway(view.overall)}</p>
        <ShareBars rows={rows(view.overall)} label={t("calibration.allCourses")} />
      </div>
      {topics.length > 0 && (
        <section aria-labelledby="calibration-topics">
          <h3 id="calibration-topics" {...stylex.props(s.heading)}>
            {t("calibration.byTopic")}
          </h3>
          <ul {...stylex.props(s.topics)}>
            {topics.map((topic) => (
              <li key={topic.topicId} {...stylex.props(s.topic)}>
                <p title={topic.title} {...stylex.props(s.topicTitle)}>
                  {topic.title}
                </p>
                <ShareBars rows={rows(topic.levels)} label={topic.title} dense />
              </li>
            ))}
          </ul>
        </section>
      )}
      {anyFew && <p {...stylex.props(s.legend)}>{t("calibration.fewLegend", { n: MIN_RATED })}</p>}
    </div>
  );
}
