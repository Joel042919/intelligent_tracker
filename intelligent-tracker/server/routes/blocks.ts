import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool.js';

export const blocksRouter = Router();

const updateBlockStatusSchema = z.object({
  outcome_status: z.enum([
    'PLANNED',
    'IN_PROGRESS',
    'COMPLETED',
    'PARTIAL_EMERGENCY',
    'CARRIED_OVER',
    'RESCHEDULED_PROJECT',
    'DROPPED_TODAY',
    'UNPLANNED_LOGGED',
  ]),
  non_completion_reason: z
    .enum([
      'NONE',
      'FULL_DAY_UNPLANNED',
      'TIME_EXHAUSTED',
      'WOKE_LATE',
      'LOW_ENERGY',
      'FRICTION',
      'DETOX_DAY',
    ])
    .nullable()
    .optional(),
  friction_id: z.string().uuid().nullable().optional(),
  actual_start: z.string().datetime().nullable().optional(),
  actual_end: z.string().datetime().nullable().optional(),
  actual_minutes: z.number().int().min(0).nullable().optional(),
  adjustment_reason: z.string().nullable().optional(),
});

blocksRouter.patch('/blocks/:id/status', async (req, res) => {
  const parsed = updateBlockStatusSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const d = parsed.data;
  const reason = d.outcome_status === 'COMPLETED' ? 'NONE' : (d.non_completion_reason ?? null);

  if (
    ['PARTIAL_EMERGENCY', 'CARRIED_OVER', 'RESCHEDULED_PROJECT', 'DROPPED_TODAY'].includes(
      d.outcome_status
    ) &&
    (!reason || reason === 'NONE')
  ) {
    res.status(400).json({
      error: 'non_completion_reason is required and cannot be NONE for incomplete statuses',
    });
    return;
  }

  const { rows } = await pool.query(
    `UPDATE time_blocks
     SET outcome_status = $2,
         non_completion_reason = $3,
         friction_id = COALESCE($4, friction_id),
         actual_start = COALESCE($5::timestamptz, actual_start),
         actual_end = COALESCE($6::timestamptz, actual_end),
         actual_minutes = COALESCE($7, actual_minutes),
         adjustment_reason = COALESCE($8, adjustment_reason),
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1
     RETURNING *`,
    [
      req.params.id,
      d.outcome_status,
      reason,
      d.friction_id ?? null,
      d.actual_start ?? null,
      d.actual_end ?? null,
      d.actual_minutes ?? null,
      d.adjustment_reason ?? null,
    ]
  );

  if (rows.length === 0) {
    res.status(404).json({ error: 'Time block not found' });
    return;
  }

  res.json({ block: rows[0] });
});
