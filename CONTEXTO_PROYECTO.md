# Contexto y Arquitectura del Sistema: Gestión de Vida, Hábitos, Tracker 24h y Autoajuste Metacognitivo

Este documento consolida todo el contexto conceptual, funcional, técnico y de modelado de datos diseñado para el desarrollo local en **Antigravity**. Su objetivo es servir como *Single Source of Truth* (fuente única de verdad) para implementar la base de datos, el motor de reajuste horario, las notificaciones basadas en disparadores (*triggers*) y el módulo de evaluación metacognitiva *low-code*.

---

## 1. Visión y Filosofía del Producto

El sistema no es una simple lista de tareas (*to-do list*) ni un gestor tradicional de metas. Está diseñado como un **sistema de arquitectura conductual y control situacional** orientado a que el usuario ejecute diariamente sus hábitos y avance en sus proyectos **sin depender de la fuerza de voluntad** (que es un recurso finito y agotable), sino apoyándose en **disparadores contextuales (*triggers*)**, **bloques de tiempo estructurados**, **protocolos de emergencia** y **retroalimentación diaria para autoajuste**.

### Fundamentos Teóricos Integrados
El diseño recoge principios de psicología conductual, gestión del tiempo y aprendizaje profundo:
1. **Automatización mediante Contexto y Disparadores (*Good Habits, Bad Habits* - Wendy Wood):**
   * Los hábitos se forman asociando una **pista contextual estable** (hora, ubicación, audio, acción previa, entorno físico) con una respuesta repetida y recompensada.
   * La fricción del entorno determina si el hábito ocurre o si el cerebro entra en "negociación mental". Reducir fricción en lo deseado y aumentar fricción en distracciones es más efectivo que intentar resistir tentaciones.
   * **No existe la fragilidad de "romper la cadena" por 1 o 2 días de ausencia:** Omitir un hábito uno o dos días no borra la automaticidad acumulada ni devuelve al usuario a cero. El sistema jamás debe castigar o reiniciar contadores por fallos puntuales; debe usar el fallo como un dato diagnóstico para ajustar el entorno o reducir la dosis mínima.
2. **Trabajo Profundo, Ritmos y Bloques de Tiempo (*Deep Work* - Cal Newport):**
   * Separar bloques de alta demanda cognitiva (`DEEP`) de tareas logísticas (`SHALLOW`) y descanso (`RECOVERY`).
   * Planificar cada minuto del día (1,440 minutos) mediante bloques con un propósito asignado y bloques condicionales de desbordamiento (*overflow buffers*).
   * Ritual de cierre diario (*shutdown ritual*) para liberar carga cognitiva residual (efecto Zeigarnik).
3. **Finitud del Tiempo y Serialización (*Four Thousand Weeks* - Oliver Burkeman):**
   * El día tiene exactamente **24 horas (1,440 minutos)**; aceptar este límite obliga a priorizar.
   * **Límite de Proyectos Activos (*Front Burner* vs. *Back Burner*):** Evitar tener 10 proyectos abiertos a medias. El usuario mantiene un máximo estricto de proyectos principales en hornilla delantera (`FRONT`, p. ej., 1 o 2) y otros en segundo plano (`BACK`).
   * **Incrementalismo y Re-planificación:** Cuando el día se descuadra por imprevistos, el objetivo no es la perfección rígida, sino decidir conscientemente qué hacer con el tiempo restante.
4. **Experimentación Diaria y Enfoque (*Make Time* - Jake Knapp & John Zeratsky):**
   * Elegir un *Highlight* diario, proteger la energía y tratar cada día como un experimento donde lo que falla no es "fracaso personal", sino un dato para calibrar las tácticas del sistema.
5. **Deconstrucción, Evocación Activa y Metacognición (*Make It Stick* & *The Science of Rapid Skill Acquisition*):**
   * Descomponer habilidades/proyectos grandes en sub-habilidades secuenciales o paralelas aplicando el principio 80/20.
   * Cerrar el día con **evocación activa (*Exit Ticket*)** en lugar de revisión pasiva, evaluando objetivamente el rendimiento del sistema.

---

## 2. Requerimientos Funcionales Clave

1. **Jerarquía y Dependencias de Proyectos y Tareas:**
   * **Proyectos:** Tienen área de vida, prioridad de foco (`FRONT`, `BACK`, `ARCHIVE`), fecha de inicio y fin, días de la semana activos y duración objetivo por sesión.
   * **Concatenación de Fases (`project_transitions`):** Cuando un proyecto concluye, puede encadenarse automáticamente o por confirmación a su siguiente fase/proyecto heredando configuraciones, disparadores y aprendizajes.
   * **Tareas y Subtareas (`tasks` + `task_dependencies`):**
     * Subdivisión jerárquica infinita (`parent_task_id`).
     * **Ejecución Secuencial (`SEQUENTIAL` / `FINISH_TO_START`):** La tarea B no puede pasar a ejecución hasta que su tarea prerrequisito A esté `DONE`.
     * **Ejecución Paralela (`PARALLEL` / `START_TO_START`) e Independiente (`INDEPENDENT`):** Múltiples tareas pueden ejecutarse en paralelo dentro de la misma ventana del proyecto.
2. **Sistema de Disparadores (*Triggers*) y Notificaciones:**
   * Cada proyecto o tarea puede vincularse a uno o varios *triggers* (hora exacta, canción/audio, lugar físico, hábito previo encadenado, señal ambiental).
   * Cada *trigger* incluye su **protocolo de reducción de fricción** (preparación previa) y su **protocolo de emergencia** (versión mínima viable de 5–15 minutos para días difíciles).
   * El modelo soporta configuración granular de notificaciones (`PUSH`, `ALARM`, `EMAIL`, `IN_APP`, minutos de anticipación `notify_offset_minutes`, mensaje personalizado).
3. **Tracker Preciso de 24 Horas (1,440 Minutos) y Sueño:**
   * La suma de bloques de un día (`daily_logs`) representa las **24 horas completas (1,440 minutos)**, incluyendo sueño, rutinas, bloques de proyecto/hábito, tiempo libre y márgenes (*buffers*).
   * Compara **sueño ideal** (`ideal_bedtime`, `ideal_wake_time`, `ideal_sleep_minutes`) contra **sueño real** (`actual_bedtime`, `actual_wake_time`, `actual_sleep_minutes`), calculando automáticamente el retraso al despertar (`wake_delay_minutes`), deuda de sueño (`sleep_debt_minutes`) y bandera de trasnoche (`is_late_night`).
4. **Motor de Reajuste Dinámico ante Imprevistos y Desfases:**
   * Si surge un **imprevisto** (`block_kind = 'UNPLANNED'`) o una actividad planificada toma más tiempo del estimado (`actual_minutes > planned_minutes`), el sistema recalcula el resto del día.
   * **Regla de cumplimiento obligatorio:** Las actividades marcadas como obligatorias para hoy (`is_mandatory_today = true`) deben mantenerse en la agenda del día aunque sea necesario **desplazarlas** en horario o **reducir su duración** hasta su umbral mínimo de emergencia (`min_emergency_minutes`), antes de descartarlas.
   * Todo movimiento queda auditado en `schedule_adjustments`.
5. **Evaluación Diaria Metacognitiva y Diseño *Low-Code*:**
   * Basado en la hoja de auditoría diaria del usuario:
     1. **Auditoría de ejecución por bloque:** Disparador activado, fricción/obstáculo reportado, estado de ejecución (`Completo`, `Emergencia`, `Omitido`) y protocolo de ajuste aplicado.
     2. **Diagnóstico metacognitivo cuantitativo (escala 1 a 5):** Dimensiones configurables por el usuario (ej. *Control de Triggers*, *Fricción Digital/Celular*, *Transición de Entorno Social*, *Práctica Generativa*) + selección múltiple de *chips* diagnósticos + causa raíz y ajuste situacional inmediato.
     3. **Cierre del día:** *Exit Ticket* de 60 segundos (evocación activa de aprendizajes) + *Mise en Place* nocturno (checklist anti-fricción para el día siguiente).
   * **Enfoque *Low-Code*:** Dimensiones de evaluación, escalas `1–5`, catálogo de fricciones (`friction_catalog`), *chips* y checklists se almacenan como datos/JSONB configurables desde la interfaz sin necesidad de modificar esquema SQL ni código backend.

---

## 3. Casos Borde y Comportamiento Humano Real (Reglas de Negocio)

El sistema está explícitamente diseñado para resistir los patrones reales por los que las personas abandonan aplicaciones de hábitos:

### Caso A: Trasnocharse y Despertar Tarde (`is_late_night = true`, `wake_delay_minutes > 0`)
* **Problema:** El usuario planeó despertar a las 05:00 AM, pero se acostó tarde y despertó a las 07:30 AM (`wake_delay_minutes = 150`).
* **Comportamiento del Sistema:**
  1. Actualiza `actual_wake_time`, `actual_sleep_minutes`, `sleep_debt_minutes` y `wake_delay_minutes` en `daily_logs`.
  2. El motor de agenda detecta que los bloques entre `05:00` y `07:30` quedaron en el pasado.
  3. Reconstruye la línea de tiempo desde la hora real de despertar (`07:30`) hasta `fixed_day_end_time` / hora ideal de dormir:
     * Consume primero bloques `FREE` / `BUFFER`.
     * Desplaza hacia adelante (`WAKE_LATE_SHIFT`) los bloques `is_mandatory_today = true`.
     * Si el tiempo total disponible no alcanza para la duración completa de todos los bloques obligatorios, comprime proporcionalmente o reduce los bloques no críticos a su `min_emergency_minutes` (`SHRINK_TO_MIN`).

### Caso B: Imprevisto Masivo que Ocupa Todo el Día o Impide Completar Hábitos
* **Problema:** Un imprevisto ocupa 6–10 horas o toda la jornada, haciendo físicamente imposible ejecutar los hábitos/tareas planeados incluso en su versión mínima.
* **Comportamiento del Sistema:**
  1. Se registra el bloque con `block_kind = 'UNPLANNED'` y `outcome_status = 'UNPLANNED_LOGGED'`.
  2. Los bloques afectados que no alcanzan a ejecutarse nunca quedan en limbo ni se borran; pasan a `CARRIED_OVER`, `RESCHEDULED_PROJECT` o `DROPPED_TODAY` con `non_completion_reason = 'FULL_DAY_UNPLANNED'` (o `'TIME_EXHAUSTED'`).
  3. **Regla anti-avalancha:** Si pasan a `CARRIED_OVER`, al día siguiente **no se suma** el tiempo de ayer + hoy (evitando jornadas imposibles de 16 horas), sino que la tarea ocupa el slot normal del día siguiente y el proyecto extiende su `end_date` en +1 día (`accumulated_shift_days + 1`).

### Caso C: Día *Detox* / Descanso Intencional (`day_mode = 'RECOVERY_DETOX'`)
* **Problema:** El usuario decide tomar un día *detox* (desconexión digital, descanso profundo o pausa consciente) y no registra avance de hábitos.
* **Comportamiento del Sistema:**
  1. El usuario (o una regla programada) marca el `daily_log` con `day_mode = 'RECOVERY_DETOX'` y registra `detox_notes`.
  2. Todos los bloques de hábito/proyecto no esenciales del día pasan automáticamente a `outcome_status = 'DROPPED_TODAY'` con `non_completion_reason = 'DETOX_DAY'`.
  3. **Protección de métricas:** Los días `RECOVERY_DETOX` se excluyen del cálculo de incumplimiento o penalización de consistencia. No rompen rachas ni disparan alertas de abandono.

### Caso D: Abandono Temporal / Ausencia de Varios Días o Semanas (1–2+ Semanas sin Abrir la App)
* **Problema:** El usuario deja de usar la aplicación durante 7 o 14 días y regresa queriendo retomar su vida sin sentirse abrumado por decenas de tareas vencidas.
* **Comportamiento del Sistema:**
  1. Al iniciar sesión, el backend calcula `gap_days = current_date - last_active_date`.
  2. Si `gap_days >= 3` (configurable), el sistema **no muestra una lista roja de tareas atrasadas**.
  3. Marca los días intermedios sin registro como `day_mode = 'UNLOGGED_ABSENCE'` y `day_status = 'RECONCILED_LATE'`.
  4. Abre obligatoriamente un asistente de **Sesión de Reentrada (`reentry_sessions`)** donde para cada proyecto activo (`status = 'ACTIVE'`) se aplica una acción (`reentry_project_actions`):
     * `EXTEND_DEADLINE`: Desplaza `end_date` sumando `days_shifted` (ej. los `gap_days` perdidos) y actualiza `accumulated_shift_days`.
     * `REDUCE_DOSE`: Activa durante `users.reentry_ramp_days` (ej. 3 días) el modo `day_mode = 'REENTRY_RAMP'`, donde los bloques usan `min_session_minutes` / `min_emergency_minutes` en lugar de la duración completa para reconstruir el hábito sin fricción.
     * `PAUSE_PROJECT` / `ARCHIVE_PROJECT` / `ADVANCE_PHASE`: Permite pausar o archivar proyectos que ya no tienen sentido tras la pausa.

---

## 4. Esquema Completo de Base de Datos (DBML)

Este esquema está listo para PostgreSQL (usando `uuid`, `timestamptz`, `jsonb`, `smallint`) y visualizable en `dbdiagram.io`:

```dbml
// ==========================================
// 1. USUARIO, RITMOS DE SUEÑO Y POLÍTICA DE RETORNO
// ==========================================

Table users {
  id uuid [pk]
  full_name varchar(120)
  username varchar(40) [not null, unique]
  email varchar(120) [unique]
  password_hash text [not null]
  timezone varchar(60) [not null, default: 'America/Lima']
  ideal_bedtime time [default: '22:00:00']
  ideal_wake_time time [default: '05:00:00']
  ideal_sleep_minutes int [not null, default: 420] // Ej. 7h = 420 min
  fixed_day_end_time time // Hora tope de cierre diario si aplica
  max_front_burner_projects int [not null, default: 2] // Límite de proyectos en foco principal (Front Burner)
  reentry_ramp_days int [not null, default: 3] // Días de reentrada gradual tras ausencia larga
  state bool [not null, default: true]
  created_at timestamptz [not null, default: `CURRENT_TIMESTAMP`]
  updated_at timestamptz
}

Table life_areas {
  id uuid [pk]
  user_id uuid [not null, ref: > users.id]
  name varchar(60) [not null] // Ej. Espiritual, Trabajo/Universidad, Salud/Físico, Habilidades
  description text
  color_hex varchar(10)
  sort_order int [default: 0]
  state bool [not null, default: true]
}

// ==========================================
// 2. PROYECTOS, TRANSICIONES Y TAREAS (SECUENCIA / PARALELO)
// ==========================================

Table projects {
  id uuid [pk]
  user_id uuid [not null, ref: > users.id]
  life_area_id uuid [ref: > life_areas.id]
  parent_project_id uuid [ref: > projects.id] // Subproyecto jerárquico opcional
  title varchar(80) [not null]
  reference_goal text // Objetivo de referencia (norte, no el sistema diario)
  burner_slot varchar(20) [not null, default: 'BACK'] // FRONT | BACK | ARCHIVE
  start_date date [not null]
  end_date date [not null]
  accumulated_shift_days int [not null, default: 0] // Días desplazados por pausas o reajustes
  target_minutes_per_session int [not null, default: 45]
  min_session_minutes int [not null, default: 15] // Dosis mínima en días ajustados o de retorno
  links jsonb // Enlaces o recursos asociados
  status varchar(20) [not null, default: 'ACTIVE'] // DRAFT | ACTIVE | PAUSED | COMPLETED | CANCELLED
  completion_notes text
  created_at timestamptz [not null, default: `CURRENT_TIMESTAMP`]
  updated_at timestamptz
}

// Concatenación explícita cuando un proyecto termina y da paso a su siguiente fase
Table project_transitions {
  id uuid [pk]
  from_project_id uuid [not null, ref: > projects.id]
  to_project_id uuid [not null, ref: > projects.id]
  transition_rule varchar(30) [not null, default: 'ON_COMPLETE'] // ON_COMPLETE | ON_DATE | MANUAL
  carry_over_config jsonb // Triggers, parámetros y reglas que hereda la siguiente fase
  created_at timestamptz [not null, default: `CURRENT_TIMESTAMP`]
}

// Días de la semana y tiempo dedicado al proyecto
Table project_schedules {
  id uuid [pk]
  project_id uuid [not null, ref: > projects.id]
  day_of_week smallint [not null] // 1=Lun ... 7=Dom (ISO-8601)
  preferred_start_time time
  allocated_minutes int [not null]
  is_active bool [not null, default: true]
}

Table tasks {
  id uuid [pk]
  project_id uuid [not null, ref: > projects.id]
  parent_task_id uuid [ref: > tasks.id] // Subdivisión de tarea en subtareas
  title varchar(100) [not null]
  description text
  links jsonb
  is_habit bool [not null, default: true]
  execution_mode varchar(20) [not null, default: 'SEQUENTIAL'] // SEQUENTIAL | PARALLEL | INDEPENDENT
  estimated_minutes int [not null, default: 30]
  min_emergency_minutes int [not null, default: 10] // Versión mínima para protocolo de emergencia
  is_highlight bool [not null, default: false]
  status varchar(20) [not null, default: 'PENDING'] // PENDING | BLOCKED | IN_PROGRESS | DONE | SKIPPED
  due_date date
  completed_at timestamptz
  sort_order int [default: 0]
  created_at timestamptz [not null, default: `CURRENT_TIMESTAMP`]
  updated_at timestamptz
}

// Grafo de dependencias entre tareas (cadena secuencial o inicio paralelo)
Table task_dependencies {
  id uuid [pk]
  task_id uuid [not null, ref: > tasks.id]
  prerequisite_task_id uuid [not null, ref: > tasks.id]
  dependency_type varchar(20) [not null, default: 'FINISH_TO_START'] // FINISH_TO_START | START_TO_START
}

// ==========================================
// 3. TRIGGERS, FRICCIONES, EMERGENCIAS Y NOTIFICACIONES (LOW-CODE)
// ==========================================

Table triggers {
  id uuid [pk]
  user_id uuid [not null, ref: > users.id]
  name varchar(80) [not null] // Ej. "Canción Llenos de poder", "Fin de clase 19:00", "Alarma 5:00 AM"
  cue_type varchar(30) [not null] // TIME | AUDIO_CUE | LOCATION | PREVIOUS_HABIT | ENVIRONMENT
  cue_detail text // Pista contextual exacta
  friction_reduction_protocol text // Cómo preparar el entorno para eliminar fricción
  emergency_protocol text // Acción mínima viable si hay fatiga, visitas o poco tiempo
  links jsonb
  is_active bool [not null, default: true]
  created_at timestamptz [not null, default: `CURRENT_TIMESTAMP`]
}

// Vincula triggers con proyectos/tareas y configura notificaciones
Table entity_triggers {
  id uuid [pk]
  trigger_id uuid [not null, ref: > triggers.id]
  project_id uuid [ref: > projects.id]
  task_id uuid [ref: > tasks.id]
  notification_enabled bool [not null, default: true]
  notify_offset_minutes int [default: 0] // 0 = hora exacta, -10 = 10 min antes
  notification_channel varchar(20) [default: 'PUSH'] // PUSH | ALARM | EMAIL | IN_APP
  notification_message text
  priority int [default: 1]
  state bool [not null, default: true]
}

// Catálogo low-code de fricciones / obstáculos (extensible sin tocar código)
Table friction_catalog {
  id uuid [pk]
  user_id uuid [not null, ref: > users.id]
  label varchar(80) [not null] // Ej. "Sueño / dormí tarde", "Celular en mesa", "Visitas en casa"
  category varchar(30) [not null] // SLEEP_DISRUPTION | ENVIRONMENT | ENERGY | DIGITAL | SOCIAL | PLANNING | ABSENCE
  default_adjustment_rule text // Regla de ajuste sugerida cuando ocurre esta fricción
  is_active bool [not null, default: true]
}

// ==========================================
// 4. TRACKER DE 24H, SUEÑO/TRASNOCHE, DÍAS DETOX Y REAJUSTES
// ==========================================

Table daily_logs {
  id uuid [pk]
  user_id uuid [not null, ref: > users.id]
  log_date date [not null]
  day_mode varchar(25) [not null, default: 'NORMAL'] // NORMAL | RECOVERY_DETOX | REENTRY_RAMP | UNLOGGED_ABSENCE
  detox_notes text // Motivo o reglas del día detox si aplica
  actual_bedtime timestamptz
  actual_wake_time timestamptz
  actual_sleep_minutes int [default: 0]
  wake_delay_minutes int [not null, default: 0] // Minutos tarde respecto a ideal_wake_time
  sleep_debt_minutes int [not null, default: 0] // Diferencia respecto a ideal_sleep_minutes
  is_late_night bool [not null, default: false] // Bandera de trasnoche / acostarse tarde
  planned_total_minutes int [not null, default: 1440] // Siempre cuadra a 1440 min (24h)
  unplanned_total_minutes int [not null, default: 0]
  readjustment_count int [not null, default: 0]
  day_status varchar(20) [not null, default: 'OPEN'] // OPEN | CLOSED | RECONCILED_LATE
  created_at timestamptz [not null, default: `CURRENT_TIMESTAMP`]
  updated_at timestamptz

  Indexes {
    (user_id, log_date) [unique]
  }
}

Table time_blocks {
  id uuid [pk]
  daily_log_id uuid [not null, ref: > daily_logs.id]
  project_id uuid [ref: > projects.id]
  task_id uuid [ref: > tasks.id]
  trigger_id uuid [ref: > triggers.id]
  title varchar(120) [not null]
  block_kind varchar(25) [not null] // SLEEP | PROJECT_WORK | TASK | ROUTINE | UNPLANNED | DETOX | BUFFER | FREE
  depth_level varchar(15) [default: 'DEEP'] // DEEP | SHALLOW | RECOVERY
  planned_start timestamptz [not null]
  planned_end timestamptz [not null]
  planned_minutes int [not null]
  actual_start timestamptz
  actual_end timestamptz
  actual_minutes int
  is_mandatory_today bool [not null, default: true] // Si es true, el motor intenta mantenerlo hoy aunque reduzca tiempo
  outcome_status varchar(25) [not null, default: 'PLANNED'] // PLANNED | IN_PROGRESS | COMPLETED | PARTIAL_EMERGENCY | CARRIED_OVER | RESCHEDULED_PROJECT | DROPPED_TODAY | UNPLANNED_LOGGED
  non_completion_reason varchar(35) // NONE | FULL_DAY_UNPLANNED | TIME_EXHAUSTED | WOKE_LATE | LOW_ENERGY | FRICTION | DETOX_DAY
  friction_id uuid [ref: > friction_catalog.id]
  adjustment_reason text
  sort_order int [default: 0]
  created_at timestamptz [not null, default: `CURRENT_TIMESTAMP`]
  updated_at timestamptz
}

// Auditoría de cada reajuste automático o manual dentro de las 24h
Table schedule_adjustments {
  id uuid [pk]
  daily_log_id uuid [not null, ref: > daily_logs.id]
  trigger_block_id uuid [ref: > time_blocks.id] // Bloque imprevisto o extendido que detonó el reajuste
  affected_block_id uuid [ref: > time_blocks.id] // Bloque futuro desplazado o recortado
  adjustment_type varchar(30) [not null] // SHIFT_TIME | SHRINK_TO_MIN | WAKE_LATE_SHIFT | FULL_DAY_OVERFLOW | CARRY_TOMORROW | EXTEND_PROJECT_END
  minutes_delta int [not null]
  notes text
  created_at timestamptz [not null, default: `CURRENT_TIMESTAMP`]
}

// Reajuste global de proyectos y hábitos cuando el usuario regresa tras días/semanas sin actividad
Table reentry_sessions {
  id uuid [pk]
  user_id uuid [not null, ref: > users.id]
  return_date date [not null]
  last_active_date date
  gap_days int [not null] // Ej. 7 o 14 días sin uso/registro
  return_strategy varchar(25) [not null, default: 'GRADUAL_RAMP'] // GRADUAL_RAMP | FULL_RESET | SELECTIVE_RESUME
  summary_notes text
  created_at timestamptz [not null, default: `CURRENT_TIMESTAMP`]
}

Table reentry_project_actions {
  id uuid [pk]
  reentry_session_id uuid [not null, ref: > reentry_sessions.id]
  project_id uuid [not null, ref: > projects.id]
  action_taken varchar(25) [not null] // EXTEND_DEADLINE | REDUCE_DOSE | PAUSE_PROJECT | ARCHIVE_PROJECT | ADVANCE_PHASE
  days_shifted int [not null, default: 0]
  new_target_minutes int
  rationale text
}

// ==========================================
// 5. META-EVALUACIÓN DIARIA, JOURNALING Y AUTOAJUSTE (LOW-CODE)
// ==========================================

Table evaluation_dimensions {
  id uuid [pk]
  user_id uuid [not null, ref: > users.id]
  code varchar(40) [not null] // Ej. TRIGGER_CONTROL, PHONE_FRICTION, SOCIAL_TRANSITION, ACTIVE_PRACTICE
  name varchar(80) [not null]
  prompt_question text [not null]
  score_1_label varchar(120) // Ej. "1 = Negociación mental / disparo ciego"
  score_5_label varchar(120) // Ej. "5 = Automático sin fricción"
  available_chips jsonb // Chips predefinidos configurables para esta dimensión
  sort_order int [default: 0]
  is_active bool [not null, default: true]
}

Table daily_evaluations {
  id uuid [pk]
  daily_log_id uuid [not null, unique, ref: > daily_logs.id]
  overall_system_score numeric(3,1) // Evaluación numérica global del sistema en el día
  exit_ticket_notes text // Evocación activa de 60s al cierre del día
  mise_en_place_checklist jsonb // Checklist nocturno anti-fricción para el día siguiente
  system_adjustment_summary text // Ajuste estructural decidido tras evaluar el día
  evaluated_at timestamptz [not null, default: `CURRENT_TIMESTAMP`]
}

Table daily_dimension_scores {
  id uuid [pk]
  daily_evaluation_id uuid [not null, ref: > daily_evaluations.id]
  dimension_id uuid [not null, ref: > evaluation_dimensions.id]
  friction_id uuid [ref: > friction_catalog.id]
  score smallint [not null] // Escala 1 a 5 (CHECK score BETWEEN 1 AND 5)
  selected_chips jsonb // Chips marcados durante la evaluación
  root_cause text
  immediate_adjustment text
}

Table journal_entries {
  id uuid [pk]
  user_id uuid [not null, ref: > users.id]
  daily_log_id uuid [ref: > daily_logs.id]
  project_id uuid [ref: > projects.id]
  reentry_session_id uuid [ref: > reentry_sessions.id]
  entry_type varchar(25) [not null, default: 'DAILY_REFLECTION'] // DAILY_REFLECTION | SYSTEM_TWEAK | INSIGHT | FRICTION_LOG | REENTRY_NOTE
  title varchar(120)
  content text [not null]
  created_at timestamptz [not null, default: `CURRENT_TIMESTAMP`]
}
```

---

## 5. Máquinas de Estado y Reglas de Transición

Para garantizar consistencia de datos en backend y base de datos, implementa las siguientes 4 máquinas de estado:

### 5.1. Máquina de Estados de `tasks.status`
* **Estados:** `PENDING`, `BLOCKED`, `IN_PROGRESS`, `DONE`, `SKIPPED`.
* **Transiciones válidas:**
  * `CREATE` $\rightarrow$ `BLOCKED` si existe alguna fila en `task_dependencies` donde `dependency_type = 'FINISH_TO_START'` y `prerequisite_task.status <> 'DONE'`. En caso contrario $\rightarrow$ `PENDING`.
  * `BLOCKED` $\rightarrow$ `PENDING`: Automática cuando todos sus prerrequisitos pasan a `DONE`.
  * `PENDING` $\rightarrow$ `IN_PROGRESS`: Al iniciar el bloque horario vinculado o inicio manual.
  * `BLOCKED` $\rightarrow$ `IN_PROGRESS`: Solo permitido mediante anulación explícita (*override*) de dependencia.
  * `IN_PROGRESS` $\rightarrow$ `DONE`: Registra `completed_at = now()`, desbloquea tareas dependientes y verifica si `projects` completó sus tareas para evaluar `project_transitions`.
  * `IN_PROGRESS` $\rightarrow$ `PENDING`: Pausa de tarea sin finalizarla.
  * `PENDING | BLOCKED | IN_PROGRESS` $\rightarrow$ `SKIPPED`: Requiere registro de motivo; no bloquea el cierre de fase si la regla de proyecto lo permite.
  * `DONE | SKIPPED` $\rightarrow$ `PENDING | IN_PROGRESS`: Reapertura correctiva (debe recalcular estado de tareas dependientes).

### 5.2. Máquina de Estados de `time_blocks.outcome_status` e Invariantes
* **Estados:** `PLANNED`, `IN_PROGRESS`, `COMPLETED`, `PARTIAL_EMERGENCY`, `CARRIED_OVER`, `RESCHEDULED_PROJECT`, `DROPPED_TODAY`, `UNPLANNED_LOGGED`.
* **Transiciones válidas:**
  * **Bloques planificados (`block_kind <> 'UNPLANNED'`):**
    * `PLANNED` $\rightarrow$ `IN_PROGRESS`
    * `IN_PROGRESS` $\rightarrow$ `COMPLETED`
    * `PLANNED | IN_PROGRESS` $\rightarrow$ `PARTIAL_EMERGENCY` (ejecutado en versión mínima viable)
    * `PLANNED | IN_PROGRESS` $\rightarrow$ `CARRIED_OVER` | `RESCHEDULED_PROJECT` | `DROPPED_TODAY`
  * **Bloques imprevistos (`block_kind = 'UNPLANNED'`):**
    * Nacen en `IN_PROGRESS` o directamente en `UNPLANNED_LOGGED`. Nunca usan estados de cumplimiento de hábito (`COMPLETED`, `CARRIED_OVER`, `DROPPED_TODAY`).
* **Invariantes SQL (`CHECK` Constraints recomendados):**
  * Si `outcome_status = 'COMPLETED'`, entonces `non_completion_reason IS NULL OR non_completion_reason = 'NONE'`.
  * Si `outcome_status IN ('PARTIAL_EMERGENCY', 'CARRIED_OVER', 'RESCHEDULED_PROJECT', 'DROPPED_TODAY')`, entonces `non_completion_reason IS NOT NULL AND non_completion_reason <> 'NONE'`.
  * `planned_end > planned_start` y `planned_minutes > 0`.

### 5.3. Modos y Cierre del Día (`daily_logs.day_mode` y `day_status`)
* **`day_mode`:**
  * `NORMAL`: Operación estándar.
  * `RECOVERY_DETOX`: Día de descanso/desconexión intencional. Convierte bloques no esenciales en `DROPPED_TODAY` con `non_completion_reason = 'DETOX_DAY'`.
  * `REENTRY_RAMP`: Día de retorno gradual tras una ausencia (`reentry_sessions`). Usa duraciones mínimas (`min_session_minutes` / `min_emergency_minutes`).
  * `UNLOGGED_ABSENCE`: Día pasado sin actividad registrada; se genera automáticamente al detectar un hueco de días antes de reconciliar.
* **`day_status`:**
  * `OPEN` $\rightarrow$ `CLOSED`: Al completar la evaluación diaria (`daily_evaluations`).
  * `OPEN` $\rightarrow$ `RECONCILED_LATE`: Al cerrar o auditar un día pasado (p. ej., durante una sesión de reentrada).

### 5.4. Ciclo de Vida de Proyectos (`projects.status`)
* `DRAFT` $\rightarrow$ `ACTIVE`: Valida que los proyectos en `burner_slot = 'FRONT'` no superen `users.max_front_burner_projects` (o muestra advertencia de sobrecarga).
* `ACTIVE` $\rightarrow$ `PAUSED` $\rightarrow$ `ACTIVE`: Al reactivar desde pausa, actualiza `accumulated_shift_days` y `end_date` si corresponde.
* `ACTIVE` $\rightarrow$ `COMPLETED`: Evalúa `project_transitions` donde `from_project_id = project.id` y `transition_rule = 'ON_COMPLETE'` para activar o sugerir el proyecto siguiente (`to_project_id`).
* `ACTIVE | PAUSED` $\rightarrow$ `CANCELLED`: Requiere `completion_notes` explicando qué se aprendió o por qué se descartó el sistema/proyecto.

---

## 6. Algoritmo Determinista del Motor de Reajuste de 24 Horas

Cuando ocurre cualquier perturbación en el día (`wake_delay_minutes > 0`, bloque `UNPLANNED` insertado, o `actual_minutes > planned_minutes` en un bloque), ejecutar este flujo:

1. **Calcular déficit de tiempo (`deficit_minutes`):** Diferencia entre el tiempo necesario para los bloques pendientes del día y el tiempo restante hasta `fixed_day_end_time` (o `ideal_bedtime`).
2. **Paso 1 — Absorber con holguras:** Reducir o eliminar bloques pendientes con `block_kind IN ('FREE', 'BUFFER')`. Registrar en `schedule_adjustments` (`SHIFT_TIME`).
3. **Paso 2 — Desplazar bloques obligatorios:** Recorrer cronológicamente los bloques pendientes con `is_mandatory_today = true` y desplazar `planned_start` / `planned_end` sin solapamientos (`SHIFT_TIME` / `WAKE_LATE_SHIFT`).
4. **Paso 3 — Activar Protocolo de Emergencia (`SHRINK_TO_MIN`):** Si tras desplazar aún se excede el límite del día, reducir `planned_minutes` de los bloques obligatorios hasta su `min_emergency_minutes` (o `min_session_minutes`), priorizando mantener intactos los bloques marcados como `is_highlight = true`.
5. **Paso 4 — Desbordamiento Total (`FULL_DAY_OVERFLOW`):** Si el imprevisto consumió todo el día y ni siquiera caben los tiempos mínimos de emergencia, marcar los bloques restantes como `CARRIED_OVER` o `RESCHEDULED_PROJECT` con `non_completion_reason = 'FULL_DAY_UNPLANNED'`, sin acumular deuda doble de tiempo para mañana.

---

## 7. Guía de Implementación Recomendada para Antigravity

1. **Base de Datos (PostgreSQL):**
   * Crear migración inicial con todas las tablas del bloque DBML, claves foráneas con `ON DELETE CASCADE` donde corresponda (ej. `daily_logs` $\rightarrow$ `time_blocks`) y `CHECK` constraints para las máquinas de estado.
   * Añadir índices compuestos en `(user_id, log_date)`, `(daily_log_id, planned_start)` y `(project_id, status)`.
2. **Seed Inicial (*Low-Code*):**
   * Precargar las 4 dimensiones metacognitivas base (`Control de Triggers`, `Fricción Digital/Celular`, `Transición de Entorno Social`, `Práctica Generativa`), el catálogo inicial de fricciones y un template de *Mise en Place* nocturno.
3. **Servicios Backend Clave:**
   * `DailyBootstrapService`: Al abrir la app cada día, verifica si hay `gap_days >= 3` (dispara `ReentryService`), o instancia el `daily_log` de 1,440 minutos a partir de `project_schedules` y `users.ideal_sleep_minutes`.
   * `ScheduleRebalancerService`: Implementa los 4 pasos deterministas del reajuste de 24h y persiste la trazabilidad en `schedule_adjustments`.
   * `TriggerNotificationWorker`: Cron/cola que evalúa `entity_triggers` activos del día y dispara notificaciones en `planned_start + notify_offset_minutes`.
   * `SystemAutoTunerService`: Analiza patrones en `daily_dimension_scores` y `friction_catalog` (ej. 3 días seguidos con fricción `"Sueño / dormí tarde"` o nota `< 3` en `"Control de Triggers"`) para sugerir ajustes automáticos en horarios, dosis mínimas o disparadores.