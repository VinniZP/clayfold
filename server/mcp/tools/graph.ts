import { checkGraph } from "../../gates/deterministic";
import { defineTool, ToolError } from "../context";

export const graphSet = defineTool({
  name: "graph_set",
  description: `Create or update the topic's knowledge graph: nodes (a piece of knowledge or a skill) with their prerequisite node ids.
Call it during onboarding once you know what the learner needs, and again whenever the graph changes. Nodes are upserted by id: nodes you leave out stay as they are, and existing nodes keep the learner's placement and mastery.
The server rejects the whole call (isError) when an id repeats, a prerequisite is not a node (in this call or already stored), or prerequisites form a cycle; fix the graph and call again.
Returns {ok, total, added, updated}.`,
  handler(ctx, { nodes }) {
    const stored = new Map(
      ctx.db
        .query<{ id: string; prereqs: string }, [string]>("SELECT id, prereqs FROM nodes WHERE topic_id = ?")
        .all(ctx.topicId)
        .map((r) => [r.id, JSON.parse(r.prereqs) as string[]]),
    );
    const violations = checkGraph(nodes, stored);
    if (violations.length > 0) throw new ToolError("the graph is invalid; nothing was stored", violations);
    const upsert = ctx.db.query(
      `INSERT INTO nodes (topic_id, id, title, kind, summary, prereqs) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (topic_id, id) DO UPDATE SET title = excluded.title, kind = excluded.kind, summary = excluded.summary, prereqs = excluded.prereqs`,
    );
    ctx.db.transaction(() => {
      for (const n of nodes) upsert.run(ctx.topicId, n.id, n.title, n.kind, n.summary, JSON.stringify(n.prereqs));
    })();
    ctx.publish({ type: "graph.updated" });
    const added = nodes.filter((n) => !stored.has(n.id)).length;
    return { result: { ok: true, total: new Set([...stored.keys(), ...nodes.map((n) => n.id)]).size, added, updated: nodes.length - added } };
  },
});

export const placementRecord = defineTool({
  name: "placement_record",
  description: `Record what the learner already knows about one graph node, from a placement question such as "what is the first step?".
outcome: known (they could start correctly), partial (right direction, gaps), unknown. evidence: what they answered, in a sentence.
Lessons for novices use worked examples first; for known nodes they go straight to problems (L5). Returns {ok}.`,
  handler(ctx, { nodeId, outcome, evidence }) {
    const res = ctx.db
      .query("UPDATE nodes SET placement = ?, placement_evidence = ? WHERE topic_id = ? AND id = ?")
      .run(outcome, evidence, ctx.topicId, nodeId);
    if (res.changes === 0) throw new ToolError(`node "${nodeId}" is not in the knowledge graph; call graph_set first`);
    ctx.publish({ type: "graph.updated" });
    return { result: { ok: true } };
  },
});
