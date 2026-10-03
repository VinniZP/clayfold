import { describe, expect, test } from "bun:test";
import { derivePhases, firstSuccessCriterion, type OnboardingFacts } from "./onboarding";

const MISSION = `# Mission: Git basics\n\n## Why\nKeep a version history.\n\n## Success means\n- in 5 minutes I create a repository, commit and roll a file back to an earlier version\n- second\n`;
const fresh: OnboardingFacts = { mission: null, okSources: 0, publishers: 0, nodes: 0, placed: 0, running: true, stopped: false };
const statuses = (f: OnboardingFacts) => derivePhases(f).map((p) => `${p.key}:${p.status}`);

describe("derivePhases", () => {
  test("fresh topic: interview active, the rest pending", () => {
    expect(statuses(fresh)).toEqual(["interview:active", "mission:pending", "sources:pending", "graph:pending", "placement:pending"]);
    expect(derivePhases(fresh).map((p) => p.label)).toEqual(["Interview", "Mission", "Sources", "Knowledge map", "Level"]);
  });

  test("mid-sources: mission done with its first criterion, sources active with a count", () => {
    const phases = derivePhases({ ...fresh, mission: MISSION, okSources: 2, publishers: 1 });
    expect(phases.map((p) => p.status)).toEqual(["done", "done", "active", "pending", "pending"]);
    expect(phases[1]!.detail).toBe("in 5 minutes I create a repository, commit and roll a file…");
    expect(phases[2]!.detail).toBe("2 sources · 1 publisher");
  });

  test("sources are done only with at least 8 sources from at least 4 publishers", () => {
    const sources = (okSources: number, publishers: number) =>
      derivePhases({ ...fresh, mission: MISSION, okSources, publishers, nodes: 3 })[2]!.status;
    expect(sources(12, 3)).toBe("active");
    expect(sources(7, 5)).toBe("active");
    expect(sources(8, 4)).toBe("done");
  });

  test("idle waiting for the learner keeps the phase active; a failed last turn leaves none active", () => {
    expect(statuses({ ...fresh, running: false })[0]).toBe("interview:active");
    expect(derivePhases({ ...fresh, running: false, stopped: true }).every((p) => p.status === "pending")).toBe(true);
  });

  test("all done: none active; placement waits for the run to end", () => {
    const all = { ...fresh, mission: MISSION, okSources: 9, publishers: 5, nodes: 14, placed: 3 };
    expect(statuses(all).at(-1)).toBe("placement:active");
    const phases = derivePhases({ ...all, running: false });
    expect(phases.every((p) => p.status === "done")).toBe(true);
    expect(phases.map((p) => p.detail).slice(2)).toEqual(["9 sources · 5 publishers", "14 topics", "3 marked"]);
  });
});

test("firstSuccessCriterion without the section is null", () => {
  expect(firstSuccessCriterion("# Mission: Git\n\n## Why\n- x\n")).toBeNull();
});
