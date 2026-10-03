import { Hono } from "hono";
import { z } from "zod";
import type { ReviewRating } from "../../shared/api";
import { Card } from "../../shared/schemas";
import { db } from "../db";
import { activateCard, reviewCard } from "../review/fsrs";
import { reviewSession } from "../review/session";
import { fail, readBody } from "./http";
import { cardView } from "./topics";

type CardRow = Parameters<typeof cardView>[0];

function cardRow(id: string): CardRow {
  const row = db().query<CardRow, [string]>("SELECT * FROM cards WHERE id = ?").get(id);
  if (!row) fail(404, "card not found");
  return row;
}

export const review = new Hono();

review.get("/review", (c) => c.json(reviewSession(c.req.query("topicId") || null)));

review.post("/cards/:cardId/review", async (c) => {
  const card = cardRow(c.req.param("cardId"));
  if (card.status !== "active") fail(409, "card is not active");
  const { rating, durationMs } = await readBody(
    c,
    z.object({ rating: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]), durationMs: z.number().min(0).optional() }),
  );
  const { due } = reviewCard(card.id, rating as ReviewRating, new Date(), undefined, durationMs ?? null);
  return c.json({ due });
});

review.post("/cards/:cardId/accept", (c) => {
  const card = cardRow(c.req.param("cardId"));
  if (card.status === "rejected") fail(409, "card was rejected");
  activateCard(card.id);
  return c.json(cardView(cardRow(card.id)));
});

for (const [action, status] of [
  ["suspend", "suspended"],
  ["reject", "rejected"],
] as const) {
  review.post(`/cards/:cardId/${action}`, (c) => {
    const card = cardRow(c.req.param("cardId"));
    db().query("UPDATE cards SET status = ? WHERE id = ?").run(status, card.id);
    return c.json(cardView(cardRow(card.id)));
  });
}

review.patch("/cards/:cardId", async (c) => {
  const row = cardRow(c.req.param("cardId"));
  const edit = await readBody(c, z.object({ front: z.string().trim().optional(), back: z.string().trim().optional() }));
  const current = JSON.parse(row.content) as Card;
  const next = Card.safeParse({ ...current, ...(edit.front ? { front: edit.front } : {}), ...(edit.back ? { back: edit.back } : {}) });
  if (!next.success) fail(400, next.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  if (next.data.kind === "cloze" && next.data.front.split("____").length !== 2) fail(400, "a cloze front holds exactly one ____");
  db().query("UPDATE cards SET content = ? WHERE id = ?").run(JSON.stringify(next.data), row.id);
  return c.json(cardView(cardRow(row.id)));
});
