import { en, enContent, type MessageKey } from "./en";
import { ru, ruContent } from "./ru";

export type { MessageKey } from "./en";

export const LANGS = ["en", "ru"] as const;
export type Lang = (typeof LANGS)[number];
export const DEFAULT_LANG: Lang = "en";

/** A message with plural forms, picked by the `count` param under the language's plural rules. */
export type Plural = { one: string; few?: string; many?: string; other: string };
export type Entry = string | Plural;
export type Catalog = Record<MessageKey, Entry>;
export type Params = Record<string, string | number>;

/** Language-specific rules for learner-facing content, which may be in any supported language. */
export type ContentRules = {
  /** English name of the language, used in instructions to Claude. */
  name: string;
  /** Words that make an option an absolute claim. */
  absolutes: string[];
  /** Matches "all/none of the above" options; input is lowercased and folded. */
  catchAll: RegExp[];
  /** Matches a yes/no question at the start of a lowercased card front. */
  yesNoFront: RegExp;
  /** Bare yes/no answers, lowercased. */
  yesNoBack: string[];
  /** Matches a "don't know" option label. */
  dontKnow: RegExp;
  /** Letters folded to one form before text comparison. */
  fold: Record<string, string>;
  /** Lowercase letters mapped to Latin for slugs. */
  translit: Record<string, string>;
  /** Title words that pick a topic card's picture, tried in TOPIC_ART order. */
  topicArt: Partial<Record<TopicArt, RegExp>>;
};

/** Topic pictures in match order: an earlier one wins when a title matches several. */
export const TOPIC_ART = ["branch", "chart", "mat", "code", "brain", "calculator", "flask", "palette", "note", "globe", "gear", "leaf", "book", "bulb"] as const;
export type TopicArt = (typeof TOPIC_ART)[number];

export const CATALOGS: Record<Lang, Catalog> = { en, ru };
export const CONTENT_RULES: Record<Lang, ContentRules> = { en: enContent, ru: ruContent };

export function isLang(value: unknown): value is Lang {
  return typeof value === "string" && (LANGS as readonly string[]).includes(value);
}

const pluralRules = new Map<Lang, Intl.PluralRules>();

function pick(lang: Lang, entry: Plural, n: number): string {
  let rules = pluralRules.get(lang);
  if (!rules) pluralRules.set(lang, (rules = new Intl.PluralRules(lang)));
  const form = rules.select(n);
  return (form === "one" || form === "few" || form === "many" ? entry[form] : undefined) ?? entry.other;
}

/** The message for `key` in `lang` with `{name}` placeholders filled from `params`. */
export function translate(lang: Lang, key: MessageKey, params?: Params): string {
  const entry = CATALOGS[lang][key];
  const text = typeof entry === "string" ? entry : pick(lang, entry, Number(params?.count ?? 0));
  return params ? text.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m)) : text;
}

/** Applies the letter folding of every supported language. */
export function foldLetters(text: string): string {
  let out = text;
  for (const rules of Object.values(CONTENT_RULES)) for (const [from, to] of Object.entries(rules.fold)) out = out.replaceAll(from, to);
  return out;
}
