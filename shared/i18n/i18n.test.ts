import { expect, test } from "bun:test";
import { CATALOGS, LANGS, translate, type Entry, type MessageKey } from ".";

const placeholders = (entry: Entry) =>
  [...new Set((typeof entry === "string" ? [entry] : Object.values(entry)).flatMap((s) => s.match(/\{\w+\}/g) ?? []))].sort();

test("every translation uses the placeholders of its English source", () => {
  for (const lang of LANGS) {
    for (const key of Object.keys(CATALOGS.en) as MessageKey[]) {
      expect([lang, key, placeholders(CATALOGS[lang][key])]).toEqual([lang, key, placeholders(CATALOGS.en[key])]);
    }
  }
});

test("plural forms follow the language's rules", () => {
  expect([1, 2].map((count) => translate("en", "onboarding.nodeCount", { count }))).toEqual(["1 topic", "2 topics"]);
  expect([1, 2, 5, 11, 12, 21, 22, 25, 111].map((count) => translate("ru", "onboarding.nodeCount", { count }))).toEqual([
    "1 тема", "2 темы", "5 тем", "11 тем", "12 тем", "21 тема", "22 темы", "25 тем", "111 тем",
  ]);
});

test("unknown placeholders stay as written", () => {
  expect(translate("en", "activity.stepCheck", {})).toBe("Checking step {n}");
});
