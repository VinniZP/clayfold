import { flushSync } from "react-dom";
import { setPrinting } from "./theme";

// Printing switches the app to the light palette and opens collapsed <details>; the print rules in
// styles/global.css (data-print attributes) hide the app chrome.

const renders = new Set<Promise<unknown>>();

/** Registers an asynchronous figure render, so printPage waits for it. */
export function trackRender(render: Promise<unknown>): void {
  renders.add(render);
  void render.finally(() => renders.delete(render));
}

const opened: HTMLDetailsElement[] = [];

function enter() {
  // flushSync commits the light palette, and starts the figure re-renders, before the browser lays out the page.
  flushSync(() => setPrinting(true));
  for (const details of document.querySelectorAll<HTMLDetailsElement>("#main details:not([open])")) {
    details.open = true;
    opened.push(details);
  }
}

function leave() {
  for (const details of opened.splice(0)) details.open = false;
  setPrinting(false);
}

/** Keeps a print started from the browser menu in the print look; returns the cleanup. */
export function watchPrinting(): () => void {
  window.addEventListener("beforeprint", enter);
  window.addEventListener("afterprint", leave);
  return () => {
    window.removeEventListener("beforeprint", enter);
    window.removeEventListener("afterprint", leave);
  };
}

/** Prints once diagrams and charts have been drawn again in the light palette. */
export async function printPage(): Promise<void> {
  enter();
  while (renders.size > 0) await Promise.allSettled([...renders]);
  window.print();
}
