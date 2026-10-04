import type { TeachbackFinishResult } from "../../../shared/tools";
import { runJsonPrompt } from "../../claude/oneshot";
import { finishTeachback } from "../../routes/teachback";
import { defineTool, ToolError } from "../context";

export const teachbackFinish = defineTool({
  name: "teachback_finish",
  description: `End a teach-back once your follow-up questions are answered: the platform checks the learner's explanation against the lesson and shows them a debrief. teachbackId: the id in the teach-back context. Call it after your closing line, as your last action. Returns {ok, instruction}.`,
  handler(ctx, { teachbackId }) {
    if (!ctx.db.query("SELECT 1 FROM teachbacks WHERE id = ? AND topic_id = ?").get(teachbackId, ctx.topicId)) {
      throw new ToolError(`teach-back "${teachbackId}" is not a teach-back of this topic`);
    }
    try {
      finishTeachback(teachbackId, "persona", { database: ctx.db, runPrompt: runJsonPrompt, publish: (_, event) => ctx.publish(event) });
    } catch (e) {
      throw new ToolError(e instanceof Error ? e.message : String(e));
    }
    const result: TeachbackFinishResult = { ok: true, instruction: "End your turn now; the learner sees the debrief." };
    return { result };
  },
});
