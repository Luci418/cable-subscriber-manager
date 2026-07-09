import { useMemo } from 'react';
import { Users, CreditCard, TrendingUp, AlertCircle, ArrowRight } from 'lucide-react';
import { PageHeader, StatCard, SectionCard, EmptyState, Money } from '@/components/ui-ext';
import { Button } from '@/components/ui/button';
import type { NavId } from '@/components/AppSidebar';
import { getActiveSubs } from '@/lib/activeSubs';

interface DashboardProps {
  subscribers: any[];
  transactions: any[];
  onNavigate: (id: NavId) => void;
  onSelectSubscriber: (id: string) => void;
}

/**
 * Dashboard — landing screen for the operator console.
 *
 * Batch 1 delivers KPI + queue layout on the new design system; Batch 3 will
 * enrich with revenue trend/status donut. Slots are intentional so provider
 * P&L, network health etc. drop in without a redesign.
 */
export function Dashboard({ subscribers, transactions, onNavigate, onSelectSubscriber }: DashboardProps) {
  const stats = useMemo(() => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthTx = transactions.filter((t) => new Date(t.date) >= monthStart);
    const collected = monthTx
      .filter((t) => t.type === 'payment')
      .reduce((s, t) => s + Number(t.amount || 0), 0);

    const debt = subscribers.reduce(
      (s, sub) => s + Math.max(0, Number(sub.cable_balance || 0)) + Math.max(0, Number(sub.internet_balance || 0)),
      0,
    );
    const overdue = subscribers.filter(
      (s) => Number(s.cable_balance || 0) > 0 || Number(s.internet_balance || 0) > 0,
    );
    const active = subscribers.filter((s) => (s as any).status !== 'archived').length;
    return { collected, debt, overdue, active, total: subscribers.length };
  }, [subscribers, transactions]);

  const expiring = useMemo(() => {
    const soon = new Date();
    soon.setDate(soon.getDate() + 7);
    return subscribers
      .flatMap((s) => {
        const subs = getActiveSubs(s);
        return subs
          .filter((sub: any) => sub.end_date && new Date(sub.end_date) <= soon)
          .map((sub: any) => ({ subscriber: s, end: sub.end_date, pack: sub.pack_name }));
      })
      .slice(0, 6);
  }, [subscribers]);

  return (
    <>
      <PageHeader
        title="Overview"
        description="Today's collections, upcoming renewals, and where operators should focus."
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
        <StatCard
          label="Active Subscribers"
          value={stats.active}
          hint={`${stats.total} total`}
          icon={<Users className="h-4 w-4" />}
          onClick={() => onNavigate('customers')}
        />
        <StatCard
          label="Collected This Month"
          value={<Money value={stats.collected} />}
          icon={<TrendingUp className="h-4 w-4" />}
          onClick={() => onNavigate('billing')}
        />
        <StatCard
          label="Outstanding Debt"
          value={<Money value={stats.debt} />}
          hint={`${stats.overdue.length} customers`}
          icon={<CreditCard className="h-4 w-4" />}
          onClick={() => onNavigate('billing')}
        />
        <StatCard
          label="Overdue"
          value={stats.overdue.length}
          hint="Needs collection"
          icon={<AlertCircle className="h-4 w-4" />}
          onClick={() => onNavigate('billing')}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard
          title="Needs collection"
          description="Customers with a positive balance."
          actions={
            <Button variant="ghost" size="sm" onClick={() => onNavigate('billing')} className="text-xs">
              View all <ArrowRight className="ml-1 h-3 w-3" />
            </Button>
          }
          padded={false}
        >
          {stats.overdue.length === 0 ? (
            <EmptyState
              icon={<CreditCard className="h-5 w-5" />}
              title="All caught up"
              description="No customers currently owe a balance."
            />
          ) : (
            <ul className="divide-y divide-border">
              {stats.overdue.slice(0, 6).map((s) => {
                const owed = Math.max(0, Number(s.cable_balance || 0)) + Math.max(0, Number(s.internet_balance || 0));
                return (
                  <li key={s.id}>
                    <button
                      onClick={() => onSelectSubscriber(s.id)}
                      className="w-full flex items-center justify-between gap-3 px-5 py-3 hover:bg-accent/40 text-left"
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{s.name}</div>
                        <div className="text-xs text-muted-foreground font-mono truncate">
                          {s.subscriber_id}
                        </div>
                      </div>
                      <div className="text-sm font-semibold text-destructive">
                        <Money value={owed} />
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          title="Expiring in 7 days"
          description="Subscriptions ending soon — nudge for renewal."
          padded={false}
        >
          {expiring.length === 0 ? (
            <EmptyState
              icon={<TrendingUp className="h-5 w-5" />}
              title="Nothing expiring soon"
              description="All active subscriptions have more than a week left."
            />
          ) : (
            <ul className="divide-y divide-border">
              {expiring.map((row, i) => (
                <li key={i}>
                  <button
                    onClick={() => onSelectSubscriber(row.subscriber.id)}
                    className="w-full flex items-center justify-between gap-3 px-5 py-3 hover:bg-accent/40 text-left"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{row.subscriber.name}</div>
                      <div className="text-xs text-muted-foreground truncate">{row.pack ?? 'Subscription'}</div>
                    </div>
                    <div className="text-xs text-muted-foreground tabular-nums">
                      {new Date(row.end).toLocaleDateString()}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>
    </>
  );
}
