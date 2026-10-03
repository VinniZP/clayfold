import { expect, test } from "bun:test";
import { toolArgs } from "./scope";

const parse = (kind: Parameters<typeof toolArgs>[0]) => {
  const args = toolArgs(kind);
  const value = (flag: string) => (args.includes(flag) ? args[args.indexOf(flag) + 1]!.split(",") : []);
  const short = (list: string[]) => list.map((t) => t.replace("mcp__plugin_clayfold_clayfold__", "")).sort();
  return { tools: value("--tools").sort(), allowed: short(value("--allowedTools")), denied: short(value("--disallowedTools")) };
};
const AUTHORING = ["cards_propose", "item_replace", "lesson_finish", "lesson_plan", "step_submit"];

test("tutor: memory tools and three plugin tools; every authoring tool removed", () => {
  const t = parse("tutor");
  expect(t.tools).toEqual(["Edit", "Glob", "Grep", "Read", "Write"]);
  expect(t.allowed).toEqual(["Edit", "Glob", "Grep", "Read", "Write", "ask_learner", "get_learner_state", "source_search"]);
  expect(t.denied).toEqual([...AUTHORING, "graph_set", "placement_record", "source_add"].sort());
});

test("review adds item_replace; onboard has the web and graph tools but cannot author; lesson has everything", () => {
  expect(parse("review").allowed).toContain("item_replace");
  expect(parse("review").denied).not.toContain("item_replace");
  const onboard = parse("onboard");
  expect(onboard.tools).toContain("WebSearch");
  expect(onboard.allowed).toEqual(expect.arrayContaining(["graph_set", "source_add", "placement_record", "ask_learner"]));
  expect(onboard.denied).toEqual(AUTHORING);
  expect(parse("lesson").denied).toEqual([]);
  expect(parse("lesson").allowed).toEqual(expect.arrayContaining([...AUTHORING, "source_add", "WebFetch"]));
});
