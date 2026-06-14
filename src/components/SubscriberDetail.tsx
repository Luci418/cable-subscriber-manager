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
import { ArrowLeft, Plus, Trash2, Edit, Download, Calendar, Clock, History, Pencil, Printer, FileText, RefreshCw, Tv, Wifi, Receipt, User } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useEnabledServices } from '@/hooks/useEnabledServices';
import { AddTransactionDialog } from './AddTransactionDialog';
import { EditSubscriberDialog } from './EditSubscriberDialog';
import { AddPackageSubscriptionDialog } from './AddPackageSubscriptionDialog';
import { VoidTransactionDialog } from './VoidTransactionDialog';
import { TransactionNotesDialog } from './TransactionNotesDialog';
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
import { getActives, getHistory, hasAnyActive, type SubscriptionBlob } from '@/lib/activeSubs';

interface SubscriberDetailProps {
  subscriber: Subscriber;
  transactions: Transaction[];
  onBack: () => void;
  onAddTransaction: (transaction: { type: 'payment' | 'charge'; amount: number; description: string; service_type: 'cable' | 'internet' }) => void;
  onEdit: (updates: Partial<Subscriber>) => void;
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
  const [showAddTransaction, setShowAddTransaction] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showAddPackage, setShowAddPackage] = useState(false);
  const [addPackageService, setAddPackageService] = useState<'cable' | 'internet'>('cable');
  const [showVoidDialog, setShowVoidDialog] = useState(false);
  const [voidingTransaction, setVoidingTransaction] = useState<Transaction | null>(null);
  const [showNotesDialog, setShowNotesDialog] = useState(false);
  const [notesTransaction, setNotesTransaction] = useState<Transaction | null>(null);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [cancelService, setCancelService] = useState<'cable' | 'internet'>('cable');
  const [internetDevice, setInternetDevice] = useState<any>(null);
  const [providerNames, setProviderNames] = useState<{ cable?: string; internet?: string }>({});
  const [deleteBlockers, setDeleteBlockers] = useState<string[] | null>(null);
  const [deleteChecking, setDeleteChecking] = useState(false);

  const { cableEnabled, internetEnabled } = useEnabledServices();
  const subscriberServices = subscriber.services && subscriber.services.length > 0
    ? subscriber.services
    : ['cable'];
  const showCableTab = cableEnabled && subscriberServices.includes('cable');
  const showInternetTab = internetEnabled && subscriberServices.includes('internet');
  const [activeTab, setActiveTab] = useState<string>('overview');

  // Load the assigned internet device (ONU/router) for this subscriber.
  // We query stb_inventory filtered by device_type so cable STBs and internet
  // devices stay in their own lanes.
  useEffect(() => {
    if (!showInternetTab) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('stb_inventory')
        .select('*')
        .eq('subscriber_id', subscriber.id)
        .in('device_type', ['onu', 'router'])
        .maybeSingle();
      if (!cancelled) setInternetDevice(data);
    })();
    return () => { cancelled = true; };
  }, [subscriber.id, showInternetTab]);

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
    // Phase 1 (ADR-012): cancellation goes through a single atomic RPC.
    // The server clears current_subscription, marks history cancelled, and
    // inserts the refund payment on the ledger in one transaction. The
    // balance trigger recomputes cable_balance / internet_balance — we
    // never write balance from the client.
    const isInternet = cancelService === 'internet';
    const label = isInternet ? 'Internet' : 'Cable';

    const { error } = await (supabase as any).rpc('cancel_subscription', {
      p_subscriber_id: subscriber.id,
      p_service_type: cancelService,
      p_refund_amount: refundAmount || 0,
      p_reason: null,
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
    onReload?.();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to List
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowEditDialog(true)}>
            <Edit className="h-4 w-4 mr-2" />
            Edit
          </Button>
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

              {/* Per-service balance summary — also surfaces provider + active pack
                  so operators see WHO delivers each service at a glance. */}
              <div className={`grid gap-4 ${showCableTab && showInternetTab ? 'md:grid-cols-2' : 'grid-cols-1'}`}>
                {showCableTab && (
                  <div className="rounded-lg border p-4 space-y-2">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Tv className="h-4 w-4" />
                      <span>Cable</span>
                      <span className="ml-auto text-xs">
                        {(subscriber.cable_balance || 0) >= 0 ? 'Dues' : 'Advance'}
                      </span>
                    </div>
                    <p className={`text-2xl font-bold ${getBalanceColor(subscriber.cable_balance || 0)}`}>
                      ₹{Math.abs(subscriber.cable_balance || 0).toFixed(2)}
                    </p>
                    <div className="text-xs text-muted-foreground space-y-0.5">
                      <p><span className="font-medium text-foreground">Provider:</span> {providerNames.cable || '—'}</p>
                      <p><span className="font-medium text-foreground">Pack:</span> {primaryCable?.packName || subscriber.pack || '—'}{cableActives.length > 1 && <span className="ml-1 text-muted-foreground">(+{cableActives.length - 1} more)</span>}</p>
                    </div>
                  </div>
                )}
                {showInternetTab && (
                  <div className="rounded-lg border p-4 space-y-2">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Wifi className="h-4 w-4" />
                      <span>Internet</span>
                      <span className="ml-auto text-xs">
                        {(subscriber.internet_balance || 0) >= 0 ? 'Dues' : 'Advance'}
                      </span>
                    </div>
                    <p className={`text-2xl font-bold ${getBalanceColor(subscriber.internet_balance || 0)}`}>
                      ₹{Math.abs(subscriber.internet_balance || 0).toFixed(2)}
                    </p>
                    <div className="text-xs text-muted-foreground space-y-0.5">
                      <p><span className="font-medium text-foreground">Provider:</span> {providerNames.internet || '—'}</p>
                      <p><span className="font-medium text-foreground">Plan:</span> {primaryInternet?.packName || (subscriber as any).current_internet_pack || '—'}{internetActives.length > 1 && <span className="ml-1 text-muted-foreground">(+{internetActives.length - 1} more)</span>}</p>
                    </div>
                  </div>
                )}
              </div>

            </CardContent>
          </Card>
        </TabsContent>

        {/* CABLE TAB — STB info + package subscription + history */}
        {showCableTab && (
          <TabsContent value="cable" className="space-y-4 mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Tv className="h-5 w-5" />Cable Service</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Provider</p>
                    <p className="font-medium">{providerNames.cable || 'Not assigned'}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">STB Number</p>
                    <p className="font-medium">{(subscriber as any).stb_number || subscriber.stbNumber || 'N/A'}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Current Pack</p>
                    <p className="font-medium">{subscriber.pack || 'None'}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Balance</p>
                    <p className={`font-medium ${getBalanceColor(subscriber.cable_balance || 0)}`}>
                      ₹{Math.abs(subscriber.cable_balance || 0).toFixed(2)}{' '}
                      <span className="text-xs text-muted-foreground">
                        {(subscriber.cable_balance || 0) >= 0 ? 'dues' : 'advance'}
                      </span>
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Package Subscriptions</CardTitle>
                  <Button onClick={() => { setAddPackageService('cable'); setShowAddPackage(true); }} size="sm">
                    <Plus className="h-4 w-4 mr-2" />
                    Add Package
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {cableActives.length > 0 ? (
                  <div className="space-y-4">
                    {/* One active card per active subscription. Multi-device
                        subscribers get multiple cards, one per device. */}
                    {cableActives.map((sub) => {
                      const status = getSubscriptionStatus(sub as unknown as SubscriptionEntry);
                      return (
                        <div key={sub.subscriptionId} className="rounded-lg border bg-primary/5 p-4">
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex flex-col">
                              <span className="text-sm font-medium text-muted-foreground">Active Pack</span>
                              {sub.stbNumber && (
                                <span className="text-xs text-muted-foreground">Device: <span className="font-mono">{sub.stbNumber}</span></span>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs px-2 py-1 rounded-full bg-green-500/10 text-green-700 dark:text-green-400">
                                Active
                              </span>
                              <span className={`text-xs px-2 py-1 rounded-full ${
                                status.statusColor === 'yellow'
                                  ? 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400'
                                  : 'bg-blue-500/10 text-blue-700 dark:text-blue-400'
                              }`}>
                                {status.statusText}
                              </span>
                            </div>
                          </div>
                          <h4 className="text-xl font-bold mb-3">{sub.packName}</h4>
                          <div className="grid grid-cols-2 gap-3 text-sm mb-4">
                            <div>
                              <p className="text-muted-foreground">Start Date</p>
                              <p className="font-medium">{new Date(sub.startDate).toLocaleDateString()}</p>
                            </div>
                            <div>
                              <p className="text-muted-foreground">Expiry Date</p>
                              <p className="font-medium">{new Date(sub.endDate).toLocaleDateString()}</p>
                            </div>
                            <div>
                              <p className="text-muted-foreground">Duration</p>
                              <p className="font-medium">{sub.duration || 1} months</p>
                            </div>
                            <div>
                              <p className="text-muted-foreground">Monthly Price</p>
                              <p className="font-medium">₹{(sub.packPrice || 0).toFixed(2)}</p>
                            </div>
                          </div>
                          <div className="flex gap-2 mb-2">
                            <Button
                              variant="outline"
                              size="sm"
                              className="flex-1"
                              onClick={() => {
                                generateThermalReceipt({
                                  subscriberName: subscriber.name,
                                  subscriberId: (subscriber as any).subscriber_id || subscriber.id,
                                  mobile: subscriber.mobile,
                                  stbNumber: sub.stbNumber || subscriber.stbNumber,
                                  region: subscriber.region,
                                  packName: sub.packName,
                                  packPrice: sub.packPrice || 0,
                                  duration: sub.duration || 1,
                                  startDate: sub.startDate,
                                  endDate: sub.endDate,
                                  totalAmount: (sub.packPrice || 0) * (sub.duration || 1),
                                  balance: subscriber.cable_balance || 0,
                                });
                              }}
                            >
                              <Printer className="h-4 w-4 mr-1" />
                              Thermal
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="flex-1"
                              onClick={() => {
                                generateSubscriptionInvoice({
                                  subscriberName: subscriber.name,
                                  subscriberId: (subscriber as any).subscriber_id || subscriber.id,
                                  mobile: subscriber.mobile,
                                  stbNumber: sub.stbNumber || subscriber.stbNumber,
                                  region: subscriber.region,
                                  packName: sub.packName,
                                  packPrice: sub.packPrice || 0,
                                  duration: sub.duration || 1,
                                  startDate: sub.startDate,
                                  endDate: sub.endDate,
                                  totalAmount: (sub.packPrice || 0) * (sub.duration || 1),
                                  balance: subscriber.cable_balance || 0,
                                });
                              }}
                            >
                              <FileText className="h-4 w-4 mr-1" />
                              A4 Invoice
                            </Button>
                          </div>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => {
                              setCancelService('cable');
                              setShowCancelDialog(true);
                            }}
                            className="w-full"
                          >
                            Cancel Subscription
                          </Button>
                        </div>
                      );
                    })}

                    {cableHistory.length > 0 && (
                      <>
                        <Separator />
                        <div>
                          <div className="flex items-center gap-2 mb-3">
                            <History className="h-4 w-4" />
                            <h4 className="font-semibold">Subscription History</h4>
                          </div>
                          <div className="space-y-2">
                            {cableHistory
                              .slice()
                              .sort((a, b) => new Date(b.subscribedAt).getTime() - new Date(a.subscribedAt).getTime())
                              .map((sub) => (
                                <div key={sub.subscriptionId} className="rounded-lg border p-3 text-sm">
                                  <div className="flex items-center justify-between mb-2">
                                    <span className="font-medium">{sub.packName}</span>
                                    <span className="text-xs px-2 py-1 rounded-full bg-muted text-muted-foreground">
                                      {sub.status === 'expired' ? 'Expired' : 'Cancelled'}
                                    </span>
                                  </div>
                                  <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                                    <div>
                                      <span className="block">Duration</span>
                                      <span className="font-medium text-foreground">{sub.duration}m</span>
                                    </div>
                                    <div>
                                      <span className="block">Started</span>
                                      <span className="font-medium text-foreground">
                                        {new Date(sub.startDate).toLocaleDateString()}
                                      </span>
                                    </div>
                                    <div>
                                      <span className="block">Ended</span>
                                      <span className="font-medium text-foreground">
                                        {new Date(sub.endDate).toLocaleDateString()}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              ))}
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <p>No active package subscription</p>
                    <p className="text-sm mt-1">Click "Add Package" to subscribe</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* INTERNET TAB — ONU/router device, current pack, history */}
        {showInternetTab && (
          <TabsContent value="internet" className="space-y-4 mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Wifi className="h-5 w-5" />Internet Device</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Provider</p>
                    <p className="font-medium">{providerNames.internet || 'Not assigned'}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Balance</p>
                    <p className={`font-medium ${getBalanceColor(subscriber.internet_balance || 0)}`}>
                      ₹{Math.abs(subscriber.internet_balance || 0).toFixed(2)}{' '}
                      <span className="text-xs text-muted-foreground">
                        {(subscriber.internet_balance || 0) >= 0 ? 'dues' : 'advance'}
                      </span>
                    </p>
                  </div>
                </div>
                <Separator />
                {internetDevice ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm text-muted-foreground">Device Type</p>
                      <p className="font-medium capitalize">{internetDevice.device_type || 'Router'}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Serial Number</p>
                      <p className="font-mono text-sm">{internetDevice.serial_number}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Status</p>
                      <Badge variant="secondary" className="capitalize">{internetDevice.status}</Badge>
                    </div>
                    {internetDevice.notes && (
                      <div className="md:col-span-2">
                        <p className="text-sm text-muted-foreground">Notes</p>
                        <p className="text-sm">{internetDevice.notes}</p>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-4 text-muted-foreground">
                    <Wifi className="h-8 w-8 mx-auto opacity-40 mb-2" />
                    <p>No ONU/Router assigned to this subscriber.</p>
                    <p className="text-sm mt-1">Assign one from the Inventory screen.</p>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Internet Plan</CardTitle>
                  <Button onClick={() => { setAddPackageService('internet'); setShowAddPackage(true); }} size="sm">
                    <Plus className="h-4 w-4 mr-2" />
                    Add Plan
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {internetActives.length > 0 ? (
                  <div className="space-y-4">
                    {internetActives.map((sub) => {
                      const status = getSubscriptionStatus(sub as unknown as SubscriptionEntry);
                      return (
                        <div key={sub.subscriptionId} className="rounded-lg border bg-primary/5 p-4">
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex flex-col">
                              <span className="text-sm font-medium text-muted-foreground">Active Plan</span>
                              {sub.stbNumber && (
                                <span className="text-xs text-muted-foreground">Device: <span className="font-mono">{sub.stbNumber}</span></span>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs px-2 py-1 rounded-full bg-green-500/10 text-green-700 dark:text-green-400">
                                Active
                              </span>
                              <span className={`text-xs px-2 py-1 rounded-full ${
                                status.statusColor === 'yellow'
                                  ? 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400'
                                  : 'bg-blue-500/10 text-blue-700 dark:text-blue-400'
                              }`}>
                                {status.statusText}
                              </span>
                            </div>
                          </div>
                          <h4 className="text-xl font-bold mb-3">{sub.packName}</h4>
                          <div className="grid grid-cols-2 gap-3 text-sm mb-4">
                            <div>
                              <p className="text-muted-foreground">Start Date</p>
                              <p className="font-medium">{new Date(sub.startDate).toLocaleDateString()}</p>
                            </div>
                            <div>
                              <p className="text-muted-foreground">Expiry Date</p>
                              <p className="font-medium">{new Date(sub.endDate).toLocaleDateString()}</p>
                            </div>
                            <div>
                              <p className="text-muted-foreground">Duration</p>
                              <p className="font-medium">{sub.duration || 1} months</p>
                            </div>
                            <div>
                              <p className="text-muted-foreground">Monthly Price</p>
                              <p className="font-medium">₹{(sub.packPrice || 0).toFixed(2)}</p>
                            </div>
                          </div>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => {
                              setCancelService('internet');
                              setShowCancelDialog(true);
                            }}
                            className="w-full"
                          >
                            Cancel Plan
                          </Button>
                        </div>
                      );
                    })}

                    {internetHistory.length > 0 && (
                      <>
                        <Separator />
                        <div>
                          <div className="flex items-center gap-2 mb-3">
                            <History className="h-4 w-4" />
                            <h4 className="font-semibold">Plan History</h4>
                          </div>
                          <div className="space-y-2">
                            {internetHistory
                              .slice()
                              .sort((a, b) => new Date(b.subscribedAt).getTime() - new Date(a.subscribedAt).getTime())
                              .map((sub) => (
                                <div key={sub.subscriptionId} className="rounded-lg border p-3 text-sm">
                                  <div className="flex items-center justify-between mb-2">
                                    <span className="font-medium">{sub.packName}</span>
                                    <span className="text-xs px-2 py-1 rounded-full bg-muted text-muted-foreground">
                                      {sub.status === 'expired' ? 'Expired' : 'Cancelled'}
                                    </span>
                                  </div>
                                  <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                                    <div>
                                      <span className="block">Duration</span>
                                      <span className="font-medium text-foreground">{sub.duration}m</span>
                                    </div>
                                    <div>
                                      <span className="block">Started</span>
                                      <span className="font-medium text-foreground">
                                        {new Date(sub.startDate).toLocaleDateString()}
                                      </span>
                                    </div>
                                    <div>
                                      <span className="block">Ended</span>
                                      <span className="font-medium text-foreground">
                                        {new Date(sub.endDate).toLocaleDateString()}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              ))}
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <p>No active internet plan</p>
                    <p className="text-sm mt-1">Click "Add Plan" to subscribe</p>
                  </div>
                )}
              </CardContent>
            </Card>
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
                  <Button onClick={() => setShowAddTransaction(true)} size="sm">
                    <Plus className="h-4 w-4 mr-2" />
                    Add Transaction
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {visibleTransactions.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">No transactions to show</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Service</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleTransactions.map(transaction => {
                      const svc = ((transaction as any).service_type || 'cable') as 'cable' | 'internet';
                      const status = ((transaction as any).status as string) || 'posted';
                      const source = ((transaction as any).source as string) || 'manual_charge';
                      const isVoided = status === 'voided';
                      const isReversal = status === 'reversal';
                      const isSubscriptionSourced =
                        source === 'subscription_charge' || source === 'subscription_refund';
                      const rowMuted = isVoided ? 'opacity-60 line-through' : '';
                      return (
                        <TableRow key={transaction.id} className={rowMuted}>
                          <TableCell className="text-sm">{formatDate(transaction.date)}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className="gap-1">
                              {svc === 'internet' ? <Wifi className="h-3 w-3" /> : <Tv className="h-3 w-3" />}
                              {svc === 'internet' ? 'Internet' : 'Cable'}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <Badge variant={transaction.type === 'payment' ? 'default' : 'destructive'}>
                                {transaction.type === 'payment' ? 'Cash Received' : 'Bill'}
                              </Badge>
                              {isSubscriptionSourced && (
                                <Badge variant="secondary" className="text-xs">Subscription</Badge>
                              )}
                              {isVoided && <Badge variant="outline" className="text-xs">Voided</Badge>}
                              {isReversal && <Badge variant="outline" className="text-xs">Reversal</Badge>}
                            </div>
                          </TableCell>
                          <TableCell>{transaction.description}</TableCell>
                          <TableCell className={`text-right font-semibold ${
                            transaction.type === 'payment' ? 'text-success' : 'text-destructive'
                          }`}>
                            {transaction.type === 'payment' ? '+' : '-'}₹{transaction.amount.toFixed(2)}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex gap-1 justify-end">
                              <Button variant="ghost" size="sm" onClick={() => openNotes(transaction)} title="Notes">
                                <FileText className="h-4 w-4" />
                              </Button>
                              <Button variant="ghost" size="sm" onClick={() => generateInvoicePDF(transaction, subscriber)} title="Download invoice">
                                <Download className="h-4 w-4" />
                              </Button>
                              {!isVoided && !isReversal && !isSubscriptionSourced && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="text-destructive hover:text-destructive"
                                  title="Void transaction"
                                  onClick={() => openVoid(transaction)}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}

                  </TableBody>
                </Table>
              )}
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
        onOpenChange={setShowAddPackage}
        subscriberId={subscriber.id}
        subscriberName={subscriber.name}
        serviceType={addPackageService}
        onSuccess={() => {
          setShowAddPackage(false);
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

      {(() => {
        const subForCancel = cancelService === 'internet'
          ? (subscriber as any).internet_subscription
          : (subscriber as any).current_subscription;
        return subForCancel ? (
          <CancelSubscriptionDialog
            open={showCancelDialog}
            onOpenChange={setShowCancelDialog}
            subscription={subForCancel}
            onConfirm={handleCancelSubscription}
          />
        ) : null;
      })()}

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
