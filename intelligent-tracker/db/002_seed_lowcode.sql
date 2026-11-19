-- ============================================================================
-- Intelligent Tracker 24h — Seed Inicial Low-Code (Idempotente)
-- Basado en CONTEXTO_PROYECTO.md Sección 7.2
-- ============================================================================

-- Usuario inicial de desarrollo/demo
INSERT INTO users (id, full_name, username, email, password_hash, timezone, ideal_bedtime, ideal_wake_time, ideal_sleep_minutes, max_front_burner_projects, reentry_ramp_days)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'Israel',
  'israel',
  'israel@intelligent-tracker.local',
  '$2b$12$demo.hash.replace.in.auth.setup',
  'America/Lima',
  '22:00:00',
  '05:00:00',
  420,
  2,
  3
)
ON CONFLICT (username) DO NOTHING;

-- Áreas de vida base
INSERT INTO life_areas (id, user_id, name, description, color_hex, sort_order)
VALUES
  ('00000000-0000-0000-0001-000000000001', '00000000-0000-0000-0000-000000000001', 'Trabajo / Tecnología', 'Desarrollo de software, arquitectura y proyectos técnicos', '#B1E4E3', 1),
  ('00000000-0000-0000-0001-000000000002', '00000000-0000-0000-0000-000000000001', 'Habilidades / Idiomas', 'Aprendizaje activo y práctica deliberada', '#EBDEFC', 2),
  ('00000000-0000-0000-0001-000000000003', '00000000-0000-0000-0000-000000000001', 'Salud / Físico', 'Sueño, ejercicio, energía y recuperación', '#FED141', 3),
  ('00000000-0000-0000-0001-000000000004', '00000000-0000-0000-0000-000000000001', 'Espiritual / Reflexión', 'Propósito, gratitud y claridad mental', '#E0F2FE', 4)
ON CONFLICT (id) DO NOTHING;

-- 4 Dimensiones Metacognitivas Base (Low-Code)
INSERT INTO evaluation_dimensions (id, user_id, code, name, prompt_question, score_1_label, score_5_label, available_chips, sort_order)
VALUES
  (
    '00000000-0000-0000-0002-000000000001',
    '00000000-0000-0000-0000-000000000001',
    'TRIGGER_CONTROL',
    'Control de Triggers',
    '¿Qué tan automático fue tu arranque al activarse el disparador sin negociación mental?',
    '1 = Negociación mental / disparo ignorado',
    '5 = Arranque automático sin fricción',
    '["Sin negociación", "Audio cue funcionó", "Entorno listo", "Postergué inicio"]'::jsonb,
    1
  ),
  (
    '00000000-0000-0000-0002-000000000002',
    '00000000-0000-0000-0000-000000000001',
    'PHONE_FRICTION',
    'Fricción Digital / Celular',
    '¿Qué tan bien protegiste tu atención frente a distracciones digitales o el celular?',
    '1 = Revisión compulsiva / celular en mesa',
    '5 = Celular fuera de vista / cero interrupciones',
    '["Celular lejos", "Modo No Molestar", "Abri redes por inercia", "Notificaciones apagadas"]'::jsonb,
    2
  ),
  (
    '00000000-0000-0000-0002-000000000003',
    '00000000-0000-0000-0000-000000000001',
    'SOCIAL_TRANSITION',
    'Transición de Entorno Social',
    '¿Cómo manejaste las transiciones entre familia, visitas o trabajo hacia tus bloques?',
    '1 = Cambio caótico / perdí el bloque',
    '5 = Transición limpia / usé protocolo mínimo',
    '["Visitas en casa", "Apliqué dosis mínima", "Límite claro de tiempo", "Me adapté sin culpa"]'::jsonb,
    3
  ),
  (
    '00000000-0000-0000-0002-000000000004',
    '00000000-0000-0000-0000-000000000001',
    'ACTIVE_PRACTICE',
    'Práctica Generativa',
    '¿Tu sesión fue práctica activa / evocación real (80/20) en lugar de consumo pasivo?',
    '1 = Consumo pasivo / lectura sin salida',
    '5 = Construcción activa / evocación constante',
    '["Construí código/output", "Evocación activa", "Solo leí/vi videos", "Apliqué regla 80/20"]'::jsonb,
    4
  )
ON CONFLICT (id) DO NOTHING;

-- Catálogo Inicial de Fricciones (Low-Code)
INSERT INTO friction_catalog (id, user_id, label, category, default_adjustment_rule)
VALUES
  ('00000000-0000-0000-0003-000000000001', '00000000-0000-0000-0000-000000000001', 'Sueño / dormí tarde', 'SLEEP_DISRUPTION', 'Activar WAKE_LATE_SHIFT y reducir bloques no críticos a dosis mínima'),
  ('00000000-0000-0000-0003-000000000002', '00000000-0000-0000-0000-000000000001', 'Celular en mesa', 'DIGITAL', 'Dejar celular en otra habitación o en modo avión durante bloque DEEP'),
  ('00000000-0000-0000-0003-000000000003', '00000000-0000-0000-0000-000000000001', 'Visitas o interrupción en casa', 'SOCIAL', 'Activar protocolo de emergencia de 10-15 min en horario alternativo'),
  ('00000000-0000-0000-0003-000000000004', '00000000-0000-0000-0000-000000000001', 'Fatiga / baja energía', 'ENERGY', 'Ejecutar dosis mínima viable (min_emergency_minutes) y proteger sueño'),
  ('00000000-0000-0000-0003-000000000005', '00000000-0000-0000-0000-000000000001', 'Entorno sin preparar (fricción inicial)', 'ENVIRONMENT', 'Reforzar Mise en Place nocturno la noche anterior'),
  ('00000000-0000-0000-0003-000000000006', '00000000-0000-0000-0000-000000000001', 'Imprevisto externo prolongado', 'PLANNING', 'Registrar bloque UNPLANNED y ejecutar rebalanceo determinista de 4 pasos')
ON CONFLICT (id) DO NOTHING;
