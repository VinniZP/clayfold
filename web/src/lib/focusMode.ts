import { useSyncExternalStore } from "react";

const KEY = "clayfold-focus";
const listeners = new Set<() => void>();

function readStored(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

let on = readStored();

export function setFocusMode(value: boolean) {
  on = value;
  try {
    if (value) localStorage.setItem(KEY, "1");
    else localStorage.removeItem(KEY);
  } catch {
    // Storage may be unavailable (private mode); the choice then lasts for this page only.
  }
  for (const l of listeners) l();
}

/** Lesson focus mode: the current step alone, without the app and lesson chrome, kept across lessons and visits. */
export function useFocusMode(): boolean {
  return useSyncExternalStore(
    (notify) => {
      listeners.add(notify);
      return () => listeners.delete(notify);
    },
    () => on,
  );
}
