import { afterEach, expect, test } from "bun:test";
import { openDb } from "./db";
import { language, languageInstruction, loadLanguage, setLanguage, t } from "./i18n";

const database = openDb(":memory:");
afterEach(() => setLanguage("en", database));

test("English until a language is set; the stored setting is read back on start", () => {
  loadLanguage(database);
  expect(language()).toBe("en");
  expect(t("grading.right")).toBe("Correct.");

  setLanguage("ru", database);
  loadLanguage(openDb(":memory:"));
  expect(language()).toBe("en");
  loadLanguage(database);
  expect(language()).toBe("ru");
  expect(languageInstruction()).toContain("Write everything the learner sees in Russian");
});

test("an unknown stored value falls back to English", () => {
  database.query("INSERT INTO settings (key, value) VALUES ('language', '\"xx\"') ON CONFLICT (key) DO UPDATE SET value = excluded.value").run();
  loadLanguage(database);
  expect(language()).toBe("en");
});
