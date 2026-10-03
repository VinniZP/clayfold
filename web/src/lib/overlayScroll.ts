import { OverlayScrollbars, type PartialOptions } from "overlayscrollbars";
import { useEffect, type RefObject } from "react";

/** One look for every scroller; the theme is styled in styles/global.css (.os-theme-clayfold). */
export const SCROLLBAR_OPTIONS: PartialOptions = {
  scrollbars: { theme: "os-theme-clayfold", autoHide: "scroll", autoHideDelay: 900, clickScroll: true },
};

/** Overlay scrollbars for the page; window scrolling APIs keep working. */
export function initPageScrollbars() {
  OverlayScrollbars(document.body, SCROLLBAR_OPTIONS);
}

/**
 * Overlay scrollbars on an element that already scrolls. The element stays its own viewport, so
 * refs, scrollTop and scroll listeners on it keep working.
 */
export function useOverlayScroll(ref: RefObject<HTMLElement | null>, enabled = true) {
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    const instance = OverlayScrollbars({ target: el, elements: { viewport: el } }, SCROLLBAR_OPTIONS);
    return () => instance.destroy();
  }, [ref, enabled]);
}
