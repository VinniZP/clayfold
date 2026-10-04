import type { Database } from "bun:sqlite";
import type { z } from "zod";
import type { TopicEvent } from "../../shared/events";
import type { Violation } from "../../shared/rules";
import type { PublicStep } from "../../shared/schemas";
import { TOOL_INPUTS, type ToolName } from "../../shared/tools";
import type { ExaClient } from "../exa";
import type { CriticRunner } from "../gates/critic";

export type ToolContext = {
  db: Database;
  topicId: string;
  publish: (event: TopicEvent) => void;
  critic?: CriticRunner;
  fetch?: typeof fetch;
  publicStep: (db: Database, stepId: string) => PublicStep;
  /** Gamification is on: the tool accepts its GAME_FIELDS. */
  game: boolean;
  /** The learner's Exa key, or null: source_discover offers "web" only with one. Never part of a result. */
  exaKey: string | null;
  exa?: ExaClient;
};

export type ToolInput<K extends ToolName> = z.infer<z.ZodObject<(typeof TOOL_INPUTS)[K]>>;

/** `result` is serialized as the JSON text content; each note becomes an extra plain-text content block. */
export type ToolReply = { result: unknown; notes?: string[] };

export type ToolDef<K extends ToolName = ToolName> = {
  name: K;
  description: string;
  /** Appended to the description while gamification is on. */
  gameDescription?: string;
  /** Appended to the description while an Exa key is set. */
  webDescription?: string;
  handler: (ctx: ToolContext, input: ToolInput<K>) => ToolReply | Promise<ToolReply>;
};

export const defineTool = <K extends ToolName>(def: ToolDef<K>): ToolDef<K> => def;

/** A failure reported to Claude as an error result (isError: true). */
export class ToolError extends Error {
  constructor(
    message: string,
    readonly violations: Violation[] = [],
  ) {
    super(message);
  }
}
