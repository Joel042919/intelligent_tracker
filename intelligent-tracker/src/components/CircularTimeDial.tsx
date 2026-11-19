import { Minus, Plus } from 'lucide-react';

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function formatClockTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '--:--';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function CircularTimeDial({
  title,
  plannedStart,
  plannedEnd,
  durationMinutes,
  onChangeDuration,
}: {
  title: string;
  plannedStart: string;
  plannedEnd: string;
  durationMinutes: number;
  onChangeDuration?: (nextMinutes: number) => void;
}) {
  const cx = 120;
  const cy = 120;
  const r = 92;
  const circumference = 2 * Math.PI * r;
  const ratio = Math.min(1, Math.max(0.05, durationMinutes / 240)); // max 4h dial scale
  const dash = ratio * circumference;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#64748B', textAlign: 'center' }}>
        {title}
      </div>

      <div style={{ position: 'relative', width: 240, height: 240 }}>
        <svg width={240} height={240} viewBox="0 0 240 240">
          <circle cx={cx} cy={cy} r={r + 12} fill="#FFFFFF" stroke="#E2E8F0" strokeWidth={2} />
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="#F1F5F9" strokeWidth={14} />
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke="#B1E4E3"
            strokeWidth={14}
            strokeLinecap="round"
            strokeDasharray={`${dash} ${circumference}`}
            transform={`rotate(-90 ${cx} ${cy})`}
          />
          <circle cx={cx} cy={cy} r={r - 16} fill="#FAF9F5" stroke="#E2E8F0" strokeWidth={1} />
          <text x={cx} y={cy - 68} textAnchor="middle" fontSize="11" fontWeight="600" fill="#64748B">
            12
          </text>
          <text x={cx + 72} y={cy + 4} textAnchor="middle" fontSize="11" fontWeight="600" fill="#64748B">
            3
          </text>
          <text x={cx} y={cy + 76} textAnchor="middle" fontSize="11" fontWeight="600" fill="#64748B">
            6
          </text>
          <text x={cx - 72} y={cy + 4} textAnchor="middle" fontSize="11" fontWeight="600" fill="#64748B">
            9
          </text>
          {/* Start handle (Soft Lavender Dark) */}
          <circle cx={cx} cy={cy - r} r={10} fill="#6D4AFF" stroke="#FFFFFF" strokeWidth={2.5} />
        </svg>

        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <span style={{ fontSize: 28, fontWeight: 700, color: '#18181B' }}>
            {formatDuration(durationMinutes)}
          </span>
          <span style={{ fontSize: 11, fontWeight: 500, color: '#64748B', marginTop: 2 }}>
            Duración bloque
          </span>

          {onChangeDuration && (
            <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
              <button
                type="button"
                className="btn btn-ghost"
                style={{ padding: '4px 10px' }}
                onClick={() => onChangeDuration(Math.max(10, durationMinutes - 15))}
                aria-label="Restar 15 minutos"
              >
                <Minus size={14} />
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                style={{ padding: '4px 10px' }}
                onClick={() => onChangeDuration(Math.min(240, durationMinutes + 15))}
                aria-label="Sumar 15 minutos"
              >
                <Plus size={14} />
              </button>
            </div>
          )}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, width: '100%' }}>
        <div
          style={{
            background: '#FAF9F5',
            border: '1px solid #E2E8F0',
            borderRadius: 12,
            padding: '8px 12px',
            textAlign: 'center',
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          Inicio: {formatClockTime(plannedStart)}
        </div>
        <div
          style={{
            background: '#FAF9F5',
            border: '1px solid #E2E8F0',
            borderRadius: 12,
            padding: '8px 12px',
            textAlign: 'center',
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          Fin: {formatClockTime(plannedEnd)}
        </div>
      </div>
    </div>
  );
}
