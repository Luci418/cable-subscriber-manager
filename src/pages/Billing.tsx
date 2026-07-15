import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertTriangle, Calendar, CreditCard, Search, Tv, Wallet, Wifi } from 'lucide-react';
import {
  PageHeader,
  SectionCard,
  StatCard,
  DataTable,
  EmptyState,
  Toolbar,
  Money,
  Pagination,
  type DataTableColumn,
} from '@/components/ui-ext';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useAuth } from '@/hooks/useAuth';
import { useAppData } from '@/contexts/AppDataContext';
import { useEnabledServices } from '@/hooks/useEnabledServices';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { friendlyDbError } from '@/lib/dbErrors';
import { RecentVoidsCard } from '@/components/RecentVoidsCard';
import { TodaysCollectionsCard } from '@/components/TodaysCollectionsCard';
import type { Subscriber } from '@/hooks/useSubscribers';

/**
 * Billing — cross-subscriber worklist.
 *
 * Batch 3 rebuild:
 *  - "Needs attention today" section at the top: overdue balances +
 *    subscriptions expiring in ≤7 days. This is the operator's morning view.
 *  - Full billing table below with URL-bound search/filters. Built on the
 *    shared DataTable primitive so future columns and empty states inherit
 *    the same behaviour.
 *  - Removed the tabbed layout, subscription plan cards, and back button —
 *    the sidebar + breadcrumb handle navigation now.
 *  - Reads through useAppData so payments recorded here refresh Home,
 *    Customers, and the profile without a manual reload.
 */
type ServiceFilter = 'all' | 'cable' | 'internet';
type StatusFilter = 'all' | 'overdue' | 'expiring' | 'active' | 'inactive';

type ServiceLine = {
  subscriber: Subscriber;
  service: 'cable' | 'internet';
  sub: any | null;
  pack: string | null;
  balance: number;
  daysUntil: number | null;
  isActive: boolean;
  isOverdue: boolean;
  isExpiring: boolean;
  key: string;
};

export const Billing = () => {
  const { user } = useAuth();
  const { cableEnabled, internetEnabled, bothEnabled } = useEnabledServices();
  const { subscribers, loading, reloadSubscribers, reloadTransactions } = useAppData();
  const [params, setParams] = useSearchParams();

  const service = (params.get('service') ?? (bothEnabled ? 'all' : cableEnabled ? 'cable' : 'internet')) as ServiceFilter;
  const status = (params.get('status') ?? 'all') as StatusFilter;
  const q = params.get('q') ?? '';

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value == null || value === '' || value === 'all') next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  };

  const [payLine, setPayLine] = useState<ServiceLine | null>(null);
  const [payAmount, setPayAmount] = useState<string>('');
  const [paySaving, setPaySaving] = useState(false);
  /** Local service filter for the "Needs attention today" section only. */
  const [needsServiceFilter, setNeedsServiceFilter] = useState<ServiceFilter>('all');
  /** Client-side pagination for the full worklist. */
  const [worklistPage, setWorklistPage] = useState(1);
  const WORKLIST_PAGE_SIZE = 25;

  const openRecordPayment = (line: ServiceLine) => {
    setPayLine(line);
    setPayAmount(line.balance > 0 ? line.balance.toFixed(2) : '');
  };

  const submitRecordPayment = async () => {
    if (!payLine || !user?.id) return;
    const amount = Number(payAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error('Enter a positive amount.');
      return;
    }
    setPaySaving(true);
    const targetSubscriptionId: string | null = payLine.sub?.subscriptionId ?? null;
    const { error } = await (supabase.from('transactions') as any).insert({
      user_id: user.id,
      subscriber_id: payLine.subscriber.id,
      type: 'payment',
      amount,
      service_type: payLine.service,
      source: 'manual_payment',
      subscription_id: targetSubscriptionId,
      provider_id: payLine.service === 'cable'
        ? (payLine.subscriber as any).cable_provider_id
        : (payLine.subscriber as any).internet_provider_id,
      description: `Payment received — ${payLine.service === 'cable' ? 'Cable' : 'Internet'} dues`,
      date: new Date().toISOString(),
    });
    setPaySaving(false);
    if (error) {
      toast.error(friendlyDbError(error, 'Failed to record payment'));
      return;
    }
    toast.success(`Payment of ₹${amount.toFixed(2)} recorded.`);
    setPayLine(null);
    await Promise.all([reloadSubscribers(), reloadTransactions()]);
  };

  const allLines: ServiceLine[] = useMemo(() => {
    const out: ServiceLine[] = [];
    const today = Date.now();
    const daysLeft = (endDate: string) =>
      Math.ceil((new Date(endDate).getTime() - today) / (1000 * 60 * 60 * 24));

    const emitFor = (s: any, svc: 'cable' | 'internet') => {
      const actives: any[] = (svc === 'cable' ? s._activeCable : s._activeInternet) || [];
      const timeline: any[] = (svc === 'cable' ? s._timelineCable : s._timelineInternet) || [];
      const balance = Number(svc === 'cable' ? s.cable_balance || 0 : s.internet_balance || 0);
      if (actives.length === 0) {
        out.push({
          subscriber: s, service: svc, sub: null, pack: timeline[0]?.packName ?? null, balance,
          daysUntil: null, isActive: false,
          isOverdue: balance > 0,
          isExpiring: false,
          key: `${s.id}-${svc}-none`,
        });
        return;
      }
      for (const sub of actives) {
        const du = sub?.endDate ? daysLeft(sub.endDate) : null;
        const isActive = du !== null && du > 0;
        out.push({
          subscriber: s, service: svc, sub, pack: sub?.packName ?? null, balance,
          daysUntil: du,
          isActive,
          isOverdue: balance > 0,
          isExpiring: du !== null && du >= 0 && du <= 7,
          key: `${s.id}-${svc}-${sub.subscriptionId}`,
        });
      }
    };

    for (const s of subscribers) {
      if ((s as any).customer_status === 'archived') continue;
      const services = (s as any).services?.length ? (s as any).services : ['cable'];
      if (cableEnabled && services.includes('cable')) emitFor(s, 'cable');
      if (internetEnabled && services.includes('internet')) emitFor(s, 'internet');
    }
    return out;
  }, [subscribers, cableEnabled, internetEnabled]);

  const bySvc = useMemo(
    () => (service === 'all' ? allLines : allLines.filter((l) => l.service === service)),
    [allLines, service],
  );

  const needsAttention = useMemo(
    () =>
      bySvc
        .filter((l) => l.isOverdue || l.isExpiring)
        .filter((l) => needsServiceFilter === 'all' || l.service === needsServiceFilter)
        .sort((a, b) => {
          // Overdue first, then soonest-expiring, then largest balance
          if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1;
          if (a.isExpiring && b.isExpiring) return (a.daysUntil ?? 999) - (b.daysUntil ?? 999);
          return b.balance - a.balance;
        }),
    [bySvc, needsServiceFilter],
  );

  const worklist = useMemo(() => {
    const term = q.trim().toLowerCase();
    return bySvc.filter((l) => {
      if (status === 'overdue' && !l.isOverdue) return false;
      if (status === 'expiring' && !l.isExpiring) return false;
      if (status === 'active' && !l.isActive) return false;
      if (status === 'inactive' && l.isActive) return false;
      if (!term) return true;
      return (
        l.subscriber.name.toLowerCase().includes(term) ||
        (l.subscriber.mobile ?? '').toLowerCase().includes(term) ||
        ((l.subscriber as any).subscriber_id ?? '').toLowerCase().includes(term) ||
        (l.pack ?? '').toLowerCase().includes(term)
      );
    });
  }, [bySvc, q, status]);

  const totalOutstanding = bySvc.filter((l) => l.balance > 0).reduce((s, l) => s + l.balance, 0);
  const overdueCount = bySvc.filter((l) => l.isOverdue).length;
  const expiringCount = bySvc.filter((l) => l.isExpiring).length;
  const activeCount = bySvc.filter((l) => l.isActive).length;

  const nextActionChip = (l: ServiceLine) => {
    if (l.isOverdue && l.daysUntil !== null && l.daysUntil < 0) {
      return <Badge variant="destructive">Overdue · expired {Math.abs(l.daysUntil)}d ago</Badge>;
    }
    if (l.isOverdue) return <Badge variant="destructive">Collect payment</Badge>;
    if (l.isExpiring) {
      return (
        <Badge className="bg-warning/15 text-warning border-warning/30" variant="outline">
          {l.daysUntil === 0 ? 'Expires today' : `Renew in ${l.daysUntil}d`}
        </Badge>
      );
    }
    if (!l.isActive) return <Badge variant="outline">No active subscription</Badge>;
    return <Badge variant="outline" className="bg-success/15 text-success border-success/30">Current</Badge>;
  };

  if (loading) {
    return (
      <div className="py-12 text-center text-sm text-muted-foreground">Loading billing data…</div>
    );
  }

  const columns: DataTableColumn<ServiceLine>[] = [
    {
      id: 'subscriber',
      header: 'Subscriber',
      cell: (l) => (
        <div className="min-w-0">
          <Link
            to={`/customers/${l.subscriber.id}`}
            className="font-medium hover:underline truncate block max-w-[220px]"
          >
            {l.subscriber.name}
          </Link>
          <div className="text-xs text-muted-foreground font-mono">
            {(l.subscriber as any).subscriber_id ?? l.subscriber.mobile}
          </div>
        </div>
      ),
    },
    ...(bothEnabled
      ? [
          {
            id: 'service',
            header: 'Service',
            cell: (l: ServiceLine) => (
              <Badge variant="outline" className="gap-1">
                {l.service === 'internet' ? <Wifi className="h-3 w-3" /> : <Tv className="h-3 w-3" />}
                {l.service === 'internet' ? 'Internet' : 'Cable'}
              </Badge>
            ),
            hideBelow: 'sm' as const,
          },
        ]
      : []),
    {
      id: 'pack',
      header: 'Pack',
      cell: (l) => <span className="text-sm">{l.pack ?? '—'}</span>,
      hideBelow: 'md',
    },
    {
      id: 'endDate',
      header: 'Ends',
      cell: (l) =>
        l.sub?.endDate ? (
          <span className="text-xs tabular-nums">
            {new Date(l.sub.endDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
      hideBelow: 'md',
    },
    {
      id: 'status',
      header: 'Status',
      cell: (l) => nextActionChip(l),
    },
    {
      id: 'balance',
      header: 'Balance',
      cell: (l) => (
        <Money
          value={l.balance}
          className={l.balance > 0 ? 'text-destructive font-medium' : 'text-muted-foreground'}
        />
      ),
      align: 'right',
    },
  ];

  return (
    <>
      <PageHeader
        title="Billing"
        description="Your daily collection worklist. Overdue and expiring first, everything else below."
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
        <StatCard
          label="Needs attention"
          value={overdueCount + expiringCount}
          hint={`${overdueCount} overdue · ${expiringCount} expiring`}
          icon={<AlertTriangle className="h-4 w-4" />}
          onClick={() => setParam('status', overdueCount > 0 ? 'overdue' : 'expiring')}
        />
        <StatCard
          label="Total outstanding"
          value={<Money value={totalOutstanding} compact />}
          hint="across service lines"
          icon={<CreditCard className="h-4 w-4" />}
          onClick={() => setParam('status', 'overdue')}
        />
        <StatCard
          label="Active"
          value={activeCount}
          hint={`of ${bySvc.length} lines`}
          icon={<Calendar className="h-4 w-4" />}
          onClick={() => setParam('status', 'active')}
        />
        <StatCard
          label="Inactive"
          value={bySvc.length - activeCount}
          hint="no active subscription"
          icon={<Wallet className="h-4 w-4" />}
          onClick={() => setParam('status', 'inactive')}
        />
      </div>

      {/* Priority worklist — overdue & expiring inside 7 days. */}
      <TodaysCollectionsCard />

      <SectionCard
        title="Needs attention today"
        description="Overdue balances and subscriptions expiring in the next 7 days. Act top-down."
        className="mb-6"
        padded={false}
      >
        {needsAttention.length === 0 ? (
          <EmptyState
            icon={<AlertTriangle className="h-5 w-5" />}
            title="All caught up"
            description="No overdue balances or subscriptions expiring in the next 7 days."
          />
        ) : (
          <ul className="divide-y">
            {needsAttention.slice(0, 12).map((l) => (
              <li key={l.key} className="flex items-center justify-between gap-3 p-3 sm:px-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <Link
                      to={`/customers/${l.subscriber.id}`}
                      className="font-medium truncate hover:underline"
                    >
                      {l.subscriber.name}
                    </Link>
                    {bothEnabled && (
                      <Badge variant="outline" className="gap-1 shrink-0">
                        {l.service === 'internet' ? <Wifi className="h-3 w-3" /> : <Tv className="h-3 w-3" />}
                      </Badge>
                    )}
                    {nextActionChip(l)}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">
                    {(l.subscriber as any).subscriber_id ?? l.subscriber.mobile}
                    {l.pack ? ` · ${l.pack}` : ''}
                    {l.sub?.endDate && ` · ends ${new Date(l.sub.endDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}`}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <Money
                    value={l.balance}
                    className={l.balance > 0 ? 'text-destructive font-semibold' : 'text-muted-foreground'}
                  />
                  {l.balance > 0 && (
                    <div className="mt-1">
                      <Button size="sm" variant="outline" onClick={() => openRecordPayment(l)}>
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

      <SectionCard title="All service lines" padded={false}>
        <Toolbar
          searchValue={q}
          onSearchChange={(v) => setParam('q', v)}
          searchPlaceholder="Search name, mobile, ID, pack…"
          filters={
            <>
              {bothEnabled && (
                <Select value={service} onValueChange={(v) => setParam('service', v)}>
                  <SelectTrigger className="w-[130px]">
                    <SelectValue placeholder="Service" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All services</SelectItem>
                    <SelectItem value="cable">Cable</SelectItem>
                    <SelectItem value="internet">Internet</SelectItem>
                  </SelectContent>
                </Select>
              )}
              <Select value={status} onValueChange={(v) => setParam('status', v)}>
                <SelectTrigger className="w-[150px]">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="overdue">Overdue</SelectItem>
                  <SelectItem value="expiring">Expiring ≤7d</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </>
          }
        />

        {worklist.length === 0 ? (
          <EmptyState
            icon={<Search className="h-5 w-5" />}
            title="No matching service lines"
            description="Adjust the filters or search to see other lines."
          />
        ) : (
          <DataTable
            rows={worklist}
            rowKey={(l) => l.key}
            columns={columns}
            rowActions={(l) =>
              l.balance > 0 ? (
                <Button size="sm" variant="outline" onClick={() => openRecordPayment(l)}>
                  <Wallet className="h-3.5 w-3.5 mr-1" /> Collect
                </Button>
              ) : null
            }
          />
        )}
      </SectionCard>

      <div className="mt-6">
        <RecentVoidsCard />
      </div>

      <Dialog open={!!payLine} onOpenChange={(o) => { if (!o) setPayLine(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record Payment</DialogTitle>
            <DialogDescription>
              {payLine && (
                <>
                  {payLine.subscriber.name} · {payLine.service === 'cable' ? 'Cable' : 'Internet'} ·{' '}
                  Outstanding: <span className="font-medium text-destructive">₹{payLine.balance.toFixed(2)}</span>
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="pay-amt">Amount received (₹)</Label>
            <Input
              id="pay-amt"
              type="number"
              min="0"
              step="0.01"
              value={payAmount}
              onChange={(e) => setPayAmount(e.target.value)}
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              Posts a payment to the immutable ledger. Use Void from the subscriber page if entered incorrectly.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayLine(null)} disabled={paySaving}>Cancel</Button>
            <Button onClick={submitRecordPayment} disabled={paySaving}>
              {paySaving ? 'Saving…' : 'Mark as Paid'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
