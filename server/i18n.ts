import type { Database } from "bun:sqlite";
import { CONTENT_RULES, DEFAULT_LANG, isLang, translate, type Lang, type MessageKey, type Params } from "../shared/i18n";
import { db } from "./db";

let current: Lang = DEFAULT_LANG;

/** The app language: the UI and everything Claude writes for the learner use it. */
export const language = (): Lang => current;

export function loadLanguage(database: Database = db()): void {
  const row = database.query<{ value: string }, []>("SELECT value FROM settings WHERE key = 'language'").get();
  const value: unknown = row ? JSON.parse(row.value) : null;
  current = isLang(value) ? value : DEFAULT_LANG;
}

export function setLanguage(lang: Lang, database: Database = db()): void {
  database.query("INSERT INTO settings (key, value) VALUES ('language', ?1) ON CONFLICT (key) DO UPDATE SET value = ?1").run(JSON.stringify(lang));
  current = lang;
}

export const t = (key: MessageKey, params?: Params): string => translate(current, key, params);

/** Appended to Claude's system prompt on every run. */
export function languageInstruction(lang: Lang = current): string {
  const name = CONTENT_RULES[lang].name;
  return `The learner's language is ${name}. Write everything the learner sees in ${name}: chat messages, questions and options, workspace files, lesson plans, steps, items, cards, summaries and figure labels. Keep tool names, ids and file names as they are.`;
}
