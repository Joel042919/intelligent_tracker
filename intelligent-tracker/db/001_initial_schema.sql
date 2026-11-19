-- ============================================================================
-- Intelligent Tracker 24h — Migración Inicial PostgreSQL (Neon)
-- Basado en CONTEXTO_PROYECTO.md (Esquema DBML + Máquinas de Estado + Índices)
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ==========================================
-- 1. USUARIO, RITMOS DE SUEÑO Y POLÍTICA DE RETORNO
-- ==========================================

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name varchar(120),
  username varchar(40) NOT NULL UNIQUE,
  email varchar(120) UNIQUE,
  password_hash text NOT NULL,
  timezone varchar(60) NOT NULL DEFAULT 'America/Lima',
  ideal_bedtime time DEFAULT '22:00:00',
  ideal_wake_time time DEFAULT '05:00:00',
  ideal_sleep_minutes int NOT NULL DEFAULT 420,
  fixed_day_end_time time,
  max_front_burner_projects int NOT NULL DEFAULT 2,
  reentry_ramp_days int NOT NULL DEFAULT 3,
  state bool NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz
);

CREATE TABLE IF NOT EXISTS life_areas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name varchar(60) NOT NULL,
  description text,
  color_hex varchar(10),
  sort_order int DEFAULT 0,
  state bool NOT NULL DEFAULT true
);

-- ==========================================
-- 2. PROYECTOS, TRANSICIONES Y TAREAS (SECUENCIA / PARALELO)
-- ==========================================

CREATE TABLE IF NOT EXISTS projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  life_area_id uuid REFERENCES life_areas(id) ON DELETE SET NULL,
  parent_project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  title varchar(80) NOT NULL,
  icon varchar(60),
  reference_goal text,
  burner_slot varchar(20) NOT NULL DEFAULT 'BACK'
    CHECK (burner_slot IN ('FRONT', 'BACK', 'ARCHIVE')),
  start_date date NOT NULL,
  end_date date NOT NULL,
  accumulated_shift_days int NOT NULL DEFAULT 0,
  target_minutes_per_session int NOT NULL DEFAULT 45,
  min_session_minutes int NOT NULL DEFAULT 15,
  links jsonb,
  status varchar(20) NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED')),
  completion_notes text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz
);

CREATE TABLE IF NOT EXISTS project_transitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  to_project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  transition_rule varchar(30) NOT NULL DEFAULT 'ON_COMPLETE'
    CHECK (transition_rule IN ('ON_COMPLETE', 'ON_DATE', 'MANUAL')),
  carry_over_config jsonb,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS project_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  day_of_week smallint NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),
  preferred_start_time time,
  allocated_minutes int NOT NULL CHECK (allocated_minutes > 0),
  is_active bool NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  parent_task_id uuid REFERENCES tasks(id) ON DELETE CASCADE,
  title varchar(100) NOT NULL,
  description text,
  links jsonb,
  is_habit bool NOT NULL DEFAULT true,
  execution_mode varchar(20) NOT NULL DEFAULT 'SEQUENTIAL'
    CHECK (execution_mode IN ('SEQUENTIAL', 'PARALLEL', 'INDEPENDENT')),
  estimated_minutes int NOT NULL DEFAULT 30,
  min_emergency_minutes int NOT NULL DEFAULT 10,
  is_highlight bool NOT NULL DEFAULT false,
  status varchar(20) NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'BLOCKED', 'IN_PROGRESS', 'DONE', 'SKIPPED')),
  due_date date,
  completed_at timestamptz,
  sort_order int DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz
);

CREATE TABLE IF NOT EXISTS task_dependencies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  prerequisite_task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  dependency_type varchar(20) NOT NULL DEFAULT 'FINISH_TO_START'
    CHECK (dependency_type IN ('FINISH_TO_START', 'START_TO_START')),
  CHECK (task_id <> prerequisite_task_id)
);

-- ==========================================
-- 3. TRIGGERS, FRICCIONES, EMERGENCIAS Y NOTIFICACIONES (LOW-CODE)
-- ==========================================

CREATE TABLE IF NOT EXISTS triggers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name varchar(80) NOT NULL,
  cue_type varchar(30) NOT NULL
    CHECK (cue_type IN ('TIME', 'AUDIO_CUE', 'LOCATION', 'PREVIOUS_HABIT', 'ENVIRONMENT')),
  cue_detail text,
  friction_reduction_protocol text,
  emergency_protocol text,
  links jsonb,
  is_active bool NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS entity_triggers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger_id uuid NOT NULL REFERENCES triggers(id) ON DELETE CASCADE,
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  task_id uuid REFERENCES tasks(id) ON DELETE CASCADE,
  notification_enabled bool NOT NULL DEFAULT true,
  notify_offset_minutes int DEFAULT 0,
  notification_channel varchar(20) DEFAULT 'PUSH'
    CHECK (notification_channel IN ('PUSH', 'ALARM', 'EMAIL', 'IN_APP')),
  notification_message text,
  priority int DEFAULT 1,
  state bool NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS friction_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label varchar(80) NOT NULL,
  category varchar(30) NOT NULL
    CHECK (category IN ('SLEEP_DISRUPTION', 'ENVIRONMENT', 'ENERGY', 'DIGITAL', 'SOCIAL', 'PLANNING', 'ABSENCE')),
  default_adjustment_rule text,
  is_active bool NOT NULL DEFAULT true
);

-- ==========================================
-- 4. TRACKER DE 24H, SUEÑO/TRASNOCHE, DÍAS DETOX Y REAJUSTES
-- ==========================================

CREATE TABLE IF NOT EXISTS daily_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  log_date date NOT NULL,
  day_mode varchar(25) NOT NULL DEFAULT 'NORMAL'
    CHECK (day_mode IN ('NORMAL', 'RECOVERY_DETOX', 'REENTRY_RAMP', 'UNLOGGED_ABSENCE')),
  detox_notes text,
  actual_bedtime timestamptz,
  actual_wake_time timestamptz,
  actual_sleep_minutes int DEFAULT 0,
  wake_delay_minutes int NOT NULL DEFAULT 0,
  sleep_debt_minutes int NOT NULL DEFAULT 0,
  is_late_night bool NOT NULL DEFAULT false,
  planned_total_minutes int NOT NULL DEFAULT 1440,
  unplanned_total_minutes int NOT NULL DEFAULT 0,
  readjustment_count int NOT NULL DEFAULT 0,
  day_status varchar(20) NOT NULL DEFAULT 'OPEN'
    CHECK (day_status IN ('OPEN', 'CLOSED', 'RECONCILED_LATE')),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz,
  UNIQUE (user_id, log_date)
);

CREATE TABLE IF NOT EXISTS time_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  daily_log_id uuid NOT NULL REFERENCES daily_logs(id) ON DELETE CASCADE,
  project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  task_id uuid REFERENCES tasks(id) ON DELETE SET NULL,
  trigger_id uuid REFERENCES triggers(id) ON DELETE SET NULL,
  title varchar(120) NOT NULL,
  block_kind varchar(25) NOT NULL
    CHECK (block_kind IN ('SLEEP', 'PROJECT_WORK', 'TASK', 'ROUTINE', 'UNPLANNED', 'DETOX', 'BUFFER', 'FREE')),
  depth_level varchar(15) DEFAULT 'DEEP'
    CHECK (depth_level IN ('DEEP', 'SHALLOW', 'RECOVERY')),
  planned_start timestamptz NOT NULL,
  planned_end timestamptz NOT NULL,
  planned_minutes int NOT NULL,
  actual_start timestamptz,
  actual_end timestamptz,
  actual_minutes int,
  is_mandatory_today bool NOT NULL DEFAULT true,
  outcome_status varchar(25) NOT NULL DEFAULT 'PLANNED'
    CHECK (outcome_status IN ('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'PARTIAL_EMERGENCY', 'CARRIED_OVER', 'RESCHEDULED_PROJECT', 'DROPPED_TODAY', 'UNPLANNED_LOGGED')),
  non_completion_reason varchar(35)
    CHECK (non_completion_reason IS NULL OR non_completion_reason IN ('NONE', 'FULL_DAY_UNPLANNED', 'TIME_EXHAUSTED', 'WOKE_LATE', 'LOW_ENERGY', 'FRICTION', 'DETOX_DAY')),
  friction_id uuid REFERENCES friction_catalog(id) ON DELETE SET NULL,
  adjustment_reason text,
  sort_order int DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz,
  -- Invariantes de Máquina de Estados (Sección 5.2)
  CONSTRAINT chk_time_blocks_window CHECK (planned_end > planned_start AND planned_minutes > 0),
  CONSTRAINT chk_time_blocks_completed_reason CHECK (
    outcome_status <> 'COMPLETED' OR non_completion_reason IS NULL OR non_completion_reason = 'NONE'
  ),
  CONSTRAINT chk_time_blocks_incomplete_reason CHECK (
    outcome_status NOT IN ('PARTIAL_EMERGENCY', 'CARRIED_OVER', 'RESCHEDULED_PROJECT', 'DROPPED_TODAY')
    OR (non_completion_reason IS NOT NULL AND non_completion_reason <> 'NONE')
  )
);

CREATE TABLE IF NOT EXISTS schedule_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  daily_log_id uuid NOT NULL REFERENCES daily_logs(id) ON DELETE CASCADE,
  trigger_block_id uuid REFERENCES time_blocks(id) ON DELETE SET NULL,
  affected_block_id uuid REFERENCES time_blocks(id) ON DELETE SET NULL,
  adjustment_type varchar(30) NOT NULL
    CHECK (adjustment_type IN ('SHIFT_TIME', 'SHRINK_TO_MIN', 'WAKE_LATE_SHIFT', 'FULL_DAY_OVERFLOW', 'CARRY_TOMORROW', 'EXTEND_PROJECT_END')),
  minutes_delta int NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS reentry_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  return_date date NOT NULL,
  last_active_date date,
  gap_days int NOT NULL,
  return_strategy varchar(25) NOT NULL DEFAULT 'GRADUAL_RAMP'
    CHECK (return_strategy IN ('GRADUAL_RAMP', 'FULL_RESET', 'SELECTIVE_RESUME')),
  summary_notes text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS reentry_project_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reentry_session_id uuid NOT NULL REFERENCES reentry_sessions(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  action_taken varchar(25) NOT NULL
    CHECK (action_taken IN ('EXTEND_DEADLINE', 'REDUCE_DOSE', 'PAUSE_PROJECT', 'ARCHIVE_PROJECT', 'ADVANCE_PHASE')),
  days_shifted int NOT NULL DEFAULT 0,
  new_target_minutes int,
  rationale text
);

-- ==========================================
-- 5. META-EVALUACIÓN DIARIA, JOURNALING Y AUTOAJUSTE (LOW-CODE)
-- ==========================================

CREATE TABLE IF NOT EXISTS evaluation_dimensions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code varchar(40) NOT NULL,
  name varchar(80) NOT NULL,
  prompt_question text NOT NULL,
  score_1_label varchar(120),
  score_5_label varchar(120),
  available_chips jsonb,
  sort_order int DEFAULT 0,
  is_active bool NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS daily_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  daily_log_id uuid NOT NULL UNIQUE REFERENCES daily_logs(id) ON DELETE CASCADE,
  overall_system_score numeric(3,1),
  exit_ticket_notes text,
  mise_en_place_checklist jsonb,
  system_adjustment_summary text,
  evaluated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS daily_dimension_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  daily_evaluation_id uuid NOT NULL REFERENCES daily_evaluations(id) ON DELETE CASCADE,
  dimension_id uuid NOT NULL REFERENCES evaluation_dimensions(id) ON DELETE CASCADE,
  friction_id uuid REFERENCES friction_catalog(id) ON DELETE SET NULL,
  score smallint NOT NULL CHECK (score BETWEEN 1 AND 5),
  selected_chips jsonb,
  root_cause text,
  immediate_adjustment text
);

CREATE TABLE IF NOT EXISTS journal_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  daily_log_id uuid REFERENCES daily_logs(id) ON DELETE SET NULL,
  project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  reentry_session_id uuid REFERENCES reentry_sessions(id) ON DELETE SET NULL,
  entry_type varchar(25) NOT NULL DEFAULT 'DAILY_REFLECTION'
    CHECK (entry_type IN ('DAILY_REFLECTION', 'SYSTEM_TWEAK', 'INSIGHT', 'FRICTION_LOG', 'REENTRY_NOTE')),
  title varchar(120),
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ==========================================
-- 6. ÍNDICES COMPUESTOS RECOMENDADOS
-- ==========================================

CREATE INDEX IF NOT EXISTS idx_daily_logs_user_date ON daily_logs(user_id, log_date);
CREATE INDEX IF NOT EXISTS idx_time_blocks_log_start ON time_blocks(daily_log_id, planned_start);
CREATE INDEX IF NOT EXISTS idx_tasks_project_status ON tasks(project_id, status);
CREATE INDEX IF NOT EXISTS idx_projects_user_slot_status ON projects(user_id, burner_slot, status);
