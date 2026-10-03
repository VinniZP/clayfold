import { describe, expect, test } from "bun:test";
import { openDb } from "../db";
import { checkCites } from "./quotes";
import { QUOTE_EN, seedTopic } from "./test-fixtures";
import { normalizeForQuote } from "./text";

function setup() {
  const db = openDb(":memory:");
  const { topicId, sourceId } = seedTopic(db);
  seedTopic(db, "top_other");
  db.query("INSERT INTO sources (id, topic_id, url, title, kind, note, status, error) VALUES ('src_bad', ?, 'https://x.org/a.pdf', 'pdf', 'paper', 'a failed source', 'failed', 'pdf')").run(topicId);
  return { db, topicId, sourceId };
}

describe("Q6 quote verification", () => {
  test("verbatim quotes pass, Russian and English", () => {
    const { db, topicId, sourceId } = setup();
    const ruText = "Команда git add добавляет изменения в индекс. Индекс — это промежуточная область между рабочей копией и репозиторием.";
    db.query("INSERT INTO sources (id, topic_id, url, title, kind, note, text, status) VALUES ('src_ru', ?, 'https://example.org/ru/git', 'Git (ru)', 'docs', 'a Russian source', ?, 'ok')").run(topicId, ruText);
    const v = checkCites(db, topicId, [
      { cite: { sourceId, quote: QUOTE_EN }, path: "cites.0" },
      { cite: { sourceId: "src_ru", quote: "Команда git add добавляет изменения в индекс." }, path: "cites.1" },
    ]);
    expect(v).toEqual([]);
  });
  test("typographic differences are tolerated", () => {
    const { db, topicId, sourceId } = setup();
    const quote = "The index - the staging area - sits between  the working tree\nand the repository";
    expect(checkCites(db, topicId, [{ cite: { sourceId, quote }, path: "q" }])).toEqual([]);
    expect(checkCites(db, topicId, [{ cite: { sourceId, quote: "EACH COMMIT RECORDS a snapshot" }, path: "q" }])).toEqual([]);
  });
  test("paraphrase fails", () => {
    const { db, topicId, sourceId } = setup();
    const v = checkCites(db, topicId, [{ cite: { sourceId, quote: "Every commit stores a snapshot of the index." }, path: "items.0.cites.0" }]);
    expect(v).toEqual([expect.objectContaining({ rule: "Q6", path: "items.0.cites.0.quote" })]);
  });
  test("source of another topic fails", () => {
    const { db, sourceId } = setup();
    expect(checkCites(db, "top_other", [{ cite: { sourceId, quote: QUOTE_EN }, path: "c" }])).toEqual([
      expect.objectContaining({ rule: "Q6", path: "c.sourceId" }),
    ]);
  });
  test("failed source fails", () => {
    const { db, topicId } = setup();
    expect(checkCites(db, topicId, [{ cite: { sourceId: "src_bad", quote: QUOTE_EN }, path: "c" }])[0]!.message).toContain("failed");
  });
});

describe("normalizeForQuote", () => {
  test("unifies quotes, dashes, ellipsis, ё and spacing", () => {
    expect(normalizeForQuote("«Ёлка» — это “tree”…")).toBe(normalizeForQuote('"елка" - это "tree"...'));
  });
  test("NFKC folds compatibility forms", () => expect(normalizeForQuote("ﬁle")).toBe("file"));
  test("drops soft hyphens and zero-width spaces", () => expect(normalizeForQuote("ре­по​зиторий")).toBe("репозиторий"));
});
