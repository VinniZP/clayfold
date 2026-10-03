import type { CardsProposeResult } from "../../../shared/tools";
import { newId } from "../../db";
import { gateCards, recordGates } from "../../gates/pipeline";
import { defineTool, ToolError } from "../context";

export const cardsPropose = defineTool({
  name: "cards_propose",
  description: `Propose flashcards to the learner, who accepts, edits or suspends each one. Every card passes the gates first:
C1 one fact per card: back at most 120 characters, no lists (bullets, numbering, three or more ";"-separated parts), no yes/no front ("Is…", "Can…") or yes/no back, a cloze front with exactly one "____"; Q6 every quote occurs verbatim in its stored source; then a critic checks that the front stands alone without the lesson, asks for one fact, has one unambiguous answer, and that each quote supports the back.
Each card is judged on its own: passing cards are stored as proposals even when others fail. Resubmit only the rejected ones after fixing them.
Returns {results: [{index, status: proposed|rejected, cardId?, violations}]}.`,
  async handler(ctx, { lessonId, cards }) {
    if (lessonId) {
      const lesson = ctx.db.query("SELECT 1 FROM lessons WHERE id = ? AND topic_id = ?").get(lessonId, ctx.topicId);
      if (!lesson) throw new ToolError(`lesson "${lessonId}" does not exist in this topic`);
    }
    const runs = await gateCards({ db: ctx.db, critic: ctx.critic }, { topicId: ctx.topicId, cards });
    const insert = ctx.db.query("INSERT INTO cards (id, topic_id, lesson_id, node_id, content, status) VALUES (?, ?, ?, ?, ?, 'proposed')");
    const results: CardsProposeResult["results"] = [];
    const proposed: string[] = [];
    runs.forEach((run, index) => {
      const card = cards[index]!;
      const cardId = newId("card");
      if (run.violations.length === 0) {
        insert.run(cardId, ctx.topicId, lessonId ?? null, card.nodeId, JSON.stringify(card));
        proposed.push(cardId);
        results.push({ index, status: "proposed", cardId, violations: [] });
      } else {
        results.push({ index, status: "rejected", violations: run.violations });
      }
      recordGates(ctx.db, { type: "card", id: cardId, attempt: 1 }, run.records);
    });
    if (proposed.length > 0) ctx.publish({ type: "cards.proposed", cardIds: proposed });
    const result: CardsProposeResult = { results };
    return { result };
  },
});
