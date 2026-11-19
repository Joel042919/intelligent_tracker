import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { analyzeAutoTuneSuggestions } from '../services/autoTuner.js';

export const evaluationRouter = Router();

const closeDaySchema = z.object({
  daily_log_id: z.string().uuid(),
  overall_system_score: z.number().min(1).max(5).optional(),
  exit_ticket_notes: z.string().min(1),
  mise_en_place_checklist: z.array(
    z.object({
      label: z.string(),
      done: z.boolean(),
    })
  ),
  system_adjustment_summary: z.string().nullable().optional(),
  dimension_scores: z.array(
    z.object({
      dimension_id: z.string().uuid(),
      friction_id: z.string().uuid().nullable().optional(),
      score: z.number().int().min(1).max(5),
      selected_chips: z.array(z.string()).default([]),
      root_cause: z.string().nullable().optional(),
      immediate_adjustment: z.string().nullable().optional(),
    })
  ),
});

evaluationRouter.get('/evaluation/config/:userId', async (req, res) => {
  const { userId } = req.params;
  const dims = await pool.query(
    `SELECT * FROM evaluation_dimensions WHERE user_id = $1 AND is_active = true ORDER BY sort_order ASC`,
    [userId]
  );
  const frictions = await pool.query(
    `SELECT * FROM friction_catalog WHERE user_id = $1 AND is_active = true ORDER BY label ASC`,
    [userId]
  );
  res.json({
    dimensions: dims.rows,
    frictionCatalog: frictions.rows,
  });
});

evaluationRouter.post('/evaluation/close-day', async (req, res) => {
  const parsed = closeDaySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const d = parsed.data;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const avgScore =
      d.overall_system_score ??
      (d.dimension_scores.length > 0
        ? Number(
            (
              d.dimension_scores.reduce((s, x) => s + x.score, 0) / d.dimension_scores.length
            ).toFixed(1)
          )
        : null);

    const evalRes = await client.query<{ id: string }>(
      `INSERT INTO daily_evaluations
         (daily_log_id, overall_system_score, exit_ticket_notes, mise_en_place_checklist, system_adjustment_summary)
       VALUES ($1, $2, $3, $4::jsonb, $5)
       ON CONFLICT (daily_log_id) DO UPDATE
         SET overall_system_score = EXCLUDED.overall_system_score,
             exit_ticket_notes = EXCLUDED.exit_ticket_notes,
             mise_en_place_checklist = EXCLUDED.mise_en_place_checklist,
             system_adjustment_summary = EXCLUDED.system_adjustment_summary,
             evaluated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [
        d.daily_log_id,
        avgScore,
        d.exit_ticket_notes,
        JSON.stringify(d.mise_en_place_checklist),
        d.system_adjustment_summary ?? null,
      ]
    );
    const evaluation = evalRes.rows[0];

    await client.query(`DELETE FROM daily_dimension_scores WHERE daily_evaluation_id = $1`, [
      evaluation.id,
    ]);

    for (const ds of d.dimension_scores) {
      await client.query(
        `INSERT INTO daily_dimension_scores
           (daily_evaluation_id, dimension_id, friction_id, score, selected_chips, root_cause, immediate_adjustment)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
        [
          evaluation.id,
          ds.dimension_id,
          ds.friction_id ?? null,
          ds.score,
          JSON.stringify(ds.selected_chips),
          ds.root_cause ?? null,
          ds.immediate_adjustment ?? null,
        ]
      );
    }

    const logRes = await client.query<{ user_id: string }>(
      `UPDATE daily_logs
       SET day_status = 'CLOSED', updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING *`,
      [d.daily_log_id]
    );

    if (logRes.rows.length === 0) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'Daily log not found' });
      return;
    }

    const suggestions = await analyzeAutoTuneSuggestions(client, logRes.rows[0].user_id);

    await client.query('COMMIT');
    res.status(201).json({
      evaluation,
      dailyLog: logRes.rows[0],
      autoTuneSuggestions: suggestions,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: (err as Error).message });
  } finally {
    client.release();
  }
});
