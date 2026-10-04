import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { z } from "zod";

export function fail(status: 400 | 404 | 409 | 502, message: string): never {
  throw new HTTPException(status, { message });
}

export async function readBody<S extends z.ZodType>(c: Context, schema: S): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    const text = await c.req.text();
    raw = text.trim() ? JSON.parse(text) : {};
  } catch {
    fail(400, "invalid JSON body");
  }
  return parseBody(schema, raw);
}

export function parseBody<S extends z.ZodType>(schema: S, raw: unknown): z.infer<S> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) fail(400, parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
  return parsed.data;
}

export const parseJson = <T>(text: string | null): T | null => (text === null ? null : (JSON.parse(text) as T));
