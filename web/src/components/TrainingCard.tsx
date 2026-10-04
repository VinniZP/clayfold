import * as stylex from "@stylexjs/stylex";
import { Dumbbell } from "lucide-react";
import type { LessonSummary } from "@shared/api";
import { t, useLang } from "../lib/i18n";
import { color } from "../theme/tokens.stylex";
import { card, layout, text } from "../theme/ui";
import { LessonList } from "./LessonList";
import { PracticeButton } from "./Practice";
import { PracticeTestCard } from "./PracticeTestCard";
import { CardHead } from "./ui";

const s = stylex.create({
  card: { display: "grid", gap: 20 },
  divider: { height: 1, backgroundColor: color.border },
  start: { justifySelf: "start" },
});

/** A course's practice beyond its lessons: practice tests from their items, and new questions Claude writes. */
export function TrainingCard({ topicId, sets }: { topicId: string; sets: LessonSummary[] }) {
  useLang();
  return (
    <section aria-labelledby={`training-${topicId}`} {...stylex.props(card.base, s.card)}>
      <CardHead title={t("training.title")} id={`training-${topicId}`}>
        <Dumbbell size={20} aria-hidden="true" />
      </CardHead>
      <PracticeTestCard scopeId={topicId} section />
      <div aria-hidden="true" {...stylex.props(s.divider)} />
      <section aria-labelledby={`training-new-${topicId}`} {...stylex.props(layout.stack)}>
        <h3 id={`training-new-${topicId}`} {...stylex.props(text.h3)}>
          {t("training.newTitle")}
        </h3>
        <p {...stylex.props(text.small, text.muted)}>{t("practiceSet.courseOffer")}</p>
        <PracticeButton from={{ courseId: topicId }} label={t("practiceSet.course")} small xstyle={s.start} />
        {sets.length > 0 && <LessonList lessons={sets} />}
      </section>
    </section>
  );
}
