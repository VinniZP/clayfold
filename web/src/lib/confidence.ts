import { useSyncExternalStore } from "react";
import { api } from "./api";

let enabled = true;
const listeners = new Set<() => void>();

function subscribe(notify: () => void) {
  listeners.add(notify);
  return () => listeners.delete(notify);
}

/** Applies the confidence-rating setting (Settings.confidence) to every mounted answer form. */
export function setConfidenceEnabled(next: boolean): void {
  enabled = next;
  for (const l of listeners) l();
}

/** Loads the setting before the first render; an unreachable server leaves ratings on. */
export async function initConfidence(): Promise<void> {
  const settings = await api.settings().catch(() => null);
  if (settings) setConfidenceEnabled(settings.confidence.enabled);
}

/** Whether graded answers ask how sure the learner is before checking (L23). */
export function useConfidenceEnabled(): boolean {
  return useSyncExternalStore(subscribe, () => enabled);
}
