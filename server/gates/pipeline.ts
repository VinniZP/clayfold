import type { Database } from "bun:sqlite";
import type { z } from "zod";
import { Card, Item, Step, type Bloom, type Level } from "../../shared/schemas";
import type { Violation } from "../../shared/rules";
import { newId } from "../db";
import { cardCites, itemCites, itemSurface, stepCites, stepItems, type ItemRole } from "./content";
import { criticEnabled, critiqueCards, critiqueItem, critiqueStep, type CriticRunner, type CriticVerdict } from "./critic";
import { checkCard, checkDuplicates, checkItem, checkStep, HIGHER_BLOOM, Report } from "./deterministic";
import { checkLessonDiversity } from "./diversity";
import { checkCites } from "./quotes";
import { checkTermMarks, glossaryKeys } from "./terms";
import { stripTermMarksDeep } from "../../shared/terms";

// schema -> deterministic -> quotes -> critic. A stage runs only when every earlier stage passed;
// every check that ran is recorded, passes included, for the audit page.

export type Stage = "schema" | "deterministic" | "quotes" | "critic";
export type GateRecord = { stage: Stage; rule: string; pass: boolean; message: string };
export type GateRun = { violations: Violation[]; records: GateRecord[] };

export type GateDeps = { db: Database; critic?: CriticRunner };

export const CRITIC_UNAVAILABLE = "critic unavailable, resubmit";

/** True when the only violation is a critic outage, which says nothing about the content. */
export function criticOutage(violations: Violation[]): boolean {
  return violations.length === 1 && violations[0]!.rule === "S1" && violations[0]!.message.startsWith(CRITIC_UNAVAILABLE);
}

function schemaStage<T>(schema: z.ZodType<T>, value: unknown, prefix = ""): { ok: true; value: T; run: GateRun } | { ok: false; run: GateRun } {
  const parsed = schema.safeParse(value);
  if (parsed.success) return { ok: true, value: parsed.data, run: { violations: [], records: [{ stage: "schema", rule: "S1", pass: true, message: "ok" }] } };
  const violations: Violation[] = parsed.error.issues.map((i) => ({
    rule: "S1",
    message: i.message,
    path: [prefix, ...i.path.map(String)].filter(Boolean).join("."),
  }));
  return { ok: false, run: { violations, records: violations.map((v) => ({ stage: "schema", rule: "S1", pass: false, message: withPath(v) })) } };
}

const withPath = (v: Violation) => (v.path ? `${v.path}: ${v.message}` : v.message);

function reportStage(stage: Stage, r: Report, run: GateRun): boolean {
  for (const rule of r.checked) {
    if (!r.violations.some((v) => v.rule === rule)) run.records.push({ stage, rule, pass: true, message: "ok" });
  }
  for (const v of r.violations) run.records.push({ stage, rule: v.rule, pass: false, message: withPath(v) });
  run.violations.push(...r.violations);
  return r.violations.length === 0;
}

function quoteStage(db: Database, topicId: string, cites: ReturnType<typeof stepCites>, run: GateRun): boolean {
  const r = new Report();
  if (cites.length > 0) r.merge(checkCites(db, topicId, cites), "Q6");
  return reportStage("quotes", r, run);
}

function criticStage(verdict: CriticVerdict, run: GateRun): void {
  if (!verdict.ok) {
    const v: Violation = { rule: "S1", message: `${CRITIC_UNAVAILABLE} (${verdict.error.slice(0, 300)})` };
    run.violations.push(v);
    run.records.push({ stage: "critic", rule: "S1", pass: false, message: v.message });
    return;
  }
  for (const c of verdict.checks) {
    run.records.push({ stage: "critic", rule: c.rule, pass: c.pass, message: c.path ? `${c.path}: ${c.message}` : c.message });
    if (!c.pass) run.violations.push(c.path === undefined ? { rule: c.rule, message: c.message } : { rule: c.rule, message: c.message, path: c.path });
  }
}

function checkNodes(db: Database, topicId: string, refs: { nodeId: string; path: string }[], r: Report): void {
  if (refs.length === 0) return;
  r.check("S1");
  const known = new Set(db.query<{ id: string }, [string]>("SELECT id FROM nodes WHERE topic_id = ?").all(topicId).map((n) => n.id));
  for (const ref of refs) {
    if (!known.has(ref.nodeId)) r.fail("S1", `node "${ref.nodeId}" is not in the knowledge graph`, `${ref.path}.nodeId`);
  }
}

function activeSurfaces(db: Database, topicId: string, excludeItemId?: string): string[] {
  return db
    .query<{ content: string }, [string, string]>("SELECT content FROM items WHERE topic_id = ? AND status = 'active' AND id != ?")
    .all(topicId, excludeItemId ?? "")
    .map((row) => itemSurface(stripTermMarksDeep(JSON.parse(row.content) as Item)));
}

/** Blooms of the lesson's graded items; ungraded prequestions (activate) do not count toward Q5. */
function lessonBlooms(db: Database, lessonId: string): Bloom[] {
  return db
    .query<{ content: string }, [string]>("SELECT content FROM items WHERE lesson_id = ? AND role != 'activate'")
    .all(lessonId)
    .map((row) => (JSON.parse(row.content) as Item).bloom);
}

export async function gateStep(
  deps: GateDeps,
  input: { topicId: string; lessonId: string; level: Level; step: unknown; displayOrders: (number[] | null)[]; challenge?: boolean },
): Promise<GateRun> {
  const schema = schemaStage(Step, input.step);
  if (!schema.ok) return schema.run;
  // Every check below reads the text as the learner sees it; the marks themselves are checked once, here.
  const step = stripTermMarksDeep(schema.value);
  const run = schema.run;

  const det = await checkStep(step, { existingSurfaces: activeSurfaces(deps.db, input.topicId), lessonBlooms: lessonBlooms(deps.db, input.lessonId) });
  if (input.challenge && step.kind === "practice") {
    det.check("G1");
    if (!HIGHER_BLOOM.has(step.item.bloom)) det.fail("G1", `the challenge item is "${step.item.bloom}"; a challenge is apply or higher`, "item.bloom");
  }
  checkNodes(deps.db, input.topicId, stepItems(step).map(({ item, path }) => ({ nodeId: item.nodeId, path })), det);
  checkLessonDiversity(deps.db, { topicId: input.topicId, lessonId: input.lessonId, step }, det);
  checkTermMarks(schema.value, "step", glossaryKeys(deps.db, input.topicId), det);
  if (!reportStage("deterministic", det, run)) return run;
  if (!quoteStage(deps.db, input.topicId, stepCites(step), run)) return run;
  if (criticEnabled()) criticStage(await critiqueStep(step, { level: input.level, displayOrders: input.displayOrders }, deps.critic), run);
  return run;
}

export async function gateItem(
  deps: GateDeps,
  input: { topicId: string; item: unknown; role: ItemRole; replacesItemId: string; displayOrder: number[] | null },
): Promise<GateRun> {
  const schema = schemaStage(Item, input.item, "item");
  if (!schema.ok) return schema.run;
  const item = stripTermMarksDeep(schema.value);
  const run = schema.run;

  const r = new Report();
  checkItem(item, "item", input.role, r);
  checkTermMarks(schema.value, "item", glossaryKeys(deps.db, input.topicId), r, "item");
  checkNodes(deps.db, input.topicId, [{ nodeId: item.nodeId, path: "item" }], r);
  checkDuplicates([{ item, path: "item" }], activeSurfaces(deps.db, input.topicId, input.replacesItemId), r);
  if (!reportStage("deterministic", r, run)) return run;
  if (!quoteStage(deps.db, input.topicId, itemCites(item, "item"), run)) return run;
  if (criticEnabled()) criticStage(await critiqueItem(item, input.displayOrder, deps.critic), run);
  return run;
}

/** Gates each card on its own; the critic sees all cards that passed the earlier stages in one call. */
export async function gateCards(deps: GateDeps, input: { topicId: string; cards: unknown[]; pathPrefix?: string }): Promise<GateRun[]> {
  const prefix = input.pathPrefix ?? "cards";
  const runs: GateRun[] = [];
  const passed: { index: number; card: Card }[] = [];
  const glossary = glossaryKeys(deps.db, input.topicId);
  input.cards.forEach((raw, index) => {
    const path = `${prefix}.${index}`;
    const schema = schemaStage(Card, raw, path);
    runs.push(schema.run);
    if (!schema.ok) return;
    const card = stripTermMarksDeep(schema.value);
    const r = new Report();
    checkCard(card, path, r);
    checkTermMarks(schema.value, "card", glossary, r, path);
    checkNodes(deps.db, input.topicId, [{ nodeId: card.nodeId, path }], r);
    if (!reportStage("deterministic", r, schema.run)) return;
    if (!quoteStage(deps.db, input.topicId, cardCites(card, path), schema.run)) return;
    passed.push({ index, card });
  });
  if (passed.length === 0 || !criticEnabled()) return runs;

  const verdict = await critiqueCards(passed.map((p) => p.card), deps.critic);
  passed.forEach(({ index }, k) => {
    const own: CriticVerdict = verdict.ok
      ? {
          ok: true,
          checks: verdict.checks
            .filter((c) => c.path === `cards.${k}` || c.path?.startsWith(`cards.${k}.`))
            .map((c) => ({ ...c, path: c.path!.replace(`cards.${k}`, `${prefix}.${index}`) })),
        }
      : verdict;
    criticStage(own, runs[index]!);
  });
  return runs;
}

export function recordGates(db: Database, target: { type: "step" | "item" | "card"; id: string; attempt: number }, records: GateRecord[]): void {
  const insert = db.query(
    "INSERT INTO gate_results (id, target_type, target_id, attempt, stage, rule, pass, message) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  );
  db.transaction(() => {
    for (const r of records) insert.run(newId("gate"), target.type, target.id, target.attempt, r.stage, r.rule, r.pass ? 1 : 0, r.message);
  })();
}
