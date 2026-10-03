// Glossary term marks in model-written text: [[surface|Term]] shows `surface` and links it to the
// glossary entry `Term`; [[Term]] shows the term as written.

export const TERM_MARK = /\[\[([^[\]|]+?)(?:\|([^[\]|]+?))?\]\]/g;

export type TermMark = { surface: string; term: string };

export function termMarks(text: string): TermMark[] {
  return [...text.matchAll(TERM_MARK)].map((m) => ({ surface: m[1]!.trim(), term: (m[2] ?? m[1]!).trim() }));
}

export const termKey = (term: string) => term.trim().toLowerCase();

/** The text as the reader sees it, with every mark replaced by its surface. */
export function stripTermMarks(text: string): string {
  return text.replace(TERM_MARK, (_, surface: string) => surface.trim());
}

/** stripTermMarks applied to every string inside a JSON value, except `cites`, which hold verbatim source quotes. */
export function stripTermMarksDeep<T>(value: T): T {
  if (typeof value === "string") return stripTermMarks(value) as T;
  if (Array.isArray(value)) return value.map(stripTermMarksDeep) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, k === "cites" ? v : stripTermMarksDeep(v)])) as T;
  }
  return value;
}
