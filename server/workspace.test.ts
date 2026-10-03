import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "./db";
import { missionTitle, slugify, syncAllTopicTitles, syncTopicTitle } from "./workspace";

test("slugify transliterates Russian, drops punctuation and cuts at a word boundary", () => {
  expect(slugify("Git basics: branches & merging")).toBe("git-basics-branches-merging");
  expect(slugify("Основы git: ветки и слияния")).toBe("osnovy-git-vetki-i-sliyaniya");
  expect(slugify("Bayesian statistics for beginner data analysts")).toBe("bayesian-statistics-for-beginner-data");
  expect(slugify("Café déjà vu")).toBe("cafe-deja-vu");
  expect(slugify("!!!")).toBe("topic");
});

describe("topic title from MISSION.md", () => {
  test("missionTitle reads «# <word>: <name>» from the first heading only", () => {
    expect(missionTitle("# Mission: LLM agent patterns\n\n## Why\n…")).toBe("LLM agent patterns");
    expect(missionTitle("\n#Mission:   Git basics  \n")).toBe("Git basics");
    expect(missionTitle("# Миссия: Основы git")).toBe("Основы git");
    expect(missionTitle("# Mission\n\n## Mission: not the first heading")).toBeNull();
    expect(missionTitle("Mission: no heading")).toBeNull();
  });

  test("syncAllTopicTitles updates titles from workspaces and keeps the request", () => {
    const root = mkdtempSync(join(tmpdir(), "clayfold-ws-"));
    const database = openDb(":memory:");
    const add = database.query("INSERT INTO topics (id, slug, title, request) VALUES (?, ?, ?, ?)");
    add.run("t1", "named", "I want to understand agents", "I want to understand agents");
    add.run("t2", "plain", "Git basics", "Git basics");
    add.run("t3", "missing", "No mission", "No mission");
    mkdirSync(join(root, "named"));
    writeFileSync(join(root, "named", "MISSION.md"), "# Mission: LLM agent patterns\n");
    mkdirSync(join(root, "plain"));
    writeFileSync(join(root, "plain", "MISSION.md"), "# Mission\n");
    const workspaceOf = (slug: string) => join(root, slug);

    expect(syncAllTopicTitles(database, workspaceOf)).toBe(1);
    expect(database.query("SELECT id, title, request FROM topics ORDER BY id").all()).toEqual([
      { id: "t1", title: "LLM agent patterns", request: "I want to understand agents" },
      { id: "t2", title: "Git basics", request: "Git basics" },
      { id: "t3", title: "No mission", request: "No mission" },
    ]);
    expect(syncTopicTitle("t1", "named", database, workspaceOf)).toBe(false); // unchanged
  });
});
