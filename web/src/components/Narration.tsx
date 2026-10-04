import * as stylex from "@stylexjs/stylex";
import { Headphones } from "lucide-react";
import { createContext, useContext } from "react";
import { t, useLang } from "../lib/i18n";
import { useShortcuts } from "../lib/shortcuts";
import { btn, layout } from "../theme/ui";
import { Markdown } from "./ui";

/** The lesson player of the page: whether it is open, and how to start it on the step on screen. */
export const LessonAudio = createContext<{ open: boolean; start: () => void } | null>(null);

/** Element whose rendered blocks the lesson player highlights while it reads the step. */
export const narrationBodyId = (stepId: string) => `narration-${stepId}`;

/** Explanation body with a Listen button that opens the lesson player on this step. */
export function NarratedBody({ stepId, body, active, xstyle }: { stepId: string; body: string; active: boolean; xstyle?: stylex.StyleXStyles }) {
  useLang();
  const audio = useContext(LessonAudio);
  useShortcuts(
    "step",
    (a) => {
      if (a.name !== "narration" || !audio || audio.open) return false;
      audio.start();
      return true;
    },
    active,
  );
  return (
    <>
      {audio && !audio.open && (
        <div {...stylex.props(layout.row)}>
          <button type="button" onClick={audio.start} {...stylex.props(btn.base, btn.soft, btn.sm)}>
            <Headphones size={16} aria-hidden="true" /> {t("narration.listen")}
          </button>
        </div>
      )}
      <div id={narrationBodyId(stepId)}>
        <Markdown src={body} xstyle={xstyle} />
      </div>
    </>
  );
}
