import {
  AlertTriangle,
  Bell,
  Brain,
  Check,
  CheckCircle2,
  Clock,
  Flame,
  FolderKanban,
  Home,
  Leaf,
  Lock,
  Moon,
  Play,
  Plus,
  ShieldAlert,
  Sparkles,
  Timer,
  User,
  Zap,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  api,
  type DailyLogDTO,
  type EvaluationDimensionDTO,
  type FrictionDTO,
  type ProjectDTO,
  type TaskDTO,
  type TimeBlockDTO,
} from './api/client';
import { CircularTimeDial } from './components/CircularTimeDial';
import { ProjectIconBadge } from './components/ProjectIcon';
import { PROJECT_ICON_OPTIONS } from './components/projectIconCatalog';
import { ProjectRing } from './components/ProjectRing';
import { ReentryModal } from './components/ReentryModal';

type TabKey = 'dashboard' | 'tracker' | 'projects' | 'evaluation';

function todayIso(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '--:--';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function App() {
  const [activeTab, setActiveTab] = useState<TabKey>('dashboard');
  const [logDate] = useState<string>(todayIso);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const [dailyLog, setDailyLog] = useState<DailyLogDTO | null>(null);
  const [timeBlocks, setTimeBlocks] = useState<TimeBlockDTO[]>([]);
  const [projects, setProjects] = useState<ProjectDTO[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [tasks, setTasks] = useState<TaskDTO[]>([]);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);

  // Reentry state
  const [reentryState, setReentryState] = useState<{
    gapDays: number;
    lastActiveDate: string | null;
  } | null>(null);

  // Evaluation low-code config & form
  const [dimensions, setDimensions] = useState<EvaluationDimensionDTO[]>([]);
  const [frictions, setFrictions] = useState<FrictionDTO[]>([]);
  const [dimScores, setDimScores] = useState<Record<string, number>>({});
  const [dimChips, setDimChips] = useState<Record<string, string[]>>({});
  const [exitTicket, setExitTicket] = useState('');
  const [miseChecklist, setMiseChecklist] = useState([
    { label: 'Dejar laptop lista con repo abierto', done: true },
    { label: 'Cargar botella de agua en escritorio', done: true },
    { label: 'Activar modo No Molestar a las 22:00', done: false },
  ]);
  const [autoTuneNotes, setAutoTuneNotes] = useState<string[]>([]);

  // Modals
  const [showUnplannedModal, setShowUnplannedModal] = useState(false);
  const [unplannedTitle, setUnplannedTitle] = useState('');
  const [unplannedMinutes, setUnplannedMinutes] = useState(60);
  const [showNewProjectModal, setShowNewProjectModal] = useState(false);
  const [newProjTitle, setNewProjTitle] = useState('');
  const [newProjIcon, setNewProjIcon] = useState('code');
  const [newProjSlot, setNewProjSlot] = useState<'FRONT' | 'BACK'>('FRONT');
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [showSleepModal, setShowSleepModal] = useState(false);
  const [sleepBed, setSleepBed] = useState('22:30');
  const [sleepWake, setSleepWake] = useState('06:15');

  const notify = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3500);
  };

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.bootstrapDaily(logDate),
      api.getProjects(),
      api.getEvaluationConfig(),
    ])
      .then(([boot, projRes, evalCfg]) => {
        if (cancelled) return;
        setProjects(projRes.projects);
        if (projRes.projects.length > 0) {
          setSelectedProjectId((prev) => prev ?? projRes.projects[0].id);
        }
        setDimensions(evalCfg.dimensions);
        setFrictions(evalCfg.frictionCatalog);
        setDimScores((prev) => {
          const next = { ...prev };
          for (const d of evalCfg.dimensions) {
            if (!next[d.id]) next[d.id] = 4;
          }
          return next;
        });

        if (boot.requiresReentry) {
          setReentryState({ gapDays: boot.gapDays, lastActiveDate: boot.lastActiveDate });
        } else {
          setReentryState(null);
          setDailyLog(boot.dailyLog);
          setTimeBlocks(boot.timeBlocks);
          const firstWork =
            boot.timeBlocks.find((b) => b.block_kind === 'PROJECT_WORK') ?? boot.timeBlocks[0];
          if (firstWork) setSelectedBlockId(firstWork.id);
        }
      })
      .catch((err) => {
        if (!cancelled) setErrorMsg((err as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [logDate]);

  useEffect(() => {
    if (!selectedProjectId) return;
    void api.getProjectTasks(selectedProjectId).then((res) => setTasks(res.tasks));
  }, [selectedProjectId]);

  const frontBurnerCount = useMemo(
    () => projects.filter((p) => p.burner_slot === 'FRONT' && p.status === 'ACTIVE').length,
    [projects]
  );

  const progressStats = useMemo(() => {
    const actionable = timeBlocks.filter(
      (b) => b.block_kind !== 'SLEEP' && b.block_kind !== 'FREE' && b.block_kind !== 'BUFFER'
    );
    const done = actionable.filter(
      (b) => b.outcome_status === 'COMPLETED' || b.outcome_status === 'PARTIAL_EMERGENCY'
    );
    const pct = actionable.length > 0 ? Math.round((done.length / actionable.length) * 100) : 0;
    const remaining = Math.max(0, actionable.length - done.length);
    return { pct, remaining, total: actionable.length };
  }, [timeBlocks]);

  const selectedBlock = useMemo(
    () => timeBlocks.find((b) => b.id === selectedBlockId) ?? timeBlocks[0] ?? null,
    [timeBlocks, selectedBlockId]
  );

  const nextPendingBlock = useMemo(
    () =>
      timeBlocks.find(
        (b) =>
          (b.block_kind === 'PROJECT_WORK' || b.block_kind === 'TASK') &&
          (b.outcome_status === 'PLANNED' || b.outcome_status === 'IN_PROGRESS')
      ) ?? null,
    [timeBlocks]
  );

  const sleepSummary = useMemo(() => {
    const mins = dailyLog?.actual_sleep_minutes ?? 440;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m`;
  }, [dailyLog]);

  // Handlers
  const handleBlockStatus = async (
    block: TimeBlockDTO,
    outcome: TimeBlockDTO['outcome_status'],
    reason?: string
  ) => {
    try {
      await api.updateBlockStatus(block.id, outcome, reason);
      const fresh = await api.getDaily(logDate);
      setDailyLog(fresh.dailyLog);
      setTimeBlocks(fresh.timeBlocks);
      notify(`Bloque "${block.title}" actualizado a ${outcome}`);
    } catch (err) {
      notify(`Error: ${(err as Error).message}`);
    }
  };

  const handleSleepSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dailyLog) return;
    try {
      const bedIso = `${logDate}T${sleepBed}:00.000Z`;
      const wakeIso = `${logDate}T${sleepWake}:00.000Z`;
      await api.checkinSleep(dailyLog.id, bedIso, wakeIso);
      const fresh = await api.getDaily(logDate);
      setDailyLog(fresh.dailyLog);
      setTimeBlocks(fresh.timeBlocks);
      setShowSleepModal(false);
      notify('Check-in de sueño guardado y agenda rebalanceada');
    } catch (err) {
      notify(`Error: ${(err as Error).message}`);
    }
  };

  const handleUnplannedSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dailyLog || !unplannedTitle.trim()) return;
    try {
      const start = new Date();
      const end = new Date(start.getTime() + unplannedMinutes * 60_000);
      await api.addUnplanned(
        dailyLog.id,
        unplannedTitle.trim(),
        start.toISOString(),
        end.toISOString()
      );
      const fresh = await api.getDaily(logDate);
      setDailyLog(fresh.dailyLog);
      setTimeBlocks(fresh.timeBlocks);
      setUnplannedTitle('');
      setShowUnplannedModal(false);
      notify('Imprevisto registrado y día reajustado automáticamente');
    } catch (err) {
      notify(`Error: ${(err as Error).message}`);
    }
  };

  const handleActivateDetox = async () => {
    if (!dailyLog) return;
    try {
      await api.activateDetox(dailyLog.id, 'Día Detox intencional — métricas protegidas');
      const fresh = await api.getDaily(logDate);
      setDailyLog(fresh.dailyLog);
      setTimeBlocks(fresh.timeBlocks);
      notify('Modo RECOVERY_DETOX activado sin penalizaciones');
    } catch (err) {
      notify(`Error: ${(err as Error).message}`);
    }
  };

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjTitle.trim()) return;
    try {
      const endD = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
      const res = await api.createProject({
        title: newProjTitle.trim(),
        icon: newProjIcon,
        burner_slot: newProjSlot,
        start_date: logDate,
        end_date: endD,
        target_minutes_per_session: 45,
        min_session_minutes: 15,
      });
      setProjects((prev) => [res.project, ...prev]);
      setSelectedProjectId(res.project.id);
      setNewProjTitle('');
      setShowNewProjectModal(false);
      notify(res.warning ? `Proyecto creado (${res.warning})` : 'Proyecto creado');
    } catch (err) {
      notify(`Error: ${(err as Error).message}`);
    }
  };

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProjectId || !newTaskTitle.trim()) return;
    try {
      const lastTask = tasks[tasks.length - 1];
      const res = await api.createTask(selectedProjectId, {
        title: newTaskTitle.trim(),
        execution_mode: 'SEQUENTIAL',
        estimated_minutes: 30,
        min_emergency_minutes: 10,
        is_highlight: tasks.length === 0,
        prerequisite_task_ids: lastTask && lastTask.status !== 'DONE' ? [lastTask.id] : [],
      });
      setTasks((prev) => [...prev, res.task]);
      setNewTaskTitle('');
      notify(`Tarea "${res.task.title}" creada (${res.task.status})`);
    } catch (err) {
      notify(`Error: ${(err as Error).message}`);
    }
  };

  const handleCompleteTask = async (task: TaskDTO) => {
    try {
      const next = task.status === 'DONE' ? 'PENDING' : 'DONE';
      const res = await api.updateTaskStatus(task.id, next);
      if (selectedProjectId) {
        const refreshed = await api.getProjectTasks(selectedProjectId);
        setTasks(refreshed.tasks);
      }
      if (res.unlockedTaskIds.length > 0) {
        notify(`Tarea completada y ${res.unlockedTaskIds.length} tarea(s) desbloqueada(s)`);
      } else {
        notify(`Tarea "${task.title}" -> ${next}`);
      }
    } catch (err) {
      notify(`Error: ${(err as Error).message}`);
    }
  };

  const handleCloseDay = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dailyLog) return;
    try {
      const res = await api.closeDay({
        daily_log_id: dailyLog.id,
        exit_ticket_notes: exitTicket.trim() || 'Cierre diario completado.',
        mise_en_place_checklist: miseChecklist,
        dimension_scores: dimensions.map((d) => ({
          dimension_id: d.id,
          score: dimScores[d.id] ?? 4,
          selected_chips: dimChips[d.id] ?? [],
        })),
      });
      setDailyLog(res.dailyLog);
      setAutoTuneNotes(res.autoTuneSuggestions.map((s) => s.message));
      notify(`Día cerrado con score ${res.evaluation.overall_system_score}/5`);
    } catch (err) {
      notify(`Error: ${(err as Error).message}`);
    }
  };

  const navItems: Array<{ key: TabKey; label: string; Icon: typeof Home }> = [
    { key: 'dashboard', label: 'Dashboard', Icon: Home },
    { key: 'tracker', label: 'Tracker 24h', Icon: Timer },
    { key: 'projects', label: 'Proyectos', Icon: FolderKanban },
    { key: 'evaluation', label: 'Cierre Diario', Icon: Brain },
  ];

  const systemScore = useMemo(() => {
    const vals = Object.values(dimScores);
    if (vals.length === 0) return '8.8';
    const avg = (vals.reduce((a, b) => a + b, 0) / vals.length) * 2;
    return avg.toFixed(1);
  }, [dimScores]);

  return (
    <div className="app-shell">
      {/* Desktop Sidebar (Laptop 1440) */}
      <aside className="desktop-sidebar">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '4px 8px 28px' }}>
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: '50%',
                background: '#FED141',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Zap size={20} color="#18181B" strokeWidth={2.5} />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 16 }}>Tracker 24h</div>
              <div style={{ fontSize: 11, color: '#94A3B8' }}>Conductual OS</div>
            </div>
          </div>

          <nav style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {navItems.map(({ key, label, Icon }) => {
              const active = activeTab === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setActiveTab(key)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '12px 14px',
                    borderRadius: 14,
                    border: 'none',
                    cursor: 'pointer',
                    fontWeight: active ? 700 : 500,
                    fontSize: 13,
                    background: active ? '#EBDEFC' : 'transparent',
                    color: active ? '#18181B' : '#CBD5E1',
                    textAlign: 'left',
                  }}
                >
                  <Icon size={18} />
                  {label}
                </button>
              );
            })}
          </nav>
        </div>

        <div
          style={{
            background: '#27272A',
            borderRadius: 16,
            padding: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: '50%',
              background: '#B1E4E3',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <User size={18} color="#18181B" />
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 13 }}>Israel</div>
            <div style={{ fontSize: 11, color: '#B1E4E3' }}>
              Modo {dailyLog?.day_mode ?? 'NORMAL'}
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="main-content">
        {/* Top Header */}
        <header
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            marginBottom: 20,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: 42,
                height: 42,
                borderRadius: '50%',
                background: '#EBDEFC',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <User size={20} color="#6D4AFF" />
            </div>
            <div>
              <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>
                Hola, Israel — Tu arquitectura diaria
              </h1>
              <div style={{ fontSize: 12, color: '#64748B', marginTop: 2 }}>
                {logDate} · Modo <strong>{dailyLog?.day_mode ?? 'NORMAL'}</strong> ·{' '}
                {dailyLog?.planned_total_minutes ?? 1440} min
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-danger" onClick={handleActivateDetox}>
              <Leaf size={15} />
              Día Detox
            </button>
            <button
              type="button"
              className="btn btn-limencello"
              onClick={() => setShowUnplannedModal(true)}
            >
              <Plus size={15} />
              Imprevisto
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setShowSleepModal(true)}
              title="Check-in de Sueño"
            >
              <Moon size={15} />
              Sueño
            </button>
          </div>
        </header>

        {errorMsg && (
          <div
            className="card"
            style={{
              background: '#FFE4E6',
              borderColor: '#E11D48',
              color: '#881337',
              marginBottom: 16,
              display: 'flex',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <AlertTriangle size={18} />
            <span>Error conectando con la API: {errorMsg}</span>
          </div>
        )}

        {loading ? (
          <div className="card" style={{ textAlign: 'center', padding: 48, color: '#64748B' }}>
            Cargando arquitectura de 24 horas...
          </div>
        ) : (
          <>
            {/* ================= TAB 1: DASHBOARD ================= */}
            {activeTab === 'dashboard' && (
              <div className="bento-dashboard">
                {/* Hero Progress Banner (Image 2) */}
                <section className="card-lavender span-2-tablet span-2-desktop">
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 12,
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Flame size={18} color="#6D4AFF" />
                        <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>
                          Tu plan de hoy {progressStats.pct >= 80 ? 'casi listo' : 'en marcha'}
                        </h2>
                      </div>
                      <p style={{ margin: '6px 0 14px', fontSize: 13, color: '#4338CA' }}>
                        {progressStats.pct}% completado · Faltan {progressStats.remaining} bloques
                        obligatorios
                      </p>
                    </div>
                    <div style={{ fontSize: 30, fontWeight: 700, color: '#6D4AFF' }}>
                      {progressStats.pct}%
                    </div>
                  </div>
                  <div
                    style={{
                      height: 11,
                      borderRadius: 6,
                      background: '#FFFFFF',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        height: '100%',
                        width: `${progressStats.pct}%`,
                        background: '#6D4AFF',
                        borderRadius: 6,
                        transition: 'width 0.3s ease',
                      }}
                    />
                  </div>
                </section>

                {/* Project Ring Card (Image 3) */}
                <section className="card">
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: 10,
                    }}
                  >
                    <span style={{ fontWeight: 700, fontSize: 14 }}>
                      Proyectos Activos (Front {frontBurnerCount}/2)
                    </span>
                    <Sparkles size={16} color="#6D4AFF" />
                  </div>
                  <ProjectRing
                    projects={projects}
                    score={systemScore}
                    onSelectProject={(p) => {
                      setSelectedProjectId(p.id);
                      setActiveTab('projects');
                    }}
                  />
                  <div
                    style={{
                      textAlign: 'center',
                      fontSize: 11,
                      color: '#64748B',
                      marginTop: 8,
                    }}
                  >
                    Toca un ícono circular para abrir sus tareas
                  </div>
                </section>

                {/* Circular Time Dial Preview (Image 1) */}
                <section className="card">
                  <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>
                    Selector Circular de Tiempo
                  </div>
                  {selectedBlock ? (
                    <CircularTimeDial
                      title={selectedBlock.title}
                      plannedStart={selectedBlock.planned_start}
                      plannedEnd={selectedBlock.planned_end}
                      durationMinutes={selectedBlock.planned_minutes}
                    />
                  ) : (
                    <p style={{ fontSize: 13, color: '#64748B' }}>Sin bloques hoy.</p>
                  )}
                </section>

                {/* Stat Cards: Sueño + Highlight (Image 1) */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                  <div
                    className="card-summer"
                    style={{ cursor: 'pointer' }}
                    onClick={() => setShowSleepModal(true)}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, fontSize: 13 }}>
                      <Moon size={15} color="#1A7F7D" />
                      Sueño Real
                    </div>
                    <div style={{ fontSize: 22, fontWeight: 700, marginTop: 10 }}>{sleepSummary}</div>
                    <div style={{ fontSize: 11, color: '#1A7F7D', marginTop: 4 }}>
                      Deuda: {dailyLog?.sleep_debt_minutes ?? 0} min
                    </div>
                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 42, marginTop: 14 }}>
                      {[20, 30, 24, 36, 32, 40].map((h, idx) => (
                        <div
                          key={idx}
                          style={{
                            flex: 1,
                            height: h,
                            background: '#FFFFFF',
                            borderRadius: 4,
                          }}
                        />
                      ))}
                    </div>
                  </div>

                  <div className="card-limencello">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, fontSize: 13 }}>
                      <Zap size={15} color="#B45309" />
                      Highlight
                    </div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: '#B45309', marginTop: 10 }}>
                      {nextPendingBlock?.title ?? 'Bloque Principal'}
                    </div>
                    <div style={{ fontSize: 11, marginTop: 4 }}>
                      {nextPendingBlock
                        ? `${formatTime(nextPendingBlock.planned_start)} – ${formatTime(nextPendingBlock.planned_end)}`
                        : 'Protegido hoy'}
                    </div>
                    <span
                      className="badge-pill"
                      style={{ background: '#FED141', color: '#18181B', marginTop: 18 }}
                    >
                      {dailyLog?.day_status ?? 'OPEN'}
                    </span>
                  </div>
                </div>

                {/* Next Trigger Action Card */}
                <section className="card">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                    <ProjectIconBadge iconKey="code" size={44} />
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>
                        {nextPendingBlock ? `Siguiente: ${nextPendingBlock.title}` : 'Día al día'}
                      </div>
                      <div
                        style={{
                          fontSize: 12,
                          color: '#64748B',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                          marginTop: 2,
                        }}
                      >
                        <Bell size={12} />
                        Trigger contextual activo
                      </div>
                    </div>
                  </div>
                  {nextPendingBlock && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => handleBlockStatus(nextPendingBlock, 'COMPLETED')}
                      >
                        <Play size={14} />
                        Completar
                      </button>
                      <button
                        type="button"
                        className="btn btn-danger"
                        onClick={() =>
                          handleBlockStatus(nextPendingBlock, 'PARTIAL_EMERGENCY', 'LOW_ENERGY')
                        }
                      >
                        <ShieldAlert size={14} />
                        Emergencia
                      </button>
                    </div>
                  )}
                </section>

                {/* Full 24h Timeline Column */}
                <section className="card timeline-desktop-tall">
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: 14,
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 16 }}>Línea de Tiempo 24h</div>
                      <div style={{ fontSize: 11, color: '#1A7F7D', fontWeight: 600 }}>
                        Reajustes hoy: {dailyLog?.readjustment_count ?? 0}
                      </div>
                    </div>
                    <Clock size={18} color="#64748B" />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {timeBlocks.map((b) => {
                      const bg =
                        b.outcome_status === 'COMPLETED'
                          ? '#B1E4E3'
                          : b.block_kind === 'UNPLANNED'
                            ? '#FEF9C3'
                            : b.outcome_status === 'IN_PROGRESS'
                              ? '#EBDEFC'
                              : b.block_kind === 'BUFFER' || b.block_kind === 'FREE'
                                ? '#F1F5F9'
                                : '#FFFFFF';
                      return (
                        <div
                          key={b.id}
                          onClick={() => {
                            setSelectedBlockId(b.id);
                            setActiveTab('tracker');
                          }}
                          style={{
                            background: bg,
                            border: '1px solid #E2E8F0',
                            borderRadius: 16,
                            padding: '12px 14px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 10,
                            cursor: 'pointer',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                            <span style={{ fontSize: 12, fontWeight: 700, color: '#64748B' }}>
                              {formatTime(b.planned_start)}
                            </span>
                            <div>
                              <div style={{ fontWeight: 700, fontSize: 13 }}>{b.title}</div>
                              <div style={{ fontSize: 11, color: '#6D4AFF', fontWeight: 600 }}>
                                {b.outcome_status} · {b.planned_minutes}m
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              </div>
            )}

            {/* ================= TAB 2: TRACKER 24H ================= */}
            {activeTab === 'tracker' && (
              <div className="bento-two-col">
                <section className="card">
                  <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 14 }}>
                    Ajustar Tiempo del Bloque
                  </div>
                  {selectedBlock ? (
                    <CircularTimeDial
                      title={selectedBlock.title}
                      plannedStart={selectedBlock.planned_start}
                      plannedEnd={selectedBlock.planned_end}
                      durationMinutes={selectedBlock.planned_minutes}
                      onChangeDuration={(mins) => {
                        setTimeBlocks((prev) =>
                          prev.map((x) =>
                            x.id === selectedBlock.id ? { ...x, planned_minutes: mins } : x
                          )
                        );
                      }}
                    />
                  ) : (
                    <p style={{ color: '#64748B', fontSize: 13 }}>Selecciona un bloque.</p>
                  )}
                </section>

                <section className="card">
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: 14,
                    }}
                  >
                    <span style={{ fontWeight: 700, fontSize: 16 }}>Bloques del Día (1,440m)</span>
                    <button
                      type="button"
                      className="btn btn-limencello"
                      onClick={() => setShowUnplannedModal(true)}
                    >
                      <Plus size={14} />
                      Imprevisto
                    </button>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {timeBlocks.map((b) => (
                      <div
                        key={b.id}
                        onClick={() => setSelectedBlockId(b.id)}
                        style={{
                          border:
                            b.id === selectedBlock?.id ? '2px solid #6D4AFF' : '1px solid #E2E8F0',
                          borderRadius: 16,
                          padding: 12,
                          background: b.outcome_status === 'COMPLETED' ? '#B1E4E3' : '#FFFFFF',
                          cursor: 'pointer',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                          }}
                        >
                          <div>
                            <div style={{ fontWeight: 700, fontSize: 13 }}>
                              {formatTime(b.planned_start)} · {b.title}
                            </div>
                            <div style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>
                              {b.block_kind} · {b.planned_minutes}m · {b.outcome_status}
                            </div>
                          </div>
                          {b.outcome_status === 'PLANNED' && b.block_kind !== 'SLEEP' && (
                            <div style={{ display: 'flex', gap: 6 }}>
                              <button
                                type="button"
                                className="btn btn-summer"
                                style={{ padding: '6px 10px', fontSize: 11 }}
                                onClick={(ev) => {
                                  ev.stopPropagation();
                                  void handleBlockStatus(b, 'COMPLETED');
                                }}
                              >
                                <Check size={13} />
                              </button>
                              <button
                                type="button"
                                className="btn btn-danger"
                                style={{ padding: '6px 10px', fontSize: 11 }}
                                onClick={(ev) => {
                                  ev.stopPropagation();
                                  void handleBlockStatus(b, 'PARTIAL_EMERGENCY', 'LOW_ENERGY');
                                }}
                              >
                                <ShieldAlert size={13} />
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            )}

            {/* ================= TAB 3: PROYECTOS & TAREAS ================= */}
            {activeTab === 'projects' && (
              <div className="bento-two-col">
                <section className="card">
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: 16,
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 16 }}>Proyectos & Foco</div>
                      <span
                        className="badge-pill"
                        style={{
                          background: '#FEF9C3',
                          border: '1px solid #FED141',
                          color: '#B45309',
                          marginTop: 6,
                        }}
                      >
                        FRONT BURNER: {frontBurnerCount} / 2 MÁX
                      </span>
                    </div>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => setShowNewProjectModal(true)}
                    >
                      <Plus size={14} />
                      Nuevo
                    </button>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {projects.map((p) => (
                      <div
                        key={p.id}
                        onClick={() => setSelectedProjectId(p.id)}
                        className="card"
                        style={{
                          padding: 14,
                          cursor: 'pointer',
                          border:
                            p.id === selectedProjectId ? '2px solid #6D4AFF' : '1px solid #E2E8F0',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <ProjectIconBadge iconKey={p.icon} size={46} />
                          <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 700, fontSize: 14 }}>{p.title}</div>
                            <div style={{ fontSize: 11, color: '#1A7F7D', fontWeight: 600 }}>
                              {p.burner_slot} · {p.target_minutes_per_session}m/día (mín{' '}
                              {p.min_session_minutes}m)
                            </div>
                          </div>
                          <span
                            className="badge-pill"
                            style={{ background: '#EBDEFC', color: '#6D4AFF' }}
                          >
                            {p.status}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="card">
                  <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 12 }}>
                    Tareas & Dependencias (Sequential / Parallel)
                  </div>

                  <form
                    onSubmit={handleCreateTask}
                    style={{ display: 'flex', gap: 8, marginBottom: 16 }}
                  >
                    <input
                      type="text"
                      placeholder="Nueva tarea secuencial..."
                      value={newTaskTitle}
                      onChange={(e) => setNewTaskTitle(e.target.value)}
                      style={{
                        flex: 1,
                        padding: '10px 14px',
                        borderRadius: 12,
                        border: '1px solid #E2E8F0',
                      }}
                    />
                    <button type="submit" className="btn btn-lavender">
                      <Plus size={15} />
                      Agregar
                    </button>
                  </form>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {tasks.length === 0 ? (
                      <p style={{ fontSize: 13, color: '#64748B' }}>
                        No hay tareas aún para este proyecto.
                      </p>
                    ) : (
                      tasks.map((tk) => (
                        <div
                          key={tk.id}
                          style={{
                            padding: 14,
                            borderRadius: 16,
                            border: '1px solid #E2E8F0',
                            background:
                              tk.status === 'DONE'
                                ? '#B1E4E3'
                                : tk.status === 'BLOCKED'
                                  ? '#F1F5F9'
                                  : '#FFFFFF',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            gap: 10,
                          }}
                        >
                          <div>
                            <div style={{ fontWeight: 700, fontSize: 13 }}>{tk.title}</div>
                            <div style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>
                              {tk.execution_mode} · {tk.status}
                            </div>
                          </div>
                          {tk.status === 'BLOCKED' ? (
                            <span className="badge-pill" style={{ background: '#E2E8F0' }}>
                              <Lock size={12} />
                              BLOCKED
                            </span>
                          ) : (
                            <button
                              type="button"
                              className="btn btn-ghost"
                              style={{ padding: '6px 12px', fontSize: 11 }}
                              onClick={() => void handleCompleteTask(tk)}
                            >
                              <CheckCircle2 size={14} />
                              {tk.status === 'DONE' ? 'Reabrir' : 'Completar'}
                            </button>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </section>
              </div>
            )}

            {/* ================= TAB 4: CIERRE METACOGNITIVO ================= */}
            {activeTab === 'evaluation' && (
              <form onSubmit={handleCloseDay} className="bento-two-col">
                <section className="card">
                  <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 14 }}>
                    Diagnóstico Metacognitivo (Low-Code 1–5)
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                    {dimensions.map((dim) => {
                      const val = dimScores[dim.id] ?? 4;
                      const chips = dim.available_chips ?? [];
                      const selected = dimChips[dim.id] ?? [];
                      return (
                        <div
                          key={dim.id}
                          style={{
                            paddingBottom: 14,
                            borderBottom: '1px solid #E2E8F0',
                          }}
                        >
                          <div style={{ fontWeight: 700, fontSize: 14 }}>{dim.name}</div>
                          <div style={{ fontSize: 12, color: '#64748B', margin: '4px 0 10px' }}>
                            {dim.prompt_question}
                          </div>
                          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                            {[1, 2, 3, 4, 5].map((n) => (
                              <button
                                key={n}
                                type="button"
                                onClick={() =>
                                  setDimScores((prev) => ({ ...prev, [dim.id]: n }))
                                }
                                style={{
                                  flex: 1,
                                  height: 40,
                                  borderRadius: 12,
                                  fontWeight: 700,
                                  cursor: 'pointer',
                                  background: val === n ? '#EBDEFC' : '#FAF9F5',
                                  border:
                                    val === n ? '2px solid #6D4AFF' : '1px solid #E2E8F0',
                                }}
                              >
                                {n}
                              </button>
                            ))}
                          </div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                            {chips.map((ch) => {
                              const on = selected.includes(ch);
                              return (
                                <button
                                  key={ch}
                                  type="button"
                                  onClick={() =>
                                    setDimChips((prev) => ({
                                      ...prev,
                                      [dim.id]: on
                                        ? selected.filter((x) => x !== ch)
                                        : [...selected, ch],
                                    }))
                                  }
                                  className="badge-pill"
                                  style={{
                                    border: 'none',
                                    cursor: 'pointer',
                                    background: on ? '#B1E4E3' : '#F1F5F9',
                                    color: '#18181B',
                                  }}
                                >
                                  {ch}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                  <section className="card-lavender">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                      <Zap size={18} color="#6D4AFF" />
                      <span style={{ fontWeight: 700, fontSize: 15 }}>
                        Exit Ticket (60s — Evocación Activa)
                      </span>
                    </div>
                    <textarea
                      rows={4}
                      value={exitTicket}
                      onChange={(e) => setExitTicket(e.target.value)}
                      placeholder="¿Qué aprendiste hoy y qué fricción vas a eliminar mañana?"
                      style={{
                        width: '100%',
                        borderRadius: 14,
                        border: 'none',
                        padding: 12,
                        fontSize: 13,
                      }}
                    />
                  </section>

                  <section className="card">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                      <Moon size={18} color="#18181B" />
                      <span style={{ fontWeight: 700, fontSize: 15 }}>Mise en Place Nocturno</span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {miseChecklist.map((item, idx) => (
                        <label
                          key={item.label}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                            fontSize: 13,
                            cursor: 'pointer',
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={item.done}
                            onChange={() =>
                              setMiseChecklist((prev) =>
                                prev.map((x, i) => (i === idx ? { ...x, done: !x.done } : x))
                              )
                            }
                          />
                          {item.label}
                        </label>
                      ))}
                    </div>

                    {frictions.length > 0 && (
                      <div style={{ marginTop: 14, fontSize: 11, color: '#64748B' }}>
                        Fricciones activas en catálogo: {frictions.length}
                      </div>
                    )}

                    <button
                      type="submit"
                      className="btn btn-primary"
                      style={{ width: '100%', marginTop: 18, padding: '13px 18px' }}
                    >
                      Cerrar Día y Guardar Evaluación
                    </button>
                  </section>

                  {autoTuneNotes.length > 0 && (
                    <section className="card-limencello">
                      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>
                        Sugerencias SystemAutoTuner
                      </div>
                      {autoTuneNotes.map((msg, i) => (
                        <p key={i} style={{ margin: '4px 0', fontSize: 12 }}>
                          {msg}
                        </p>
                      ))}
                    </section>
                  )}
                </div>
              </form>
            )}
          </>
        )}
      </main>

      {/* Mobile & Tablet Floating Pill Nav */}
      <nav className="mobile-pill-nav" aria-label="Navegación principal">
        <button
          type="button"
          className={`pill-nav-btn ${activeTab === 'dashboard' ? 'active' : ''}`}
          onClick={() => setActiveTab('dashboard')}
        >
          <Home size={20} />
        </button>
        <button
          type="button"
          className={`pill-nav-btn ${activeTab === 'tracker' ? 'active' : ''}`}
          onClick={() => setActiveTab('tracker')}
        >
          <Timer size={20} />
        </button>
        <button
          type="button"
          className="pill-fab-btn"
          onClick={() => setShowUnplannedModal(true)}
          aria-label="Registrar imprevisto o bloque"
        >
          <Plus size={24} strokeWidth={2.5} />
        </button>
        <button
          type="button"
          className={`pill-nav-btn ${activeTab === 'projects' ? 'active' : ''}`}
          onClick={() => setActiveTab('projects')}
        >
          <FolderKanban size={20} />
        </button>
        <button
          type="button"
          className={`pill-nav-btn ${activeTab === 'evaluation' ? 'active' : ''}`}
          onClick={() => setActiveTab('evaluation')}
        >
          <Brain size={20} />
        </button>
      </nav>

      {/* Reentry Modal (Caso D) */}
      {reentryState && (
        <ReentryModal
          gapDays={reentryState.gapDays}
          lastActiveDate={reentryState.lastActiveDate}
          projects={projects}
          onApply={async (actions) => {
            const res = await api.applyReentry({
              return_date: logDate,
              last_active_date: reentryState.lastActiveDate,
              gap_days: reentryState.gapDays,
              actions,
            });
            setReentryState(null);
            setDailyLog(res.bootstrap.dailyLog);
            setTimeBlocks(res.bootstrap.timeBlocks);
            notify('Rampa gradual de reentrada activada');
          }}
        />
      )}

      {/* Modal: Imprevisto (Caso B) */}
      {showUnplannedModal && (
        <div className="modal-backdrop" onClick={() => setShowUnplannedModal(false)}>
          <form
            className="modal-panel"
            onClick={(e) => e.stopPropagation()}
            onSubmit={handleUnplannedSubmit}
          >
            <h3 style={{ marginTop: 0 }}>Registrar Imprevisto / Reajuste 24h</h3>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
              ¿Qué ocurrió?
            </label>
            <input
              type="text"
              required
              placeholder="Ej. Reunión de emergencia o trámite"
              value={unplannedTitle}
              onChange={(e) => setUnplannedTitle(e.target.value)}
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: 12,
                border: '1px solid #E2E8F0',
                marginBottom: 14,
              }}
            />
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
              Duración estimada (minutos)
            </label>
            <input
              type="number"
              min={10}
              max={720}
              value={unplannedMinutes}
              onChange={(e) => setUnplannedMinutes(Number(e.target.value))}
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: 12,
                border: '1px solid #E2E8F0',
                marginBottom: 18,
              }}
            />
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setShowUnplannedModal(false)}
              >
                Cancelar
              </button>
              <button type="submit" className="btn btn-primary">
                Registrar y Rebalancear
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal: Nuevo Proyecto con Selector de Icono Circular */}
      {showNewProjectModal && (
        <div className="modal-backdrop" onClick={() => setShowNewProjectModal(false)}>
          <form
            className="modal-panel"
            onClick={(e) => e.stopPropagation()}
            onSubmit={handleCreateProject}
          >
            <h3 style={{ marginTop: 0 }}>Nuevo Proyecto</h3>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
              Nombre del proyecto
            </label>
            <input
              type="text"
              required
              placeholder="Ej. Certificación Cloud"
              value={newProjTitle}
              onChange={(e) => setNewProjTitle(e.target.value)}
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: 12,
                border: '1px solid #E2E8F0',
                marginBottom: 14,
              }}
            />
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 8 }}>
              Ícono circular del proyecto (columna `icon`)
            </label>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                gap: 8,
                marginBottom: 14,
              }}
            >
              {PROJECT_ICON_OPTIONS.map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setNewProjIcon(opt.key)}
                  style={{
                    padding: 8,
                    borderRadius: 14,
                    border: newProjIcon === opt.key ? '2px solid #6D4AFF' : '1px solid #E2E8F0',
                    background: newProjIcon === opt.key ? '#EBDEFC' : '#FAF9F5',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 4,
                    cursor: 'pointer',
                  }}
                >
                  <ProjectIconBadge iconKey={opt.key} size={34} />
                  <span style={{ fontSize: 10, fontWeight: 600 }}>{opt.label.split(' ')[0]}</span>
                </button>
              ))}
            </div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
              Prioridad de Foco (Burner)
            </label>
            <select
              value={newProjSlot}
              onChange={(e) => setNewProjSlot(e.target.value as 'FRONT' | 'BACK')}
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: 12,
                border: '1px solid #E2E8F0',
                marginBottom: 18,
              }}
            >
              <option value="FRONT">FRONT (Foco Principal — Máx 2)</option>
              <option value="BACK">BACK (Segundo Plano)</option>
            </select>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setShowNewProjectModal(false)}
              >
                Cancelar
              </button>
              <button type="submit" className="btn btn-primary">
                Crear Proyecto
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal: Check-in de Sueño */}
      {showSleepModal && (
        <div className="modal-backdrop" onClick={() => setShowSleepModal(false)}>
          <form
            className="modal-panel"
            onClick={(e) => e.stopPropagation()}
            onSubmit={handleSleepSubmit}
          >
            <h3 style={{ marginTop: 0 }}>Check-in de Sueño Real</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 18 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
                  Hora de dormir
                </label>
                <input
                  type="time"
                  value={sleepBed}
                  onChange={(e) => setSleepBed(e.target.value)}
                  style={{
                    width: '100%',
                    padding: 10,
                    borderRadius: 12,
                    border: '1px solid #E2E8F0',
                  }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
                  Hora de despertar
                </label>
                <input
                  type="time"
                  value={sleepWake}
                  onChange={(e) => setSleepWake(e.target.value)}
                  style={{
                    width: '100%',
                    padding: 10,
                    borderRadius: 12,
                    border: '1px solid #E2E8F0',
                  }}
                />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setShowSleepModal(false)}
              >
                Cancelar
              </button>
              <button type="submit" className="btn btn-primary">
                Guardar y Rebalancear
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Toast Notification */}
      {toastMsg && (
        <div
          style={{
            position: 'fixed',
            top: 20,
            right: 20,
            background: '#18181B',
            color: '#FFFFFF',
            padding: '12px 18px',
            borderRadius: 14,
            fontSize: 13,
            fontWeight: 600,
            zIndex: 80,
            boxShadow: '0 10px 30px rgba(0,0,0,0.2)',
          }}
        >
          {toastMsg}
        </div>
      )}
    </div>
  );
}

export default App;
