import { useSyncExternalStore } from "react";

// Reading preferences of this browser. They live on <html> as data-reading-* attributes, which
// styles/global.css turns into the --reading-* custom properties; index.html sets them before first paint.

export const READING_OPTIONS = {
  size: ["s", "m", "l", "xl", "xxl"],
  leading: ["comfortable", "relaxed", "airy"],
  measure: ["narrow", "normal", "wide"],
  font: ["standard", "legible", "serif"],
  motion: ["system", "reduce"],
} as const;

export type Reading = { -readonly [K in keyof typeof READING_OPTIONS]: (typeof READING_OPTIONS)[K][number] };

export const READING_DEFAULTS: Reading = { size: "m", leading: "comfortable", measure: "normal", font: "standard", motion: "system" };

const KEYS = Object.keys(READING_OPTIONS) as (keyof Reading)[];
const KEY = "clayfold-reading";

/** Stored preferences; a missing or unknown value falls back to its default. */
export function parseReading(raw: string | null): Reading {
  let stored: unknown = null;
  try {
    stored = JSON.parse(raw ?? "null");
  } catch {
    stored = null;
  }
  const record = stored !== null && typeof stored === "object" ? (stored as Record<string, unknown>) : {};
  const pick = <K extends keyof Reading>(key: K): Reading[K] => {
    const value = record[key];
    return (READING_OPTIONS[key] as readonly unknown[]).includes(value) ? (value as Reading[K]) : READING_DEFAULTS[key];
  };
  return { size: pick("size"), leading: pick("leading"), measure: pick("measure"), font: pick("font"), motion: pick("motion") };
}

function readStored(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

let current = parseReading(readStored());
const listeners = new Set<() => void>();

export function setReading(change: Partial<Reading>) {
  current = { ...current, ...change };
  const data = document.documentElement.dataset;
  for (const key of KEYS) data[`reading${key[0]!.toUpperCase()}${key.slice(1)}`] = current[key];
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // Storage may be unavailable (private mode); the choice then lasts for this page only.
  }
  for (const l of listeners) l();
}

export function useReading(): Reading {
  return useSyncExternalStore(
    (notify) => {
      listeners.add(notify);
      return () => listeners.delete(notify);
    },
    () => current,
  );
}

const reduceQuery = "(prefers-reduced-motion: reduce)";

/** For motion started from script, which the reduced-motion rules in global.css cannot stop. */
export function prefersReducedMotion(): boolean {
  return current.motion === "reduce" || window.matchMedia(reduceQuery).matches;
}

export function useSystemReducedMotion(): boolean {
  return useSyncExternalStore(
    (notify) => {
      const m = window.matchMedia(reduceQuery);
      m.addEventListener("change", notify);
      return () => m.removeEventListener("change", notify);
    },
    () => window.matchMedia(reduceQuery).matches,
  );
}

/** The bundled fonts, whose @font-face rules main.tsx imports; the standard font is the app's own. */
const BUNDLED: Partial<Record<Reading["font"], string>> = { legible: "Andika", serif: "Literata Variable" };

/** Loads the chosen bundled font before the first render, so lesson text does not swap fonts once shown. */
export async function loadReadingFont(): Promise<void> {
  const family = BUNDLED[current.font];
  if (!family) return;
  // Latin and Cyrillic sample letters, so both subsets load.
  const sample = "AЯ";
  await Promise.all(["400", "700"].map((weight) => document.fonts.load(`${weight} 1em "${family}"`, sample))).catch(() => undefined);
}
