import { useSyncExternalStore } from "react";

const KEY = "clayfold-claude-mode";
const listeners = new Set<() => void>();

function readStored(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

let on = readStored();

export function setClaudeMode(value: boolean) {
  on = value;
  try {
    if (value) localStorage.setItem(KEY, "1");
    else localStorage.removeItem(KEY);
  } catch {
    // Storage may be unavailable (private mode); the choice then lasts for this page only.
  }
  for (const l of listeners) l();
}

/** Claude Code mode: a panel with server statistics and running Claude processes, kept across pages. */
export function useClaudeMode(): boolean {
  return useSyncExternalStore(
    (notify) => {
      listeners.add(notify);
      return () => listeners.delete(notify);
    },
    () => on,
  );
}
