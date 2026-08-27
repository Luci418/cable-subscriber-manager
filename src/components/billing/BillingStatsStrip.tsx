import { Money } from '@/components/ui-ext';
import { cn } from '@/lib/utils';

type Item = {
  label: string;
  value: React.ReactNode;
  hint?: string;
  onClick?: () => void;
  tone?: 'default' | 'danger';
};

/**
 * Compact one-line stat strip for Billing.
 *
 * Replaces the old 4-card grid: same numbers, ~90px of vertical space instead
 * of a full card row, so the worklist stays above the fold.
 */
export const BillingStatsStrip = ({
  needsAttention,
  overdueCount,
  expiringCount,
  totalOutstanding,
  activeCount,
  totalLines,
  onSelectStatus,
}: {
  needsAttention: number;
  overdueCount: number;
  expiringCount: number;
  totalOutstanding: number;
  activeCount: number;
  totalLines: number;
  onSelectStatus: (status: string) => void;
}) => {
  const items: Item[] = [
    {
      label: 'Needs attention',
      value: needsAttention,
      hint: `${overdueCount} overdue · ${expiringCount} expiring`,
      onClick: () => onSelectStatus(overdueCount > 0 ? 'overdue' : 'expiring'),
      tone: needsAttention > 0 ? 'danger' : 'default',
    },
    {
      label: 'Outstanding',
      value: <Money value={totalOutstanding} compact />,
      hint: 'across service lines',
      onClick: () => onSelectStatus('overdue'),
      tone: totalOutstanding > 0 ? 'danger' : 'default',
    },
    {
      label: 'Active',
      value: activeCount,
      hint: `of ${totalLines} lines`,
      onClick: () => onSelectStatus('active'),
    },
    {
      label: 'Inactive',
      value: totalLines - activeCount,
      hint: 'no active subscription',
      onClick: () => onSelectStatus('inactive'),
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-border rounded-lg border border-border bg-card">
      {items.map((it) => (
        <button
          key={it.label}
          type="button"
          onClick={it.onClick}
          className="text-left px-3 py-2.5 transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:bg-accent/40"
        >
          <div className="text-xs text-muted-foreground">{it.label}</div>
          <div
            className={cn(
              'text-lg font-semibold tabular-nums leading-tight',
              it.tone === 'danger' && 'text-destructive',
            )}
          >
            {it.value}
          </div>
          {it.hint && <div className="text-[11px] text-muted-foreground truncate">{it.hint}</div>}
        </button>
      ))}
    </div>
  );
};
