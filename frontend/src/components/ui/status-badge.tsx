import type { EmploymentStatus } from '../../data/app-data';

interface StatusBadgeProps {
  status: EmploymentStatus;
  size?: 'sm' | 'md';
}

const config: Record<EmploymentStatus, { label: string; classes: string; dot: string }> = {
  employed: {
    label: 'Employed',
    classes: 'bg-emerald-100 text-emerald-700 border border-emerald-200',
    dot: 'bg-emerald-500',
  },
  'self-employed': {
    label: 'Self-Employed',
    classes: 'bg-teal-100 text-teal-700 border border-teal-200',
    dot: 'bg-teal-500',
  },
  unemployed: {
    label: 'Unemployed',
    classes: 'bg-orange-100 text-orange-700 border border-orange-200',
    dot: 'bg-orange-500',
  },
};

export function StatusBadge({ status, size = 'md' }: StatusBadgeProps) {
  const { label, classes, dot } = config[status];
  const sizeClasses = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-3 py-1 text-sm';

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full font-medium ${classes} ${sizeClasses}`}>
      <span className={`rounded-full ${dot} ${size === 'sm' ? 'size-1.5' : 'size-2'}`} />
      {label}
    </span>
  );
}