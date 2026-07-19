import { useState, useEffect } from 'react';
import { Subscriber, Transaction } from '@/lib/storage';
import { settingsToCompany, useSettings } from '@/contexts/SettingsContext';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Archive, Calendar, Edit, FileText, Receipt, RotateCcw, Scale, Trash2, Tv, User } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { AddTransactionDialog } from './AddTransactionDialog';
import { EditSubscriberDialog } from './EditSubscriberDialog';
import { AddPackageSubscriptionDialog } from './AddPackageSubscriptionDialog';
import { VoidTransactionDialog } from './VoidTransactionDialog';
import { TransactionNotesDialog } from './TransactionNotesDialog';
import { PairDeviceDialog } from './PairDeviceDialog';
import { UnpairDeviceDialog } from './UnpairDeviceDialog';
import { ReplaceDeviceDialog } from './ReplaceDeviceDialog';
import { CollectPaymentDialog } from './CollectPaymentDialog';
import { CancelSubscriptionDialog } from './CancelSubscriptionDialog';
import { ArchiveCustomerDialog } from './ArchiveCustomerDialog';
import { ReactivateCustomerDialog } from './ReactivateCustomerDialog';
import { useEnabledServices } from '@/hooks/useEnabledServices';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { getActives, getHistory, hasAnyActive, type SubscriptionBlob } from '@/lib/activeSubs';
import {
  computeReconciliation,
} from '@/lib/reconciliation';
import type { LedgerAllocation, LedgerSubscription } from '@/lib/ledgerRendering';
import { usePermissions } from '@/lib/permissions';

import { OverviewTab } from './subscriber-detail/OverviewTab';
import { SubscriptionsTab } from './subscriber-detail/SubscriptionsTab';
import { DevicesTab, type LastClosedAssignment, type PairedDevice } from './subscriber-detail/DevicesTab';
import { LedgerTab } from './subscriber-detail/LedgerTab';
import { CredentialsTab } from './subscriber-detail/CredentialsTab';

interface SubscriberDetailProps {
  subscriber: Subscriber;
  transactions: Transaction[];
  onBack?: () => void;
  onAddTransaction: (transaction: { type: 'payment' | 'charge'; amount: number; description: string; service_type: 'cable' | 'internet' }) => void;
  onEdit: (updates: Partial<Subscriber>) => void | boolean | Promise<void | boolean>;
  onDelete: () => void;
  onReload?: () => void;
  activeTab?: string;
  onTabChange?: (tab: string) => void;
}

/**
 * SubscriberDetail (Batch 4 refactor) — orchestrator. Owns every piece of
 * shared state (paired devices, reconciliation snapshot, dialog toggles)
 * and delegates each tab body to a dedicated component under
 * ./subscriber-detail/*. No behaviour change from the pre-split version
 * beyond the new "device needed" guided state on the Devices tab
 * (see DevicesTab.tsx for the workflow details).
 */
export const SubscriberDetail = ({
  subscriber,
  transactions,
  onBack,
  onAddTransaction,
  onEdit,
  onDelete,
  onReload,
  activeTab: controlledTab,
  onTabChange,
}: SubscriberDetailProps) => {
  const perms = usePermissions();
  const { cableEnabled, internetEnabled } = useEnabledServices();
  const { settings: businessSettings } = useSettings();
  const companyForPdf = businessSettings
    ? settingsToCompany(businessSettings)
    : { name: '', address: '', phone: '', email: '', receipt_footer: '' };

  const isArchived = (subscriber as any).customer_status === 'archived';
  const subscriberServices = subscriber.services && subscriber.services.length > 0
    ? subscriber.services
    : ['cable'];
  const showCableTab = cableEnabled && subscriberServices.includes('cable');
  const showInternetTab = internetEnabled && subscriberServices.includes('internet');

  // Tab (URL-controlled in CustomerDetail, self-controlled otherwise).
  const [internalTab, setInternalTab] = useState<string>('overview');
  const activeTab = controlledTab ?? internalTab;
  const setActiveTab = (t: string) => {
    if (onTabChange) onTabChange(t);
    else setInternalTab(t);
  };

  // Dialog toggles.
  const [showAddTransaction, setShowAddTransaction] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showArchiveDialog, setShowArchiveDialog] = useState(false);
  const [showReactivateDialog, setShowReactivateDialog] = useState(false);
  const [showAddPackage, setShowAddPackage] = useState(false);
  const [addPackageService, setAddPackageService] = useState<'cable' | 'internet'>('cable');
  const [addPackageDeviceId, setAddPackageDeviceId] = useState<string | null>(null);
  const [showVoidDialog, setShowVoidDialog] = useState(false);
  const [voidingTransaction, setVoidingTransaction] = useState<Transaction | null>(null);
  const [showNotesDialog, setShowNotesDialog] = useState(false);
  const [notesTransaction, setNotesTransaction] = useState<Transaction | null>(null);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<{
    service: 'cable' | 'internet';
    subscriptionId: string;
    blob: SubscriptionBlob;
  } | null>(null);
  const [pairDialogService, setPairDialogService] = useState<'cable' | 'internet' | null>(null);
  const [unpairDevice, setUnpairDevice] = useState<PairedDevice | null>(null);
  const [replaceDevice, setReplaceDevice] = useState<PairedDevice | null>(null);
  const [collectTarget, setCollectTarget] = useState<{
    service: 'cable' | 'internet';
    subscriptionId: string | null;
    packName: string | null;
    outstandingForSubscription: number;
  } | null>(null);
  const [addServiceTarget, setAddServiceTarget] = useState<'cable' | 'internet' | null>(null);
  const [addingService, setAddingService] = useState(false);
  const [deleteBlockers, setDeleteBlockers] = useState<string[] | null>(null);
  const [deleteChecking, setDeleteChecking] = useState(false);

  // Shared reconciliation / device state.
  const [pairedDevices, setPairedDevices] = useState<PairedDevice[]>([]);
  const [providerNames, setProviderNames] = useState<{ cable?: string; internet?: string }>({});
  const [outstandingBySub, setOutstandingBySub] = useState<Record<string, number>>({});
  const [subsById, setSubsById] = useState<Record<string, LedgerSubscription>>({});
  const [allocByTx, setAllocByTx] = useState<Record<string, LedgerAllocation[]>>({});
  // Batch 4 — most recent CLOSED assignment per service. Powers the
  // "device needed" guided state on the Devices tab (faulty vs. plain).
  const [lastClosedByService, setLastClosedByService] = useState<{
    cable: LastClosedAssignment | null;
    internet: LastClosedAssignment | null;
  }>({ cable: null, internet: null });

  // ---- loaders ---------------------------------------------------------

  const loadPairedDevices = async () => {
    const { data, error } = await supabase
      .from('stb_inventory')
      .select('id, serial_number, device_type, service_type')
      .eq('subscriber_id', subscriber.id)
      .eq('status', 'assigned');
    if (error) {
      console.warn('Failed to load paired devices:', error);
      return;
    }
    setPairedDevices((data as PairedDevice[]) || []);
  };

  /**
   * Batch 4 — read the newest CLOSED assignment per service so the Devices
   * tab can render the "device needed / faulty replacement" guided state.
   * Read-only, no schema change.
   */
  const loadLastClosedAssignments = async () => {
    const { data, error } = await (supabase as any)
      .from('device_assignment_log')
      .select('device_serial, closed_at, close_reason, closed_by, service_type')
      .eq('subscriber_id', subscriber.id)
      .not('closed_at', 'is', null)
      .order('closed_at', { ascending: false });
    if (error) {
      console.warn('loadLastClosedAssignments failed:', error);
      return;
    }
    const rows = (data as any[]) || [];
    const firstBy: Record<string, any> = {};
    rows.forEach((r) => {
      if (!firstBy[r.service_type]) firstBy[r.service_type] = r;
    });

    // Resolve closer names in one round-trip.
    const closerIds = Array.from(
      new Set(Object.values(firstBy).map((r: any) => r.closed_by).filter(Boolean))
    ) as string[];
    let nameById: Record<string, string> = {};
    if (closerIds.length > 0) {
      const { data: profs } = await (supabase as any)
        .from('profiles')
        .select('id, full_name, email')
        .in('id', closerIds);
      ((profs as any[]) || []).forEach((p) => {
        nameById[p.id] = p.full_name || p.email || 'operator';
      });
    }
    const build = (svc: 'cable' | 'internet'): LastClosedAssignment | null => {
      const r = firstBy[svc];
      if (!r) return null;
      return {
        device_serial: r.device_serial,
        closed_at: r.closed_at,
        close_reason: r.close_reason,
        closed_by_name: r.closed_by ? (nameById[r.closed_by] || null) : null,
      };
    };
    setLastClosedByService({ cable: build('cable'), internet: build('internet') });
  };

  const loadOutstanding = async () => {
    const { data: subs, error: subErr } = await (supabase as any)
      .from('subscriptions')
      .select('id,total_charged,status,service_type,pack_name_snapshot,start_date,end_date,device_serial_snapshot,previous_subscription_id,cancelled_at,cancel_reason_note,refund_amount')
      .eq('subscriber_id', subscriber.id);
    if (subErr || !subs) return;
    const subMap: Record<string, LedgerSubscription> = {};
    (subs as any[]).forEach((s) => {
      subMap[s.id] = {
        id: s.id,
        service_type: s.service_type,
        pack_name_snapshot: s.pack_name_snapshot,
        start_date: s.start_date,
        end_date: s.end_date,
        device_serial_snapshot: s.device_serial_snapshot,
        previous_subscription_id: s.previous_subscription_id,
        cancelled_at: s.cancelled_at,
        cancel_reason_note: s.cancel_reason_note,
        refund_amount: s.refund_amount,
      };
    });
    setSubsById(subMap);

    const subIds = (subs as any[]).map((s) => s.id);
    let allocs: any[] = [];
    if (subIds.length > 0) {
      const { data } = await (supabase as any)
        .from('payment_allocations')
        .select('subscription_id,amount,transaction_id')
        .in('subscription_id', subIds);
      allocs = (data as any[]) || [];
    }

    const recon = computeReconciliation(
      (subs as any[]).map((s) => ({
        id: s.id,
        service_type: s.service_type,
        status: s.status,
        total_charged: Number(s.total_charged) || 0,
        refund_amount: s.refund_amount,
      })),
      allocs.map((a) => ({
        subscription_id: a.subscription_id,
        amount: Number(a.amount) || 0,
        transaction_id: a.transaction_id,
      })),
      transactions.map((t: any) => ({
        id: t.id,
        type: t.type,
        amount: Number(t.amount) || 0,
        service_type: (t.service_type as any) || null,
        status: t.status || 'posted',
      })),
    );

    const out: Record<string, number> = {};
    recon.services.forEach((svc) => {
      svc.perSub.forEach((p) => { out[p.subscription_id] = p.remaining; });
    });
    setOutstandingBySub(out);

    const txIds = transactions.map((t) => t.id);
    if (txIds.length > 0) {
      const { data: txAllocs } = await (supabase as any)
        .from('payment_allocations')
        .select('transaction_id,subscription_id,amount,allocated_by')
        .in('transaction_id', txIds);
      const map: Record<string, LedgerAllocation[]> = {};
      ((txAllocs as any[]) || []).forEach((a) => {
        (map[a.transaction_id] ||= []).push({
          transaction_id: a.transaction_id,
          subscription_id: a.subscription_id,
          amount: Number(a.amount) || 0,
          allocated_by: a.allocated_by,
        });
      });
      setAllocByTx(map);
    } else {
      setAllocByTx({});
    }
  };

  useEffect(() => {
    loadPairedDevices();
    loadOutstanding();
    loadLastClosedAssignments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscriber.id, transactions.length]);

  useEffect(() => {
    let cancelled = false;
    const ids = [
      (subscriber as any).cable_provider_id,
      (subscriber as any).internet_provider_id,
    ].filter(Boolean) as string[];
    if (ids.length === 0) {
      setProviderNames({});
      return;
    }
    (async () => {
      const { data } = await (supabase as any)
        .from('providers')
        .select('id,name')
        .in('id', ids);
      if (cancelled || !data) return;
      const lookup: Record<string, string> = {};
      (data as any[]).forEach((p) => { lookup[p.id] = p.name; });
      setProviderNames({
        cable: lookup[(subscriber as any).cable_provider_id] || undefined,
        internet: lookup[(subscriber as any).internet_provider_id] || undefined,
      });
    })();
    return () => { cancelled = true; };
  }, [subscriber.id, (subscriber as any).cable_provider_id, (subscriber as any).internet_provider_id]);

  // ---- derived ---------------------------------------------------------

  const sortedTransactions = [...transactions].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );

  const cableActives = getActives(subscriber, 'cable');
  const internetActives = getActives(subscriber, 'internet');
  const cableHistory = getHistory(subscriber, 'cable');
  const internetHistory = getHistory(subscriber, 'internet');
  const anyCableActive = hasAnyActive(subscriber, 'cable');
  const anyInternetActive = hasAnyActive(subscriber, 'internet');
  const anyActive = anyCableActive || anyInternetActive;
  const accountStatus = anyActive
    ? { label: 'Active', tone: 'bg-green-500/10 text-green-700 dark:text-green-400' }
    : subscriberServices.length > 0
      ? { label: 'Lapsed', tone: 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400' }
      : { label: 'No services', tone: 'bg-muted text-muted-foreground' };

  const cableTransactions = sortedTransactions.filter(
    (t: any) => (t.service_type || 'cable') === 'cable'
  );
  const internetTransactions = sortedTransactions.filter(
    (t: any) => t.service_type === 'internet'
  );

  const [txFilter, setTxFilter] = useState<'all' | 'cable' | 'internet'>(
    showCableTab && !showInternetTab ? 'cable' : showInternetTab && !showCableTab ? 'internet' : 'all'
  );
  useEffect(() => {
    if (activeTab === 'cable' && showCableTab) setTxFilter('cable');
    else if (activeTab === 'internet' && showInternetTab) setTxFilter('internet');
  }, [activeTab, showCableTab, showInternetTab]);

  const visibleTransactions =
    txFilter === 'cable' ? cableTransactions :
    txFilter === 'internet' ? internetTransactions :
    sortedTransactions;

  const formatDate = (dateString: string) =>
    new Date(dateString).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

  // ---- handlers --------------------------------------------------------

  const openDeleteDialog = async () => {
    setDeleteChecking(true);
    setShowDeleteDialog(true);
    setDeleteBlockers(null);
    const { data, error } = await (supabase as any).rpc('check_subscriber_deletable', {
      p_subscriber_id: subscriber.id,
    });
    setDeleteChecking(false);
    if (error) {
      console.error('check_subscriber_deletable failed:', error);
      const reason = error.message || error.details || error.hint || 'Unknown error';
      setDeleteBlockers([`Unable to check deletion eligibility — ${reason}. Please try again.`]);
      return;
    }
    setDeleteBlockers((data?.blockers as string[]) || []);
  };

  const handleCancelSubscription = async (refundAmount: number) => {
    if (!cancelTarget) {
      toast.error('No subscription selected to cancel');
      return;
    }
    const label = cancelTarget.service === 'internet' ? 'Internet' : 'Cable';
    const { error } = await (supabase as any).rpc('cancel_subscription', {
      p_subscriber_id: subscriber.id,
      p_service_type: cancelTarget.service,
      p_refund_amount: refundAmount || 0,
      p_reason: null,
      p_subscription_id: cancelTarget.subscriptionId,
    });
    if (error) {
      toast.error(error.message || `Failed to cancel ${label.toLowerCase()} subscription`);
      console.error(error);
      return;
    }
    toast.success(refundAmount > 0
      ? `${label} subscription cancelled. Refund: ₹${refundAmount.toFixed(2)}`
      : `${label} subscription cancelled.`);
    setShowCancelDialog(false);
    setCancelTarget(null);
    onReload?.();
  };

  const TABS = [
    { value: 'overview',      label: 'Overview',      icon: User },
    { value: 'subscriptions', label: 'Subscriptions', icon: Calendar },
    { value: 'devices',       label: 'Devices',       icon: Tv },
    { value: 'ledger',        label: 'Ledger',        icon: Receipt },
    ...(perms.canViewCredentials ? [{ value: 'credentials', label: 'Credentials', icon: FileText }] : []),
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end gap-2">
        <Button variant="outline" size="sm" onClick={() => setShowEditDialog(true)} disabled={isArchived}>
          <Edit className="h-4 w-4 mr-2" />
          Edit
        </Button>
        {perms.isOwner && (
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              const { data, error } = await (supabase as any).rpc('reconcile_subscriber_balance', {
                p_subscriber_id: subscriber.id,
              });
              if (error) {
                toast.error(error.message || 'Reconcile failed');
                return;
              }
              const services = (data?.services || []) as any[];
              const drift = services.reduce((s, r) => s + Math.abs(Number(r.drift) || 0), 0);
              if (drift === 0) {
                toast.success('Balances are correct — no drift detected.');
              } else {
                toast.success(`Balances reconciled. Corrected drift: ₹${drift.toFixed(2)}`);
              }
              onReload?.();
            }}
            title="Recompute cable & internet balances from the ledger (Owner only)"
          >
            <Scale className="h-4 w-4 mr-2" />
            Reconcile
          </Button>
        )}
        {isArchived ? (
          perms.canArchiveCustomer && (
            <Button variant="default" size="sm" onClick={() => setShowReactivateDialog(true)}>
              <RotateCcw className="h-4 w-4 mr-2" />
              Reactivate
            </Button>
          )
        ) : (
          perms.canArchiveCustomer && (
            <Button variant="outline" size="sm" onClick={() => setShowArchiveDialog(true)}>
              <Archive className="h-4 w-4 mr-2" />
              Archive
            </Button>
          )
        )}
        <Button variant="destructive" size="sm" onClick={openDeleteDialog}>
          <Trash2 className="h-4 w-4 mr-2" />
          Delete
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList
          className="grid w-full"
          style={{ gridTemplateColumns: `repeat(${TABS.length}, minmax(0, 1fr))` }}
        >
          {TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              <t.icon className="h-4 w-4 mr-1.5" />
              <span className="hidden sm:inline">{t.label}</span>
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="overview" className="space-y-4 mt-4">
          <OverviewTab
            subscriber={subscriber}
            subscriberServices={subscriberServices}
            accountStatus={accountStatus}
            showCableTab={showCableTab}
            showInternetTab={showInternetTab}
            cableEnabled={cableEnabled}
            internetEnabled={internetEnabled}
            isArchived={isArchived}
            pairedDevices={pairedDevices}
            outstandingBySub={outstandingBySub}
            subsById={subsById}
            providerNames={providerNames}
            formatDate={formatDate}
            onAddServiceRequest={(svc) => setAddServiceTarget(svc)}
          />
        </TabsContent>

        <TabsContent value="subscriptions" className="space-y-4 mt-4">
          <SubscriptionsTab
            showCableTab={showCableTab}
            showInternetTab={showInternetTab}
            cableActives={cableActives}
            internetActives={internetActives}
            cableHistory={cableHistory}
            internetHistory={internetHistory}
          />
        </TabsContent>

        <TabsContent value="devices" className="space-y-4 mt-4">
          <DevicesTab
            subscriber={subscriber}
            showCableTab={showCableTab}
            showInternetTab={showInternetTab}
            pairedDevices={pairedDevices}
            cableActives={cableActives}
            internetActives={internetActives}
            outstandingBySub={outstandingBySub}
            providerNames={providerNames}
            lastClosedByService={lastClosedByService}
            perms={{
              canCollectPayment: perms.canCollectPayment,
              canReplaceDevice: perms.canReplaceDevice,
              canPairDevice: perms.canPairDevice,
              canCancelSubscription: perms.canCancelSubscription,
            }}
            onCollect={(t) => setCollectTarget(t)}
            onRenew={(service, deviceId) => {
              setAddPackageService(service);
              setAddPackageDeviceId(deviceId);
              setShowAddPackage(true);
            }}
            onReplace={(dev) => setReplaceDevice(dev)}
            onUnpair={(dev) => setUnpairDevice(dev)}
            onCancel={(t) => { setCancelTarget(t); setShowCancelDialog(true); }}
            onPair={(service) => setPairDialogService(service)}
          />
        </TabsContent>

        <TabsContent value="ledger" className="space-y-4 mt-4">
          <LedgerTab
            subscriber={subscriber}
            transactions={transactions}
            visibleTransactions={visibleTransactions}
            subsById={subsById}
            allocByTx={allocByTx}
            outstandingBySub={outstandingBySub}
            companyForPdf={companyForPdf}
            perms={{ canVoidTransaction: perms.canVoidTransaction }}
            showCableTab={showCableTab}
            showInternetTab={showInternetTab}
            txFilter={txFilter}
            setTxFilter={setTxFilter}
            onAddTransaction={() => setShowAddTransaction(true)}
            onOpenNotes={(tx) => { setNotesTransaction(tx); setShowNotesDialog(true); }}
            onVoid={(tx) => { setVoidingTransaction(tx); setShowVoidDialog(true); }}
          />
        </TabsContent>

        {perms.canViewCredentials && (
          <TabsContent value="credentials" className="space-y-4 mt-4">
            <CredentialsTab subscriberId={subscriber.id} />
          </TabsContent>
        )}

      </Tabs>

      {/* ---- dialogs ---------------------------------------------------- */}

      <AddTransactionDialog
        open={showAddTransaction}
        onOpenChange={setShowAddTransaction}
        onSubmit={onAddTransaction}
        subscriber={subscriber}
      />

      <EditSubscriberDialog
        open={showEditDialog}
        onOpenChange={setShowEditDialog}
        subscriber={subscriber}
        onSubmit={onEdit}
      />

      <AddPackageSubscriptionDialog
        open={showAddPackage}
        onOpenChange={(o) => { setShowAddPackage(o); if (!o) setAddPackageDeviceId(null); }}
        subscriberId={subscriber.id}
        subscriberName={subscriber.name}
        serviceType={addPackageService}
        deviceId={addPackageDeviceId}
        onSuccess={() => {
          setShowAddPackage(false);
          setAddPackageDeviceId(null);
          onReload?.();
        }}
      />

      <VoidTransactionDialog
        open={showVoidDialog}
        onOpenChange={setShowVoidDialog}
        transaction={voidingTransaction}
        onVoided={() => { onReload?.(); }}
      />

      <TransactionNotesDialog
        open={showNotesDialog}
        onOpenChange={setShowNotesDialog}
        transaction={notesTransaction}
      />

      {pairDialogService && (
        <PairDeviceDialog
          open={!!pairDialogService}
          onOpenChange={(o) => { if (!o) setPairDialogService(null); }}
          subscriberId={subscriber.id}
          subscriberName={subscriber.name}
          service={pairDialogService}
          onPaired={() => { loadPairedDevices(); loadLastClosedAssignments(); onReload?.(); }}
        />
      )}

      <UnpairDeviceDialog
        open={!!unpairDevice}
        onOpenChange={(o) => { if (!o) setUnpairDevice(null); }}
        subscriberId={subscriber.id}
        device={unpairDevice}
        onUnpaired={() => { setUnpairDevice(null); loadPairedDevices(); loadLastClosedAssignments(); onReload?.(); }}
      />

      <ReplaceDeviceDialog
        open={!!replaceDevice}
        onOpenChange={(o) => { if (!o) setReplaceDevice(null); }}
        subscriberId={subscriber.id}
        subscriberName={subscriber.name}
        oldDevice={replaceDevice}
        onReplaced={() => {
          setReplaceDevice(null);
          loadPairedDevices();
          loadOutstanding();
          loadLastClosedAssignments();
          onReload?.();
        }}
      />

      <ArchiveCustomerDialog
        open={showArchiveDialog}
        onOpenChange={setShowArchiveDialog}
        subscriber={subscriber as any}
        outstandingTotal={(subscriber.cable_balance || 0) + ((subscriber as any).internet_balance || 0)}
        activeSubscriptionCount={pairedDevices.length}
        onArchived={() => { onReload?.(); onBack?.(); }}
      />
      <ReactivateCustomerDialog
        open={showReactivateDialog}
        onOpenChange={setShowReactivateDialog}
        subscriber={subscriber as any}
        onReactivated={() => { onReload?.(); }}
      />

      {collectTarget && (
        <CollectPaymentDialog
          open={!!collectTarget}
          onOpenChange={(o) => { if (!o) setCollectTarget(null); }}
          subscriberId={subscriber.id}
          subscriberName={subscriber.name}
          service={collectTarget.service}
          subscriptionId={collectTarget.subscriptionId}
          packName={collectTarget.packName}
          outstandingForSubscription={collectTarget.outstandingForSubscription}
          serviceBalance={
            collectTarget.service === 'cable'
              ? (subscriber.cable_balance || 0)
              : ((subscriber as any).internet_balance || 0)
          }
          onCollected={() => {
            setCollectTarget(null);
            loadOutstanding();
            onReload?.();
          }}
        />
      )}

      {cancelTarget && (
        <CancelSubscriptionDialog
          open={showCancelDialog}
          onOpenChange={(o) => { setShowCancelDialog(o); if (!o) setCancelTarget(null); }}
          subscription={cancelTarget.blob as any}
          onConfirm={handleCancelSubscription}
        />
      )}

      <AlertDialog
        open={!!addServiceTarget}
        onOpenChange={(o) => { if (!o && !addingService) setAddServiceTarget(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Add {addServiceTarget === 'cable' ? 'Cable TV' : 'Internet'} service?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will enable {addServiceTarget === 'cable' ? 'Cable TV' : 'Internet'} for {subscriber.name}.
              No device will be paired — you can pair a device from the{' '}
              {addServiceTarget === 'cable' ? 'Cable' : 'Internet'} tab afterwards.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={addingService}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={addingService}
              onClick={async (e) => {
                e.preventDefault();
                if (!addServiceTarget) return;
                setAddingService(true);
                try {
                  const next = Array.from(new Set([...(subscriberServices || []), addServiceTarget]));
                  const result = await onEdit({ services: next } as any);
                  if (result === false) return;
                  toast.success(`${addServiceTarget === 'cable' ? 'Cable TV' : 'Internet'} added`);
                  setAddServiceTarget(null);
                  setActiveTab(addServiceTarget);
                  onReload?.();
                } catch (err: any) {
                  toast.error(err?.message || 'Failed to add service');
                } finally {
                  setAddingService(false);
                }
              }}
            >
              {addingService ? 'Adding…' : 'Add service'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Subscriber</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                {deleteChecking ? (
                  <p>Checking whether {subscriber.name} can be deleted…</p>
                ) : deleteBlockers && deleteBlockers.length > 0 ? (
                  <>
                    <p>
                      {subscriber.name} cannot be deleted yet. Resolve the following first:
                    </p>
                    <ul className="list-disc pl-5 space-y-1 text-sm text-foreground">
                      {deleteBlockers.map((b, i) => (
                        <li key={i}>{b}</li>
                      ))}
                    </ul>
                    <p className="text-xs text-muted-foreground">
                      Historical financial records are intentionally preserved on the immutable ledger.
                      If this subscriber has ever transacted, deletion will be blocked permanently.
                    </p>
                  </>
                ) : (
                  <p>
                    Are you sure you want to delete {subscriber.name}? This action cannot be undone.
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={onDelete}
              disabled={deleteChecking || (deleteBlockers?.length ?? 1) > 0}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
