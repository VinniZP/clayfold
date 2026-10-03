import { marked, type Token, type Tokens } from "marked";

export type Part = { label: string; text: string };
export type Block = { kind: "md"; src: string } | { kind: "parts"; intro: string; parts: Part[] };
export type Parsed = { scenario: Block[]; question: string | null };

/** A part marker at the start of a list item: "(A)", "**(B)**", "A)", "1)"; any alphabet. */
const ITEM_LABEL = /^\s*(?:\*\*)?\(?([\p{Lu}0-9])\)(?:\*\*)?\s+/u;
/** Inline part markers inside a dense paragraph: "… (A) …; (B) …". */
const INLINE_LABEL = /\((\p{Lu})\)\s/gu;
/** The trailing question sentence of a dense paragraph. */
const TRAILING_QUESTION = /^([\s\S]*?[.!:;»)])\s+([^.!?]*\?)\s*$/;

function inlineParts(text: string): Block {
  const marks = [...text.matchAll(INLINE_LABEL)];
  if (marks.length < 2) return { kind: "md", src: text };
  const intro = text.slice(0, marks[0]!.index).trim();
  const parts = marks.map((m, i) => {
    const end = i + 1 < marks.length ? marks[i + 1]!.index : text.length;
    return { label: m[1]!, text: text.slice(m.index! + m[0].length, end).trim().replace(/[;,]$/, "") };
  });
  return { kind: "parts", intro, parts };
}

function listParts(list: Tokens.List): Part[] | null {
  const parts = list.items.map((it) => {
    const m = it.text.match(ITEM_LABEL);
    return m ? { label: m[1]!, text: it.text.slice(m[0].length).trim() } : null;
  });
  return parts.every(Boolean) ? (parts as Part[]) : null;
}

/**
 * Splits an item prompt into scenario blocks and the question. Structured prompts arrive as
 * scenario paragraph(s), a list of parts, then the question paragraph; older prompts are one
 * dense paragraph, so its inline (A)/(B) parts and trailing question sentence are split out too.
 */
export function parsePrompt(src: string): Parsed {
  const tokens = marked.lexer(src).filter((t: Token) => t.type !== "space");
  const last = tokens[tokens.length - 1];
  let question: string | null = null;
  let body = tokens;

  if (last?.type === "paragraph" && last.text.trim().endsWith("?")) {
    if (tokens.length > 1) {
      question = last.raw.trim();
      body = tokens.slice(0, -1);
    } else {
      const m = last.raw.trim().match(TRAILING_QUESTION);
      if (m && m[1]!.length >= 60) {
        question = m[2]!.trim();
        return { scenario: [inlineParts(m[1]!.trim())], question };
      }
    }
  }

  const scenario: Block[] = body.map((t) => {
    if (t.type === "list") {
      const parts = listParts(t as Tokens.List);
      if (parts) return { kind: "parts", intro: "", parts };
    }
    if (t.type === "paragraph") return inlineParts(t.raw.trim());
    return { kind: "md", src: t.raw };
  });
  return { scenario, question };
}
