import * as stylex from "@stylexjs/stylex";
import { Headphones } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import type { NarrationSegment } from "@shared/api";
import { api, ApiFailure, errorText } from "../lib/api";
import { t, useLang } from "../lib/i18n";
import { useShortcuts } from "../lib/shortcuts";
import { btn, layout, text } from "../theme/ui";
import { Markdown, Spinner } from "./ui";

const s = stylex.create({
  player: { width: "100%", maxWidth: 520, height: 40 },
});

type State =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; audio: Blob; segments: NarrationSegment[] }
  | { status: "error"; message: string; needsSettings: boolean };

/** Explanation body with a Listen button; while the audio plays, the block being read is highlighted. */
export function NarratedBody({ stepId, body, active, xstyle }: { stepId: string; body: string; active: boolean; xstyle?: stylex.StyleXStyles }) {
  useLang();
  const [state, setState] = useState<State>({ status: "idle" });
  const bodyRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const audio = state.status === "ready" ? state.audio : null;

  // The audio is loaded as a blob so seeking works without HTTP range requests.
  const listen = async () => {
    setState({ status: "loading" });
    try {
      const view = await api.narrate(stepId);
      const res = await fetch(view.audioUrl);
      if (!res.ok) throw new ApiFailure(t("error.server", { status: res.status }), res.status);
      setState({ status: "ready", audio: await res.blob(), segments: view.segments });
    } catch (err) {
      setState({ status: "error", message: errorText(err), needsSettings: err instanceof ApiFailure && err.status === 409 });
    }
  };

  const mark = (block: number | null) => {
    const blocks = bodyRef.current?.firstElementChild?.children ?? [];
    for (let i = 0; i < blocks.length; i++) blocks[i]!.toggleAttribute("data-narrating", i === block);
  };

  useEffect(() => {
    const player = audioRef.current;
    if (!audio || !player) return;
    const url = URL.createObjectURL(audio);
    player.src = url;
    void player.play().catch(() => {});
    return () => {
      player.pause();
      player.removeAttribute("src");
      URL.revokeObjectURL(url);
      mark(null);
    };
  }, [audio]);

  useShortcuts(
    "step",
    (a) => {
      if (a.name !== "narration") return false;
      const player = audioRef.current;
      if (state.status === "ready" && player) {
        if (player.paused) void player.play().catch(() => {});
        else player.pause();
      } else if (state.status !== "loading") void listen();
      return true;
    },
    active,
  );

  const onTime = (time: number) => {
    if (state.status !== "ready") return;
    mark(state.segments.find((seg) => time >= seg.start && time < seg.end)?.block ?? null);
  };

  return (
    <>
      <div {...stylex.props(layout.stack)}>
        {state.status === "ready" ? (
          <audio
            ref={audioRef}
            controls
            aria-label={t("narration.player")}
            onTimeUpdate={(e) => onTime(e.currentTarget.currentTime)}
            onSeeked={(e) => onTime(e.currentTarget.currentTime)}
            onEnded={() => mark(null)}
            {...stylex.props(s.player)}
          />
        ) : (
          <div {...stylex.props(layout.row)}>
            <button type="button" disabled={state.status === "loading"} onClick={() => void listen()} {...stylex.props(btn.base, btn.soft, btn.sm)}>
              {state.status === "loading" ? <Spinner /> : <Headphones size={16} aria-hidden="true" />} {t("narration.listen")}
            </button>
            {state.status === "loading" && (
              <p role="status" {...stylex.props(text.muted, text.small)}>
                {t("narration.preparing")}
              </p>
            )}
          </div>
        )}
        {state.status === "error" && (
          <p role="alert" {...stylex.props(text.error)}>
            {state.message}
            {state.needsSettings && (
              <Link to="/settings" {...stylex.props(text.link)}>
                {t("narration.openSettings")}
              </Link>
            )}
          </p>
        )}
      </div>
      <div ref={bodyRef}>
        <Markdown src={body} xstyle={xstyle} />
      </div>
    </>
  );
}
