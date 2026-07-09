import { cn } from '@/lib/utils';

/**
 * Money — one place that formats currency. INR by default (matches domain).
 * Optional signed=true prefixes +/- for deltas (debt vs credit).
 */
interface MoneyProps {
  value: number | null | undefined;
  signed?: boolean;
  className?: string;
  currency?: string;
  compact?: boolean;
}

export function Money({ value, signed, className, currency = 'INR', compact }: MoneyProps) {
  if (value == null) return <span className={cn('text-muted-foreground', className)}>—</span>;
  const abs = Math.abs(value);
  const formatted = new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    maximumFractionDigits: compact && abs >= 100000 ? 1 : 0,
    notation: compact && abs >= 100000 ? 'compact' : 'standard',
  }).format(abs);
  const sign = signed ? (value > 0 ? '+' : value < 0 ? '−' : '') : value < 0 ? '−' : '';
  return <span className={cn('tabular-nums', className)}>{sign}{formatted}</span>;
}

/**
 * KeyValue — label/value pair used inside SectionCards.
 */
export function KeyValue({
  label,
  value,
  className,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-baseline justify-between gap-4 py-2 border-b border-border last:border-0', className)}>
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium text-foreground text-right tabular-nums">{value}</span>
    </div>
  );
}
