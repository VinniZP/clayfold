import type { Database } from "bun:sqlite";
import { OUTFIT_ITEMS, OUTFIT_SLOTS, REWARD_PREFIX, type Outfit } from "../../shared/game";
import { db } from "../db";

const read = (key: string, database: Database): unknown => {
  const row = database.query<{ value: string }, [string]>("SELECT value FROM settings WHERE key = ?").get(key);
  return row ? JSON.parse(row.value) : null;
};

const write = (key: string, value: unknown, database: Database) =>
  database.query("INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT (key) DO UPDATE SET value = ?2").run(key, JSON.stringify(value));

/** The meerkat is off until the learner turns it on in Settings. */
export const gameOn = (database: Database = db()): boolean => read("gamification", database) === true;

export const setGameOn = (on: boolean, database: Database = db()): void => void write("gamification", on, database);

export function storedOutfit(database: Database = db()): Outfit {
  const value = read("game_outfit", database);
  if (!value || typeof value !== "object") return {};
  const out: Outfit = {};
  for (const slot of OUTFIT_SLOTS) {
    const ref = (value as Record<string, unknown>)[slot];
    if (typeof ref === "string" && (ref in OUTFIT_ITEMS || ref.startsWith(REWARD_PREFIX))) out[slot] = ref as Outfit[typeof slot];
  }
  return out;
}

export const storeOutfit = (outfit: Outfit, database: Database = db()): void => void write("game_outfit", outfit, database);
