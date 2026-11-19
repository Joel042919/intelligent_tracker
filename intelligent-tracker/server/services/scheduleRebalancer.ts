import type { PoolClient } from 'pg';
import type {
  AdjustmentType,
  BlockKind,
  NonCompletionReason,
  OutcomeStatus,
} from '../types/domain.js';

export interface RebalanceBlockInput {
  id: string;
  project_id: string | null;
  title: string;
  block_kind: BlockKind;
  planned_start: Date;
  planned_end: Date;
  planned_minutes: number;
  min_emergency_minutes: number;
  is_mandatory_today: boolean;
  is_highlight: boolean;
  outcome_status: OutcomeStatus;
}

export interface AdjustmentRecord {
  affected_block_id: string;
  adjustment_type: AdjustmentType;
  minutes_delta: number;
  notes: string;
}

export interface RebalancedBlockResult {
  id: string;
  project_id: string | null;
  planned_start: Date;
  planned_end: Date;
  planned_minutes: number;
  outcome_status: OutcomeStatus;
  non_completion_reason: NonCompletionReason | null;
  adjustment_reason: string | null;
  removed: boolean;
}

export interface RebalanceOutput {
  deficit_minutes: number;
  updated_blocks: RebalancedBlockResult[];
  adjustments: AdjustmentRecord[];
  projects_to_extend_ids: string[];
}

const MS_PER_MIN = 60_000;

/**
 * Algoritmo determinista de 4 pasos del Motor de Reajuste de 24 Horas (Sección 6).
 */
export function rebalanceSchedulePlan(params: {
  blocks: RebalanceBlockInput[];
  cursorStart: Date;
  dayEnd: Date;
  wakeDelayMinutes?: number;
  isFullDayUnplanned?: boolean;
}): RebalanceOutput {
  const {
    blocks,
    cursorStart,
    dayEnd,
    wakeDelayMinutes = 0,
    isFullDayUnplanned = false,
  } = params;

  const pending = blocks
    .filter(
      (b) =>
        b.outcome_status === 'PLANNED' &&
        b.block_kind !== 'UNPLANNED' &&
        b.block_kind !== 'SLEEP'
    )
    .sort((a, b) => a.planned_start.getTime() - b.planned_start.getTime());

  const availableMinutes = Math.max(
    0,
    Math.floor((dayEnd.getTime() - cursorStart.getTime()) / MS_PER_MIN)
  );
  const neededMinutes = pending.reduce((sum, b) => sum + b.planned_minutes, 0);
  const deficit = Math.max(0, neededMinutes - availableMinutes);

  const adjustments: AdjustmentRecord[] = [];
  const results = new Map<string, RebalancedBlockResult>();

  for (const b of pending) {
    results.set(b.id, {
      id: b.id,
      project_id: b.project_id,
      planned_start: new Date(b.planned_start),
      planned_end: new Date(b.planned_end),
      planned_minutes: b.planned_minutes,
      outcome_status: b.outcome_status,
      non_completion_reason: null,
      adjustment_reason: null,
      removed: false,
    });
  }

  // Paso 1: Absorber déficit reduciendo o eliminando bloques FREE / BUFFER
  let remainingDeficit = deficit;
  if (remainingDeficit > 0) {
    for (const b of pending) {
      if (remainingDeficit <= 0) break;
      if (b.block_kind !== 'FREE' && b.block_kind !== 'BUFFER') continue;
      const res = results.get(b.id)!;
      if (res.planned_minutes <= remainingDeficit) {
        remainingDeficit -= res.planned_minutes;
        res.removed = true;
        res.outcome_status = 'DROPPED_TODAY';
        res.non_completion_reason = wakeDelayMinutes > 0 ? 'WOKE_LATE' : 'TIME_EXHAUSTED';
        res.adjustment_reason = 'Holgura absorbida por reajuste';
        adjustments.push({
          affected_block_id: b.id,
          adjustment_type: 'SHIFT_TIME',
          minutes_delta: -b.planned_minutes,
          notes: `Bloque ${b.block_kind} absorbido para cubrir déficit`,
        });
      } else {
        const cut = remainingDeficit;
        res.planned_minutes -= cut;
        res.planned_end = new Date(res.planned_start.getTime() + res.planned_minutes * MS_PER_MIN);
        res.adjustment_reason = `Holgura reducida en ${cut}m`;
        remainingDeficit = 0;
        adjustments.push({
          affected_block_id: b.id,
          adjustment_type: 'SHIFT_TIME',
          minutes_delta: -cut,
          notes: `Bloque ${b.block_kind} recortado ${cut}m`,
        });
      }
    }
  }

  // Paso 3 (pre-cálculo de duraciones si aún hay déficit):
  // Comprimir primero bloques NO highlight hasta min_emergency_minutes
  if (remainingDeficit > 0) {
    const activeNonHighlight = pending.filter(
      (b) => !results.get(b.id)!.removed && b.is_mandatory_today && !b.is_highlight
    );
    for (const b of activeNonHighlight) {
      if (remainingDeficit <= 0) break;
      const res = results.get(b.id)!;
      const minDur = Math.max(5, Math.min(b.min_emergency_minutes, res.planned_minutes));
      const reducible = res.planned_minutes - minDur;
      if (reducible > 0) {
        const cut = Math.min(reducible, remainingDeficit);
        res.planned_minutes -= cut;
        remainingDeficit -= cut;
        res.adjustment_reason = `Protocolo de emergencia: reducido a ${res.planned_minutes}m`;
        adjustments.push({
          affected_block_id: b.id,
          adjustment_type: 'SHRINK_TO_MIN',
          minutes_delta: -cut,
          notes: `Comprimido hasta dosis mínima (${res.planned_minutes}m)`,
        });
      }
    }
  }

  // Si aún falta tiempo, comprimir también highlights como último recurso antes de descartar
  if (remainingDeficit > 0) {
    const activeHighlights = pending.filter(
      (b) => !results.get(b.id)!.removed && b.is_mandatory_today && b.is_highlight
    );
    for (const b of activeHighlights) {
      if (remainingDeficit <= 0) break;
      const res = results.get(b.id)!;
      const minDur = Math.max(5, Math.min(b.min_emergency_minutes, res.planned_minutes));
      const reducible = res.planned_minutes - minDur;
      if (reducible > 0) {
        const cut = Math.min(reducible, remainingDeficit);
        res.planned_minutes -= cut;
        remainingDeficit -= cut;
        res.adjustment_reason = `Highlight comprimido a mínimo (${res.planned_minutes}m)`;
        adjustments.push({
          affected_block_id: b.id,
          adjustment_type: 'SHRINK_TO_MIN',
          minutes_delta: -cut,
          notes: `Highlight comprimido a ${res.planned_minutes}m`,
        });
      }
    }
  }

  // Paso 2 y Paso 4: Recorrer cronológicamente desde cursorStart sin solapamientos;
  // si un bloque ya no cabe antes de dayEnd -> CARRIED_OVER + extender proyecto (anti-avalancha).
  let cursorMs = cursorStart.getTime();
  const projectsToExtend = new Set<string>();
  const shiftType: AdjustmentType = wakeDelayMinutes > 0 ? 'WAKE_LATE_SHIFT' : 'SHIFT_TIME';

  for (const b of pending) {
    const res = results.get(b.id)!;
    if (res.removed) continue;

    // Respetar inicio futuro si ya está después del cursor, o empujar al cursor si se solapó
    const desiredStartMs = Math.max(cursorMs, res.planned_start.getTime());
    const desiredEndMs = desiredStartMs + res.planned_minutes * MS_PER_MIN;

    if (desiredEndMs > dayEnd.getTime()) {
      // Paso 4: Desbordamiento total (FULL_DAY_OVERFLOW)
      res.outcome_status = 'CARRIED_OVER';
      res.non_completion_reason = isFullDayUnplanned ? 'FULL_DAY_UNPLANNED' : 'TIME_EXHAUSTED';
      res.adjustment_reason = 'Movido al día siguiente sin acumular deuda doble';
      adjustments.push({
        affected_block_id: b.id,
        adjustment_type: 'FULL_DAY_OVERFLOW',
        minutes_delta: -res.planned_minutes,
        notes: 'Tiempo agotado hoy; pasa a CARRIED_OVER (regla anti-avalancha)',
      });
      if (res.project_id) {
        projectsToExtend.add(res.project_id);
        adjustments.push({
          affected_block_id: b.id,
          adjustment_type: 'EXTEND_PROJECT_END',
          minutes_delta: 0,
          notes: 'Proyecto extiende end_date +1 día',
        });
      }
      continue;
    }

    const shiftedByMin = Math.round((desiredStartMs - b.planned_start.getTime()) / MS_PER_MIN);
    if (shiftedByMin !== 0) {
      res.planned_start = new Date(desiredStartMs);
      res.planned_end = new Date(desiredEndMs);
      res.adjustment_reason = res.adjustment_reason ?? `Desplazado +${shiftedByMin}m`;
      adjustments.push({
        affected_block_id: b.id,
        adjustment_type: shiftType,
        minutes_delta: shiftedByMin,
        notes: `Bloque desplazado a ${res.planned_start.toISOString()}`,
      });
    } else {
      res.planned_end = new Date(desiredEndMs);
    }

    cursorMs = desiredEndMs;
  }

  return {
    deficit_minutes: deficit,
    updated_blocks: Array.from(results.values()),
    adjustments,
    projects_to_extend_ids: Array.from(projectsToExtend),
  };
}

/**
 * Persiste el resultado del rebalanceo en time_blocks, schedule_adjustments, daily_logs y projects.
 */
export async function persistRebalance(
  client: PoolClient,
  dailyLogId: string,
  triggerBlockId: string | null,
  plan: RebalanceOutput
): Promise<void> {
  for (const blk of plan.updated_blocks) {
    await client.query(
      `UPDATE time_blocks
       SET planned_start = $2,
           planned_end = $3,
           planned_minutes = $4,
           outcome_status = $5,
           non_completion_reason = $6,
           adjustment_reason = $7,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [
        blk.id,
        blk.planned_start.toISOString(),
        blk.planned_end.toISOString(),
        blk.planned_minutes,
        blk.outcome_status,
        blk.non_completion_reason,
        blk.adjustment_reason,
      ]
    );
  }

  for (const adj of plan.adjustments) {
    await client.query(
      `INSERT INTO schedule_adjustments
         (daily_log_id, trigger_block_id, affected_block_id, adjustment_type, minutes_delta, notes)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        dailyLogId,
        triggerBlockId,
        adj.affected_block_id,
        adj.adjustment_type,
        adj.minutes_delta,
        adj.notes,
      ]
    );
  }

  if (plan.adjustments.length > 0) {
    await client.query(
      `UPDATE daily_logs
       SET readjustment_count = readjustment_count + 1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [dailyLogId]
    );
  }

  for (const projectId of plan.projects_to_extend_ids) {
    await client.query(
      `UPDATE projects
       SET end_date = end_date + INTERVAL '1 day',
           accumulated_shift_days = accumulated_shift_days + 1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [projectId]
    );
  }
}
