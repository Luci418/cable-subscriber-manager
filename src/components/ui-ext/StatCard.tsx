import { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { TrendingUp, TrendingDown } from 'lucide-react';

/**
 * StatCard — one KPI tile. Used on Dashboard and page-level stat rows.
 * Value uses tabular numerals so a row of cards aligns cleanly.
 */
interface StatCardProps {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  delta?: { value: number; suffix?: string } | null;
  icon?: ReactNode;
  className?: string;
  onClick?: () => void;
}

export function StatCard({ label, value, hint, delta, icon, className, onClick }: StatCardProps) {
  const positive = delta && delta.value >= 0;
  const Wrapper: any = onClick ? 'button' : 'div';
  return (
    <Wrapper
      onClick={onClick}
      className={cn(
        'group rounded-lg border border-border bg-card p-5 text-left shadow-xs transition-colors',
        onClick && 'hover:bg-accent/40 cursor-pointer',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</p>
        {icon && <div className="text-muted-foreground/70">{icon}</div>}
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums text-foreground">{value}</div>
      {(hint || delta) && (
        <div className="mt-2 flex items-center gap-2 text-xs">
          {delta && (
            <span
              className={cn(
                'inline-flex items-center gap-1 font-medium tabular-nums',
                positive ? 'text-success' : 'text-destructive',
              )}
            >
              {positive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
              {Math.abs(delta.value)}
              {delta.suffix ?? '%'}
            </span>
          )}
          {hint && <span className="text-muted-foreground">{hint}</span>}
        </div>
      )}
    </Wrapper>
  );
}
