/**
 * Keyboard shortcuts as actions. Letters and digits match `event.code`, the physical key, so they work
 * in any keyboard layout; the `?` key matches its character too, as layouts place it on different keys.
 */
type Named = "submit" | "reveal" | "hint" | "giveUp" | "tutor" | "note" | "narration" | "nextStep" | "prevStep" | "escape" | "help";

export type Action = { name: "choose"; n: number } | { name: Named };

export type KeyInput = Pick<
  KeyboardEvent,
  "key" | "code" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey" | "repeat" | "isComposing" | "keyCode" | "defaultPrevented" | "target"
>;

const LETTERS: Record<string, Named> = {
  KeyH: "hint",
  KeyG: "giveUp",
  KeyT: "tutor",
  KeyN: "note",
  KeyL: "narration",
  KeyJ: "nextStep",
  KeyK: "prevStep",
};

const NON_TEXT_INPUTS = new Set(["checkbox", "radio", "button", "submit", "reset", "image", "range", "color", "file"]);

/** A field where keys type text or pick a value, so single-key shortcuts stay off. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== "string") return false;
  if (el.tagName === "TEXTAREA" || el.tagName === "SELECT") return true;
  if (el.tagName === "INPUT") return !NON_TEXT_INPUTS.has((el as HTMLInputElement).type);
  return el.isContentEditable === true || el.closest('[contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]') !== null;
}

/** An element whose own behaviour for Enter or Space (click, toggle, play) the shortcut must not replace. */
function hasNativeKey(target: EventTarget | null, key: "Enter" | "Space"): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.matches !== "function") return false;
  if (el.tagName === "INPUT") {
    const type = (el as HTMLInputElement).type;
    return type === "checkbox" || type === "radio" ? key === "Space" : NON_TEXT_INPUTS.has(type);
  }
  return el.matches('button, a[href], summary, audio, video, [role="button"], [role="link"], [role="tab"], [role="checkbox"], [role="radio"], [role="switch"], [role="option"], [role="menuitem"]');
}

const inDialog = (target: EventTarget | null): boolean => {
  const el = target as HTMLElement | null;
  return typeof el?.closest === "function" && el.closest('dialog, [role="dialog"]') !== null;
};

/** The action a key press asks for, or null when the press belongs to a text field, a dialog or the browser. */
export function keyAction(e: KeyInput): Action | null {
  if (e.defaultPrevented || e.isComposing || e.keyCode === 229 || inDialog(e.target)) return null;
  if (e.ctrlKey || e.metaKey) return null;
  if (e.key === "Escape") return e.altKey || e.shiftKey ? null : { name: "escape" };
  if (e.repeat || isTypingTarget(e.target)) return null;
  if (e.altKey) {
    if (e.shiftKey) return null;
    return e.key === "ArrowDown" ? { name: "nextStep" } : e.key === "ArrowUp" ? { name: "prevStep" } : null;
  }
  if (e.key === "?" || (e.shiftKey && e.code === "Slash")) return { name: "help" };
  if (e.shiftKey) return null;
  const digit = /^Digit([1-9])$/.exec(e.code) ?? (/^Numpad[1-9]$/.test(e.code) ? /^([1-9])$/.exec(e.key) : null);
  if (digit) return { name: "choose", n: Number(digit[1]) };
  if (e.key === "Enter") return hasNativeKey(e.target, "Enter") ? null : { name: "submit" };
  if (e.code === "Space") return hasNativeKey(e.target, "Space") ? null : { name: "reveal" };
  const letter = LETTERS[e.code];
  return letter ? { name: letter } : null;
}
