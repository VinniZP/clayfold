import { Hono } from "hono";
import { z } from "zod";
import { t } from "../i18n";
import { checkForUpdate, requestUpdate, updateView } from "../update";
import { fail, readBody } from "./http";

export const update = new Hono();

update.get("/update", async (c) => {
  await checkForUpdate();
  return c.json(updateView());
});

update.post("/update", async (c) => {
  const { mode } = await readBody(c, z.object({ mode: z.enum(["now", "idle"]) }));
  if (!requestUpdate(mode)) fail(409, t("update.cannotStart"));
  return c.json(updateView());
});
