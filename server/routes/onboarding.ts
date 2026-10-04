import type { Database } from "bun:sqlite";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { OnboardingPhase } from "../../shared/api";
import { isRunning } from "../claude/runner";
import { paths } from "../config";
import { db } from "../db";
import { t } from "../i18n";
import { LEARNER_PUBLISHER, publisherCounts } from "../publishers";

export type OnboardingFacts = {
  /** MISSION.md content, or null when the file does not exist. */
  mission: string | null;
  /** Ok sources Claude registered; the learner's materials are counted in `materials`. */
  okSources: number;
  /** Distinct publishers among those sources. */
  publishers: number;
  materials: number;
  nodes: number;
  placed: number;
  /** Goals only: entries of the plan. */
  planned: number;
  /** The onboarding conversation has a run in progress. */
  running: boolean;
  /** The onboarding conversation's last turn ended in an error or a cancel. */
  stopped: boolean;
};

const MIN_SOURCES = 8;
const MIN_PUBLISHERS = 4;
const DETAIL_CHARS = 60;

/** The first bullet of MISSION.md's second "##" section, which the mission format reserves for success criteria. */
export function firstSuccessCriterion(mission: string): string | null {
  const lines = mission.split("\n");
  const heading = lines.flatMap((l, i) => (/^##\s/.test(l.trim()) ? [i] : []))[1];
  if (heading === undefined) return null;
  for (const line of lines.slice(heading + 1)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#")) return null;
    const bullet = trimmed.match(/^(?:[-*+]|\d+[.)])\s+(.+)$/);
    if (bullet) {
      const text = bullet[1]!.trim();
      return text.length > DETAIL_CHARS ? `${text.slice(0, DETAIL_CHARS - 1).trimEnd()}…` : text;
    }
  }
  return null;
}

/**
 * The five onboarding phases in order. The first phase not done is active while onboarding is in progress:
 * a run is going, or the learner is being waited on. A last turn that failed or was cancelled leaves none active.
 */
export function derivePhases(f: OnboardingFacts): OnboardingPhase[] {
  const hasMission = f.mission !== null;
  const phases: Omit<OnboardingPhase, "status">[] = [
    { key: "interview", label: t("onboarding.interview"), detail: null },
    { key: "mission", label: t("onboarding.mission"), detail: f.mission !== null ? firstSuccessCriterion(f.mission) : null },
    {
      key: "sources",
      label: t("onboarding.sources"),
      detail:
        [
          f.materials ? t("material.count", { count: f.materials }) : null,
          f.okSources ? `${t("onboarding.sourceCount", { count: f.okSources })} · ${t("onboarding.publisherCount", { count: f.publishers })}` : null,
        ]
          .filter(Boolean)
          .join(" · ") || null,
    },
    { key: "graph", label: t("onboarding.graph"), detail: f.nodes ? t("onboarding.nodeCount", { count: f.nodes }) : null },
    { key: "placement", label: t("onboarding.placement"), detail: f.placed ? t("onboarding.placed", { count: f.placed }) : null },
  ];
  // Learner materials are the primary sources, and Claude searches only for their gaps, so the graph closes the phase.
  const sourcesDone = (f.okSources >= MIN_SOURCES && f.publishers >= MIN_PUBLISHERS) || (f.materials >= 1 && f.nodes >= 1);
  const done = [hasMission, hasMission, sourcesDone, f.nodes >= 1, f.placed >= 1 && !f.running];
  const inProgress = f.running || !f.stopped;
  const active = inProgress ? done.indexOf(false) : -1;
  return phases.map((p, i) => ({ ...p, status: done[i] ? "done" : i === active ? "active" : "pending" }));
}

/** A goal's two phases: the interview ends with MISSION.md, the plan with goal_plan_set and the end of the run. */
export function deriveGoalPhases(f: OnboardingFacts): OnboardingPhase[] {
  const phases: Omit<OnboardingPhase, "status">[] = [
    { key: "interview", label: t("onboarding.interview"), detail: f.mission !== null ? firstSuccessCriterion(f.mission) : null },
    { key: "plan", label: t("onboarding.plan"), detail: f.planned ? t("onboarding.courseCount", { count: f.planned }) : null },
  ];
  const done = [f.mission !== null, f.planned >= 1 && !f.running];
  const active = f.running || !f.stopped ? done.indexOf(false) : -1;
  return phases.map((p, i) => ({ ...p, status: done[i] ? "done" : i === active ? "active" : "pending" }));
}

export function onboardingFacts(topic: { id: string; slug: string }, database: Database = db()): OnboardingFacts {
  const missionFile = join(paths.workspace(topic.slug), "MISSION.md");
  const counts = database
    .query<{ sources: number; materials: number; nodes: number; placed: number; planned: number }, [string, string, string, string, string]>(
      `SELECT
         (SELECT count(*) FROM sources WHERE topic_id = ? AND status = 'ok' AND origin = 'web') AS sources,
         (SELECT count(*) FROM sources WHERE topic_id = ? AND status = 'ok' AND origin = 'learner') AS materials,
         (SELECT count(*) FROM nodes WHERE topic_id = ?) AS nodes,
         (SELECT count(*) FROM nodes WHERE topic_id = ? AND placement IS NOT NULL) AS placed,
         (SELECT count(*) FROM goal_plan WHERE goal_id = ?) AS planned`,
    )
    .get(topic.id, topic.id, topic.id, topic.id, topic.id)!;
  const conv = database
    .query<{ id: string; last_role: string | null }, [string]>(
      `SELECT c.id, (SELECT role FROM messages WHERE conversation_id = c.id ORDER BY rowid DESC LIMIT 1) AS last_role
       FROM conversations c WHERE c.topic_id = ? AND c.kind = 'onboard' ORDER BY c.created_at DESC, c.rowid DESC LIMIT 1`,
    )
    .get(topic.id);
  const running = conv ? isRunning(conv.id) : false;
  return {
    mission: existsSync(missionFile) ? readFileSync(missionFile, "utf8") : null,
    okSources: counts.sources,
    publishers: Object.keys(publisherCounts(topic.id, database)).filter((p) => p !== LEARNER_PUBLISHER).length,
    materials: counts.materials,
    nodes: counts.nodes,
    placed: counts.placed,
    planned: counts.planned,
    running,
    stopped: !conv || (!running && conv.last_role === "error"),
  };
}
