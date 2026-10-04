import { useEffect } from "react";
import type { GlossaryEntry } from "@shared/api";
import { looseTermKey, termKey } from "@shared/terms";
import { api } from "./api";

// Every course's glossary, loaded on the first term the learner points at. A term a newer lesson added
// is missing from the loaded copy, so a miss reloads it, at most once per RELOAD_MS.

const RELOAD_MS = 30_000;

let entries: GlossaryEntry[] | null = null;
let loadedAt = 0;
let pending: Promise<void> | null = null;
let scopeTopicId: string | null = null;

function load(): Promise<void> {
  pending ??= api
    .glossary()
    .then((list) => {
      entries = list;
      loadedAt = Date.now();
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}

function find(matches: (e: GlossaryEntry) => boolean): GlossaryEntry | null {
  const found = (entries ?? []).filter(matches);
  return found.find((e) => e.topicId === scopeTopicId) ?? found[0] ?? null;
}

async function search(matches: (e: GlossaryEntry) => boolean): Promise<GlossaryEntry | null> {
  if (!entries) await load();
  const hit = find(matches);
  if (hit || Date.now() - loadedAt < RELOAD_MS) return hit;
  await load();
  return find(matches);
}

/** The term's entry, from the current course's glossary first, then from any other course. */
export function lookupTerm(term: string): Promise<GlossaryEntry | null> {
  const key = termKey(term);
  return search((e) => termKey(e.term) === key);
}

/** The entry whose term or original is the text the reader selected, looked up as lookupTerm does. */
export function matchTerm(text: string): Promise<GlossaryEntry | null> {
  const key = looseTermKey(text);
  if (!key) return Promise.resolve(null);
  return search((e) => looseTermKey(e.term) === key || (e.original !== null && looseTermKey(e.original) === key));
}

export const glossaryScope = () => scopeTopicId;

/** Marks the course a page belongs to, so its own definition wins when several courses define a term. */
export function useGlossaryScope(topicId: string | null) {
  useEffect(() => {
    scopeTopicId = topicId;
    return () => {
      if (scopeTopicId === topicId) scopeTopicId = null;
    };
  }, [topicId]);
}
