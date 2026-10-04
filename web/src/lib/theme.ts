import { useSyncExternalStore } from "react";

export type Theme = "light" | "dark";
const KEY = "clayfold-theme";
const listeners = new Set<() => void>();
let printing = false;

function read(): Theme {
  return !printing && document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

/** While printing, everything that follows the theme uses the light palette; the stored choice stays. */
export function setPrinting(on: boolean) {
  if (printing === on) return;
  printing = on;
  for (const l of listeners) l();
}

export function setTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // Storage may be unavailable (private mode); the choice then lasts for this page only.
  }
  for (const l of listeners) l();
}

// Follow the OS setting until the learner picks a theme explicitly.
const media = window.matchMedia("(prefers-color-scheme: dark)");
media.addEventListener("change", (e) => {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(KEY);
  } catch {
    stored = null;
  }
  if (stored) return;
  document.documentElement.dataset.theme = e.matches ? "dark" : "light";
  for (const l of listeners) l();
});

export function useTheme(): Theme {
  return useSyncExternalStore(
    (notify) => {
      listeners.add(notify);
      return () => listeners.delete(notify);
    },
    read,
  );
}
