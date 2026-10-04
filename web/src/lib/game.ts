import { useEffect, useSyncExternalStore } from "react";
import type { CrownsView, GameView } from "@shared/api";
import { api } from "./api";

// The meerkat's state for the whole app. While gamification is off nothing here calls the server.

export type GameState = { on: boolean; view: GameView | null; crowns: CrownsView | null };

let state: GameState = { on: false, view: null, crowns: null };
const listeners = new Set<() => void>();

function set(next: Partial<GameState>) {
  state = { ...state, ...next };
  for (const l of listeners) l();
}

function subscribe(notify: () => void) {
  listeners.add(notify);
  return () => listeners.delete(notify);
}

export function useGame(): GameState {
  return useSyncExternalStore(subscribe, () => state);
}

let pending: ReturnType<typeof setTimeout> | null = null;

/** Fetches the view and the crowns; calls within 400 ms collapse into one. */
export function refreshGame(): void {
  if (!state.on) return;
  if (pending) clearTimeout(pending);
  pending = setTimeout(() => {
    pending = null;
    void Promise.all([api.game(), api.gameCrowns()]).then(
      ([view, crowns]) => state.on && set({ view, crowns }),
      () => {},
    );
  }, 400);
}

/** Reads the setting before the first render; an unreachable server leaves the meerkat off. */
export async function initGame(): Promise<void> {
  try {
    setGameOn((await api.settings()).gamification);
  } catch {
    setGameOn(false);
  }
}

export function setGameOn(on: boolean): void {
  set(on ? { on } : { on, view: null, crowns: null });
  refreshGame();
}

export const setGameView = (view: GameView) => set({ view });

/** Something the learner did that the companion reacts to. */
export type GameEvent = { kind: "answer"; correct: boolean } | { kind: "progress" };

const eventListeners = new Set<(e: GameEvent) => void>();

/** Reports a learning action: the companion reacts, and rewards it may have unlocked are fetched. */
export function gameProgress(event: GameEvent): void {
  if (!state.on) return;
  for (const l of eventListeners) l(event);
  refreshGame();
}

export function useGameEvents(onEvent: (e: GameEvent) => void): void {
  useEffect(() => {
    eventListeners.add(onEvent);
    return () => {
      eventListeners.delete(onEvent);
    };
  }, [onEvent]);
}

let celebrationHold = 0;
const holdListeners = new Set<() => void>();

/**
 * Unlock celebrations wait while the learner works through a lesson; the lesson page holds them and
 * lets go at its end.
 */
export function useCelebrationHold(hold: boolean): void {
  useEffect(() => {
    if (!hold) return;
    celebrationHold++;
    for (const l of holdListeners) l();
    return () => {
      celebrationHold--;
      for (const l of holdListeners) l();
    };
  }, [hold]);
}

export function useCelebrationsHeld(): boolean {
  return useSyncExternalStore(
    (notify) => {
      holdListeners.add(notify);
      return () => holdListeners.delete(notify);
    },
    () => celebrationHold > 0,
  );
}
