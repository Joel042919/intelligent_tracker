import type { ProjectDTO } from '../api/client';
import { resolveProjectIcon } from './projectIconCatalog';

const RING_COLORS = ['#FED141', '#B1E4E3', '#EBDEFC', '#BAE6FD'];

function describeArc(cx: number, cy: number, r: number, startAngle: number, endAngle: number) {
  const rad = (deg: number) => ((deg - 90) * Math.PI) / 180;
  const x1 = cx + r * Math.cos(rad(startAngle));
  const y1 = cy + r * Math.sin(rad(startAngle));
  const x2 = cx + r * Math.cos(rad(endAngle));
  const y2 = cy + r * Math.sin(rad(endAngle));
  const large = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

export function ProjectRing({
  projects,
  score,
  onSelectProject,
}: {
  projects: ProjectDTO[];
  score: string;
  onSelectProject?: (project: ProjectDTO) => void;
}) {
  const active = projects.filter((p) => p.status === 'ACTIVE').slice(0, 4);
  const segments =
    active.length > 0
      ? active
      : ([
          { id: 'demo-1', title: 'Deep Work', icon: 'flame' },
          { id: 'demo-2', title: 'Backend', icon: 'code' },
          { id: 'demo-3', title: 'Estudio', icon: 'book' },
          { id: 'demo-4', title: 'Salud', icon: 'activity' },
        ] as unknown as ProjectDTO[]);

  const count = segments.length;
  const gapDeg = count > 1 ? 16 : 4;
  const segSpan = (360 - gapDeg * count) / count;
  const cx = 130;
  const cy = 130;
  const r = 94;

  return (
    <div style={{ position: 'relative', width: 260, height: 260, margin: '0 auto' }}>
      <svg width={260} height={260} viewBox="0 0 260 260">
        {segments.map((proj, idx) => {
          const start = idx * (segSpan + gapDeg) + gapDeg / 2;
          const end = start + segSpan;
          const stroke = RING_COLORS[idx % RING_COLORS.length];
          return (
            <path
              key={proj.id}
              d={describeArc(cx, cy, r, start, end)}
              fill="none"
              stroke={stroke}
              strokeWidth={22}
              strokeLinecap="round"
              style={{ cursor: onSelectProject ? 'pointer' : 'default' }}
              onClick={() => onSelectProject?.(proj)}
            />
          );
        })}
      </svg>

      {/* Circular Project Icon Badges positioned along each segment */}
      {segments.map((proj, idx) => {
        const start = idx * (segSpan + gapDeg) + gapDeg / 2;
        const mid = start + segSpan / 2;
        const rad = ((mid - 90) * Math.PI) / 180;
        const ix = cx + r * Math.cos(rad);
        const iy = cy + r * Math.sin(rad);
        const { bg, color, Icon } = resolveProjectIcon(proj.icon);
        return (
          <button
            key={`badge-${proj.id}`}
            type="button"
            title={proj.title}
            onClick={() => onSelectProject?.(proj)}
            style={{
              position: 'absolute',
              left: ix - 18,
              top: iy - 18,
              width: 36,
              height: 36,
              borderRadius: '50%',
              backgroundColor: bg,
              border: '2.5px solid #FFFFFF',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              boxShadow: '0 2px 8px rgba(15, 23, 42, 0.14)',
            }}
          >
            <Icon size={16} color={color} strokeWidth={2.3} />
          </button>
        );
      })}

      {/* Center Score */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          pointerEvents: 'none',
        }}
      >
        <span style={{ fontSize: 36, fontWeight: 700, lineHeight: 1, color: '#18181B' }}>
          {score}
        </span>
        <span style={{ fontSize: 12, fontWeight: 500, color: '#64748B', marginTop: 6 }}>
          score del sistema
        </span>
      </div>
    </div>
  );
}
