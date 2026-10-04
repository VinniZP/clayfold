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
  const parsed = schema.safeParse(raw);
  if (!parsed.success) fail(400, parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
  return parsed.data;
}

/**
 * Content-Disposition for a download named `name.ext`: `filename` carries an ASCII fallback built from
 * `asciiName`, and `filename*` the UTF-8 name, percent-encoded as RFC 5987 attr-chars.
 */
export function attachment(name: string, asciiName: string, ext: string): string {
  const utf8 = `${name.replace(/[\\/:*?"<>|\p{Cc}]+/gu, " ").replace(/\s+/g, " ").trim() || asciiName}.${ext}`;
  const ascii = `${asciiName.replace(/[^\w.-]+/g, "-") || "download"}.${ext}`;
  const encoded = encodeURIComponent(utf8).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

export const parseJson = <T>(text: string | null): T | null => (text === null ? null : (JSON.parse(text) as T));
