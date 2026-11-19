import type { PoolClient } from 'pg';
import type { DailyLogRow, DayMode, TimeBlockRow } from '../types/domain.js';

export interface BootstrapResult {
  requiresReentry: boolean;
  gapDays: number;
  lastActiveDate: string | null;
  dailyLog: DailyLogRow | null;
  timeBlocks: TimeBlockRow[];
}

function parseTimeToMinutes(timeStr: string | null, fallbackMin: number): number {
  if (!timeStr) return fallbackMin;
  const [h, m] = timeStr.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return fallbackMin;
  return h * 60 + m;
}

function addMinutesUtc(dateStr: string, minutesOffset: number): Date {
  const base = new Date(`${dateStr}T00:00:00.000Z`);
  return new Date(base.getTime() + minutesOffset * 60_000);
}

function isoWeekday(dateStr: string): number {
  const d = new Date(`${dateStr}T12:00:00.000Z`);
  const day = d.getUTCDay();
  return day === 0 ? 7 : day; // 1=Lun ... 7=Dom
}

function diffDays(laterDate: string, earlierDate: string): number {
  const a = new Date(`${laterDate}T00:00:00.000Z`).getTime();
  const b = new Date(`${earlierDate}T00:00:00.000Z`).getTime();
  return Math.round((a - b) / 86_400_000);
}

export async function bootstrapDailyLog(
  client: PoolClient,
  userId: string,
  logDate: string,
  options: { reentryGapThreshold?: number; forceMode?: DayMode } = {}
): Promise<BootstrapResult> {
  const threshold = options.reentryGapThreshold ?? 3;

  // 1. Si ya existe daily_log para hoy, devolverlo con sus bloques
  const existing = await client.query<DailyLogRow>(
    `SELECT * FROM daily_logs WHERE user_id = $1 AND log_date = $2`,
    [userId, logDate]
  );
  if (existing.rows.length > 0) {
    const log = existing.rows[0];
    const blocks = await client.query<TimeBlockRow>(
      `SELECT * FROM time_blocks WHERE daily_log_id = $1 ORDER BY planned_start ASC`,
      [log.id]
    );
    return {
      requiresReentry: false,
      gapDays: 0,
      lastActiveDate: null,
      dailyLog: log,
      timeBlocks: blocks.rows,
    };
  }

  // 2. Buscar última fecha activa
  const lastRes = await client.query<{ log_date: string }>(
    `SELECT TO_CHAR(log_date, 'YYYY-MM-DD') AS log_date
     FROM daily_logs
     WHERE user_id = $1 AND log_date < $2 AND day_mode <> 'UNLOGGED_ABSENCE'
     ORDER BY log_date DESC
     LIMIT 1`,
    [userId, logDate]
  );

  const lastActiveDate = lastRes.rows[0]?.log_date ?? null;
  if (lastActiveDate && !options.forceMode) {
    const gapDays = diffDays(logDate, lastActiveDate);
    if (gapDays >= threshold) {
      // Caso D: Reconciliar días ausentes sin lista roja
      for (let d = 1; d < gapDays; d++) {
        const missingDate = new Date(
          new Date(`${lastActiveDate}T00:00:00.000Z`).getTime() + d * 86_400_000
        )
          .toISOString()
          .slice(0, 10);
        await client.query(
          `INSERT INTO daily_logs (user_id, log_date, day_mode, day_status, planned_total_minutes)
           VALUES ($1, $2, 'UNLOGGED_ABSENCE', 'RECONCILED_LATE', 1440)
           ON CONFLICT (user_id, log_date) DO NOTHING`,
          [userId, missingDate]
        );
      }
      return {
        requiresReentry: true,
        gapDays,
        lastActiveDate,
        dailyLog: null,
        timeBlocks: [],
      };
    }
  }

  // 3. Instanciar nuevo día (1,440 minutos)
  const userRes = await client.query<{
    ideal_wake_time: string | null;
    ideal_sleep_minutes: number;
  }>(`SELECT ideal_wake_time::text, ideal_sleep_minutes FROM users WHERE id = $1`, [userId]);

  if (userRes.rows.length === 0) {
    throw new Error('USER_NOT_FOUND');
  }

  const { ideal_wake_time, ideal_sleep_minutes } = userRes.rows[0];
  const dayMode: DayMode = options.forceMode ?? 'NORMAL';

  const insertLog = await client.query<DailyLogRow>(
    `INSERT INTO daily_logs (user_id, log_date, day_mode, planned_total_minutes, day_status)
     VALUES ($1, $2, $3, 1440, 'OPEN')
     RETURNING *`,
    [userId, logDate, dayMode]
  );
  const dailyLog = insertLog.rows[0];

  const wakeMin = parseTimeToMinutes(ideal_wake_time, 300); // default 05:00
  const sleepMin = Math.min(720, Math.max(240, ideal_sleep_minutes || 420));
  const createdBlocks: TimeBlockRow[] = [];

  // Bloque de sueño (00:00 -> ideal_wake_time, o ideal_sleep_minutes)
  const sleepEndMin = wakeMin > 0 ? wakeMin : sleepMin;
  const sleepRes = await client.query<TimeBlockRow>(
    `INSERT INTO time_blocks
       (daily_log_id, title, block_kind, depth_level, planned_start, planned_end, planned_minutes, is_mandatory_today, outcome_status, sort_order)
     VALUES ($1, 'Sueño Base', 'SLEEP', 'RECOVERY', $2, $3, $4, true, 'PLANNED', 1)
     RETURNING *`,
    [
      dailyLog.id,
      addMinutesUtc(logDate, 0).toISOString(),
      addMinutesUtc(logDate, sleepEndMin).toISOString(),
      sleepEndMin,
    ]
  );
  createdBlocks.push(sleepRes.rows[0]);

  // Cargar project_schedules activos del día ISO
  const dow = isoWeekday(logDate);
  const schedRes = await client.query<{
    project_id: string;
    title: string;
    preferred_start_time: string | null;
    allocated_minutes: number;
    min_session_minutes: number;
  }>(
    `SELECT p.id AS project_id, p.title, ps.preferred_start_time::text, ps.allocated_minutes, p.min_session_minutes
     FROM project_schedules ps
     JOIN projects p ON p.id = ps.project_id
     WHERE p.user_id = $1
       AND p.status = 'ACTIVE'
       AND ps.is_active = true
       AND ps.day_of_week = $2
     ORDER BY ps.preferred_start_time ASC NULLS LAST`,
    [userId, dow]
  );

  let cursorMin = sleepEndMin + 30; // 30m rutina inicial libre
  let sortOrder = 2;

  for (const s of schedRes.rows) {
    const duration =
      dayMode === 'REENTRY_RAMP'
        ? Math.min(s.allocated_minutes, s.min_session_minutes)
        : s.allocated_minutes;
    const prefMin = parseTimeToMinutes(s.preferred_start_time, cursorMin);
    const startMin = Math.max(cursorMin, prefMin);
    if (startMin + duration > 1440) continue;

    // Si hay hueco antes, insertar BUFFER / FREE
    if (startMin > cursorMin) {
      const gap = startMin - cursorMin;
      const buf = await client.query<TimeBlockRow>(
        `INSERT INTO time_blocks
           (daily_log_id, title, block_kind, depth_level, planned_start, planned_end, planned_minutes, is_mandatory_today, outcome_status, sort_order)
         VALUES ($1, 'Holgura / Buffer', 'BUFFER', 'RECOVERY', $2, $3, $4, false, 'PLANNED', $5)
         RETURNING *`,
        [
          dailyLog.id,
          addMinutesUtc(logDate, cursorMin).toISOString(),
          addMinutesUtc(logDate, startMin).toISOString(),
          gap,
          sortOrder++,
        ]
      );
      createdBlocks.push(buf.rows[0]);
    }

    const blk = await client.query<TimeBlockRow>(
      `INSERT INTO time_blocks
         (daily_log_id, project_id, title, block_kind, depth_level, planned_start, planned_end, planned_minutes, is_mandatory_today, outcome_status, sort_order)
       VALUES ($1, $2, $3, 'PROJECT_WORK', 'DEEP', $4, $5, $6, true, 'PLANNED', $7)
       RETURNING *`,
      [
        dailyLog.id,
        s.project_id,
        s.title,
        addMinutesUtc(logDate, startMin).toISOString(),
        addMinutesUtc(logDate, startMin + duration).toISOString(),
        duration,
        sortOrder++,
      ]
    );
    createdBlocks.push(blk.rows[0]);
    cursorMin = startMin + duration;
  }

  // Rellenar resto hasta 1,440 min con bloque FREE
  if (cursorMin < 1440) {
    const rest = 1440 - cursorMin;
    const freeRes = await client.query<TimeBlockRow>(
      `INSERT INTO time_blocks
         (daily_log_id, title, block_kind, depth_level, planned_start, planned_end, planned_minutes, is_mandatory_today, outcome_status, sort_order)
       VALUES ($1, 'Tiempo Libre / Cierre', 'FREE', 'RECOVERY', $2, $3, $4, false, 'PLANNED', $5)
       RETURNING *`,
      [
        dailyLog.id,
        addMinutesUtc(logDate, cursorMin).toISOString(),
        addMinutesUtc(logDate, 1440).toISOString(),
        rest,
        sortOrder,
      ]
    );
    createdBlocks.push(freeRes.rows[0]);
  }

  return {
    requiresReentry: false,
    gapDays: 0,
    lastActiveDate,
    dailyLog,
    timeBlocks: createdBlocks,
  };
}
