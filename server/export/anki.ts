import { Database } from "bun:sqlite";
import { Marked } from "marked";
import type { Card } from "../../shared/schemas";
import { stripTermMarks } from "../../shared/terms";
import { zip } from "./zip";

export type AnkiCard = { id: string; deck: string; card: Card };

export type AnkiNote = {
  guid: string;
  kind: Card["kind"];
  deck: string;
  tags: string[];
  /** Basic: Front, Back. Cloze: Text, Back Extra. HTML. */
  fields: [string, string];
};

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

// Raw HTML in a card is shown as text: Anki renders fields as HTML.
const markdown = new Marked({ gfm: true, breaks: true, renderer: { html: ({ text }) => escapeHtml(text) } });
const fieldHtml = (src: string) => markdown.parseInline(stripTermMarks(src), { async: false }).trim();

/** The card convention for a cloze blank (Card schema). */
const BLANK = "____";
const SLOT = "\uE000";

// Anki reads {{c1::answer::hint}} in the raw field, so braces outside the deletion and colons inside it are written as entities.
const braces = (html: string) => html.replaceAll("{", "&#123;").replaceAll("}", "&#125;");

function clozeText(front: string, back: string): string {
  const answer = braces(fieldHtml(back)).replaceAll(":", "&#58;");
  return braces(fieldHtml(front.replace(BLANK, SLOT))).replace(SLOT, `{{c1::${answer}}}`);
}

/** One level of Anki's deck tree; "::" would open a subdeck. */
export const deckName = (title: string) => title.replace(/\s+/g, " ").replaceAll("::", ":").trim() || "Clayfold";

export function ankiNotes(cards: AnkiCard[]): AnkiNote[] {
  return cards.map(({ id, deck, card }) => ({
    guid: `clayfold-${id}`,
    kind: card.kind,
    deck: deckName(deck),
    tags: ["clayfold", `node::${card.nodeId}`, `lens::${card.lens}`],
    fields: card.kind === "cloze" ? [clozeText(card.front, card.back), ""] : [fieldHtml(card.front), fieldHtml(card.back)],
  }));
}

const tsvField = (value: string) => (/[\t\n\r"]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value);

/** Anki's text import with file headers (manual: Importing > Text Files). */
export function ankiText(notes: AnkiNote[]): string {
  const header = ["#separator:tab", "#html:true", "#guid column:1", "#notetype column:2", "#deck column:3", "#tags column:4"];
  const rows = notes.map((n) => [n.guid, n.kind === "cloze" ? "Cloze" : "Basic", n.deck, n.tags.join(" "), ...n.fields].map(tsvField).join("\t"));
  return `${[...header, ...rows].join("\n")}\n`;
}

// ---------- .apkg ----------

// A legacy package: collection.anki2 at schema 11 plus an empty media map, as genanki writes it and Anki still imports.

const SCHEMA = `
CREATE TABLE col (id integer primary key, crt integer not null, mod integer not null, scm integer not null, ver integer not null,
  dty integer not null, usn integer not null, ls integer not null, conf text not null, models text not null, decks text not null,
  dconf text not null, tags text not null);
CREATE TABLE notes (id integer primary key, guid text not null, mid integer not null, mod integer not null, usn integer not null,
  tags text not null, flds text not null, sfld integer not null, csum integer not null, flags integer not null, data text not null);
CREATE TABLE cards (id integer primary key, nid integer not null, did integer not null, ord integer not null, mod integer not null,
  usn integer not null, type integer not null, queue integer not null, due integer not null, ivl integer not null, factor integer not null,
  reps integer not null, lapses integer not null, left integer not null, odue integer not null, odid integer not null,
  flags integer not null, data text not null);
CREATE TABLE revlog (id integer primary key, cid integer not null, usn integer not null, ease integer not null, ivl integer not null,
  lastIvl integer not null, factor integer not null, time integer not null, type integer not null);
CREATE TABLE graves (usn integer not null, oid integer not null, type integer not null);
CREATE INDEX ix_notes_usn on notes (usn);
CREATE INDEX ix_cards_usn on cards (usn);
CREATE INDEX ix_revlog_usn on revlog (usn);
CREATE INDEX ix_cards_nid on cards (nid);
CREATE INDEX ix_cards_sched on cards (did, queue, due);
CREATE INDEX ix_revlog_cid on revlog (cid);
CREATE INDEX ix_notes_csum on notes (csum);
`;

// Fixed ids: a later import finds the note types it created before.
export const BASIC_MODEL_ID = 1779150401117;
export const CLOZE_MODEL_ID = 1779150401118;

const CSS = `.card { font-family: "Onest", system-ui, sans-serif; font-size: 20px; line-height: 1.45; text-align: center; color: black; background-color: white; }
.cloze { font-weight: bold; color: #5640AE; }
.nightMode .cloze { color: #C4BCFF; }
code { font-family: ui-monospace, Menlo, monospace; font-size: 0.9em; }`;

const LATEX_PRE =
  "\\documentclass[12pt]{article}\n\\special{papersize=3in,5in}\n\\usepackage[utf8]{inputenc}\n\\usepackage{amssymb,amsmath}\n\\pagestyle{empty}\n\\setlength{\\parindent}{0in}\n\\begin{document}\n";

function model(id: number, name: string, type: 0 | 1, fields: [string, string], qfmt: string, afmt: string, deckId: number, mod: number) {
  return {
    id,
    name,
    type,
    mod,
    usn: -1,
    sortf: 0,
    did: deckId,
    css: CSS,
    latexPre: LATEX_PRE,
    latexPost: "\\end{document}",
    latexsvg: false,
    req: [[0, "any", [0]]],
    tags: [],
    vers: [],
    flds: fields.map((f, ord) => ({ name: f, ord, font: "Arial", size: 20, media: [], rtl: false, sticky: false })),
    tmpls: [{ name: type === 1 ? "Cloze" : "Card 1", ord: 0, qfmt, afmt, bqfmt: "", bafmt: "", bfont: "", bsize: 0, did: null }],
  };
}

const deckJson = (id: number, name: string, mod: number) => ({
  id,
  name,
  mod,
  usn: -1,
  desc: "",
  dyn: 0,
  conf: 1,
  collapsed: false,
  extendNew: 0,
  extendRev: 50,
  newToday: [0, 0],
  revToday: [0, 0],
  lrnToday: [0, 0],
  timeToday: [0, 0],
});

const DECK_CONF = {
  1: {
    id: 1,
    name: "Default",
    mod: 0,
    usn: 0,
    maxTaken: 60,
    autoplay: true,
    timer: 0,
    replayq: true,
    new: { bury: true, delays: [1, 10], initialFactor: 2500, ints: [1, 4, 7], order: 1, perDay: 20, separate: true },
    lapse: { delays: [10], leechAction: 0, leechFails: 8, minInt: 1, mult: 0 },
    rev: { bury: true, ease4: 1.3, fuzz: 0.05, ivlFct: 1, maxIvl: 36500, minSpace: 1, perDay: 100 },
  },
};

const plainText = (html: string) =>
  html
    .replace(/<[^>]*>/g, "")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&");

/** Anki's duplicate checksum: the first 8 hex digits of the SHA-1 of the sort field's text. */
const checksum = (text: string) => Number.parseInt(new Bun.CryptoHasher("sha1").update(text).digest("hex").slice(0, 8), 16);

/** An Anki package with its own note types, "Clayfold Basic" and "Clayfold Cloze"; its cards arrive as new cards. */
export function ankiPackage(notes: AnkiNote[], at: Date = new Date()): Uint8Array<ArrayBuffer> {
  const ms = at.getTime();
  const sec = Math.floor(ms / 1000);
  const deckIds = new Map<string, number>();
  for (const n of notes) if (!deckIds.has(n.deck)) deckIds.set(n.deck, 1_500_000_000_000 + Bun.hash.crc32(n.deck));
  const firstDeck = deckIds.values().next().value ?? 1;
  const models = {
    [BASIC_MODEL_ID]: model(BASIC_MODEL_ID, "Clayfold Basic", 0, ["Front", "Back"], "{{Front}}", '{{FrontSide}}<hr id="answer">{{Back}}', firstDeck, sec),
    [CLOZE_MODEL_ID]: model(CLOZE_MODEL_ID, "Clayfold Cloze", 1, ["Text", "Back Extra"], "{{cloze:Text}}", "{{cloze:Text}}<br>{{Back Extra}}", firstDeck, sec),
  };
  const decks: Record<number, ReturnType<typeof deckJson>> = { 1: deckJson(1, "Default", sec) };
  for (const [name, id] of deckIds) decks[id] = deckJson(id, name, sec);
  const conf = { activeDecks: [1], curDeck: 1, curModel: String(BASIC_MODEL_ID), nextPos: notes.length + 1, sortType: "noteFld", sortBackwards: false, addToCur: true, newSpread: 0, dueCounts: true, estTimes: true, collapseTime: 1200, timeLim: 0 };

  const col = new Database(":memory:");
  try {
    col.exec(SCHEMA);
    col
      .query("INSERT INTO col VALUES (1, ?, ?, ?, 11, 0, 0, 0, ?, ?, ?, ?, '{}')")
      .run(Math.floor(new Date(at).setHours(4, 0, 0, 0) / 1000), ms, ms, JSON.stringify(conf), JSON.stringify(models), JSON.stringify(decks), JSON.stringify(DECK_CONF));
    const note = col.query("INSERT INTO notes VALUES (?, ?, ?, ?, -1, ?, ?, ?, ?, 0, '')");
    const card = col.query("INSERT INTO cards VALUES (?, ?, ?, 0, ?, -1, 0, 0, ?, 0, 0, 0, 0, 0, 0, 0, 0, '')");
    notes.forEach((n, i) => {
      const id = ms + i;
      const sort = plainText(n.fields[0]);
      note.run(id, n.guid, n.kind === "cloze" ? CLOZE_MODEL_ID : BASIC_MODEL_ID, sec, ` ${n.tags.join(" ")} `, n.fields.join("\x1f"), sort, checksum(sort));
      card.run(id, id, deckIds.get(n.deck)!, sec, i + 1);
    });
    const media = new TextEncoder().encode("{}");
    return zip(
      [
        { name: "collection.anki2", data: col.serialize() },
        { name: "media", data: media },
      ],
      at,
    );
  } finally {
    col.close();
  }
}
