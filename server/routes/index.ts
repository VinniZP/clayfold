import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ApiError } from "../../shared/api";
import { conversations } from "./conversations";
import { game } from "./game";
import { glossary } from "./glossary";
import { items } from "./items";
import { lessons } from "./lessons";
import { narration } from "./narration";
import { video } from "./video";
import { notes } from "./notes";
import { review } from "./review";
import { settings } from "./settings";
import { stats } from "./stats";
import { system } from "./system";
import { todayRoutes } from "./today";
import { topics } from "./topics";
import { update } from "./update";

export const api = new Hono();

api.route("/topics", topics);
api.route("/conversations", conversations);
api.route("/lessons", lessons);
api.route("/", items);
api.route("/", glossary);
api.route("/", narration);
api.route("/", video);
api.route("/", review);
api.route("/", notes);
api.route("/", stats);
api.route("/", todayRoutes);
api.route("/", settings);
api.route("/", system);
api.route("/", update);
api.route("/", game);

api.onError((err, c) => {
  if (err instanceof HTTPException) return c.json({ error: err.message } satisfies ApiError, err.status);
  console.error(err);
  return c.json({ error: err.message || "internal error" } satisfies ApiError, 500);
});
