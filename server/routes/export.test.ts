import { expect, test } from "bun:test";
import { openDb } from "../db";
import { acceptedCards } from "./export";
import { attachment } from "./http";
import { insertCard, seed } from "./test-fixtures";

test("attachment gives an ASCII fallback and the UTF-8 name as RFC 5987 attr-chars", () => {
  expect(attachment("Теорема Байеса: шпаргалка", "teorema-bayesa", "md")).toBe(
    `attachment; filename="teorema-bayesa.md"; filename*=UTF-8''%D0%A2%D0%B5%D0%BE%D1%80%D0%B5%D0%BC%D0%B0%20%D0%91%D0%B0%D0%B9%D0%B5%D1%81%D0%B0%20%D1%88%D0%BF%D0%B0%D1%80%D0%B3%D0%B0%D0%BB%D0%BA%D0%B0.md`,
  );
  expect(attachment(`Rock'n'roll (live) *1/2*`, "rock n roll", "apkg")).toBe(
    `attachment; filename="rock-n-roll.apkg"; filename*=UTF-8''Rock%27n%27roll%20%28live%29%201%202.apkg`,
  );
  expect(attachment('  "/\\  ', "x", "txt")).toBe(`attachment; filename="x.txt"; filename*=UTF-8''x.txt`);
});

test("only accepted cards are exported, grouped by topic, with the topic title as deck", () => {
  const database = openDb(":memory:");
  seed(database);
  database.query("INSERT INTO topics (id, slug, title, request, created_at) VALUES ('tp2', 'tp2', 'Later topic', 'r', '2999-01-01T00:00:00.000Z')").run();
  const active = insertCard(database, "a", "active");
  insertCard(database, "a", "proposed");
  insertCard(database, "b", "suspended");
  insertCard(database, "b", "rejected");
  const later = database.query("INSERT INTO cards (id, topic_id, node_id, content, status) SELECT 'cd_later', 'tp2', node_id, content, 'active' FROM cards WHERE id = ?").run(active);
  expect(later.changes).toBe(1);

  expect(acceptedCards(null, database).map((c) => [c.id, c.deck])).toEqual([
    [active, "Topic"],
    ["cd_later", "Later topic"],
  ]);
  expect(acceptedCards("tp2", database).map((c) => c.id)).toEqual(["cd_later"]);
  expect(acceptedCards("tp1", database)[0]!.card.front).toBe("What is node A?");
});
