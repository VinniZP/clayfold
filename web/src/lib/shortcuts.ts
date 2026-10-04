import { useEffect, useRef, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { api } from "./api";
import { isTypingTarget, keyAction, type Action } from "./keys";

/**
 * One keydown listener for the whole app. Handlers register by level and are asked in the order
 * item, step, page; the first that returns true takes the key. A component's own key handling
 * that calls preventDefault keeps the key from reaching them.
 */
export type Level = "item" | "step" | "page";
type Handler = (action: Action, e: KeyboardEvent) => boolean;

const handlers: Record<Level, Set<{ current: Handler }>> = { item: new Set(), step: new Set(), page: new Set() };
const LEVELS: Level[] = ["item", "step", "page"];
let listening = false;

function onKeyDown(e: KeyboardEvent) {
  const action = keyAction(e);
  if (!action) return;
  for (const level of LEVELS) {
    for (const h of handlers[level]) {
      if (h.current(action, e)) {
        e.preventDefault();
        return;
      }
    }
  }
  if (action.name === "escape" && isTypingTarget(e.target)) (e.target as HTMLElement).blur();
}

/** Registers `handler` while `enabled`; it always sees the latest props and state. */
export function useShortcuts(level: Level, handler: Handler, enabled = true) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!enabled) return;
    if (!listening) {
      window.addEventListener("keydown", onKeyDown);
      listening = true;
    }
    const entry = { current: (a: Action, e: KeyboardEvent) => ref.current(a, e) };
    handlers[level].add(entry);
    return () => {
      handlers[level].delete(entry);
    };
  }, [level, enabled]);
}

/**
 * Whether shortcuts of `scope` act on `el`: of the visible elements marked with that
 * `data-shortcut-scope`, the one holding focus, else the first.
 */
export function isCurrent(el: Element | null, scope: "item" | "step"): boolean {
  if (!el) return false;
  const all = [...document.querySelectorAll(`[data-shortcut-scope="${scope}"]`)].filter((x) => !x.closest("[hidden]"));
  return (all.find((x) => x.contains(document.activeElement)) ?? all[0]) === el;
}

/** Pages whose shortcuts the shortcut sheet lists besides the global ones. */
export type ShortcutPage = "lesson" | "review";
let page: ShortcutPage | null = null;

export const shortcutPage = (): ShortcutPage | null => page;

export function useShortcutPage(p: ShortcutPage) {
  useEffect(() => {
    page = p;
    return () => {
      if (page === p) page = null;
    };
  }, [p]);
}

let hints = true;
let hintsLoaded = false;
const hintListeners = new Set<() => void>();

export function setKeyHints(on: boolean) {
  hints = on;
  for (const l of hintListeners) l();
}

/** The `shortcuts.hints` setting, loaded on first use. */
export function useKeyHints(): boolean {
  return useSyncExternalStore((notify) => {
    hintListeners.add(notify);
    if (!hintsLoaded) {
      hintsLoaded = true;
      api.settings().then(
        (s) => setKeyHints(s.shortcuts.hints),
        () => {},
      );
    }
    return () => hintListeners.delete(notify);
  }, () => hints);
}

/** Ctrl/Cmd+Enter in a form's text box submits the form, unless its submit button is disabled. */
export function submitOnModEnter(e: ReactKeyboardEvent<HTMLFormElement>) {
  if (e.key !== "Enter" || !(e.ctrlKey || e.metaKey) || e.nativeEvent.isComposing) return;
  e.preventDefault();
  const submitter = e.currentTarget.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (submitter && !submitter.disabled) e.currentTarget.requestSubmit(submitter);
}
