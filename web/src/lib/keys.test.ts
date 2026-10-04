import { describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { isTypingTarget, keyAction, type KeyInput } from "./keys";

const doc = new Window().document;

function el(html: string): HTMLElement {
  const host = doc.createElement("div");
  host.innerHTML = html;
  doc.body.appendChild(host);
  return host.querySelector("[data-t]") as unknown as HTMLElement;
}

const press = (init: Partial<KeyInput>): KeyInput => ({
  key: "",
  code: "",
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  repeat: false,
  isComposing: false,
  keyCode: 0,
  defaultPrevented: false,
  target: doc.body as unknown as EventTarget,
  ...init,
});

describe("keyAction", () => {
  test("digits choose by physical key, numpad digits only with Num Lock on", () => {
    expect(keyAction(press({ code: "Digit3", key: "3" }))).toEqual({ name: "choose", n: 3 });
    expect(keyAction(press({ code: "Digit1", key: "&" }))).toEqual({ name: "choose", n: 1 });
    expect(keyAction(press({ code: "Numpad5", key: "5" }))).toEqual({ name: "choose", n: 5 });
    expect(keyAction(press({ code: "Numpad5", key: "Clear" }))).toBeNull();
    expect(keyAction(press({ code: "Digit0", key: "0" }))).toBeNull();
  });

  test("letters match the physical key, so a Russian layout works", () => {
    expect(keyAction(press({ code: "KeyH", key: "р" }))).toEqual({ name: "hint" });
    expect(keyAction(press({ code: "KeyG", key: "п" }))).toEqual({ name: "giveUp" });
    expect(keyAction(press({ code: "KeyT", key: "е" }))).toEqual({ name: "tutor" });
    expect(keyAction(press({ code: "KeyN", key: "т" }))).toEqual({ name: "note" });
    expect(keyAction(press({ code: "KeyL", key: "д" }))).toEqual({ name: "narration" });
    expect(keyAction(press({ code: "KeyJ", key: "о" }))).toEqual({ name: "nextStep" });
    expect(keyAction(press({ code: "KeyK", key: "л" }))).toEqual({ name: "prevStep" });
    expect(keyAction(press({ code: "KeyQ", key: "й" }))).toBeNull();
  });

  test("? opens help on US and Russian layouts", () => {
    expect(keyAction(press({ code: "Slash", key: "?", shiftKey: true }))).toEqual({ name: "help" });
    expect(keyAction(press({ code: "Slash", key: ",", shiftKey: true }))).toEqual({ name: "help" });
    expect(keyAction(press({ code: "Digit7", key: "?", shiftKey: true }))).toEqual({ name: "help" });
  });

  test("modifiers turn single keys off; Alt+arrows move between steps", () => {
    expect(keyAction(press({ code: "KeyH", key: "h", ctrlKey: true }))).toBeNull();
    expect(keyAction(press({ code: "KeyH", key: "h", metaKey: true }))).toBeNull();
    expect(keyAction(press({ code: "KeyH", key: "H", shiftKey: true }))).toBeNull();
    expect(keyAction(press({ code: "KeyH", key: "˙", altKey: true }))).toBeNull();
    expect(keyAction(press({ code: "Digit2", key: "@", shiftKey: true }))).toBeNull();
    expect(keyAction(press({ code: "ArrowDown", key: "ArrowDown", altKey: true }))).toEqual({ name: "nextStep" });
    expect(keyAction(press({ code: "ArrowUp", key: "ArrowUp", altKey: true }))).toEqual({ name: "prevStep" });
    expect(keyAction(press({ code: "ArrowDown", key: "ArrowDown" }))).toBeNull();
  });

  test("IME composition, auto-repeat and keys already handled are ignored", () => {
    expect(keyAction(press({ code: "KeyH", key: "h", isComposing: true }))).toBeNull();
    expect(keyAction(press({ code: "KeyH", key: "Process", keyCode: 229 }))).toBeNull();
    expect(keyAction(press({ code: "KeyH", key: "h", repeat: true }))).toBeNull();
    expect(keyAction(press({ code: "Escape", key: "Escape", defaultPrevented: true }))).toBeNull();
  });

  test("in a text field only Escape gets through", () => {
    for (const html of ['<input data-t type="text">', '<input data-t type="number">', "<textarea data-t></textarea>", "<select data-t></select>", '<div contenteditable="true"><p data-t>x</p></div>']) {
      const target = el(html);
      expect([html, keyAction(press({ code: "KeyH", key: "h", target }))]).toEqual([html, null]);
      expect([html, keyAction(press({ code: "Digit1", key: "1", target }))]).toEqual([html, null]);
      expect([html, keyAction(press({ code: "Enter", key: "Enter", target }))]).toEqual([html, null]);
      expect([html, keyAction(press({ code: "Escape", key: "Escape", target }))]).toEqual([html, { name: "escape" }]);
    }
  });

  test("Enter and Space keep their own meaning on buttons, links and toggles", () => {
    const button = el("<button data-t>Go</button>");
    expect(keyAction(press({ code: "Enter", key: "Enter", target: button }))).toBeNull();
    expect(keyAction(press({ code: "Space", key: " ", target: button }))).toBeNull();
    expect(keyAction(press({ code: "Digit1", key: "1", target: button }))).toEqual({ name: "choose", n: 1 });
    expect(keyAction(press({ code: "Enter", key: "Enter", target: el('<a data-t href="/x">x</a>') }))).toBeNull();

    const radio = el('<input data-t type="radio">');
    expect(keyAction(press({ code: "Enter", key: "Enter", target: radio }))).toEqual({ name: "submit" });
    expect(keyAction(press({ code: "Space", key: " ", target: radio }))).toBeNull();
    expect(keyAction(press({ code: "Digit2", key: "2", target: radio }))).toEqual({ name: "choose", n: 2 });

    const row = el('<li data-t tabindex="0">line</li>');
    expect(keyAction(press({ code: "Enter", key: "Enter", target: row }))).toEqual({ name: "submit" });
    expect(keyAction(press({ code: "Space", key: " ", target: row }))).toEqual({ name: "reveal" });
  });

  test("keys inside a dialog belong to the dialog", () => {
    expect(keyAction(press({ code: "KeyH", key: "h", target: el("<dialog open><button data-t>x</button></dialog>") }))).toBeNull();
    expect(keyAction(press({ code: "Escape", key: "Escape", target: el('<div role="dialog"><span data-t>x</span></div>') }))).toBeNull();
  });
});

describe("isTypingTarget", () => {
  test("text inputs type, choice inputs and plain elements do not", () => {
    expect(isTypingTarget(el('<input data-t type="email">'))).toBe(true);
    expect(isTypingTarget(el('<input data-t type="checkbox">'))).toBe(false);
    expect(isTypingTarget(el('<input data-t type="radio">'))).toBe(false);
    expect(isTypingTarget(el("<p data-t>x</p>"))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});
