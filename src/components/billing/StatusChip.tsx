import { chipDotClasses } from '@/lib/financialPosition';
import type { ServiceLine } from './types';

/** Calm status language — small dot + neutral text (matches the Customers list). */
export const StatusChip = ({ line }: { line: ServiceLine }) => {
  const dot = (tone: 'danger' | 'warning' | 'success' | 'muted', label: string) => (
    <span className="inline-flex items-center gap-1.5 text-sm">
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full shrink-0 ${chipDotClasses(tone)}`} />
      <span
        className={
          tone === 'muted' ? 'text-muted-foreground' : tone === 'danger' ? 'text-destructive' : ''
        }
      >
        {label}
      </span>
    </span>
  );

  if (line.isOverdue && line.daysUntil !== null && line.daysUntil < 0) {
    return dot('danger', `Overdue · expired ${Math.abs(line.daysUntil)}d ago`);
  }
  if (line.isOverdue) return dot('danger', 'Collect payment');
  if (line.isExpiring) {
    return dot('warning', line.daysUntil === 0 ? 'Expires today' : `Renew in ${line.daysUntil}d`);
  }
  if (!line.isActive) return dot('muted', 'No active subscription');
  return dot('success', 'Current');
};
