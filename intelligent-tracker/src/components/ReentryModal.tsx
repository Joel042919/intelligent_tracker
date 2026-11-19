import { Sprout } from 'lucide-react';
import { useState } from 'react';
import type { ProjectDTO } from '../api/client';
import { ProjectIconBadge } from './ProjectIcon';

type ReentryAction = 'REDUCE_DOSE' | 'EXTEND_DEADLINE' | 'PAUSE_PROJECT' | 'ARCHIVE_PROJECT';

export function ReentryModal({
  gapDays,
  lastActiveDate,
  projects,
  onApply,
}: {
  gapDays: number;
  lastActiveDate: string | null;
  projects: ProjectDTO[];
  onApply: (
    actions: Array<{
      project_id: string;
      action_taken: ReentryAction;
      days_shifted: number;
      new_target_minutes?: number;
    }>
  ) => Promise<void>;
}) {
  const activeProjects = projects.filter((p) => p.status === 'ACTIVE');
  const [choices, setChoices] = useState<Record<string, ReentryAction>>(() =>
    Object.fromEntries(activeProjects.map((p) => [p.id, 'REDUCE_DOSE']))
  );
  const [submitting, setSubmitting] = useState(false);

  const handleConfirm = async () => {
    setSubmitting(true);
    try {
      await onApply(
        activeProjects.map((p) => ({
          project_id: p.id,
          action_taken: choices[p.id] ?? 'REDUCE_DOSE',
          days_shifted: choices[p.id] === 'EXTEND_DEADLINE' ? gapDays : 0,
          new_target_minutes: choices[p.id] === 'REDUCE_DOSE' ? p.min_session_minutes : undefined,
        }))
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-backdrop">
      <div className="modal-panel">
        <div className="card-lavender" style={{ marginBottom: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Sprout size={22} color="#6D4AFF" />
            <h2 style={{ margin: 0, fontSize: 18 }}>Bienvenido de vuelta</h2>
          </div>
          <p style={{ margin: '8px 0 0', fontSize: 13, color: '#4338CA' }}>
            Estuviste {gapDays} días sin registro{lastActiveDate ? ` (último: ${lastActiveDate})` : ''}.
            Reconciliamos tus días pasados sin penalizaciones ni listas rojas.
          </p>
        </div>

        <div style={{ fontSize: 11, fontWeight: 700, color: '#64748B', marginBottom: 10 }}>
          ELIGE TU ESTRATEGIA POR PROYECTO
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 18 }}>
          {activeProjects.length === 0 ? (
            <p style={{ fontSize: 13, color: '#64748B' }}>
              No tienes proyectos activos por ajustar. Iniciaremos tu día limpio.
            </p>
          ) : (
            activeProjects.map((p) => {
              const selected = choices[p.id] ?? 'REDUCE_DOSE';
              return (
                <div key={p.id} className="card" style={{ padding: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                    <ProjectIconBadge iconKey={p.icon} size={36} />
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{p.title}</div>
                      <div style={{ fontSize: 11, color: '#64748B' }}>
                        Dosis normal: {p.target_minutes_per_session}m · Mínima: {p.min_session_minutes}m
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    {(
                      [
                        ['REDUCE_DOSE', `Dosis mínima (${p.min_session_minutes}m)`],
                        ['EXTEND_DEADLINE', `Extender (+${gapDays} días)`],
                        ['PAUSE_PROJECT', 'Pausar proyecto'],
                        ['ARCHIVE_PROJECT', 'Archivar'],
                      ] as const
                    ).map(([val, label]) => (
                      <button
                        key={val}
                        type="button"
                        onClick={() => setChoices((prev) => ({ ...prev, [p.id]: val }))}
                        className="btn"
                        style={{
                          padding: '8px 10px',
                          fontSize: 11,
                          borderRadius: 12,
                          background: selected === val ? '#B1E4E3' : '#FAF9F5',
                          borderColor: selected === val ? '#1A7F7D' : '#E2E8F0',
                          color: '#18181B',
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </div>

        <button
          type="button"
          className="btn btn-primary"
          style={{ width: '100%', padding: '12px 18px' }}
          disabled={submitting}
          onClick={handleConfirm}
        >
          {submitting ? 'Aplicando reentrada...' : 'Iniciar Rampa Gradual (REENTRY_RAMP)'}
        </button>
      </div>
    </div>
  );
}
