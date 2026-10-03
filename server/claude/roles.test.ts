import { beforeEach, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { config } from "../config";
import { openDb } from "../db";
import { effortArgs, roleRun, roleSettingsView, setRoleSetting } from "./roles";

let database: Database;
beforeEach(() => {
  database = openDb(":memory:");
});

test("a role without a setting runs on the configured model and the role's default effort", () => {
  expect(roleRun("lesson", database)).toEqual({ model: config.model, effort: "high" });
  expect(roleRun("grading", database)).toEqual({ model: config.criticModel, effort: "low" });
});

test("a saved setting overrides the defaults of its role only", () => {
  setRoleSetting("tutor", { model: "sonnet", effort: "low" }, database);
  setRoleSetting("critic", { model: null, effort: "high" }, database);
  expect(roleRun("tutor", database)).toEqual({ model: "sonnet", effort: "low" });
  expect(roleRun("critic", database)).toEqual({ model: config.criticModel, effort: "high" });
  expect(roleSettingsView(database).tutor).toEqual({ model: "sonnet", effort: "low", defaultModel: config.model, defaultEffort: "low" });
});

test("unknown stored values fall back to the defaults", () => {
  database.query("INSERT INTO settings (key, value) VALUES ('claude_roles', ?)").run(JSON.stringify({ tutor: { model: "gpt", effort: "huge" } }));
  expect(roleRun("tutor", database)).toEqual({ model: config.model, effort: "low" });
});

test("haiku runs without --effort", () => {
  setRoleSetting("narration", { model: "haiku", effort: "high" }, database);
  expect(roleRun("narration", database)).toEqual({ model: "haiku", effort: null });
  expect(effortArgs(null)).toEqual([]);
  expect(effortArgs("low")).toEqual(["--effort", "low"]);
});
