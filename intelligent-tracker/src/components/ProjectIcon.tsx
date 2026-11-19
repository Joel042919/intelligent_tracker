import { resolveProjectIcon } from './projectIconCatalog';

export function ProjectIconBadge({
  iconKey,
  size = 44,
}: {
  iconKey: string | null | undefined;
  size?: number;
}) {
  const { bg, color, Icon } = resolveProjectIcon(iconKey);
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        backgroundColor: bg,
        border: '2px solid #FFFFFF',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        boxShadow: '0 2px 6px rgba(15, 23, 42, 0.08)',
      }}
    >
      <Icon size={Math.round(size * 0.46)} color={color} strokeWidth={2.2} />
    </div>
  );
}
