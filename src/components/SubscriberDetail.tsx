import { useState, useEffect } from 'react';
import { Subscriber, Transaction } from '@/lib/storage';
import { generateInvoicePDF, generateThermalReceipt, generateSubscriptionInvoice } from '@/lib/pdf';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ArrowLeft, Plus, Trash2, Edit, Download, Calendar, Clock, History, Pencil, Printer, FileText, RefreshCw, Tv, Wifi, Receipt, User, Link2, Link2Off, ArrowLeftRight, Wallet } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
// Tooltip import removed in Phase 5.2/5.3 — no remaining tooltip usages.
import { useEnabledServices } from '@/hooks/useEnabledServices';
import { useSettings, settingsToCompany } from '@/contexts/SettingsContext';
import { AddTransactionDialog } from './AddTransactionDialog';
import { EditSubscriberDialog } from './EditSubscriberDialog';
import { AddPackageSubscriptionDialog } from './AddPackageSubscriptionDialog';
import { VoidTransactionDialog } from './VoidTransactionDialog';
import { TransactionNotesDialog } from './TransactionNotesDialog';
import { PairDeviceDialog } from './PairDeviceDialog';
import { UnpairDeviceDialog } from './UnpairDeviceDialog';
import { ReplaceDeviceDialog } from './ReplaceDeviceDialog';
import { CollectPaymentDialog } from './CollectPaymentDialog';
import { friendlyDbError } from '@/lib/dbErrors';
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
import { CancelSubscriptionDialog } from './CancelSubscriptionDialog';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  getSubscriptionStatus,
  SubscriptionEntry
} from '@/lib/subscriptionUtils';
import { getActives, getHistory, hasAnyActive, daysUntil, type SubscriptionBlob } from '@/lib/activeSubs';
import {
  computeOverallPosition,
  computeNextActionChip,
  chipToneClasses,
  positionToneClasses,
} from '@/lib/financialPosition';
import {
  buildLedgerEntries,
  buildGrossComponents,
  type LedgerSubscription,
  type LedgerAllocation,
  type LedgerRawTransaction,
} from '@/lib/ledgerRendering';
import { TransactionLedger } from './TransactionLedger';
import { generateAccountStatementPDF } from '@/lib/pdfStatement';
import { computeReconciliation } from '@/lib/reconciliation';
import { ArchiveCustomerDialog } from './ArchiveCustomerDialog';
import { ReactivateCustomerDialog } from './ReactivateCustomerDialog';
import { AssetTimelineCustomer } from './AssetTimelineCustomer';
import { Archive, RotateCcw } from 'lucide-react';
import { usePermissions } from '@/lib/permissions';

interface PairedDevice {
  id: string;
  serial_number: string;
  device_type: 'stb' | 'onu' | 'router';
  service_type: 'cable' | 'internet';
}

interface SubscriberDetailProps {
  subscriber: Subscriber;
  transactions: Transaction[];
  onBack: () => void;
  onAddTransaction: (transaction: { type: 'payment' | 'charge'; amount: number; description: string; service_type: 'cable' | 'internet' }) => void;
  onEdit: (updates: Partial<Subscriber>) => void | boolean | Promise<void | boolean>;
  onDelete: () => void;
  onReload?: () => void;
}

export const SubscriberDetail = ({
  subscriber,
  transactions,
  onBack,
  onAddTransaction,
  onEdit,
  onDelete,
  onReload,
}: SubscriberDetailProps) => {
  const perms = usePermissions();
  const [showAddTransaction, setShowAddTransaction] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showArchiveDialog, setShowArchiveDialog] = useState(false);
  const [showReactivateDialog, setShowReactivateDialog] = useState(false);
  const isArchived = (subscriber as any).customer_status === 'archived';
  const [showAddPackage, setShowAddPackage] = useState(false);
  const [addPackageService, setAddPackageService] = useState<'cable' | 'internet'>('cable');
  // Phase 5.1 multi-device fix: when the operator clicks Renew on a per-device
  // card, route the new subscription to THAT device via the create_subscription
  // RPC's p_device_id. Null = legacy fallback (RPC picks an assigned device).
  const [addPackageDeviceId, setAddPackageDeviceId] = useState<string | null>(null);
  const [showVoidDialog, setShowVoidDialog] = useState(false);
  const [voidingTransaction, setVoidingTransaction] = useState<Transaction | null>(null);
  const [showNotesDialog, setShowNotesDialog] = useState(false);
  const [notesTransaction, setNotesTransaction] = useState<Transaction | null>(null);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  // Phase 5.1 multi-device fix: cancel targets a specific subscription
  // (by subscriptionId) rather than "the latest active for this service".
  const [cancelTarget, setCancelTarget] = useState<{
    service: 'cable' | 'internet';
    subscriptionId: string;
    blob: SubscriptionBlob;
  } | null>(null);
  const [pairedDevices, setPairedDevices] = useState<PairedDevice[]>([]);
  const [providerNames, setProviderNames] = useState<{ cable?: string; internet?: string }>({});
  const [deleteBlockers, setDeleteBlockers] = useState<string[] | null>(null);
  const [deleteChecking, setDeleteChecking] = useState(false);
  // Item #8 — Add Service: confirmation for adding a missing service category
  // (cable / internet) to an existing subscriber. No device is paired here;
  // that remains the separate Pair Device workflow.
  const [addServiceTarget, setAddServiceTarget] = useState<'cable' | 'internet' | null>(null);
  const [addingService, setAddingService] = useState(false);

  // Pair / Unpair / Replace / Collect dialog state — Phase 5.1–5.3 workflow actions.
  const [pairDialogService, setPairDialogService] = useState<'cable' | 'internet' | null>(null);
  const [unpairDevice, setUnpairDevice] = useState<PairedDevice | null>(null);
  const [replaceDevice, setReplaceDevice] = useState<PairedDevice | null>(null);
  // Phase 5.3: bill-first Collect Payment. Carries device + subscription
  // context from the invoking card so the payment is recorded against the
  // exact subscription the operator was looking at.
  const [collectTarget, setCollectTarget] = useState<{
    service: 'cable' | 'internet';
    subscriptionId: string | null;
    packName: string | null;
    outstandingForSubscription: number;
  } | null>(null);
  // Outstanding-per-active-subscription, keyed by subscriptionId, scoped to
  // this subscriber. Computed from subscriptions.total_charged minus the
  // sum of payment_allocations against that subscription.
  const [outstandingBySub, setOutstandingBySub] = useState<Record<string, number>>({});
  const [serviceCredit, setServiceCredit] = useState<{ cable: number; internet: number }>({ cable: 0, internet: 0 });
  // Phase 5.5 — passbook rendering. Subscriptions (full snapshots) and
  // allocations (per-transaction) feed the shared `buildLedgerEntries` model.
  const [subsById, setSubsById] = useState<Record<string, LedgerSubscription>>({});
  const [allocByTx, setAllocByTx] = useState<Record<string, LedgerAllocation[]>>({});


  const { cableEnabled, internetEnabled } = useEnabledServices();
  const { settings: businessSettings } = useSettings();
  const companyForPdf = businessSettings
    ? settingsToCompany(businessSettings)
    : { name: '', address: '', phone: '', email: '', receipt_footer: '' };
  const subscriberServices = subscriber.services && subscriber.services.length > 0
    ? subscriber.services
    : ['cable'];
  const showCableTab = cableEnabled && subscriberServices.includes('cable');
  const showInternetTab = internetEnabled && subscriberServices.includes('internet');
  const [activeTab, setActiveTab] = useState<string>('overview');

  // Load ALL devices paired to this subscriber (Phase 5.1).
  // Drives the per-device cards in the Cable and Internet tabs. Multi-device
  // ready: a subscriber may have 0, 1, or many devices per service.
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

  // Authoritative reconciliation: per-subscription outstanding, per-service
  // net balance, and unallocated advance credit — all derived from the
  // immutable ledger using `computeReconciliation`. This is the SINGLE
  // source every UI surface reads, so device rows, service summaries, the
  // overall position, and Billing can never disagree.
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

    // Pull EVERY allocation for these subscriptions (not just active ones).
    // We need cancelled/expired subs too so reconciliation sees their
    // historical allocations when distinguishing live vs voided cash.
    const subIds = (subs as any[]).map((s) => s.id);
    let allocs: any[] = [];
    if (subIds.length > 0) {
      const { data } = await (supabase as any)
        .from('payment_allocations')
        .select('subscription_id,amount,transaction_id')
        .in('subscription_id', subIds);
      allocs = (data as any[]) || [];
    }

    // Reconcile using the authoritative computer. Excludes voided/reversal
    // transactions from allocation totals so a void + reversal cancel out
    // exactly the way the DB balance trigger expects.
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
    setServiceCredit({
      cable: recon.services.find((s) => s.service === 'cable')?.unallocated_credit || 0,
      internet: recon.services.find((s) => s.service === 'internet')?.unallocated_credit || 0,
    });

    // All allocations keyed by transaction_id — drives "Applied to..." rows
    // in the passbook. Scope to this subscriber's transactions.
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
    // Re-run when the transaction set changes so the allocations map and
    // outstanding-by-sub stay in sync with the passbook content.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscriber.id, transactions.length]);

  // Resolve provider names linked to this subscriber's services so the
  // operator can see WHO is delivering each service without leaving the page.
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


  // Pre-flight check before opening the destructive delete dialog. The RPC
  // returns a list of human-readable blockers (active subs, balance owed,
  // assigned devices, immutable transactions) so operators don't see the
  // generic "Validation check failed" that bubbles out of the ledger trigger.
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
    const blockers = (data?.blockers as string[]) || [];
    setDeleteBlockers(blockers);
  };


  // Server-side expiry: useSubscribers now calls the `expire_lapsed_subscriptions`
  // RPC before every fetch, and an hourly pg_cron job runs the same function.
  // No client-side lazy cleanup is needed here — the data we receive is already
  // authoritative. Kept this comment so future contributors don't re-introduce it.

  const sortedTransactions = [...transactions].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );

  const getBalanceColor = (balance: number) => {
    if (balance > 0) return 'text-success';
    if (balance < 0) return 'text-destructive';
    return 'text-muted-foreground';
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString('en-IN', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  };

  // Phase 4b: active subscriptions are ARRAYS (one entry per active sub).
  // A subscriber may have multiple active subscriptions on the same service
  // when they have multiple devices. We render each as its own card; today
  // the arrays are length 0 or 1 in most flows.
  const cableActives = getActives(subscriber, 'cable');
  const internetActives = getActives(subscriber, 'internet');
  const cableHistory = getHistory(subscriber, 'cable');
  const internetHistory = getHistory(subscriber, 'internet');

  const anyCableActive = hasAnyActive(subscriber, 'cable');
  const anyInternetActive = hasAnyActive(subscriber, 'internet');

  // Primary subscriptions used for the overview "Pack" label and provider name.
  // For a single-device subscriber this is the only active sub; for a
  // multi-device subscriber this is the most recent active one.
  const primaryCable = cableActives[0] || null;
  const primaryInternet = internetActives[0] || null;

  // Overall account status: green if any service is currently active,
  // amber if the subscriber has services but none are currently active
  // (lapsed), grey if they've onboarded with no services configured.
  const anyActive = anyCableActive || anyInternetActive;
  const accountStatus = anyActive
    ? { label: 'Active', tone: 'bg-green-500/10 text-green-700 dark:text-green-400' }
    : subscriberServices.length > 0
      ? { label: 'Lapsed', tone: 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400' }
      : { label: 'No services', tone: 'bg-muted text-muted-foreground' };

  // Per-tab transaction filtering. Legacy rows without service_type are
  // assumed to be cable so we don't lose history when the column was added.
  const cableTransactions = sortedTransactions.filter(
    (t: any) => (t.service_type || 'cable') === 'cable'
  );
  const internetTransactions = sortedTransactions.filter(
    (t: any) => t.service_type === 'internet'
  );

  // Transactions tab service filter. Defaults sensibly based on which services
  // are enabled, and auto-pivots when the user navigates from Cable/Internet tab.
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

  const openNotes = (transaction: Transaction) => {
    setNotesTransaction(transaction);
    setShowNotesDialog(true);
  };

  const openVoid = (transaction: Transaction) => {
    setVoidingTransaction(transaction);
    setShowVoidDialog(true);
  };

  // Per ADR-011 (hardened, 2026-06-08): transaction rows are fully immutable.
  // Description and source are frozen along with all financial fields. To add
  // context after the fact, operators use transaction_notes (append-only).
  // Voids are handled by VoidTransactionDialog via the void_transaction RPC.
  //
  // Per ADR-012 (Phase 1, 2026-06-09): cable_balance / internet_balance are
  // never written from the client. The transactions_recalc_balance trigger
  // recomputes them from the immutable ledger on every change.



  const handleCancelSubscription = async (refundAmount: number) => {
    // Phase 5.1 multi-device fix: pass p_subscription_id so the server
    // cancels the EXACT subscription the operator clicked on, not the
    // "latest active for this service" (which would corrupt sibling
    // device subscriptions).
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


  // -----------------------------------------------------------------------
  // Phase 5.1: per-service "Devices" card. Each paired device gets its own
  // card with the matched active subscription summary and workflow buttons:
  //   - Collect Payment (disabled — wired in Phase 5.3)
  //   - Renew           (opens AddPackageSubscriptionDialog)
  //   - Replace Device  (disabled — UI in Phase 5.2; RPC already exists)
  //   - Unpair          (opens UnpairDeviceDialog -> unpair_device RPC)
  // Pair Device CTA appears at the bottom of the card list. Multi-device
  // ready: the list grows as more devices are paired to the same service.
  // -----------------------------------------------------------------------
  const renderDevicesCard = (service: 'cable' | 'internet') => {
    const isCable = service === 'cable';
    const devicesForService = pairedDevices.filter((d) => d.service_type === service);
    const actives = isCable ? cableActives : internetActives;
    const balance = isCable
      ? (subscriber.cable_balance || 0)
      : ((subscriber as any).internet_balance || 0);
    const provider = isCable ? providerNames.cable : providerNames.internet;
    const Icon = isCable ? Tv : Wifi;
    const title = isCable ? 'Cable' : 'Internet';

    // Unmatched actives = active subscription with no deviceId or with a
    // deviceId that isn't in our paired list. Render them as ghost cards so
    // they're never invisible. Multi-device safety net.
    const matchedActiveIds = new Set(
      devicesForService
        .map((d) => actives.find((a) => a.deviceId === d.id)?.subscriptionId)
        .filter(Boolean) as string[]
    );
    const orphanActives = actives.filter(
      (a) => !a.subscriptionId || !matchedActiveIds.has(a.subscriptionId)
    );

    return (
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <CardTitle className="flex items-center gap-2"><Icon className="h-5 w-5" />{title}</CardTitle>
            <div className="text-xs text-muted-foreground text-right">
              <p>Provider: <span className="font-medium text-foreground">{provider || '—'}</span></p>
              <p>
                Balance:{' '}
                <span className={`font-medium ${getBalanceColor(balance)}`}>
                  ₹{Math.abs(balance).toFixed(2)} {balance >= 0 ? 'dues' : 'advance'}
                </span>
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {devicesForService.length === 0 && orphanActives.length === 0 ? (
            <div className="text-center py-6 text-muted-foreground">
              <Icon className="h-8 w-8 mx-auto opacity-40 mb-2" />
              <p className="text-sm">No device paired</p>
            </div>
          ) : (
            <>
              {devicesForService.map((dev) => {
                const sub = actives.find((a) => a.deviceId === dev.id) || null;
                const daysLeft = sub ? daysUntil(sub.endDate) : null;
                const subStatus = sub ? getSubscriptionStatus(sub as unknown as SubscriptionEntry) : null;

                return (
                  <div key={dev.id} className="rounded-lg border p-3 space-y-3">
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono font-medium">{dev.serial_number}</span>
                          <Badge variant="outline" className="text-xs uppercase">{dev.device_type}</Badge>
                        </div>
                        {sub ? (
                          <p className="text-sm mt-1">
                            <span className="text-muted-foreground">Active — </span>
                            <span className="font-medium">{sub.packName}</span>
                            {daysLeft !== null && (
                              <span className={`ml-2 text-xs ${
                                daysLeft < 0
                                  ? 'text-destructive'
                                  : daysLeft <= 3
                                    ? 'text-yellow-600 dark:text-yellow-400'
                                    : 'text-muted-foreground'
                              }`}>
                                {daysLeft < 0
                                  ? `Expired ${Math.abs(daysLeft)}d ago`
                                  : daysLeft === 0
                                    ? 'Expires today'
                                    : `${daysLeft}d remaining`}
                              </span>
                            )}
                          </p>
                        ) : (
                          <p className="text-sm mt-1 text-muted-foreground">No active subscription</p>
                        )}
                      </div>
                      {sub ? (
                        <Badge className={
                          subStatus?.statusColor === 'yellow'
                            ? 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 hover:bg-yellow-500/10'
                            : 'bg-green-500/10 text-green-700 dark:text-green-400 hover:bg-green-500/10'
                        }>
                          {subStatus?.statusText || 'Active'}
                        </Badge>
                      ) : (
                        <Badge variant="outline">Idle</Badge>
                      )}
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!perms.canCollectPayment}
                        title={!perms.canCollectPayment ? 'You do not have permission to collect payments' : undefined}
                        onClick={() => {
                          // Phase 5.3: bill-first Collect Payment. Pass the
                          // exact subscription on THIS device card so the
                          // dialog can show this device's bill at the top.
                          setCollectTarget({
                            service,
                            subscriptionId: sub?.subscriptionId || null,
                            packName: sub?.packName || null,
                            outstandingForSubscription:
                              sub?.subscriptionId
                                ? (outstandingBySub[sub.subscriptionId] || 0)
                                : 0,
                          });
                        }}
                      >
                        <Wallet className="h-3.5 w-3.5 mr-1.5" />Collect
                      </Button>

                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          // Phase 5.1 multi-device fix: pin the renew to THIS device.
                          setAddPackageService(service);
                          setAddPackageDeviceId(dev.id);
                          setShowAddPackage(true);
                        }}
                      >
                        <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                        {sub ? 'Renew' : 'Subscribe'}
                      </Button>

                      {perms.canReplaceDevice && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setReplaceDevice(dev)}
                        >
                          <ArrowLeftRight className="h-3.5 w-3.5 mr-1.5" />Replace
                        </Button>
                      )}

                      {perms.canPairDevice && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setUnpairDevice(dev)}
                        >
                          <Link2Off className="h-3.5 w-3.5 mr-1.5" />Unpair
                        </Button>
                      )}
                    </div>

                    {sub && perms.canCancelSubscription && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-full text-destructive hover:text-destructive"
                        onClick={() => {
                          // Phase 5.1 multi-device fix: target the exact
                          // subscription on this device card.
                          setCancelTarget({
                            service,
                            subscriptionId: sub.subscriptionId,
                            blob: sub,
                          });
                          setShowCancelDialog(true);
                        }}
                      >
                        Cancel Subscription
                      </Button>
                    )}
                  </div>
                );
              })}

              {orphanActives.map((sub) => (
                <div key={sub.subscriptionId} className="rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-3 text-sm">
                  <p className="font-medium">{sub.packName}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Active subscription with no paired device (legacy data). Use the inventory screen to reconcile.
                  </p>
                </div>
              ))}
            </>
          )}

          {perms.canPairDevice && (
            <Button
              variant="default"
              size="sm"
              className="w-full"
              onClick={() => setPairDialogService(service)}
            >
              <Link2 className="h-4 w-4 mr-1.5" />
              {devicesForService.length === 0 ? 'Pair Device' : 'Pair Another Device'}
            </Button>
          )}
        </CardContent>
      </Card>
    );
  };

  // History item rendering — Bug 2 fix. For cancelled subscriptions show the
  // ACTUAL service period (start_date → cancelled_at) rather than the
  // originally scheduled validity, and surface the original validity as a
  // separate reference line so operators see both. Expired subs continue to
  // use the validity window since end_date IS the actual end for those.
  const renderHistoryItem = (sub: SubscriptionBlob) => {
    const start = new Date(sub.startDate);
    const isCancelled = sub.status === 'cancelled';
    const cancelledAt = sub.cancelledAt ? new Date(sub.cancelledAt) : null;
    const scheduledEnd = new Date(sub.endDate);
    const actualEnd = isCancelled && cancelledAt ? cancelledAt : scheduledEnd;
    const dayMs = 1000 * 60 * 60 * 24;
    const actualDays = Math.max(0, Math.floor((actualEnd.getTime() - start.getTime()) / dayMs));
    const fmt = (d: Date) => d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    const fmtShort = (d: Date) => d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
    const statusLabel = isCancelled
      ? `Cancelled after ${actualDays} day${actualDays === 1 ? '' : 's'}`
      : sub.status === 'expired' ? 'Expired' : 'Ended';
    const statusTone = isCancelled
      ? 'bg-red-500/10 text-red-700 dark:text-red-400'
      : 'bg-muted text-muted-foreground';
    return (
      <div key={sub.subscriptionId} className="rounded-lg border p-3 text-sm space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className="font-medium">{sub.packName}</span>
          <span className={`text-xs px-2 py-1 rounded-full ${statusTone}`}>
            {isCancelled ? 'Cancelled' : 'Expired'}
          </span>
        </div>
        {isCancelled && cancelledAt && (
          <p className="text-xs text-muted-foreground">
            Cancelled on <span className="font-medium text-foreground">{fmt(cancelledAt)}</span>
          </p>
        )}
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <span className="block text-muted-foreground">Original validity</span>
            <span className="font-medium text-foreground">
              {fmtShort(start)} – {fmtShort(scheduledEnd)}
            </span>
          </div>
          <div>
            <span className="block text-muted-foreground">Status</span>
            <span className="font-medium text-foreground">{statusLabel}</span>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to List
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowEditDialog(true)} disabled={isArchived}>
            <Edit className="h-4 w-4 mr-2" />
            Edit
          </Button>
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
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full" style={{ gridTemplateColumns: `repeat(${2 + (showCableTab ? 1 : 0) + (showInternetTab ? 1 : 0)}, minmax(0, 1fr))` }}>
          <TabsTrigger value="overview"><User className="h-4 w-4 mr-1.5" />Overview</TabsTrigger>
          {showCableTab && <TabsTrigger value="cable"><Tv className="h-4 w-4 mr-1.5" />Cable</TabsTrigger>}
          {showInternetTab && <TabsTrigger value="internet"><Wifi className="h-4 w-4 mr-1.5" />Internet</TabsTrigger>}
          <TabsTrigger value="transactions"><Receipt className="h-4 w-4 mr-1.5" />Transactions</TabsTrigger>
        </TabsList>

        {/* OVERVIEW TAB — subscriber profile + per-service balance summary */}
        <TabsContent value="overview" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <div className="flex justify-between items-start">
                <div>
                  <CardTitle className="text-2xl">{subscriber.name}</CardTitle>
                  <p className="text-muted-foreground mt-1">
                    <span className="font-mono text-sm bg-muted px-2 py-0.5 rounded">
                      ID: {(subscriber as any).subscriber_id || 'N/A'}
                    </span>
                  </p>
                  <p className="text-muted-foreground mt-2">{subscriber.mobile}</p>
                </div>
                <div className="flex flex-col items-end gap-1.5">
                  <span className={`text-xs px-2 py-1 rounded-full ${accountStatus.tone}`}>
                    {accountStatus.label}
                  </span>
                  <div className="flex flex-wrap gap-1.5 justify-end">
                    {subscriberServices.includes('cable') && (
                      <Badge variant="secondary" className="gap-1"><Tv className="h-3 w-3" />Cable</Badge>
                    )}
                    {subscriberServices.includes('internet') && (
                      <Badge variant="secondary" className="gap-1"><Wifi className="h-3 w-3" />Internet</Badge>
                    )}
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Region/Cluster</p>
                  <p className="font-medium">{subscriber.region || 'N/A'}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Joined</p>
                  <p className="font-medium">
                    {(subscriber as any).join_date
                      ? formatDate((subscriber as any).join_date)
                      : (subscriber.createdAt ? formatDate(subscriber.createdAt) : 'N/A')}
                  </p>
                </div>
                {subscriber.latitude && subscriber.longitude && (
                  <div className="md:col-span-2">
                    <p className="text-sm text-muted-foreground">Location Coordinates</p>
                    <p className="font-medium">
                      📍 Lat: {(subscriber.latitude || 0).toFixed(6)}, Long: {(subscriber.longitude || 0).toFixed(6)}
                    </p>
                  </div>
                )}
              </div>

              <Separator />

              {/* BUSINESS_MODEL §G1 — overall financial position + per-device breakdown.
                  The operator must read total + composition without scrolling and
                  without arithmetic. Labels are mandatory: never raw signed numbers.
                  §G5 next-action chip is shown alongside the position. */}
              {(() => {
                const position = computeOverallPosition(subscriber);
                const chip = computeNextActionChip(subscriber);
                const gross = buildGrossComponents(subscriber as any, outstandingBySub, subsById);
                // Show gross components only when both debt AND credit coexist
                // (the case where net hides reality). Single-sided positions
                // are already self-explanatory from the label above.
                const hasDebt = gross.some((g) => g.kind === 'outstanding');
                const hasCredit = gross.some((g) => g.kind === 'available_credit' || g.kind === 'service_credit');
                const showGross = hasDebt && hasCredit;
                return (
                  <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">Overall position</p>
                        <p className={`text-2xl font-bold ${positionToneClasses(position.kind)}`}>
                          {position.label}
                        </p>
                        {showGross && (
                          <p className="text-xs text-muted-foreground mt-1">
                            {gross.map((g) => g.label).join(' · ')}
                          </p>
                        )}
                      </div>
                      <span
                        className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border ${chipToneClasses(chip.tone)}`}
                      >
                        <span aria-hidden>{chip.icon}</span>
                        {chip.label}
                      </span>
                    </div>

                    {/* Per-device composition — one line per active sub per service.
                        Renders even at zero so the operator sees what makes up Settled. */}
                    <div className="space-y-2 text-sm">
                      {position.breakdown.map((svc) => {
                        const svcLabel = svc.service === 'cable' ? 'Cable TV' : 'Internet';
                        const ServiceIcon = svc.service === 'cable' ? Tv : Wifi;
                        const devices = pairedDevices.filter((d) => d.service_type === svc.service);
                        // Build per-device rows. Match each device to its active sub
                        // (if any), then use per-sub outstanding when available.
                        const rows = devices.map((dev) => {
                          const sub = svc.actives.find((a) => a.deviceId === dev.id);
                          const outstanding = sub?.subscriptionId
                            ? (outstandingBySub[sub.subscriptionId] || 0)
                            : 0;
                          const daysLeft = sub ? daysUntil(sub.endDate) : null;
                          let statusText: string;
                          let statusClass = 'text-muted-foreground';
                          if (!sub) {
                            statusText = 'No active subscription';
                            statusClass = 'text-yellow-700 dark:text-yellow-400';
                          } else if (daysLeft !== null && daysLeft < 0) {
                            statusText = `Expired ${Math.abs(daysLeft)}d ago${outstanding > 0 ? ` · ₹${outstanding.toFixed(0)} due` : ''}`;
                            statusClass = 'text-red-700 dark:text-red-400';
                          } else if (outstanding > 0) {
                            statusText = `₹${outstanding.toFixed(0)} due`;
                            statusClass = 'text-red-700 dark:text-red-400';
                          } else {
                            statusText = 'Settled';
                          }
                          return {
                            key: dev.id,
                            primary: `${dev.serial_number}${sub?.packName ? ` (${sub.packName})` : ''}`,
                            statusText,
                            statusClass,
                          };
                        });
                        // Orphan actives (sub with no/unknown device) so we don't hide them.
                        svc.actives
                          .filter((a) => !a.deviceId || !devices.some((d) => d.id === a.deviceId))
                          .forEach((a) => {
                            const outstanding = a.subscriptionId
                              ? (outstandingBySub[a.subscriptionId] || 0)
                              : 0;
                            rows.push({
                              key: a.subscriptionId,
                              primary: `${a.packName} (no device)`,
                              statusText: outstanding > 0 ? `₹${outstanding.toFixed(0)} due` : 'Settled',
                              statusClass: outstanding > 0 ? 'text-red-700 dark:text-red-400' : 'text-muted-foreground',
                            });
                          });
                        // Net per-service balance label (using §G1 vocab).
                        const svcNet = svc.balance;
                        const svcSummary =
                          svcNet > 0 ? `Outstanding ₹${svcNet.toFixed(0)}` :
                          svcNet < 0 ? `Available Credit ₹${Math.abs(svcNet).toFixed(0)}` :
                          'Settled';
                        return (
                          <div key={svc.service} className="rounded-md bg-background/60 p-3 border">
                            <div className="flex items-center justify-between mb-1.5">
                              <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                                <ServiceIcon className="h-3.5 w-3.5" /> {svcLabel}
                              </div>
                              <span className={`text-xs font-medium ${positionToneClasses(svcNet > 0 ? 'outstanding' : svcNet < 0 ? 'available_credit' : 'settled')}`}>
                                {svcSummary}
                              </span>
                            </div>
                            {rows.length === 0 ? (
                              <p className="text-xs text-muted-foreground">No device paired</p>
                            ) : (
                              <ul className="space-y-0.5">
                                {rows.map((r) => (
                                  <li key={r.key} className="flex items-center justify-between gap-2 text-xs">
                                    <span className="font-mono truncate">{r.primary}</span>
                                    <span className={`shrink-0 ${r.statusClass}`}>{r.statusText}</span>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      Provider:{' '}
                      {showCableTab && <span className="mr-2"><Tv className="inline h-3 w-3 mr-0.5" />{providerNames.cable || '—'}</span>}
                      {showInternetTab && <span><Wifi className="inline h-3 w-3 mr-0.5" />{providerNames.internet || '—'}</span>}
                    </p>
                  </div>
                );
              })()}


            </CardContent>
          </Card>

          {/* Asset Timeline — previous devices (history). Currently paired
              devices remain rendered as their own cards in the service tabs. */}
          <AssetTimelineCustomer subscriberId={subscriber.id} />

          {/* Item #8 — Add Service: regression fix for Phase 5.1 removal of the
              services[] checkboxes from EditSubscriberDialog. Only shown when
              the customer is missing a globally-enabled service category. */}
          {(() => {
            const missing: ('cable' | 'internet')[] = [];
            if (cableEnabled && !subscriberServices.includes('cable')) missing.push('cable');
            if (internetEnabled && !subscriberServices.includes('internet')) missing.push('internet');
            if (missing.length === 0 || isArchived) return null;
            return (
              <Card>
                <CardContent className="p-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">Add another service</p>
                    <p className="text-xs text-muted-foreground">
                      This customer does not have {missing.map((m) => (m === 'cable' ? 'Cable TV' : 'Internet')).join(' or ')} yet.
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {missing.map((svc) => {
                      const SvcIcon = svc === 'cable' ? Tv : Wifi;
                      return (
                        <Button
                          key={svc}
                          size="sm"
                          variant="outline"
                          onClick={() => setAddServiceTarget(svc)}
                        >
                          <Plus className="h-4 w-4 mr-1" />
                          <SvcIcon className="h-4 w-4 mr-1" />
                          Add {svc === 'cable' ? 'Cable TV' : 'Internet'}
                        </Button>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            );
          })()}
        </TabsContent>

        {/* CABLE TAB — STB info + package subscription + history */}
        {showCableTab && (
          <TabsContent value="cable" className="space-y-4 mt-4">
            {renderDevicesCard('cable')}

            {cableHistory.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <History className="h-4 w-4" /> Subscription History
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {cableHistory
                      .slice()
                      .sort((a, b) => new Date(b.subscribedAt).getTime() - new Date(a.subscribedAt).getTime())
                      .map((sub) => renderHistoryItem(sub))}
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        )}

        {/* INTERNET TAB — ONU/router device, current pack, history */}
        {showInternetTab && (
          <TabsContent value="internet" className="space-y-4 mt-4">
            {renderDevicesCard('internet')}

            {internetHistory.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <History className="h-4 w-4" /> Plan History
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {internetHistory
                      .slice()
                      .sort((a, b) => new Date(b.subscribedAt).getTime() - new Date(a.subscribedAt).getTime())
                      .map((sub) => renderHistoryItem(sub))}
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        )}

        {/* TRANSACTIONS TAB — service filter pivots between Cable / Internet / All */}
        <TabsContent value="transactions" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <div className="flex flex-wrap justify-between items-center gap-3">
                <CardTitle>Transaction History</CardTitle>
                <div className="flex items-center gap-2">
                  {(showCableTab || showInternetTab) && (
                    <div className="inline-flex rounded-md border bg-muted/40 p-0.5">
                      <Button
                        type="button"
                        variant={txFilter === 'all' ? 'secondary' : 'ghost'}
                        size="sm"
                        className="h-7 px-3"
                        onClick={() => setTxFilter('all')}
                      >
                        All
                      </Button>
                      {showCableTab && (
                        <Button
                          type="button"
                          variant={txFilter === 'cable' ? 'secondary' : 'ghost'}
                          size="sm"
                          className="h-7 px-3"
                          onClick={() => setTxFilter('cable')}
                        >
                          <Tv className="h-3.5 w-3.5 mr-1" />Cable
                        </Button>
                      )}
                      {showInternetTab && (
                        <Button
                          type="button"
                          variant={txFilter === 'internet' ? 'secondary' : 'ghost'}
                          size="sm"
                          className="h-7 px-3"
                          onClick={() => setTxFilter('internet')}
                        >
                          <Wifi className="h-3.5 w-3.5 mr-1" />Internet
                        </Button>
                      )}
                    </div>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const rawTxs: LedgerRawTransaction[] = transactions.map((t: any) => ({
                        id: t.id,
                        date: t.date,
                        type: t.type,
                        amount: Number(t.amount) || 0,
                        description: t.description ?? null,
                        service_type: (t.service_type as any) ?? null,
                        source: t.source ?? 'manual_charge',
                        status: t.status ?? 'posted',
                        payment_method: t.payment_method ?? null,
                        subscription_id: t.subscription_id ?? null,
                        reverses_transaction_id: t.reverses_transaction_id ?? null,
                        void_reason: t.void_reason ?? null,
                        void_reason_code: t.void_reason_code ?? null,
                      }));
                      const entries = buildLedgerEntries(rawTxs, subsById, allocByTx);
                      const position = computeOverallPosition(subscriber);
                      const gross = buildGrossComponents(
                        subscriber as any,
                        outstandingBySub,
                        subsById,
                      );
                      generateAccountStatementPDF({
                        subscriber,
                        entries,
                        positionLabel: position.label,
                        grossComponents: gross,
                        company: companyForPdf,
                      });
                    }}
                  >
                    <Download className="h-4 w-4 mr-2" />
                    Download Statement
                  </Button>
                  <Button onClick={() => setShowAddTransaction(true)} size="sm">
                    <Plus className="h-4 w-4 mr-2" />
                    Add Transaction
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {(() => {
                // Phase 5.5 — passbook. Convert raw rows into business events
                // via the shared rendering model. Same model feeds the PDF.
                const rawTxs: LedgerRawTransaction[] = visibleTransactions.map((t: any) => ({
                  id: t.id,
                  date: t.date,
                  type: t.type,
                  amount: Number(t.amount) || 0,
                  description: t.description ?? null,
                  service_type: (t.service_type as any) ?? null,
                  source: t.source ?? 'manual_charge',
                  status: t.status ?? 'posted',
                  payment_method: t.payment_method ?? null,
                  subscription_id: t.subscription_id ?? null,
                  reverses_transaction_id: t.reverses_transaction_id ?? null,
                  void_reason: t.void_reason ?? null,
                  void_reason_code: t.void_reason_code ?? null,
                }));
                const entries = buildLedgerEntries(rawTxs, subsById, allocByTx);
                return (
                  <TransactionLedger
                    entries={entries}
                    onOpenNotes={(txId) => {
                      const tx = transactions.find((t) => t.id === txId);
                      if (tx) openNotes(tx);
                    }}
                    onVoid={(txId) => {
                      const tx = transactions.find((t) => t.id === txId);
                      if (tx) openVoid(tx);
                    }}
                    canVoid={(e) =>
                      !e.voided &&
                      e.kind !== 'subscription_activated' &&
                      e.kind !== 'subscription_renewed' &&
                      e.kind !== 'subscription_refund'
                    }
                  />
                );
              })()}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

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
          onPaired={() => { loadPairedDevices(); onReload?.(); }}
        />
      )}

      <UnpairDeviceDialog
        open={!!unpairDevice}
        onOpenChange={(o) => { if (!o) setUnpairDevice(null); }}
        subscriberId={subscriber.id}
        device={unpairDevice}
        onUnpaired={() => { setUnpairDevice(null); loadPairedDevices(); onReload?.(); }}
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
          onReload?.();
        }}
      />

      <ArchiveCustomerDialog
        open={showArchiveDialog}
        onOpenChange={setShowArchiveDialog}
        subscriber={subscriber as any}
        outstandingTotal={(subscriber.cable_balance || 0) + ((subscriber as any).internet_balance || 0)}
        activeSubscriptionCount={pairedDevices.length /* approximate; archive RPC re-counts authoritatively */}
        onArchived={() => { onReload?.(); onBack(); }}
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

      {/* Item #8 — confirm adding a new service category to this subscriber. */}
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
                  // onEdit returns false when the DB write is rejected (e.g. by an
                  // invariants trigger). Treat only an explicit `false` as failure —
                  // legacy callers return void, which we optimistically accept.
                  if (result === false) {
                    // The hook already surfaced a specific error toast.
                    return;
                  }
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
