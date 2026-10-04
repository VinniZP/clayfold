import type { Database } from "bun:sqlite";
import { beforeEach, describe, expect, test } from "bun:test";
import type { Step } from "../../shared/schemas";
import { openDb } from "../db";
import { recordWorkedLine, submitAttempt } from "./grading";
import { ALTERNATIVE_MAX_WORDS, checkAlternative, explainDifferently, lessonAlternatives, type AlternativeRunner } from "./alternatives";
import { insertStep, items, seed } from "./test-fixtures";

const cites = [{ sourceId: "src1", quote: "A verbatim quote from the source." }];

const explain: Step = {
  kind: "explain",
  title: "Commits",
  body: "A [[commit|Commit]] records a snapshot of the [[Staging area]].",
  cites,
  checks: [items.single("chk")],
};

const worked: Step = {
  kind: "worked_example",
  title: "Worked",
  problem: "Save the change.",
  cites,
  lines: [
    { text: "Stage the file" },
    { text: "SECRET-LINE-1 git commit", blank: { prompt: "Which command saves it?", answers: ["git commit"] } },
    { text: "SECRET-LINE-2 check the log" },
  ],
};

describe("explainDifferently", () => {
  let database: Database;
  let prompts: string[];
  let replies: string[];
  const run: AlternativeRunner = async <T>(opts: { prompt: string }) => {
    prompts.push(opts.prompt);
    const body = replies.shift();
    return body === undefined ? { ok: false as const, error: "no reply" } : { ok: true as const, value: { body } as T, costUsd: 0 };
  };
  const memory = (_slug: string, file: string) => (file === "MISSION.md" ? "## Interests and context\n- MISSION-INTERESTS" : null);
  const deps = () => ({ database, run, memory });

  beforeEach(() => {
    database = openDb(":memory:");
    seed(database);
    const term = database.query("INSERT INTO glossary_terms (topic_id, key, term, definition) VALUES ('tp1', ?, ?, ?)");
    term.run("commit", "Commit", "A snapshot saved in the repository.");
    term.run("staging area", "Staging area", "Where changes wait for the next commit.");
    term.run("branch", "Branch", "A movable pointer to a commit.");
    prompts = [];
    replies = [];
  });

  test("the prompt carries the step, its terms and the learner's interests, and none of the step's items (L7)", async () => {
    const { stepId } = insertStep(database, 1, explain);
    replies.push("Think of a [[commit|Commit]] as a photo.");
    const alt = await explainDifferently(stepId, "analogy", deps());
    expect(alt).toMatchObject({ lens: "analogy", body: "Think of a [[commit|Commit]] as a photo." });

    const [prompt] = prompts;
    for (const part of ["records a snapshot of the [[Staging area]]", "- Commit: A snapshot saved", "- Staging area: Where changes wait", "MISSION-INTERESTS", "do not answer, hint at or solve", "The learner's language is"]) {
      expect(prompt).toContain(part);
    }
    for (const part of ["Branch", "SECRET-", "Prompt chk", "key chk"]) expect(prompt).not.toContain(part);
  });

  test("a worked example shows the lines up to the first unanswered faded line, never its text or what follows", async () => {
    const { stepId } = insertStep(database, 1, worked);
    replies.push("First stage, then save.", "Again.");
    await explainDifferently(stepId, "simpler", deps());
    expect(prompts[0]).toContain("2. [Left for the learner to work out: Which command saves it?]");
    expect(prompts[0]).not.toContain("SECRET-LINE");

    recordWorkedLine(stepId, 1, "git commit", true, database);
    await explainDifferently(stepId, "simpler", deps());
    expect(prompts[1]).toContain("2. SECRET-LINE-1 git commit");
    expect(prompts[1]).toContain("3. SECRET-LINE-2 check the log");
    expect(prompts[1]).toContain("<earlier>\nFirst stage, then save.\n</earlier>");
  });

  test("an answer that breaks a check is retried once with the problem, then the call fails", async () => {
    const { stepId } = insertStep(database, 1, explain);
    replies.push("word ".repeat(ALTERNATIVE_MAX_WORDS + 1), "Short and [[clear|Clarity]].");
    const alt = await explainDifferently(stepId, "simpler", deps());
    expect(prompts[1]).toContain(`keep it within ${ALTERNATIVE_MAX_WORDS}`);
    expect(alt.body).toBe("Short and clear.");

    replies.push("## Heading\nText", "## Heading\nText");
    await expect(explainDifferently(stepId, "steps", deps())).rejects.toMatchObject({ status: 502 });
    expect(lessonAlternatives("ls1", database)[stepId]!.map((a) => a.lens)).toEqual(["simpler"]);
  });

  test("lenses follow the step kind; other steps have none", async () => {
    const { stepId } = insertStep(database, 1, worked);
    await expect(explainDifferently(stepId, "example", deps())).rejects.toMatchObject({ status: 400 });
    const practice = insertStep(database, 2, { kind: "practice", title: "Practice", item: items.single("p") });
    await expect(explainDifferently(practice.stepId, "simpler", deps())).rejects.toMatchObject({ status: 400 });
    expect(prompts).toEqual([]);
  });

  test("not available while the exit check is under way (L11)", async () => {
    const { stepId } = insertStep(database, 1, explain);
    const check = insertStep(database, 2, { kind: "check", title: "Check", items: [items.single("x1"), items.single("x2")] });
    const answer = (itemId: string) =>
      submitAttempt(itemId, { answer: { format: "single", choice: 0 }, hintsUsed: 0, durationMs: 9000, context: "check" }, { database });

    await answer(check.itemIds[0]!);
    await expect(explainDifferently(stepId, "simpler", deps())).rejects.toMatchObject({ status: 409 });
    expect(prompts).toEqual([]);

    await answer(check.itemIds[1]!);
    replies.push("After the check.");
    expect((await explainDifferently(stepId, "simpler", deps())).body).toBe("After the check.");
  });
});

test("marks of terms outside the topic glossary keep only their surface", () => {
  expect(checkAlternative(" A [[commit|Commit]] and a [[branch|Branch]]. ", new Set(["commit"]))).toEqual({ body: "A [[commit|Commit]] and a branch." });
  expect(checkAlternative("  ", new Set())).toEqual({ problem: "the explanation is empty" });
});
