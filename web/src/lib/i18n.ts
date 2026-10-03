import { DEFAULT_LANG, isLang, translate, type Lang, type MessageKey, type Params } from "@shared/i18n";
import { useSyncExternalStore } from "react";
import { api } from "./api";

const KEY = "clayfold-lang";

function stored(): Lang | null {
  try {
    const value = localStorage.getItem(KEY);
    return isLang(value) ? value : null;
  } catch {
    return null;
  }
}

let current: Lang = stored() ?? DEFAULT_LANG;

export const lang = (): Lang => current;

export const t = (key: MessageKey, params?: Params): string => translate(current, key, params);

const listeners = new Set<() => void>();

function subscribe(notify: () => void) {
  listeners.add(notify);
  return () => listeners.delete(notify);
}

/**
 * The current language, re-rendering the caller when it changes. Every component that renders
 * translated text calls it, directly or through a helper such as `formatDate`, so a switch updates
 * the text in place.
 */
export function useLang(): Lang {
  return useSyncExternalStore(subscribe, lang);
}

function apply(next: Lang) {
  current = next;
  document.documentElement.lang = next;
  for (const l of listeners) l();
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // Storage may be unavailable (private mode); the server setting still holds the choice.
  }
}

/** Loads the language from the server before the first render; the stored copy covers an unreachable server. */
export async function initLang(): Promise<void> {
  try {
    apply((await api.settings()).language);
  } catch {
    apply(current);
  }
}

/** Saves the language on the server, then re-renders the subscribed components in it. */
export async function setLang(next: Lang): Promise<void> {
  await api.setSettings({ language: next });
  apply(next);
}
