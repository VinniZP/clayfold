/**
 * Resolves CSS custom properties to #rrggbb. Mermaid and Vega manipulate colours themselves
 * and do not parse oklch(), so they get the tokens in sRGB hex.
 */
let ctx: CanvasRenderingContext2D | null = null;

function toHex(color: string): string {
  ctx ??= document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!ctx) return "#888888";
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillStyle = "#000";
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1, 1);
  const [r = 0, g = 0, b = 0] = ctx.getImageData(0, 0, 1, 1).data;
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** Reads a bridged token (theme/themes.ts `bridge`, applied to <html> by AppRoot). */
export function tokenHex(name: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();
  return toHex(value || "#888");
}

export function tokens<K extends string>(names: readonly K[]): Record<K, string> {
  const out = {} as Record<K, string>;
  for (const n of names) out[n] = tokenHex(n);
  return out;
}

export const FIG_TOKENS = ["fig-1", "fig-2", "fig-3", "fig-4", "fig-5", "fig-6"] as const;
