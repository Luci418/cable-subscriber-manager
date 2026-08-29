import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageHeader } from '@/components/ui-ext';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/hooks/useAuth';
import { useAppData } from '@/contexts/AppDataContext';
import { useEnabledServices } from '@/hooks/useEnabledServices';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { friendlyDbError } from '@/lib/dbErrors';
import { RecentVoidsCard } from '@/components/RecentVoidsCard';
import { TodaysCollectionsCard } from '@/components/TodaysCollectionsCard';
import { BillingStatsStrip } from '@/components/billing/BillingStatsStrip';
import { NeedsAttentionSection } from '@/components/billing/NeedsAttentionSection';
import { ServiceLinesTable } from '@/components/billing/ServiceLinesTable';
import { RecordPaymentDialog } from '@/components/billing/RecordPaymentDialog';
import type { ServiceFilter, ServiceLine, StatusFilter } from '@/components/billing/types';

/**
 * Billing — cross-subscriber worklist.
 *
 * Layout (2026-08 redesign): one compact stat strip, then three tabs so the
 * page is a single working surface instead of a long scroll.
 *  - Worklist    → "Needs attention today" + the full service-line table
 *  - Collections → today's collections, full width
 *  - Activity    → recent voids / corrections
 *
 * All filters (service, status, search) and the active tab live in the URL, so
 * links and refreshes land in the same place. Data derivation and payment
 * handlers stay here; presentation lives in src/components/billing/.
 */
type TabKey = 'worklist' | 'collections' | 'activity';
const TABS: TabKey[] = ['worklist', 'collections', 'activity'];

export const Billing = () => {
  const { user } = useAuth();
  const { cableEnabled, internetEnabled, bothEnabled } = useEnabledServices();
  const { subscribers, loading, reloadSubscribers, reloadTransactions } = useAppData();
  const [params, setParams] = useSearchParams();

  const service = (params.get('service') ?? (bothEnabled ? 'all' : cableEnabled ? 'cable' : 'internet')) as ServiceFilter;
  const status = (params.get('status') ?? 'all') as StatusFilter;
  const q = params.get('q') ?? '';
  const tabParam = params.get('tab') as TabKey | null;
  const tab: TabKey = tabParam && TABS.includes(tabParam) ? tabParam : 'worklist';

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
  const [worklistPage, setWorklistPage] = useState(1);

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

  if (loading) {
    return (
      <div className="py-12 text-center text-sm text-muted-foreground">Loading billing data…</div>
    );
  }

  return (
    <>
      <PageHeader
        title="Billing"
        description="Your daily collection worklist. Overdue and expiring first, everything else below."
      />

      <div className="mb-4">
        <BillingStatsStrip
          needsAttention={overdueCount + expiringCount}
          overdueCount={overdueCount}
          expiringCount={expiringCount}
          totalOutstanding={totalOutstanding}
          activeCount={activeCount}
          totalLines={bySvc.length}
          onSelectStatus={(s) => {
            // Batch both params into one setParams call — sequential setParam
            // calls read the same render-time snapshot, so the second would
            // discard the first.
            const next = new URLSearchParams(params);
            next.set('tab', 'worklist');
            if (s === 'all') next.delete('status');
            else next.set('status', s);
            setParams(next, { replace: true });
            setWorklistPage(1);
          }}
        />
      </div>

      <Tabs value={tab} onValueChange={(v) => setParam('tab', v === 'worklist' ? null : v)}>
        <TabsList className="mb-4">
          <TabsTrigger value="worklist">Worklist</TabsTrigger>
          <TabsTrigger value="collections">Collections</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>

        <TabsContent value="worklist" className="space-y-6 mt-0">
          <NeedsAttentionSection
            lines={needsAttention}
            bothEnabled={bothEnabled}
            serviceFilter={needsServiceFilter}
            onServiceFilterChange={setNeedsServiceFilter}
            onCollect={openRecordPayment}
          />
          <ServiceLinesTable
            rows={worklist}
            bothEnabled={bothEnabled}
            service={service}
            status={status}
            query={q}
            page={worklistPage}
            onPageChange={setWorklistPage}
            onServiceChange={(v) => { setParam('service', v); setWorklistPage(1); }}
            onStatusChange={(v) => { setParam('status', v); setWorklistPage(1); }}
            onQueryChange={(v) => { setParam('q', v); setWorklistPage(1); }}
            onCollect={openRecordPayment}
          />
        </TabsContent>

        <TabsContent value="collections" className="mt-0">
          <TodaysCollectionsCard />
        </TabsContent>

        <TabsContent value="activity" className="mt-0">
          <RecentVoidsCard />
        </TabsContent>
      </Tabs>

      <RecordPaymentDialog
        line={payLine}
        amount={payAmount}
        saving={paySaving}
        onAmountChange={setPayAmount}
        onClose={() => setPayLine(null)}
        onSubmit={submitRecordPayment}
      />
    </>
  );
};
