import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { resolveInitialTaskStatus, transitionTaskStatus } from '../services/taskStateMachine.js';

export const projectsRouter = Router();

const createProjectSchema = z.object({
  user_id: z.string().uuid(),
  life_area_id: z.string().uuid().nullable().optional(),
  parent_project_id: z.string().uuid().nullable().optional(),
  title: z.string().min(1).max(80),
  icon: z.string().max(60).nullable().optional(),
  reference_goal: z.string().nullable().optional(),
  burner_slot: z.enum(['FRONT', 'BACK', 'ARCHIVE']).default('BACK'),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  target_minutes_per_session: z.number().int().positive().default(45),
  min_session_minutes: z.number().int().positive().default(15),
  links: z.unknown().nullable().optional(),
  status: z.enum(['DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED']).default('ACTIVE'),
});

const updateProjectStatusSchema = z.object({
  status: z.enum(['DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED']),
  completion_notes: z.string().nullable().optional(),
  paused_days: z.number().int().min(0).optional(),
});

const createTaskSchema = z.object({
  parent_task_id: z.string().uuid().nullable().optional(),
  title: z.string().min(1).max(100),
  description: z.string().nullable().optional(),
  links: z.unknown().nullable().optional(),
  is_habit: z.boolean().default(true),
  execution_mode: z.enum(['SEQUENTIAL', 'PARALLEL', 'INDEPENDENT']).default('SEQUENTIAL'),
  estimated_minutes: z.number().int().positive().default(30),
  min_emergency_minutes: z.number().int().positive().default(10),
  is_highlight: z.boolean().default(false),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  sort_order: z.number().int().default(0),
  prerequisite_task_ids: z.array(z.string().uuid()).default([]),
  dependency_type: z.enum(['FINISH_TO_START', 'START_TO_START']).default('FINISH_TO_START'),
});

const updateTaskStatusSchema = z.object({
  status: z.enum(['PENDING', 'BLOCKED', 'IN_PROGRESS', 'DONE', 'SKIPPED']),
  override_blocked: z.boolean().default(false),
});

projectsRouter.get('/projects', async (req, res) => {
  const userId = req.query.user_id as string | undefined;
  if (!userId) {
    res.status(400).json({ error: 'user_id query param is required' });
    return;
  }
  const { rows } = await pool.query(
    `SELECT * FROM projects WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId]
  );
  res.json({ projects: rows });
});

projectsRouter.post('/projects', async (req, res) => {
  const parsed = createProjectSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const d = parsed.data;
  const client = await pool.connect();
  try {
    let frontBurnerWarning: string | null = null;
    if (d.burner_slot === 'FRONT' && d.status === 'ACTIVE') {
      const limitRes = await client.query<{ max_front_burner_projects: number; current_front: string }>(
        `SELECT u.max_front_burner_projects,
                (SELECT COUNT(*)::text FROM projects p WHERE p.user_id = u.id AND p.burner_slot = 'FRONT' AND p.status = 'ACTIVE') AS current_front
         FROM users u WHERE u.id = $1`,
        [d.user_id]
      );
      if (limitRes.rows.length > 0) {
        const { max_front_burner_projects, current_front } = limitRes.rows[0];
        if (Number(current_front) >= max_front_burner_projects) {
          frontBurnerWarning = `Supera el límite de ${max_front_burner_projects} proyectos en FRONT burner.`;
        }
      }
    }

    const { rows } = await client.query(
      `INSERT INTO projects (
         user_id, life_area_id, parent_project_id, title, icon, reference_goal,
         burner_slot, start_date, end_date, target_minutes_per_session, min_session_minutes,
         links, status
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [
        d.user_id,
        d.life_area_id ?? null,
        d.parent_project_id ?? null,
        d.title,
        d.icon ?? null,
        d.reference_goal ?? null,
        d.burner_slot,
        d.start_date,
        d.end_date,
        d.target_minutes_per_session,
        d.min_session_minutes,
        d.links ? JSON.stringify(d.links) : null,
        d.status,
      ]
    );

    res.status(201).json({ project: rows[0], warning: frontBurnerWarning });
  } finally {
    client.release();
  }
});

projectsRouter.patch('/projects/:id/status', async (req, res) => {
  const parsed = updateProjectStatusSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { status, completion_notes, paused_days } = parsed.data;
  if (status === 'CANCELLED' && (!completion_notes || completion_notes.trim().length === 0)) {
    res.status(400).json({ error: 'completion_notes is required when cancelling a project' });
    return;
  }

  const shift = status === 'ACTIVE' && paused_days ? paused_days : 0;
  const { rows } = await pool.query(
    `UPDATE projects
     SET status = $2,
         completion_notes = COALESCE($3, completion_notes),
         accumulated_shift_days = accumulated_shift_days + $4,
         end_date = end_date + ($4 * INTERVAL '1 day'),
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1
     RETURNING *`,
    [req.params.id, status, completion_notes ?? null, shift]
  );
  if (rows.length === 0) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  let suggestedTransitions: unknown[] = [];
  if (status === 'COMPLETED') {
    const tr = await pool.query(
      `SELECT pt.*, p.title AS to_project_title
       FROM project_transitions pt
       JOIN projects p ON p.id = pt.to_project_id
       WHERE pt.from_project_id = $1`,
      [req.params.id]
    );
    suggestedTransitions = tr.rows;
  }

  res.json({ project: rows[0], suggestedTransitions });
});

projectsRouter.get('/projects/:id/tasks', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT * FROM tasks WHERE project_id = $1 ORDER BY sort_order ASC, created_at ASC`,
    [req.params.id]
  );
  res.json({ tasks: rows });
});

projectsRouter.post('/projects/:id/tasks', async (req, res) => {
  const parsed = createTaskSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const d = parsed.data;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const initialStatus = await resolveInitialTaskStatus(
      client,
      d.prerequisite_task_ids,
      d.dependency_type
    );
    const { rows } = await client.query(
      `INSERT INTO tasks (
         project_id, parent_task_id, title, description, links, is_habit,
         execution_mode, estimated_minutes, min_emergency_minutes, is_highlight,
         status, due_date, sort_order
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [
        req.params.id,
        d.parent_task_id ?? null,
        d.title,
        d.description ?? null,
        d.links ? JSON.stringify(d.links) : null,
        d.is_habit,
        d.execution_mode,
        d.estimated_minutes,
        d.min_emergency_minutes,
        d.is_highlight,
        initialStatus,
        d.due_date ?? null,
        d.sort_order,
      ]
    );
    const task = rows[0];
    for (const preId of d.prerequisite_task_ids) {
      await client.query(
        `INSERT INTO task_dependencies (task_id, prerequisite_task_id, dependency_type)
         VALUES ($1, $2, $3)`,
        [task.id, preId, d.dependency_type]
      );
    }
    await client.query('COMMIT');
    res.status(201).json({ task });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: (err as Error).message });
  } finally {
    client.release();
  }
});

projectsRouter.patch('/tasks/:id/status', async (req, res) => {
  const parsed = updateTaskStatusSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { unlockedTaskIds } = await transitionTaskStatus(
      client,
      req.params.id,
      parsed.data.status,
      parsed.data.override_blocked
    );
    const { rows } = await client.query(`SELECT * FROM tasks WHERE id = $1`, [req.params.id]);
    await client.query('COMMIT');
    res.json({ task: rows[0], unlockedTaskIds });
  } catch (err) {
    await client.query('ROLLBACK');
    const msg = (err as Error).message;
    if (msg === 'TASK_NOT_FOUND') {
      res.status(404).json({ error: msg });
      return;
    }
    if (msg === 'TASK_BLOCKED_BY_PREREQUISITE') {
      res.status(409).json({ error: msg });
      return;
    }
    res.status(500).json({ error: msg });
  } finally {
    client.release();
  }
});
