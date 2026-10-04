import type { ItemState, LessonView, NarrationSegment } from "@shared/api";

/** One position of the lesson outline as the lesson player sees it; `checks` are the item ids of a published explain step. */
export type Track = { kind: string; state: LessonView["stepStatus"][number]; checks: string[] };

/**
 * What the player does when an explanation's narration ends.
 * checks:  the step's retrieval checks are still open; the learner answers them first (L4, L7).
 * advance: the next step is an explanation; it plays next.
 * wait:    other steps come first, or the next explanation is still being written; it plays when the learner reaches it.
 * end:     no explanation follows.
 */
export type AfterNarration = { type: "checks" } | { type: "advance"; pos: number } | { type: "wait"; pos: number } | { type: "end" };

export const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2] as const;

/** Solved, given up, or answered and waiting for grading; a wrong answer still open for a retry is not settled. */
export function itemSettled(state: ItemState | undefined): boolean {
  if (!state) return false;
  return state.solved || state.gaveUp || (state.attempts > 0 && state.wrongAttempts === 0);
}

export function afterNarration(tracks: Track[], pos: number, settled: Readonly<Record<string, boolean>>): AfterNarration {
  if (tracks[pos]?.checks.some((id) => !settled[id])) return { type: "checks" };
  const next = upcoming(tracks, pos);
  if (next < 0) return { type: "end" };
  const adjacent = tracks.slice(pos + 1, next).every((track) => track.state === "dropped");
  return adjacent && tracks[next]!.state === "published" ? { type: "advance", pos: next } : { type: "wait", pos: next };
}

/** The next explanation after `pos` that is not dropped (published or still being written), or -1. */
export function upcoming(tracks: Track[], pos: number): number {
  return tracks.findIndex((track, i) => i > pos && track.kind === "explain" && track.state !== "dropped");
}

/** The nearest published explanation after (`dir` 1) or before (`dir` -1) `pos`, or -1. */
export function explainNear(tracks: Track[], pos: number, dir: 1 | -1): number {
  for (let i = pos + dir; i >= 0 && i < tracks.length; i += dir) {
    if (tracks[i]!.kind === "explain" && tracks[i]!.state === "published") return i;
  }
  return -1;
}

export function blockAt(segments: NarrationSegment[], time: number): number | null {
  return segments.find((seg) => time >= seg.start && time < seg.end)?.block ?? null;
}
