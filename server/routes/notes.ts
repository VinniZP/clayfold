import { Hono } from "hono";
import { z } from "zod";
import type { AuditEntry, NoteView } from "../../shared/api";
import { db, newId, now } from "../db";
import { enqueueRegen } from "../review/signals";
import { fail, readBody } from "./http";
import type { ItemRow } from "./public";

export const notes = new Hono();

notes.post("/notes", async (c) => {
  const req = await readBody(
    c,
    z.object({
      topicId: z.string().min(1),
      lessonId: z.string().min(1).optional(),
      stepId: z.string().min(1).optional(),
      quote: z.string().max(2000).optional(),
      text: z.string().trim().min(1).max(8000),
    }),
  );
  if (!db().query("SELECT 1 FROM topics WHERE id = ?").get(req.topicId)) fail(404, "topic not found");
  const id = newId("nt");
  const createdAt = now();
  db()
    .query("INSERT INTO notes (id, topic_id, lesson_id, step_id, quote, text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(id, req.topicId, req.lessonId ?? null, req.stepId ?? null, req.quote ?? null, req.text, createdAt);
  return c.json({ ...req, id, createdAt } satisfies NoteView, 201);
});

notes.post("/reports", async (c) => {
  const req = await readBody(
    c,
    z.object({ targetType: z.enum(["item", "card", "step"]), targetId: z.string().min(1), text: z.string().trim().min(1).max(4000) }),
  );
  const table = { item: "items", card: "cards", step: "steps" }[req.targetType];
  if (!db().query(`SELECT 1 FROM ${table} WHERE id = ?`).get(req.targetId)) fail(404, `${req.targetType} not found`);
  const reportId = newId("rp");
  db().query("INSERT INTO reports (id, target_type, target_id, text) VALUES (?, ?, ?, ?)").run(reportId, req.targetType, req.targetId, req.text);
  if (req.targetType !== "step") {
    const topicId = db().query<{ topic_id: string }, [string]>(`SELECT topic_id FROM ${table} WHERE id = ?`).get(req.targetId)!.topic_id;
    enqueueRegen({ topicId, type: req.targetType, id: req.targetId }, "learner_report", { reportId, text: req.text });
    if (req.targetType === "item") db().query("UPDATE items SET status = 'flagged' WHERE id = ? AND status = 'active'").run(req.targetId);
  }
  return c.body(null, 202);
});

notes.get("/audit/sample", (c) => {
  const n = Math.min(Math.max(Number(c.req.query("n") ?? 10) || 10, 1), 50);
  const rows = db()
    .query<ItemRow & { topic_title: string }, [number]>(
      `SELECT i.*, t.title AS topic_title FROM items i JOIN topics t ON t.id = i.topic_id
       WHERE i.status = 'active' AND NOT EXISTS (SELECT 1 FROM audits a WHERE a.item_id = i.id)
       ORDER BY random() LIMIT ?`,
    )
    .all(n);
  const gate = db().query<{ stage: string; rule: string; pass: number; message: string }, [string, string | null, string | null]>(
    `SELECT g.stage, g.rule, g.pass, g.message FROM gate_results g
     WHERE (g.target_type = 'item' AND g.target_id = ?1)
        OR (g.target_type = 'step' AND g.target_id = ?2
            AND g.attempt = (SELECT attempts FROM steps WHERE id = ?3))
     ORDER BY g.created_at, g.rowid`,
  );
  return c.json(
    rows.map(
      (r): AuditEntry => ({
        itemId: r.id,
        topicTitle: r.topic_title,
        item: JSON.parse(r.content),
        gate: gate.all(r.id, r.step_id, r.step_id).map((g) => ({ ...g, pass: g.pass === 1 })),
      }),
    ),
  );
});

notes.post("/audit/:itemId", async (c) => {
  const itemId = c.req.param("itemId");
  if (!db().query("SELECT 1 FROM items WHERE id = ?").get(itemId)) fail(404, "item not found");
  const { verdict, note } = await readBody(c, z.object({ verdict: z.enum(["ok", "missed_defect"]), note: z.string().max(2000).optional() }));
  db().query("INSERT INTO audits (id, item_id, verdict, note) VALUES (?, ?, ?, ?)").run(newId("au"), itemId, verdict, note ?? null);
  return c.body(null, 201);
});
