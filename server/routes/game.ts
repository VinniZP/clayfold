import { Hono } from "hono";
import { z } from "zod";
import { OUTFIT_SLOTS } from "../../shared/game";
import { db } from "../db";
import { backfillView, startBackfill } from "../game/backfill";
import { gameOn, storedOutfit, storeOutfit } from "../game/state";
import { crownsView, gameView, markSeen, wearable } from "../game/view";
import { t } from "../i18n";
import { fail, readBody } from "./http";

export const game = new Hono();

const requireOn = async (_c: unknown, next: () => Promise<void>) => {
  if (!gameOn()) fail(409, t("game.off"));
  await next();
};
game.use("/game", requireOn);
game.use("/game/*", requireOn);

game.get("/game", (c) => c.json(gameView()));

game.get("/game/crowns", (c) => c.json(crownsView()));

game.put("/game/outfit", async (c) => {
  const { slot, item } = await readBody(c, z.object({ slot: z.enum(OUTFIT_SLOTS), item: z.string().min(1).max(80).nullable() }));
  const view = gameView();
  const outfit = storedOutfit();
  if (item === null) {
    delete outfit[slot];
  } else {
    const fits = wearable(view).get(item as never);
    if (fits !== slot) fail(400, t("game.notWearable"));
    outfit[slot] = item as never;
  }
  storeOutfit(outfit);
  return c.json({ ...view, outfit });
});

game.post("/game/seen", async (c) => {
  const marks = await readBody(
    c,
    z.object({
      rewards: z.array(z.string()).max(200).optional(),
      habits: z.array(z.string()).max(50).optional(),
      ranks: z.array(z.number().int().min(1).max(50)).max(50).optional(),
      residents: z.array(z.string()).max(200).optional(),
    }),
  );
  markSeen(marks);
  return c.body(null, 204);
});

game.get("/game/backfill", (c) => c.json(backfillView()));
game.post("/game/backfill", (c) => c.json(startBackfill(), 202));

game.post("/game/focus", async (c) => {
  const { lessonId, longestAwayMs } = await readBody(c, z.object({ lessonId: z.string().min(1), longestAwayMs: z.number().int().min(0) }));
  if (!db().query("SELECT 1 FROM lessons WHERE id = ?").get(lessonId)) fail(404, "lesson not found");
  db().query("INSERT INTO focus_runs (lesson_id, longest_away_ms) VALUES (?, ?)").run(lessonId, longestAwayMs);
  return c.body(null, 204);
});
