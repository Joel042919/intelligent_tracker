import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { pool } from '../db/pool.js';

const app = createApp();

let testUserId = '';
let testProjectId = '';
let task1Id = '';
let task2Id = '';
let dailyLogId = '';
let dimensionId = '';

describe('API Integration Tests (Neon PostgreSQL)', () => {
  beforeAll(async () => {
    const suffix = Date.now();
    const userRes = await pool.query<{ id: string }>(
      `INSERT INTO users (full_name, username, email, password_hash, ideal_wake_time, ideal_sleep_minutes, fixed_day_end_time)
       VALUES ('Test User', $1, $2, 'hash', '05:00:00', 420, '22:00:00')
       RETURNING id`,
      [`test_user_${suffix}`, `test_${suffix}@example.com`]
    );
    testUserId = userRes.rows[0].id;

    const dimRes = await pool.query<{ id: string }>(
      `INSERT INTO evaluation_dimensions (user_id, code, name, prompt_question, sort_order)
       VALUES ($1, 'TRIGGER_CONTROL', 'Control de Triggers', '¿Arranque automático?', 1)
       RETURNING id`,
      [testUserId]
    );
    dimensionId = dimRes.rows[0].id;
  });

  afterAll(async () => {
    if (testUserId) {
      await pool.query(`DELETE FROM users WHERE id = $1`, [testUserId]);
    }
    await pool.end();
  });

  it('GET /api/health conecta correctamente con Neon PostgreSQL', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.dbTime).toBeTruthy();
  });

  it('POST /api/projects crea proyecto con icon y burner_slot FRONT', async () => {
    const res = await request(app).post('/api/projects').send({
      user_id: testUserId,
      title: 'Proyecto Integración',
      icon: '💻',
      burner_slot: 'FRONT',
      start_date: '2026-11-19',
      end_date: '2026-12-19',
      target_minutes_per_session: 45,
      min_session_minutes: 15,
    });
    expect(res.status).toBe(201);
    expect(res.body.project.icon).toBe('💻');
    expect(res.body.project.burner_slot).toBe('FRONT');
    expect(res.body.warning).toBeNull();
    testProjectId = res.body.project.id;

    // Agregar schedule para jueves (day_of_week = 4, 2026-11-19 es jueves)
    await pool.query(
      `INSERT INTO project_schedules (project_id, day_of_week, preferred_start_time, allocated_minutes)
       VALUES ($1, 4, '06:00:00', 60)`,
      [testProjectId]
    );
  });

  it('Máquina de estados de tareas: FINISH_TO_START nace BLOCKED y se desbloquea al completar prerequisito', async () => {
    const t1 = await request(app)
      .post(`/api/projects/${testProjectId}/tasks`)
      .send({ title: 'Tarea 1 Prerequisito', execution_mode: 'SEQUENTIAL', is_highlight: true });
    expect(t1.status).toBe(201);
    expect(t1.body.task.status).toBe('PENDING');
    task1Id = t1.body.task.id;

    const t2 = await request(app)
      .post(`/api/projects/${testProjectId}/tasks`)
      .send({
        title: 'Tarea 2 Dependiente',
        execution_mode: 'SEQUENTIAL',
        prerequisite_task_ids: [task1Id],
        dependency_type: 'FINISH_TO_START',
      });
    expect(t2.status).toBe(201);
    expect(t2.body.task.status).toBe('BLOCKED');
    task2Id = t2.body.task.id;

    // Intentar iniciar t2 bloqueada sin override -> 409
    const blockedAttempt = await request(app)
      .patch(`/api/tasks/${task2Id}/status`)
      .send({ status: 'IN_PROGRESS' });
    expect(blockedAttempt.status).toBe(409);

    // Completar t1 -> desbloquea t2 a PENDING
    const doneRes = await request(app)
      .patch(`/api/tasks/${task1Id}/status`)
      .send({ status: 'DONE' });
    expect(doneRes.status).toBe(200);
    expect(doneRes.body.unlockedTaskIds).toContain(task2Id);
  });

  it('DailyBootstrap + Sleep Check-in (Caso A) + Invariante de bloques + Cierre Metacognitivo', async () => {
    const boot = await request(app).post('/api/daily/bootstrap').send({
      user_id: testUserId,
      log_date: '2026-11-19',
    });
    expect(boot.status).toBe(200);
    expect(boot.body.requiresReentry).toBe(false);
    expect(boot.body.dailyLog.planned_total_minutes).toBe(1440);
    dailyLogId = boot.body.dailyLog.id;

    // Sueño con despertar tarde (07:30 vs ideal 05:00 -> wake_delay_minutes = 150)
    const sleepRes = await request(app).patch(`/api/daily/${dailyLogId}/sleep`).send({
      actual_bedtime: '2026-11-19T00:30:00.000Z',
      actual_wake_time: '2026-11-19T07:30:00.000Z',
      is_late_night: true,
      auto_rebalance: true,
    });
    expect(sleepRes.status).toBe(200);
    expect(sleepRes.body.dailyLog.wake_delay_minutes).toBe(150);
    expect(sleepRes.body.dailyLog.is_late_night).toBe(true);
    expect(sleepRes.body.rebalancePlan).not.toBeNull();

    // Verificar invariante de time_blocks: PARTIAL_EMERGENCY sin motivo -> 400
    const projectBlock = boot.body.timeBlocks.find(
      (b: { block_kind: string }) => b.block_kind === 'PROJECT_WORK'
    );
    expect(projectBlock).toBeTruthy();

    const invalidBlockUpdate = await request(app)
      .patch(`/api/blocks/${projectBlock.id}/status`)
      .send({ outcome_status: 'PARTIAL_EMERGENCY' });
    expect(invalidBlockUpdate.status).toBe(400);

    const validBlockUpdate = await request(app)
      .patch(`/api/blocks/${projectBlock.id}/status`)
      .send({ outcome_status: 'PARTIAL_EMERGENCY', non_completion_reason: 'WOKE_LATE' });
    expect(validBlockUpdate.status).toBe(200);

    // Cierre diario metacognitivo
    const closeRes = await request(app).post('/api/evaluation/close-day').send({
      daily_log_id: dailyLogId,
      exit_ticket_notes: 'Aprendí a usar el protocolo de emergencia tras despertar tarde.',
      mise_en_place_checklist: [{ label: 'Dejar laptop lista', done: true }],
      dimension_scores: [
        {
          dimension_id: dimensionId,
          score: 4,
          selected_chips: ['Sin negociación'],
        },
      ],
    });
    expect(closeRes.status).toBe(201);
    expect(closeRes.body.dailyLog.day_status).toBe('CLOSED');
    expect(Number(closeRes.body.evaluation.overall_system_score)).toBe(4);
  });

  it('Caso D: ausencia >= 3 días dispara Asistente de Reentrada y crea REENTRY_RAMP', async () => {
    // 7 días después de 2026-11-19 -> 2026-11-26
    const bootReentry = await request(app).post('/api/daily/bootstrap').send({
      user_id: testUserId,
      log_date: '2026-11-26',
    });
    expect(bootReentry.status).toBe(200);
    expect(bootReentry.body.requiresReentry).toBe(true);
    expect(bootReentry.body.gapDays).toBe(7);

    const applyRes = await request(app).post('/api/reentry/apply').send({
      user_id: testUserId,
      return_date: '2026-11-26',
      last_active_date: '2026-11-19',
      gap_days: 7,
      return_strategy: 'GRADUAL_RAMP',
      actions: [
        {
          project_id: testProjectId,
          action_taken: 'REDUCE_DOSE',
          days_shifted: 7,
          new_target_minutes: 15,
        },
      ],
    });
    expect(applyRes.status).toBe(201);
    expect(applyRes.body.bootstrap.dailyLog.day_mode).toBe('REENTRY_RAMP');
  });
});
