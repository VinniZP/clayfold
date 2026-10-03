import DOMPurify from "dompurify";
import { marked } from "marked";
import { TERM_MARK } from "@shared/terms";

marked.setOptions({ gfm: true, breaks: false });

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const TERM_AT_START = new RegExp(`^${TERM_MARK.source}`);

marked.use({
  extensions: [
    {
      name: "term",
      level: "inline",
      start: (src: string) => src.indexOf("[["),
      tokenizer(src: string) {
        const m = TERM_AT_START.exec(src);
        if (!m) return undefined;
        return { type: "term", raw: m[0], surface: m[1]!.trim(), term: (m[2] ?? m[1]!).trim() };
      },
      renderer: (token) => `<span class="term" data-term="${escapeHtml(token.term as string)}" tabindex="0">${escapeHtml(token.surface as string)}</span>`,
    },
  ],
});

DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A" && node.getAttribute("href")) {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
});

export function renderMarkdown(src: string): string {
  return DOMPurify.sanitize(marked.parse(src, { async: false }));
}

export function renderInline(src: string): string {
  return DOMPurify.sanitize(marked.parseInline(src, { async: false }));
}

export function sanitizeSvg(svg: string): string {
  return DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true } });
}
