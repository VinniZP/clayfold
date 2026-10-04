import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import type { Card } from "../../shared/schemas";
import { ankiNotes, ankiPackage, ankiText, BASIC_MODEL_ID, CLOZE_MODEL_ID } from "./anki";

const card = (kind: Card["kind"], front: string, back: string): Card => ({ kind, front, back, nodeId: "bayes-rule", lens: "cause", cites: [] });

test("basic fields are HTML: markdown rendered, raw HTML escaped, term marks reduced to their surface", () => {
  const [note] = ankiNotes([{ id: "cd1", deck: "Probability", card: card("basic", "Why is `a<b` & <b>bold</b> [[rare|Prevalence]]?", 'Because **few** are sick.\nSay "few".') }]);
  expect(note).toEqual({
    guid: "clayfold-cd1",
    kind: "basic",
    deck: "Probability",
    tags: ["clayfold", "node::bayes-rule", "lens::cause"],
    fields: ["Why is <code>a&lt;b</code> &amp; &lt;b&gt;bold&lt;/b&gt; rare?", "Because <strong>few</strong> are sick.<br>Say &quot;few&quot;."],
  });
});

test("a cloze card puts its back into the blank as c1; braces and colons cannot open another deletion", () => {
  const [note] = ankiNotes([{ id: "cd2", deck: "Topic :: part", card: card("cloze", "P(A | B) = ____ {{c2::x}}", "P(A and B) / P(B)::hint") }]);
  expect(note!.deck).toBe("Topic : part");
  expect(note!.fields).toEqual(["P(A | B) = {{c1::P(A and B) / P(B)&#58;&#58;hint}} &#123;&#123;c2::x&#125;&#125;", ""]);
});

test("the text file declares its columns and quotes fields that hold tabs, quotes or line breaks", () => {
  const notes = ankiNotes([
    { id: "cd1", deck: 'The "best" deck', card: card("basic", "Front", "Back") },
    { id: "cd2", deck: "Deck", card: card("cloze", "The ____ fact", "first") },
  ]);
  const lines = ankiText(notes).split("\n");
  expect(lines.slice(0, 6)).toEqual(["#separator:tab", "#html:true", "#guid column:1", "#notetype column:2", "#deck column:3", "#tags column:4"]);
  expect(lines[6]).toBe('clayfold-cd1\tBasic\t"The ""best"" deck"\tclayfold node::bayes-rule lens::cause\tFront\tBack');
  expect(lines[7]).toBe("clayfold-cd2\tCloze\tDeck\tclayfold node::bayes-rule lens::cause\tThe {{c1::first}} fact\t");
  expect(lines[8]).toBe("");
});

/** The first entry of a zip of stored entries. */
function firstEntry(zip: Uint8Array): { name: string; data: Uint8Array } {
  const view = new DataView(zip.buffer, zip.byteOffset);
  expect(view.getUint32(0, true)).toBe(0x04034b50);
  const size = view.getUint32(18, true);
  const nameLength = view.getUint16(26, true);
  const name = new TextDecoder().decode(zip.subarray(30, 30 + nameLength));
  const data = zip.subarray(30 + nameLength, 30 + nameLength + size);
  expect(view.getUint32(14, true)).toBe(Bun.hash.crc32(data));
  return { name, data };
}

test("the package holds a schema 11 collection with one deck per topic, both note types and new cards", () => {
  const notes = ankiNotes([
    { id: "cd1", deck: "Bayes", card: card("basic", "Front", "Back") },
    { id: "cd2", deck: "Git", card: card("cloze", "The ____ fact", "first") },
  ]);
  const entry = firstEntry(ankiPackage(notes, new Date("2026-10-04T10:00:00Z")));
  expect(entry.name).toBe("collection.anki2");
  const col = Database.deserialize(entry.data);
  const row = col.query<{ ver: number; models: string; decks: string }, []>("SELECT ver, models, decks FROM col").get()!;
  expect(row.ver).toBe(11);
  expect(Object.keys(JSON.parse(row.models))).toEqual([String(BASIC_MODEL_ID), String(CLOZE_MODEL_ID)]);
  const decks = JSON.parse(row.decks) as Record<string, { name: string }>;
  expect(Object.values(decks).map((d) => d.name).sort()).toEqual(["Bayes", "Default", "Git"]);
  expect(col.query("SELECT guid, mid, tags, flds FROM notes ORDER BY id").all()).toEqual([
    { guid: "clayfold-cd1", mid: BASIC_MODEL_ID, tags: " clayfold node::bayes-rule lens::cause ", flds: "Front\x1fBack" },
    { guid: "clayfold-cd2", mid: CLOZE_MODEL_ID, tags: " clayfold node::bayes-rule lens::cause ", flds: "The {{c1::first}} fact\x1f" },
  ]);
  const cards = col.query<{ did: number; ord: number; queue: number; type: number }, []>("SELECT did, ord, queue, type FROM cards ORDER BY id").all();
  expect(cards.map((c) => decks[String(c.did)]!.name)).toEqual(["Bayes", "Git"]);
  expect(cards.every((c) => c.ord === 0 && c.queue === 0 && c.type === 0)).toBe(true);
});
