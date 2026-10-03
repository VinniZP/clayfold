import type { NodeView } from "@shared/api";
import type { Level, StepKind } from "@shared/schemas";
import { lang, t } from "./i18n";

const formats = new Map<string, Intl.DateTimeFormat>();

/** A date format in the current language, built on first use and cached per language. */
export function dateFormat(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${lang()} ${JSON.stringify(options)}`;
  let f = formats.get(key);
  if (!f) formats.set(key, (f = new Intl.DateTimeFormat(lang(), options)));
  return f;
}

const dates = () => dateFormat({ day: "numeric", month: "long" });
const times = () => dateFormat({ hour: "2-digit", minute: "2-digit" });

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : dates().format(d);
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${dates().format(d)}, ${times().format(d)}`;
}

export function formatUsd(v: number): string {
  return `$${v.toFixed(v < 0.1 ? 3 : 2)}`;
}

export const kindLabel = (kind: string): string => (isStepKind(kind) ? t(`kind.${kind}`) : kind);

export const levelLabel = (level: Level): string => t(`level.${level}`);

export const masteryLabel = (mastery: NodeView["mastery"]): string => t(`mastery.${mastery}`);

const STEP_KINDS = ["activate", "explain", "worked_example", "practice", "reflect", "check"] as const satisfies readonly StepKind[];
const isStepKind = (kind: string): kind is (typeof STEP_KINDS)[number] => (STEP_KINDS as readonly string[]).includes(kind);

/** Local calendar day as YYYY-MM-DD, the format of ActivityDay.date. */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
