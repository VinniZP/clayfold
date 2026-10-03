import type { Database } from "bun:sqlite";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { TOOL_INPUTS } from "../../shared/tools";
import { db as sharedDb } from "../db";
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
import { itemReplace } from "./tools/replace";
import { sourceAdd, sourceSearch } from "./tools/sources";

export const TOOLS: ToolDef<any>[] = [
  askLearner,
  sourceAdd,
  sourceSearch,
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
  getLearnerState,
  itemReplace,
];

export type McpDeps = Partial<Omit<ToolContext, "topicId" | "db" | "publish">> & {
  db?: () => Database;
  publish?: (topicId: string, event: Parameters<ToolContext["publish"]>[0]) => void;
};

function stepToPublic(database: Database, stepId: string) {
  const row = database.query<StepRow, [string]>("SELECT id, lesson_id, idx, kind, content, status FROM steps WHERE id = ?").get(stepId);
  if (!row) throw new Error(`step ${stepId} not found`);
  return publicStep(row, database);
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
    const ctx: ToolContext | null = known
      ? {
          db: database,
          topicId,
          publish: (event) => (deps.publish ?? hubPublish)(topicId, event),
          critic: deps.critic,
          fetch: deps.fetch,
          publicStep: deps.publicStep ?? stepToPublic,
        }
      : null;
    const server = new McpServer({ name: "clayfold", version: "0.1.0" });
    for (const def of TOOLS) {
      server.registerTool(def.name, { description: def.description, inputSchema: TOOL_INPUTS[def.name as keyof typeof TOOL_INPUTS] }, ((input: unknown) =>
        invoke(def, ctx, input)) as never);
    }
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    return transport.handleRequest(req);
  };
}

const defaultHandler = createMcpHandler();

export function handleMcp(req: Request, topicId: string): Promise<Response> {
  return defaultHandler(req, topicId);
}
