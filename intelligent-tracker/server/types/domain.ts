export type BurnerSlot = 'FRONT' | 'BACK' | 'ARCHIVE';
export type ProjectStatus = 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'CANCELLED';
export type TransitionRule = 'ON_COMPLETE' | 'ON_DATE' | 'MANUAL';

export type TaskExecutionMode = 'SEQUENTIAL' | 'PARALLEL' | 'INDEPENDENT';
export type TaskStatus = 'PENDING' | 'BLOCKED' | 'IN_PROGRESS' | 'DONE' | 'SKIPPED';
export type DependencyType = 'FINISH_TO_START' | 'START_TO_START';

export type DayMode = 'NORMAL' | 'RECOVERY_DETOX' | 'REENTRY_RAMP' | 'UNLOGGED_ABSENCE';
export type DayStatus = 'OPEN' | 'CLOSED' | 'RECONCILED_LATE';

export type BlockKind =
  | 'SLEEP'
  | 'PROJECT_WORK'
  | 'TASK'
  | 'ROUTINE'
  | 'UNPLANNED'
  | 'DETOX'
  | 'BUFFER'
  | 'FREE';

export type DepthLevel = 'DEEP' | 'SHALLOW' | 'RECOVERY';

export type OutcomeStatus =
  | 'PLANNED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'PARTIAL_EMERGENCY'
  | 'CARRIED_OVER'
  | 'RESCHEDULED_PROJECT'
  | 'DROPPED_TODAY'
  | 'UNPLANNED_LOGGED';

export type NonCompletionReason =
  | 'NONE'
  | 'FULL_DAY_UNPLANNED'
  | 'TIME_EXHAUSTED'
  | 'WOKE_LATE'
  | 'LOW_ENERGY'
  | 'FRICTION'
  | 'DETOX_DAY';

export type AdjustmentType =
  | 'SHIFT_TIME'
  | 'SHRINK_TO_MIN'
  | 'WAKE_LATE_SHIFT'
  | 'FULL_DAY_OVERFLOW'
  | 'CARRY_TOMORROW'
  | 'EXTEND_PROJECT_END';

export type ReentryStrategy = 'GRADUAL_RAMP' | 'FULL_RESET' | 'SELECTIVE_RESUME';
export type ReentryActionTaken =
  | 'EXTEND_DEADLINE'
  | 'REDUCE_DOSE'
  | 'PAUSE_PROJECT'
  | 'ARCHIVE_PROJECT'
  | 'ADVANCE_PHASE';

export interface ProjectRow {
  id: string;
  user_id: string;
  life_area_id: string | null;
  parent_project_id: string | null;
  title: string;
  icon: string | null;
  reference_goal: string | null;
  burner_slot: BurnerSlot;
  start_date: string;
  end_date: string;
  accumulated_shift_days: number;
  target_minutes_per_session: number;
  min_session_minutes: number;
  links: unknown | null;
  status: ProjectStatus;
  completion_notes: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface TaskRow {
  id: string;
  project_id: string;
  parent_task_id: string | null;
  title: string;
  description: string | null;
  links: unknown | null;
  is_habit: boolean;
  execution_mode: TaskExecutionMode;
  estimated_minutes: number;
  min_emergency_minutes: number;
  is_highlight: boolean;
  status: TaskStatus;
  due_date: string | null;
  completed_at: string | null;
  sort_order: number | null;
  created_at: string;
  updated_at: string | null;
}

export interface DailyLogRow {
  id: string;
  user_id: string;
  log_date: string;
  day_mode: DayMode;
  detox_notes: string | null;
  actual_bedtime: string | null;
  actual_wake_time: string | null;
  actual_sleep_minutes: number | null;
  wake_delay_minutes: number;
  sleep_debt_minutes: number;
  is_late_night: boolean;
  planned_total_minutes: number;
  unplanned_total_minutes: number;
  readjustment_count: number;
  day_status: DayStatus;
  created_at: string;
  updated_at: string | null;
}

export interface TimeBlockRow {
  id: string;
  daily_log_id: string;
  project_id: string | null;
  task_id: string | null;
  trigger_id: string | null;
  title: string;
  block_kind: BlockKind;
  depth_level: DepthLevel | null;
  planned_start: string;
  planned_end: string;
  planned_minutes: number;
  actual_start: string | null;
  actual_end: string | null;
  actual_minutes: number | null;
  is_mandatory_today: boolean;
  outcome_status: OutcomeStatus;
  non_completion_reason: NonCompletionReason | null;
  friction_id: string | null;
  adjustment_reason: string | null;
  sort_order: number | null;
  created_at: string;
  updated_at: string | null;
}
