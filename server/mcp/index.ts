import type { Database } from "bun:sqlite";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { DISCOVER_FREE, GAME_FIELDS, TOOL_INPUTS, type ToolName } from "../../shared/tools";
import { db as sharedDb } from "../db";
import { exaKey as storedExaKey, type SecretStore } from "../secrets";
import { gameOn } from "../game/state";
import { publish as hubPublish } from "../hub";
import { publicStep, type StepRow } from "../routes/public";
import { ToolError, type ToolContext, type ToolDef } from "./context";
import { cardsPropose } from "./tools/cards";
import { glossarySet } from "./tools/glossary";
import { workedLineRecord } from "./tools/worked";
import { goalNote, goalPlanSet } from "./tools/goal";
import { graphSet, placementRecord } from "./tools/graph";
import { askLearner, getLearnerState } from "./tools/learner";
import { lessonFinish, lessonPlan, stepSubmit } from "./tools/lessons";
import { practiceBriefTool } from "./tools/practice";
import { itemReplace } from "./tools/replace";
import { materialList, materialRead } from "./tools/materials";
import { sourceAdd, sourceDiscover, sourceRemove, sourceSearch } from "./tools/sources";
import { teachbackFinish } from "./tools/teachback";

export const TOOLS: ToolDef<any>[] = [
  askLearner,
  sourceAdd,
  sourceDiscover,
  sourceRemove,
  sourceSearch,
  materialList,
  materialRead,
  graphSet,
  placementRecord,
  lessonPlan,
  stepSubmit,
  lessonFinish,
  cardsPropose,
  goalPlanSet,
  goalNote,
  glossarySet,
  workedLineRecord,
  teachbackFinish,
  getLearnerState,
  itemReplace,
  practiceBriefTool,
];

export type McpDeps = Partial<Omit<ToolContext, "topicId" | "db" | "publish" | "exaKey">> & {
  db?: () => Database;
  publish?: (topicId: string, event: Parameters<ToolContext["publish"]>[0]) => void;
  exaKey?: SecretStore;
};

function stepToPublic(database: Database, stepId: string) {
  const row = database.query<StepRow, [string]>("SELECT id, lesson_id, idx, kind, content, status FROM steps WHERE id = ?").get(stepId);
  if (!row) throw new Error(`step ${stepId} not found`);
  return publicStep(row, database);
}

/**
 * A tool's input shape; without gamification its game fields are left out, so Claude neither sees nor sends them.
 * Without an Exa key, source_discover offers only the free catalogues.
 */
export function toolShape(name: ToolName, game: boolean, web = false) {
  const shape: Record<string, unknown> = { ...TOOL_INPUTS[name] };
  if (!game) for (const field of GAME_FIELDS[name] ?? []) delete shape[field];
  if (name === "source_discover" && !web) {
    shape.in = z.enum(DISCOVER_FREE);
    delete shape.since;
  }
  return shape as (typeof TOOL_INPUTS)[ToolName];
}

function text(value: unknown, notes: string[] = [], isError = false): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value) }, ...notes.map((n) => ({ type: "text" as const, text: n }))],
    ...(isError ? { isError: true } : {}),
  };
}

async function invoke(def: ToolDef<any>, ctx: ToolContext | null, input: unknown): Promise<CallToolResult> {
  if (!ctx) return text({ error: "unknown topic: the X-Clayfold-Topic header names no topic of this platform" }, [], true);
  try {
    const reply = await def.handler(ctx, input as never);
    return text(reply.result, reply.notes);
  } catch (e) {
    if (e instanceof ToolError) return text({ error: e.message, ...(e.violations.length > 0 ? { violations: e.violations } : {}) }, [], true);
    console.error(`[mcp] ${def.name} failed`, e);
    return text({ error: `internal error in ${def.name}: ${e instanceof Error ? e.message : String(e)}` }, [], true);
  }
}

/** Builds a stateless MCP endpoint: one server and transport per HTTP request. */
export function createMcpHandler(deps: McpDeps = {}) {
  return async (req: Request, topicId: string): Promise<Response> => {
    const database = (deps.db ?? sharedDb)();
    const known = topicId ? database.query("SELECT 1 FROM topics WHERE id = ?").get(topicId) : null;
    const game = gameOn(database);
    const exaKey = deps.exaKey ? await deps.exaKey.get().catch(() => null) : null;
    const ctx: ToolContext | null = known
      ? {
          db: database,
          topicId,
          game,
          exaKey,
          exa: deps.exa,
          publish: (event) => (deps.publish ?? hubPublish)(topicId, event),
          critic: deps.critic,
          fetch: deps.fetch,
          publicStep: deps.publicStep ?? stepToPublic,
        }
      : null;
    const server = new McpServer({ name: "clayfold", version: "0.1.0" });
    for (const def of TOOLS) {
      const description = [def.description, game && def.gameDescription, exaKey && def.webDescription].filter(Boolean).join("\n");
      server.registerTool(def.name, { description, inputSchema: toolShape(def.name, game, Boolean(exaKey)) }, ((input: unknown) => invoke(def, ctx, input)) as never);
    }
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    return transport.handleRequest(req);
  };
}

const defaultHandler = createMcpHandler({ exaKey: storedExaKey });

export function handleMcp(req: Request, topicId: string): Promise<Response> {
  return defaultHandler(req, topicId);
}
