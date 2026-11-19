import { describe, expect, it } from 'vitest';
import { rebalanceSchedulePlan, type RebalanceBlockInput } from '../services/scheduleRebalancer.js';

function dt(hour: number, min = 0): Date {
  return new Date(Date.UTC(2026, 10, 19, hour, min, 0));
}

describe('ScheduleRebalancerService (Motor de Reajuste 24h)', () => {
  it('Caso A: absorbe BUFFER y desplaza bloque obligatorio con WAKE_LATE_SHIFT', () => {
    const blocks: RebalanceBlockInput[] = [
      {
        id: 'b-buf',
        project_id: null,
        title: 'Buffer',
        block_kind: 'BUFFER',
        planned_start: dt(6, 0),
        planned_end: dt(7, 0),
        planned_minutes: 60,
        min_emergency_minutes: 10,
        is_mandatory_today: false,
        is_highlight: false,
        outcome_status: 'PLANNED',
      },
      {
        id: 'b-work',
        project_id: 'p1',
        title: 'Deep Work',
        block_kind: 'PROJECT_WORK',
        planned_start: dt(7, 0),
        planned_end: dt(9, 0),
        planned_minutes: 120,
        min_emergency_minutes: 30,
        is_mandatory_today: true,
        is_highlight: true,
        outcome_status: 'PLANNED',
      },
    ];

    // Despertó 2.5h tarde (07:30) y el día termina a las 10:00 (150 min disponibles para 180 min)
    const result = rebalanceSchedulePlan({
      blocks,
      cursorStart: dt(7, 30),
      dayEnd: dt(10, 0),
      wakeDelayMinutes: 150,
    });

    expect(result.deficit_minutes).toBe(30);
    const buf = result.updated_blocks.find((b) => b.id === 'b-buf')!;
    const work = result.updated_blocks.find((b) => b.id === 'b-work')!;

    expect(buf.planned_minutes).toBe(30);
    expect(work.planned_start.toISOString()).toBe(dt(8, 0).toISOString());
    expect(work.planned_minutes).toBe(120);
    expect(result.adjustments.some((a) => a.adjustment_type === 'WAKE_LATE_SHIFT')).toBe(true);
  });

  it('Paso 3: protege bloque is_highlight y comprime primero bloques no-highlight a min_emergency_minutes', () => {
    const blocks: RebalanceBlockInput[] = [
      {
        id: 'b-high',
        project_id: 'p1',
        title: 'Highlight Core',
        block_kind: 'PROJECT_WORK',
        planned_start: dt(18, 0),
        planned_end: dt(19, 0),
        planned_minutes: 60,
        min_emergency_minutes: 15,
        is_mandatory_today: true,
        is_highlight: true,
        outcome_status: 'PLANNED',
      },
      {
        id: 'b-sec',
        project_id: 'p2',
        title: 'Secundario',
        block_kind: 'TASK',
        planned_start: dt(19, 0),
        planned_end: dt(20, 0),
        planned_minutes: 60,
        min_emergency_minutes: 15,
        is_mandatory_today: true,
        is_highlight: false,
        outcome_status: 'PLANNED',
      },
    ];

    // Solo quedan 80 min disponibles (20:40 -> 22:00) para 120 min
    const result = rebalanceSchedulePlan({
      blocks,
      cursorStart: dt(20, 40),
      dayEnd: dt(22, 0),
    });

    const high = result.updated_blocks.find((b) => b.id === 'b-high')!;
    const sec = result.updated_blocks.find((b) => b.id === 'b-sec')!;

    expect(high.planned_minutes).toBe(60); // Highlight protegido intacto
    expect(sec.planned_minutes).toBe(20);  // Secundario comprimido (60 - 40 = 20 >= 15)
    expect(sec.outcome_status).toBe('PLANNED');
  });

  it('Caso B: desbordamiento total marca CARRIED_OVER y extiende proyecto (+1 día anti-avalancha)', () => {
    const blocks: RebalanceBlockInput[] = [
      {
        id: 'b-proj',
        project_id: 'proj-123',
        title: 'Bloque Imposible Hoy',
        block_kind: 'PROJECT_WORK',
        planned_start: dt(18, 0),
        planned_end: dt(19, 0),
        planned_minutes: 60,
        min_emergency_minutes: 15,
        is_mandatory_today: true,
        is_highlight: false,
        outcome_status: 'PLANNED',
      },
    ];

    // Imprevisto ocupó hasta las 21:55, solo quedan 5 min antes de las 22:00
    const result = rebalanceSchedulePlan({
      blocks,
      cursorStart: dt(21, 55),
      dayEnd: dt(22, 0),
      isFullDayUnplanned: true,
    });

    const projBlk = result.updated_blocks[0];
    expect(projBlk.outcome_status).toBe('CARRIED_OVER');
    expect(projBlk.non_completion_reason).toBe('FULL_DAY_UNPLANNED');
    expect(result.projects_to_extend_ids).toContain('proj-123');
    expect(result.adjustments.some((a) => a.adjustment_type === 'FULL_DAY_OVERFLOW')).toBe(true);
    expect(result.adjustments.some((a) => a.adjustment_type === 'EXTEND_PROJECT_END')).toBe(true);
  });
});
