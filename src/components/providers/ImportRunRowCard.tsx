import { Link } from 'react-router-dom';
import { ArrowUpRight, AlertTriangle } from 'lucide-react';

import { Money } from '@/components/ui-ext';
import { cn } from '@/lib/utils';
import type { RunReportRow } from '@/lib/providers/runReport';

/**
 * One customer, one row of a committed import — what changed, what it cost,
 * and where to go to verify it. Read-only by design: nothing on this card
 * re-posts or reverses anything.
 */
export function ImportRunRowCard({ row }: { row: RunReportRow }) {
  const ids = [
    row.identifiers.vc_id && `VC ${row.identifiers.vc_id}`,
    row.identifiers.stb_no && `STB ${row.identifiers.stb_no}`,
    row.identifiers.account_number && `A/c ${row.identifiers.account_number}`,
  ].filter(Boolean) as string[];

  const failed = row.group === 'failed';

  return (
    <div className={cn('p-4', failed && 'bg-destructive/5')}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {row.subscriberSlug ? (
              <Link
                to={`/customers/${row.subscriberSlug}/overview`}
                className="font-medium text-foreground hover:underline inline-flex items-center gap-1"
              >
                {row.customerName}
                <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground" />
              </Link>
            ) : (
              <span className="font-medium text-foreground">{row.customerName}</span>
            )}
            {row.subscriberSlug && (
              <span className="rounded border border-border px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                {row.subscriberSlug}
              </span>
            )}
          </div>

          <p className={cn('mt-1 text-sm', failed ? 'text-destructive' : 'text-muted-foreground')}>
            {failed && <AlertTriangle className="mr-1 inline h-3.5 w-3.5 align-[-2px]" />}
            {row.description}
          </p>

          {ids.length > 0 && (
            <p className="mt-1.5 text-xs text-muted-foreground/80 tabular-nums">{ids.join(' · ')}</p>
          )}
        </div>

        {row.amount != null && (
          <div className="shrink-0 text-right">
            <Money value={row.amount} className="text-sm font-semibold" />
            {row.subscriberSlug && row.transactionId && (
              <Link
                to={`/customers/${row.subscriberSlug}/ledger`}
                className="mt-0.5 block text-xs text-muted-foreground hover:underline"
              >
                View in ledger
              </Link>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
