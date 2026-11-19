export const DEMO_USER_ID = '00000000-0000-0000-0000-000000000001';

export interface ProjectDTO {
  id: string;
  user_id: string;
  life_area_id: string | null;
  title: string;
  icon: string | null;
  reference_goal: string | null;
  burner_slot: 'FRONT' | 'BACK' | 'ARCHIVE';
  start_date: string;
  end_date: string;
  accumulated_shift_days: number;
  target_minutes_per_session: number;
  min_session_minutes: number;
  status: 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'CANCELLED';
}

export interface TaskDTO {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  execution_mode: 'SEQUENTIAL' | 'PARALLEL' | 'INDEPENDENT';
  estimated_minutes: number;
  min_emergency_minutes: number;
  is_highlight: boolean;
  status: 'PENDING' | 'BLOCKED' | 'IN_PROGRESS' | 'DONE' | 'SKIPPED';
}

export interface DailyLogDTO {
  id: string;
  user_id: string;
  log_date: string;
  day_mode: 'NORMAL' | 'RECOVERY_DETOX' | 'REENTRY_RAMP' | 'UNLOGGED_ABSENCE';
  detox_notes: string | null;
  actual_sleep_minutes: number | null;
  wake_delay_minutes: number;
  sleep_debt_minutes: number;
  is_late_night: boolean;
  planned_total_minutes: number;
  unplanned_total_minutes: number;
  readjustment_count: number;
  day_status: 'OPEN' | 'CLOSED' | 'RECONCILED_LATE';
}

export interface TimeBlockDTO {
  id: string;
  daily_log_id: string;
  project_id: string | null;
  task_id: string | null;
  title: string;
  block_kind: 'SLEEP' | 'PROJECT_WORK' | 'TASK' | 'ROUTINE' | 'UNPLANNED' | 'DETOX' | 'BUFFER' | 'FREE';
  depth_level: 'DEEP' | 'SHALLOW' | 'RECOVERY' | null;
  planned_start: string;
  planned_end: string;
  planned_minutes: number;
  outcome_status:
    | 'PLANNED'
    | 'IN_PROGRESS'
    | 'COMPLETED'
    | 'PARTIAL_EMERGENCY'
    | 'CARRIED_OVER'
    | 'RESCHEDULED_PROJECT'
    | 'DROPPED_TODAY'
    | 'UNPLANNED_LOGGED';
  non_completion_reason: string | null;
  adjustment_reason: string | null;
}

export interface EvaluationDimensionDTO {
  id: string;
  code: string;
  name: string;
  prompt_question: string;
  score_1_label: string | null;
  score_5_label: string | null;
  available_chips: string[] | null;
}

export interface FrictionDTO {
  id: string;
  label: string;
  category: string;
  default_adjustment_rule: string | null;
}

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(typeof data.error === 'string' ? data.error : `HTTP ${res.status}`);
  }
  return data as T;
}

export const api = {
  bootstrapDaily: (logDate: string) =>
    apiFetch<{
      requiresReentry: boolean;
      gapDays: number;
      lastActiveDate: string | null;
      dailyLog: DailyLogDTO | null;
      timeBlocks: TimeBlockDTO[];
    }>('/api/daily/bootstrap', {
      method: 'POST',
      body: JSON.stringify({ user_id: DEMO_USER_ID, log_date: logDate }),
    }),

  getDaily: (logDate: string) =>
    apiFetch<{ dailyLog: DailyLogDTO; timeBlocks: TimeBlockDTO[]; adjustments: unknown[] }>(
      `/api/daily/${DEMO_USER_ID}/${logDate}`
    ),

  checkinSleep: (dailyLogId: string, actualBedtime: string, actualWakeTime: string) =>
    apiFetch<{ dailyLog: DailyLogDTO; rebalancePlan: unknown }>(`/api/daily/${dailyLogId}/sleep`, {
      method: 'PATCH',
      body: JSON.stringify({
        actual_bedtime: actualBedtime,
        actual_wake_time: actualWakeTime,
        is_late_night: false,
        auto_rebalance: true,
      }),
    }),

  activateDetox: (dailyLogId: string, detoxNotes: string) =>
    apiFetch<{ dailyLog: DailyLogDTO; droppedBlockCount: number }>(
      `/api/daily/${dailyLogId}/detox`,
      {
        method: 'POST',
        body: JSON.stringify({ detox_notes: detoxNotes }),
      }
    ),

  addUnplanned: (
    dailyLogId: string,
    title: string,
    plannedStart: string,
    plannedEnd: string,
    isFullDayUnplanned = false
  ) =>
    apiFetch<{ unplannedBlock: TimeBlockDTO; rebalancePlan: unknown }>(
      `/api/daily/${dailyLogId}/unplanned`,
      {
        method: 'POST',
        body: JSON.stringify({
          title,
          planned_start: plannedStart,
          planned_end: plannedEnd,
          is_full_day_unplanned: isFullDayUnplanned,
          auto_rebalance: true,
        }),
      }
    ),

  updateBlockStatus: (
    blockId: string,
    outcomeStatus: TimeBlockDTO['outcome_status'],
    nonCompletionReason?: string,
    actualMinutes?: number
  ) =>
    apiFetch<{ block: TimeBlockDTO }>(`/api/blocks/${blockId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({
        outcome_status: outcomeStatus,
        non_completion_reason: nonCompletionReason ?? null,
        actual_minutes: actualMinutes ?? null,
      }),
    }),

  getProjects: () =>
    apiFetch<{ projects: ProjectDTO[] }>(`/api/projects?user_id=${DEMO_USER_ID}`),

  createProject: (payload: {
    title: string;
    icon: string;
    burner_slot: 'FRONT' | 'BACK' | 'ARCHIVE';
    start_date: string;
    end_date: string;
    target_minutes_per_session: number;
    min_session_minutes: number;
    reference_goal?: string;
  }) =>
    apiFetch<{ project: ProjectDTO; warning: string | null }>('/api/projects', {
      method: 'POST',
      body: JSON.stringify({ user_id: DEMO_USER_ID, ...payload }),
    }),

  getProjectTasks: (projectId: string) =>
    apiFetch<{ tasks: TaskDTO[] }>(`/api/projects/${projectId}/tasks`),

  createTask: (
    projectId: string,
    payload: {
      title: string;
      execution_mode: 'SEQUENTIAL' | 'PARALLEL' | 'INDEPENDENT';
      estimated_minutes: number;
      min_emergency_minutes: number;
      is_highlight: boolean;
      prerequisite_task_ids?: string[];
    }
  ) =>
    apiFetch<{ task: TaskDTO }>(`/api/projects/${projectId}/tasks`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateTaskStatus: (taskId: string, status: TaskDTO['status'], overrideBlocked = false) =>
    apiFetch<{ task: TaskDTO; unlockedTaskIds: string[] }>(`/api/tasks/${taskId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status, override_blocked: overrideBlocked }),
    }),

  applyReentry: (payload: {
    return_date: string;
    last_active_date: string | null;
    gap_days: number;
    actions: Array<{
      project_id: string;
      action_taken: 'EXTEND_DEADLINE' | 'REDUCE_DOSE' | 'PAUSE_PROJECT' | 'ARCHIVE_PROJECT';
      days_shifted: number;
      new_target_minutes?: number;
    }>;
  }) =>
    apiFetch<{ bootstrap: { dailyLog: DailyLogDTO; timeBlocks: TimeBlockDTO[] } }>(
      '/api/reentry/apply',
      {
        method: 'POST',
        body: JSON.stringify({
          user_id: DEMO_USER_ID,
          return_strategy: 'GRADUAL_RAMP',
          ...payload,
        }),
      }
    ),

  getEvaluationConfig: () =>
    apiFetch<{ dimensions: EvaluationDimensionDTO[]; frictionCatalog: FrictionDTO[] }>(
      `/api/evaluation/config/${DEMO_USER_ID}`
    ),

  closeDay: (payload: {
    daily_log_id: string;
    exit_ticket_notes: string;
    mise_en_place_checklist: Array<{ label: string; done: boolean }>;
    dimension_scores: Array<{
      dimension_id: string;
      score: number;
      selected_chips: string[];
      friction_id?: string | null;
    }>;
  }) =>
    apiFetch<{
      evaluation: { overall_system_score: string };
      dailyLog: DailyLogDTO;
      autoTuneSuggestions: Array<{ type: string; target: string; message: string }>;
    }>('/api/evaluation/close-day', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
};
