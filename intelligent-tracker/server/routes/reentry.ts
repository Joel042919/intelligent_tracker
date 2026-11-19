import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { bootstrapDailyLog } from '../services/dailyBootstrap.js';

export const reentryRouter = Router();

const applyReentrySchema = z.object({
  user_id: z.string().uuid(),
  return_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  last_active_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  gap_days: z.number().int().min(1),
  return_strategy: z.enum(['GRADUAL_RAMP', 'FULL_RESET', 'SELECTIVE_RESUME']).default('GRADUAL_RAMP'),
  summary_notes: z.string().nullable().optional(),
  actions: z.array(
    z.object({
      project_id: z.string().uuid(),
      action_taken: z.enum([
        'EXTEND_DEADLINE',
        'REDUCE_DOSE',
        'PAUSE_PROJECT',
        'ARCHIVE_PROJECT',
        'ADVANCE_PHASE',
      ]),
      days_shifted: z.number().int().min(0).default(0),
      new_target_minutes: z.number().int().positive().nullable().optional(),
      rationale: z.string().nullable().optional(),
    })
  ),
});

reentryRouter.post('/reentry/apply', async (req, res) => {
  const parsed = applyReentrySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const d = parsed.data;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const sessRes = await client.query<{ id: string }>(
      `INSERT INTO reentry_sessions
         (user_id, return_date, last_active_date, gap_days, return_strategy, summary_notes)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        d.user_id,
        d.return_date,
        d.last_active_date ?? null,
        d.gap_days,
        d.return_strategy,
        d.summary_notes ?? null,
      ]
    );
    const session = sessRes.rows[0];

    let usesRamp = false;
    for (const act of d.actions) {
      await client.query(
        `INSERT INTO reentry_project_actions
           (reentry_session_id, project_id, action_taken, days_shifted, new_target_minutes, rationale)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          session.id,
          act.project_id,
          act.action_taken,
          act.days_shifted,
          act.new_target_minutes ?? null,
          act.rationale ?? null,
        ]
      );

      if (act.action_taken === 'EXTEND_DEADLINE' && act.days_shifted > 0) {
        await client.query(
          `UPDATE projects
           SET end_date = end_date + ($2 * INTERVAL '1 day'),
               accumulated_shift_days = accumulated_shift_days + $2,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $1`,
          [act.project_id, act.days_shifted]
        );
      } else if (act.action_taken === 'REDUCE_DOSE') {
        usesRamp = true;
        if (act.new_target_minutes) {
          await client.query(
            `UPDATE projects
             SET min_session_minutes = $2,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $1`,
            [act.project_id, act.new_target_minutes]
          );
        }
      } else if (act.action_taken === 'PAUSE_PROJECT') {
        await client.query(
          `UPDATE projects SET status = 'PAUSED', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
          [act.project_id]
        );
      } else if (act.action_taken === 'ARCHIVE_PROJECT') {
        await client.query(
          `UPDATE projects SET burner_slot = 'ARCHIVE', status = 'PAUSED', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
          [act.project_id]
        );
      }
    }

    const bootstrap = await bootstrapDailyLog(client, d.user_id, d.return_date, {
      forceMode: usesRamp || d.return_strategy === 'GRADUAL_RAMP' ? 'REENTRY_RAMP' : 'NORMAL',
    });

    await client.query('COMMIT');
    res.status(201).json({ reentrySession: session, bootstrap });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: (err as Error).message });
  } finally {
    client.release();
  }
});
