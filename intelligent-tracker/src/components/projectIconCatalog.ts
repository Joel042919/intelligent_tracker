import {
  Activity,
  BookOpen,
  Briefcase,
  Code2,
  Flame,
  Heart,
  Sparkles,
  Target,
  type LucideIcon,
} from 'lucide-react';

export interface ProjectIconOption {
  key: string;
  label: string;
  bg: string;
  color: string;
  Icon: LucideIcon;
}

export const PROJECT_ICON_OPTIONS: ProjectIconOption[] = [
  { key: 'code', label: 'Código / Tech', bg: '#B1E4E3', color: '#1A7F7D', Icon: Code2 },
  { key: 'book', label: 'Estudio / Idiomas', bg: '#EBDEFC', color: '#6D4AFF', Icon: BookOpen },
  { key: 'activity', label: 'Salud / Físico', bg: '#FED141', color: '#92400E', Icon: Activity },
  { key: 'target', label: 'Deep Work', bg: '#E0F2FE', color: '#0369A1', Icon: Target },
  { key: 'sparkles', label: 'Espiritual', bg: '#FCE7F3', color: '#BE185D', Icon: Sparkles },
  { key: 'briefcase', label: 'Trabajo', bg: '#DCFCE7', color: '#15803D', Icon: Briefcase },
  { key: 'heart', label: 'Bienestar', bg: '#FFE4E6', color: '#E11D48', Icon: Heart },
  { key: 'flame', label: 'Hábito Clave', bg: '#FEF3C7', color: '#B45309', Icon: Flame },
];

export function resolveProjectIcon(iconKey: string | null | undefined): ProjectIconOption {
  const found = PROJECT_ICON_OPTIONS.find((o) => o.key === iconKey);
  return found ?? PROJECT_ICON_OPTIONS[0];
}
