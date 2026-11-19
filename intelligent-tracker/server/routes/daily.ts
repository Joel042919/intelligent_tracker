import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { bootstrapDailyLog } from '../services/dailyBootstrap.js';
import { persistRebalance, rebalanceSchedulePlan, type RebalanceBlockInput } from '../services/scheduleRebalancer.js';
import type { BlockKind, OutcomeStatus } from '../types/domain.js';

export const dailyRouter = Router();

const bootstrapSchema = z.object({
  user_id: z.string().uuid(),
  log_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reentry_gap_threshold: z.number().int().min(1).default(3),
});

const sleepCheckinSchema = z.object({
  actual_bedtime: z.string().datetime(),
  actual_wake_time: z.string().datetime(),
  is_late_night: z.boolean().default(false),
  auto_rebalance: z.boolean().default(true),
});

const detoxSchema = z.object({
  detox_notes: z.string().min(1),
});

const unplannedSchema = z.object({
  title: z.string().min(1).max(120),
  planned_start: z.string().datetime(),
  planned_end: z.string().datetime(),
  is_full_day_unplanned: z.boolean().default(false),
  auto_rebalance: z.boolean().default(true),
});

dailyRouter.post('/daily/bootstrap', async (req, res) => {
  const parsed = bootstrapSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await bootstrapDailyLog(client, parsed.data.user_id, parsed.data.log_date, {
      reentryGapThreshold: parsed.data.reentry_gap_threshold,
    });
    await client.query('COMMIT');
    res.json(result);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: (err as Error).message });
  } finally {
    client.release();
  }
});

dailyRouter.get('/daily/:userId/:logDate', async (req, res) => {
  const { userId, logDate } = req.params;
  const logRes = await pool.query(
    `SELECT * FROM daily_logs WHERE user_id = $1 AND log_date = $2`,
    [userId, logDate]
  );
  if (logRes.rows.length === 0) {
    res.status(404).json({ error: 'Daily log not found' });
    return;
  }
  const log = logRes.rows[0];
  const blocksRes = await pool.query(
    `SELECT * FROM time_blocks WHERE daily_log_id = $1 ORDER BY planned_start ASC`,
    [log.id]
  );
  const adjRes = await pool.query(
    `SELECT * FROM schedule_adjustments WHERE daily_log_id = $1 ORDER BY created_at ASC`,
    [log.id]
  );
  res.json({
    dailyLog: log,
    timeBlocks: blocksRes.rows,
    adjustments: adjRes.rows,
  });
});

async function runDbRebalance(
  client: import('pg').PoolClient,
  dailyLogId: string,
  cursorStart: Date,
  dayEnd: Date,
  wakeDelayMinutes: number,
  triggerBlockId: string | null,
  isFullDayUnplanned: boolean
) {
  const blocksRes = await client.query<{
    id: string;
    project_id: string | null;
    title: string;
    block_kind: BlockKind;
    planned_start: string;
    planned_end: string;
    planned_minutes: number;
    is_mandatory_today: boolean;
    outcome_status: OutcomeStatus;
    min_session_minutes: number | null;
    task_min_emergency: number | null;
    is_highlight: boolean | null;
  }>(
    `SELECT tb.id, tb.project_id, tb.title, tb.block_kind, tb.planned_start::text, tb.planned_end::text,
            tb.planned_minutes, tb.is_mandatory_today, tb.outcome_status,
            p.min_session_minutes, t.min_emergency_minutes AS task_min_emergency, t.is_highlight
     FROM time_blocks tb
     LEFT JOIN projects p ON p.id = tb.project_id
     LEFT JOIN tasks t ON t.id = tb.task_id
     WHERE tb.daily_log_id = $1
     ORDER BY tb.planned_start ASC`,
    [dailyLogId]
  );

  const inputs: RebalanceBlockInput[] = blocksRes.rows.map((r) => ({
    id: r.id,
    project_id: r.project_id,
    title: r.title,
    block_kind: r.block_kind,
    planned_start: new Date(r.planned_start),
    planned_end: new Date(r.planned_end),
    planned_minutes: r.planned_minutes,
    min_emergency_minutes: r.task_min_emergency ?? r.min_session_minutes ?? 10,
    is_mandatory_today: r.is_mandatory_today,
    is_highlight: Boolean(r.is_highlight),
    outcome_status: r.outcome_status,
  }));

  const plan = rebalanceSchedulePlan({
    blocks: inputs,
    cursorStart,
    dayEnd,
    wakeDelayMinutes,
    isFullDayUnplanned,
  });

  await persistRebalance(client, dailyLogId, triggerBlockId, plan);
  return plan;
}

dailyRouter.patch('/daily/:dailyLogId/sleep', async (req, res) => {
  const parsed = sleepCheckinSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const logRes = await client.query<{
      id: string;
      user_id: string;
      log_date: string;
      ideal_wake_time: string | null;
      ideal_sleep_minutes: number;
      fixed_day_end_time: string | null;
    }>(
      `SELECT dl.id, dl.user_id, TO_CHAR(dl.log_date, 'YYYY-MM-DD') AS log_date,
              u.ideal_wake_time::text, u.ideal_sleep_minutes, u.fixed_day_end_time::text
       FROM daily_logs dl
       JOIN users u ON u.id = dl.user_id
       WHERE dl.id = $1`,
      [req.params.dailyLogId]
    );
    if (logRes.rows.length === 0) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'Daily log not found' });
      return;
    }
    const log = logRes.rows[0];
    const bed = new Date(parsed.data.actual_bedtime);
    const wake = new Date(parsed.data.actual_wake_time);
    const actualSleepMin = Math.max(0, Math.round((wake.getTime() - bed.getTime()) / 60_000));
    const sleepDebt = Math.max(0, log.ideal_sleep_minutes - actualSleepMin);

    const idealWakeStr = log.ideal_wake_time ?? '05:00:00';
    const idealWakeDate = new Date(`${log.log_date}T${idealWakeStr}Z`);
    const wakeDelayMin = Math.max(0, Math.round((wake.getTime() - idealWakeDate.getTime()) / 60_000));

    const updated = await client.query(
      `UPDATE daily_logs
       SET actual_bedtime = $2::timestamptz,
           actual_wake_time = $3::timestamptz,
           actual_sleep_minutes = $4,
           sleep_debt_minutes = $5,
           wake_delay_minutes = $6,
           is_late_night = $7,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING *`,
      [
        log.id,
        bed.toISOString(),
        wake.toISOString(),
        actualSleepMin,
        sleepDebt,
        wakeDelayMin,
        parsed.data.is_late_night || wakeDelayMin > 0,
      ]
    );

    let rebalancePlan = null;
    if (parsed.data.auto_rebalance && wakeDelayMin > 0) {
      const endStr = log.fixed_day_end_time ?? '22:00:00';
      const dayEnd = new Date(`${log.log_date}T${endStr}Z`);
      rebalancePlan = await runDbRebalance(client, log.id, wake, dayEnd, wakeDelayMin, null, false);
    }

    await client.query('COMMIT');
    res.json({ dailyLog: updated.rows[0], rebalancePlan });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: (err as Error).message });
  } finally {
    client.release();
  }
});

dailyRouter.post('/daily/:dailyLogId/detox', async (req, res) => {
  const parsed = detoxSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const logRes = await client.query(
      `UPDATE daily_logs
       SET day_mode = 'RECOVERY_DETOX',
           detox_notes = $2,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING *`,
      [req.params.dailyLogId, parsed.data.detox_notes]
    );
    if (logRes.rows.length === 0) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'Daily log not found' });
      return;
    }

    const dropped = await client.query(
      `UPDATE time_blocks
       SET outcome_status = 'DROPPED_TODAY',
           non_completion_reason = 'DETOX_DAY',
           adjustment_reason = 'Día Detox Intencional (métricas protegidas)',
           updated_at = CURRENT_TIMESTAMP
       WHERE daily_log_id = $1
         AND block_kind IN ('PROJECT_WORK', 'TASK')
         AND outcome_status IN ('PLANNED', 'IN_PROGRESS')
       RETURNING id`,
      [req.params.dailyLogId]
    );

    await client.query('COMMIT');
    res.json({ dailyLog: logRes.rows[0], droppedBlockCount: dropped.rows.length });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: (err as Error).message });
  } finally {
    client.release();
  }
});

dailyRouter.post('/daily/:dailyLogId/unplanned', async (req, res) => {
  const parsed = unplannedSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const start = new Date(parsed.data.planned_start);
    const end = new Date(parsed.data.planned_end);
    const minutes = Math.max(1, Math.round((end.getTime() - start.getTime()) / 60_000));

    const blkRes = await client.query<{ id: string }>(
      `INSERT INTO time_blocks
         (daily_log_id, title, block_kind, depth_level, planned_start, planned_end, planned_minutes, is_mandatory_today, outcome_status)
       VALUES ($1, $2, 'UNPLANNED', 'SHALLOW', $3, $4, $5, false, 'UNPLANNED_LOGGED')
       RETURNING *`,
      [req.params.dailyLogId, parsed.data.title, start.toISOString(), end.toISOString(), minutes]
    );

    await client.query(
      `UPDATE daily_logs
       SET unplanned_total_minutes = unplanned_total_minutes + $2,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [req.params.dailyLogId, minutes]
    );

    let rebalancePlan = null;
    if (parsed.data.auto_rebalance) {
      const logRes = await client.query<{ log_date: string; fixed_day_end_time: string | null }>(
        `SELECT TO_CHAR(dl.log_date, 'YYYY-MM-DD') AS log_date, u.fixed_day_end_time::text
         FROM daily_logs dl
         JOIN users u ON u.id = dl.user_id
         WHERE dl.id = $1`,
        [req.params.dailyLogId]
      );
      const endStr = logRes.rows[0]?.fixed_day_end_time ?? '22:00:00';
      const dayEnd = new Date(`${logRes.rows[0].log_date}T${endStr}Z`);
      rebalancePlan = await runDbRebalance(
        client,
        req.params.dailyLogId,
        end,
        dayEnd,
        0,
        blkRes.rows[0].id,
        parsed.data.is_full_day_unplanned
      );
    }

    await client.query('COMMIT');
    res.status(201).json({ unplannedBlock: blkRes.rows[0], rebalancePlan });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: (err as Error).message });
  } finally {
    client.release();
  }
});
