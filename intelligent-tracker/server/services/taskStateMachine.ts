import type { PoolClient } from 'pg';
import type { TaskStatus } from '../types/domain.js';

/**
 * Evalúa si una nueva tarea nace BLOCKED o PENDING según task_dependencies (FINISH_TO_START).
 */
export async function resolveInitialTaskStatus(
  client: PoolClient,
  prerequisiteTaskIds: string[],
  dependencyType: 'FINISH_TO_START' | 'START_TO_START' = 'FINISH_TO_START'
): Promise<TaskStatus> {
  if (prerequisiteTaskIds.length === 0 || dependencyType !== 'FINISH_TO_START') {
    return 'PENDING';
  }
  const { rows } = await client.query<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt
     FROM tasks
     WHERE id = ANY($1::uuid[]) AND status <> 'DONE'`,
    [prerequisiteTaskIds]
  );
  return Number(rows[0]?.cnt ?? 0) > 0 ? 'BLOCKED' : 'PENDING';
}

/**
 * Transiciona una tarea respetando la máquina de estados (Sección 5.1)
 * y desbloquea tareas dependientes cuando pasa a DONE.
 */
export async function transitionTaskStatus(
  client: PoolClient,
  taskId: string,
  nextStatus: TaskStatus,
  overrideBlocked = false
): Promise<{ unlockedTaskIds: string[] }> {
  const { rows } = await client.query<{ id: string; status: TaskStatus }>(
    `SELECT id, status FROM tasks WHERE id = $1`,
    [taskId]
  );
  if (rows.length === 0) {
    throw new Error('TASK_NOT_FOUND');
  }
  const current = rows[0].status;

  if (current === 'BLOCKED' && nextStatus === 'IN_PROGRESS' && !overrideBlocked) {
    throw new Error('TASK_BLOCKED_BY_PREREQUISITE');
  }

  const completedAtExpr = nextStatus === 'DONE' ? 'CURRENT_TIMESTAMP' : 'NULL';
  await client.query(
    `UPDATE tasks
     SET status = $2,
         completed_at = ${completedAtExpr},
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [taskId, nextStatus]
  );

  const unlockedTaskIds: string[] = [];
  if (nextStatus === 'DONE') {
    // Buscar tareas que dependen de esta en FINISH_TO_START y estén BLOCKED
    const deps = await client.query<{ task_id: string }>(
      `SELECT DISTINCT td.task_id
       FROM task_dependencies td
       JOIN tasks t ON t.id = td.task_id
       WHERE td.prerequisite_task_id = $1
         AND td.dependency_type = 'FINISH_TO_START'
         AND t.status = 'BLOCKED'`,
      [taskId]
    );

    for (const row of deps.rows) {
      const pendingPrereqs = await client.query<{ cnt: string }>(
        `SELECT COUNT(*)::text AS cnt
         FROM task_dependencies td
         JOIN tasks pre ON pre.id = td.prerequisite_task_id
         WHERE td.task_id = $1
           AND td.dependency_type = 'FINISH_TO_START'
           AND pre.status <> 'DONE'`,
        [row.task_id]
      );
      if (Number(pendingPrereqs.rows[0]?.cnt ?? 0) === 0) {
        await client.query(
          `UPDATE tasks SET status = 'PENDING', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
          [row.task_id]
        );
        unlockedTaskIds.push(row.task_id);
      }
    }
  }

  return { unlockedTaskIds };
}
