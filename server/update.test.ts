import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspect, install } from "./update";

const BUILD_OK = { scripts: { build: "echo built > built.txt" } };
const BUILD_FAILS = { scripts: { build: "exit 1" } };

function git(cwd: string, ...args: string[]): string {
  const out = Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", "-c", "init.defaultBranch=main", ...args], { cwd });
  if (out.exitCode !== 0) throw new Error(out.stderr.toString());
  return out.stdout.toString().trim();
}

function commit(cwd: string, file: string, content: string, subject: string): void {
  writeFileSync(join(cwd, file), content);
  git(cwd, "add", file);
  git(cwd, "commit", "-q", "-m", subject);
}

/** An origin repository with one commit and a clone of it; `upstream` pushes new commits to origin. */
function repos() {
  const dir = mkdtempSync(join(tmpdir(), "clayfold-update-"));
  const upstream = join(dir, "upstream");
  const clone = join(dir, "clone");
  git(dir, "init", "-q", "--bare", "origin.git");
  git(dir, "clone", "-q", join(dir, "origin.git"), upstream);
  commit(upstream, "package.json", JSON.stringify(BUILD_OK), "first");
  commit(upstream, ".gitignore", "built.txt\n", "ignore build output");
  git(upstream, "push", "-q", "origin", "main");
  git(dir, "clone", "-q", join(dir, "origin.git"), clone);
  const publish = (file: string, content: string, subject: string) => {
    commit(upstream, file, content, subject);
    git(upstream, "push", "-q", "origin", "main");
  };
  return { clone, publish };
}

describe("inspect", () => {
  test("lists origin/main commits missing from HEAD, newest first", async () => {
    const { clone, publish } = repos();
    expect((await inspect(clone)).commits).toEqual([]);
    publish("a.txt", "a", "feat: a");
    publish("b.txt", "b", "fix: b\twith a tab");
    const found = await inspect(clone);
    expect(found.commits.map((c) => c.subject)).toEqual(["fix: b\twith a tab", "feat: a"]);
    expect(found.version).toBe(git(clone, "rev-parse", "--short", "HEAD"));
    expect(found.blocked).toBeNull();
  });

  test("blocks a checkout with changes to tracked files, but not with untracked ones", async () => {
    const { clone, publish } = repos();
    publish("a.txt", "a", "feat: a");
    writeFileSync(join(clone, "notes.txt"), "untracked");
    expect((await inspect(clone)).blocked).toBeNull();
    writeFileSync(join(clone, ".gitignore"), "changed\n");
    expect((await inspect(clone)).blocked).toBe("dirty");
  });

  test("blocks a checkout on another branch or with commits origin/main lacks", async () => {
    const { clone, publish } = repos();
    publish("a.txt", "a", "feat: a");
    git(clone, "checkout", "-q", "-b", "work");
    expect((await inspect(clone)).blocked).toBe("branch");
    git(clone, "checkout", "-q", "main");
    commit(clone, "local.txt", "local", "local work");
    expect((await inspect(clone)).blocked).toBe("ahead");
  });
});

describe("install", () => {
  test("fast-forwards to the target and builds", async () => {
    const { clone, publish } = repos();
    publish("a.txt", "a", "feat: a");
    const { target } = await inspect(clone);
    await install(clone, target);
    expect(git(clone, "rev-parse", "HEAD")).toBe(target);
    expect(readFileSync(join(clone, "built.txt"), "utf8").trim()).toBe("built");
  });

  test("a failed build returns the checkout to the previous commit and builds it again", async () => {
    const { clone, publish } = repos();
    const before = git(clone, "rev-parse", "HEAD");
    publish("package.json", JSON.stringify(BUILD_FAILS), "break the build");
    const { target } = await inspect(clone);
    await expect(install(clone, target)).rejects.toThrow("run build exited 1");
    expect(git(clone, "rev-parse", "HEAD")).toBe(before);
    expect(git(clone, "status", "--porcelain")).toBe("");
    expect(readFileSync(join(clone, "built.txt"), "utf8").trim()).toBe("built");
  });
});
