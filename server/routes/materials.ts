import type { Context } from "hono";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { MATERIAL_LIMITS, type MaterialView } from "../../shared/api";
import { db } from "../db";
import { extractFile, extractPasted, fetchMaterial, MaterialError, materialViews, removeMaterial, storeMaterials, type Material } from "../gates/materials";
import { publish } from "../hub";
import { t } from "../i18n";
import { fail } from "./http";

/** Every part of a request at its size limit, with room for the multipart framing. */
export const materialsBodyLimit = bodyLimit({
  maxSize: MATERIAL_LIMITS.bytes * 5,
  onError: (c) => c.json({ error: t("material.error.requestTooLarge") }, 413),
});

export async function readForm(c: Context): Promise<FormData> {
  try {
    return await c.req.formData();
  } catch {
    fail(400, "invalid multipart body");
  }
}

const Pasted = z.object({ title: z.string(), text: z.string() });

/** Extracts the text of every material part of the form; the first part that fails fails them all. */
export async function extractMaterials(form: FormData): Promise<Material[]> {
  const files = form.getAll("file").filter((f): f is File => typeof f !== "string");
  const texts = form.getAll("text").filter((p): p is string => typeof p === "string");
  const links = form.getAll("link").filter((p): p is string => typeof p === "string");
  if (files.length + texts.length + links.length > MATERIAL_LIMITS.perRequest) fail(400, t("material.error.tooMany", { count: MATERIAL_LIMITS.perRequest }));
  const pasted = texts.map((raw) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
    const p = Pasted.safeParse(parsed);
    if (!p.success) fail(400, t("material.error.emptyText"));
    return p.data;
  });
  try {
    return await Promise.all([
      ...files.map(async (f) => extractFile(f.name, new Uint8Array(await f.arrayBuffer()))),
      ...pasted.map(async (p) => extractPasted(p.title, p.text)),
      ...links.map((url) => fetchMaterial(url)),
    ]);
  } catch (e) {
    if (e instanceof MaterialError) fail(400, e.message);
    throw e;
  }
}

function topicOf(topicId: string): { id: string } {
  const topic = db().query<{ id: string; kind: string }, [string]>("SELECT id, kind FROM topics WHERE id = ?").get(topicId);
  if (!topic) fail(404, "topic not found");
  if (topic.kind === "goal") fail(400, t("material.error.goal"));
  return topic;
}

export const materials = new Hono();

materials.post("/:topicId/materials", materialsBodyLimit, async (c) => {
  const topic = topicOf(c.req.param("topicId"));
  const found = await extractMaterials(await readForm(c));
  if (found.length === 0) fail(400, "the request holds no materials");
  const ids = storeMaterials(db(), topic.id, found);
  publish(topic.id, { type: "sources.updated" });
  return c.json(materialViews(db(), topic.id, ids) satisfies MaterialView[], 201);
});

materials.delete("/:topicId/materials/:materialId", (c) => {
  const topic = topicOf(c.req.param("topicId"));
  const outcome = removeMaterial(db(), topic.id, c.req.param("materialId"));
  if (outcome === "missing") fail(404, t("material.error.notFound"));
  if (outcome === "cited") fail(409, t("material.error.cited"));
  publish(topic.id, { type: "sources.updated" });
  return c.body(null, 204);
});
