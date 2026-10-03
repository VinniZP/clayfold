import { Hono } from "hono";
import { z } from "zod";
import type { Settings } from "../../shared/api";
import { LANGS } from "../../shared/i18n";
import { language, setLanguage } from "../i18n";
import { readBody } from "./http";

const settingsView = (): Settings => ({ language: language() });

export const settings = new Hono();

settings.get("/settings", (c) => c.json(settingsView()));
settings.put("/settings", async (c) => {
  const body = await readBody(c, z.object({ language: z.enum(LANGS) }));
  setLanguage(body.language);
  return c.json(settingsView());
});
