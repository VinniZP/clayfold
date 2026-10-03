import type { Blank } from "../../../shared/schemas";
import { recordWorkedLine } from "../../routes/grading";
import { defineTool, ToolError } from "../context";

export const workedLineRecord = defineTool({
  name: "worked_line_record",
  description: `Record the learner's result on a worked-example line they answered through you (the context names the step and line).
outcome "correct" once their answer covers every criterion by meaning, in any wording; "gave_up" when they give up or ask for the line. answer: their answer as they gave it. The lesson then shows the line's text to the learner. Returns {ok}.`,
  handler(ctx, { stepId, line, answer, outcome }) {
    const row = ctx.db
      .query<{ content: string; lesson_id: string }, [string, string]>(
        "SELECT s.content, s.lesson_id FROM steps s JOIN lessons l ON l.id = s.lesson_id WHERE s.id = ? AND l.topic_id = ?",
      )
      .get(stepId, ctx.topicId);
    if (!row) throw new ToolError(`step "${stepId}" is not a step of this topic`);
    const content = JSON.parse(row.content) as { kind: string; lines?: { text: string; blank?: Blank }[] };
    const target = content.kind === "worked_example" ? content.lines?.[line] : undefined;
    if (!target?.blank) throw new ToolError(`line ${line} of step "${stepId}" has no blank to answer`);
    const correct = outcome === "correct";
    recordWorkedLine(stepId, line, answer, correct, ctx.db);
    ctx.publish({ type: "worked.answered", lessonId: row.lesson_id, stepId, idx: line, correct, text: target.text });
    return { result: { ok: true } };
  },
});
