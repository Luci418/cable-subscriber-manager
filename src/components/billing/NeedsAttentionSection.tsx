import { Link } from 'react-router-dom';
import { AlertTriangle, Tv, Wallet, Wifi } from 'lucide-react';
import { SectionCard, EmptyState, Money } from '@/components/ui-ext';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { StatusChip } from './StatusChip';
import type { ServiceFilter, ServiceLine } from './types';

export const NeedsAttentionSection = ({
  lines,
  bothEnabled,
  serviceFilter,
  onServiceFilterChange,
  onCollect,
}: {
  lines: ServiceLine[];
  bothEnabled: boolean;
  serviceFilter: ServiceFilter;
  onServiceFilterChange: (v: ServiceFilter) => void;
  onCollect: (line: ServiceLine) => void;
}) => (
  <SectionCard
    title="Needs attention today"
    description="Overdue balances and subscriptions expiring in the next 7 days. Act top-down."
    padded={false}
    actions={
      bothEnabled ? (
        <div className="inline-flex rounded-md border border-border overflow-hidden text-xs">
          {(['all', 'cable', 'internet'] as ServiceFilter[]).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => onServiceFilterChange(v)}
              className={
                'px-3 py-1.5 transition-colors ' +
                (serviceFilter === v
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-transparent hover:bg-accent/40 text-muted-foreground')
              }
            >
              {v === 'all' ? 'Both' : v === 'cable' ? 'Cable' : 'Internet'}
            </button>
          ))}
        </div>
      ) : undefined
    }
  >
    {lines.length === 0 ? (
      <EmptyState
        icon={<AlertTriangle className="h-5 w-5" />}
        title="All caught up"
        description="No overdue balances or subscriptions expiring in the next 7 days."
      />
    ) : (
      <ul className="divide-y">
        {lines.slice(0, 12).map((l) => (
          <li key={l.key} className="flex items-center justify-between gap-3 p-3 sm:px-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 min-w-0">
                <Link
                  to={`/customers/${(l.subscriber as any).subscriber_id ?? l.subscriber.id}`}
                  className="font-medium truncate hover:underline"
                >
                  {l.subscriber.name}
                </Link>
                {bothEnabled && (
                  <Badge variant="outline" className="gap-1 shrink-0">
                    {l.service === 'internet' ? <Wifi className="h-3 w-3" /> : <Tv className="h-3 w-3" />}
                  </Badge>
                )}
                <StatusChip line={l} />
              </div>
              <p className="text-xs text-muted-foreground mt-0.5 truncate">
                {(l.subscriber as any).subscriber_id ?? l.subscriber.mobile}
                {l.pack ? ` · ${l.pack}` : ''}
                {l.sub?.endDate &&
                  ` · ends ${new Date(l.sub.endDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}`}
              </p>
            </div>
            <div className="text-right shrink-0">
              <Money
                value={l.balance}
                className={l.balance > 0 ? 'text-destructive font-semibold' : 'text-muted-foreground'}
              />
              {l.balance > 0 && (
                <div className="mt-1">
                  <Button size="sm" variant="outline" onClick={() => onCollect(l)}>
                    <Wallet className="h-3.5 w-3.5 mr-1" /> Collect
                  </Button>
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
    )}
  </SectionCard>
);
