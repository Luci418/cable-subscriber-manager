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
import { EditTransactionDialog } from './EditTransactionDialog';
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
  const [showEditTransaction, setShowEditTransaction] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [cancelService, setCancelService] = useState<'cable' | 'internet'>('cable');
  const [internetDevice, setInternetDevice] = useState<any>(null);

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

  // Active subscription accessors per service.
  const currentSub = (subscriber as any).current_subscription as SubscriptionEntry | null;
  const subscriptionStatus = getSubscriptionStatus(currentSub);
  const internetSub = (subscriber as any).internet_subscription as SubscriptionEntry | null;
  const internetStatus = getSubscriptionStatus(internetSub);

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

  const handleEditTransaction = (transaction: Transaction) => {
    setEditingTransaction(transaction);
    setShowEditTransaction(true);
  };

  const handleUpdateTransaction = (transactionId: string, updates: any) => {
    updateTransaction(transactionId, updates);
    setShowEditTransaction(false);
    setEditingTransaction(null);
    // Trigger parent component to reload data
    onBack();
  };

  const handleCancelSubscription = async (refundAmount: number) => {
    // Service-aware cancellation. Reads the matching subscription/history/balance
    // columns based on which tab triggered the cancel.
    const isInternet = cancelService === 'internet';
    const subCol = isInternet ? 'internet_subscription' : 'current_subscription';
    const histCol = isInternet ? 'internet_subscription_history' : 'subscription_history';
    const packCol = isInternet ? 'current_internet_pack' : 'current_pack';
    const balCol = isInternet ? 'internet_balance' : 'cable_balance';
    const label = isInternet ? 'Internet' : 'Cable';

    const activeSub = (subscriber as any)[subCol];
    if (!activeSub) return;

    const history = ((subscriber as any)[histCol] || []).map((sub: any) =>
      sub.id === activeSub.id ? { ...sub, status: 'cancelled', endDate: new Date().toISOString() } : sub
    );

    const currentBalance = Number((subscriber as any)[balCol] || 0);
    const newBalance = refundAmount > 0 ? currentBalance - refundAmount : currentBalance;

    const updates: Record<string, any> = {
      [subCol]: null,
      [histCol]: history,
      [packCol]: null,
      [balCol]: newBalance,
    };

    const { error } = await (supabase.from('subscribers') as any)
      .update(updates)
      .eq('id', subscriber.id);

    if (error) {
      toast.error(`Failed to cancel ${label.toLowerCase()} subscription`);
      console.error(error);
      return;
    }

    if (refundAmount > 0) {
      await supabase.from('transactions').insert({
        subscriber_id: subscriber.id,
        user_id: (subscriber as any).user_id,
        type: 'payment',
        amount: refundAmount,
        service_type: cancelService,
        description: `Refund for cancelled ${label.toLowerCase()} subscription: ${activeSub.packName}`,
        date: new Date().toISOString(),
      });
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
          <Button variant="destructive" size="sm" onClick={() => setShowDeleteDialog(true)}>
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
                <div className="flex flex-wrap gap-1.5 justify-end">
                  {subscriberServices.includes('cable') && (
                    <Badge variant="secondary" className="gap-1"><Tv className="h-3 w-3" />Cable</Badge>
                  )}
                  {subscriberServices.includes('internet') && (
                    <Badge variant="secondary" className="gap-1"><Wifi className="h-3 w-3" />Internet</Badge>
                  )}
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

              {/* Per-service balance summary */}
              <div className={`grid gap-4 ${showCableTab && showInternetTab ? 'md:grid-cols-2' : 'grid-cols-1'}`}>
                {showCableTab && (
                  <div className="rounded-lg border p-4">
                    <div className="flex items-center gap-2 mb-1 text-sm text-muted-foreground">
                      <Tv className="h-4 w-4" />
                      <span>Cable {(subscriber.cable_balance || 0) >= 0 ? 'Dues' : 'Advance'}</span>
                    </div>
                    <p className={`text-2xl font-bold ${getBalanceColor(subscriber.cable_balance || 0)}`}>
                      ₹{Math.abs(subscriber.cable_balance || 0).toFixed(2)}
                    </p>
                  </div>
                )}
                {showInternetTab && (
                  <div className="rounded-lg border p-4">
                    <div className="flex items-center gap-2 mb-1 text-sm text-muted-foreground">
                      <Wifi className="h-4 w-4" />
                      <span>Internet {(subscriber.internet_balance || 0) >= 0 ? 'Dues' : 'Advance'}</span>
                    </div>
                    <p className={`text-2xl font-bold ${getBalanceColor(subscriber.internet_balance || 0)}`}>
                      ₹{Math.abs(subscriber.internet_balance || 0).toFixed(2)}
                    </p>
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
                    <p className="text-sm text-muted-foreground">STB Number</p>
                    <p className="font-medium">{(subscriber as any).stb_number || subscriber.stbNumber || 'N/A'}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Current Pack</p>
                    <p className="font-medium">{subscriber.pack || 'None'}</p>
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
                {currentSub && subscriptionStatus.isActive ? (
                  <div className="space-y-4">
                    <div className="rounded-lg border bg-primary/5 p-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium text-muted-foreground">Active Pack</span>
                        <div className="flex items-center gap-2">
                          <span className="text-xs px-2 py-1 rounded-full bg-green-500/10 text-green-700 dark:text-green-400">
                            Active
                          </span>
                          <span className={`text-xs px-2 py-1 rounded-full ${
                            subscriptionStatus.statusColor === 'yellow'
                              ? 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400'
                              : 'bg-blue-500/10 text-blue-700 dark:text-blue-400'
                          }`}>
                            {subscriptionStatus.statusText}
                          </span>
                        </div>
                      </div>
                      <h4 className="text-xl font-bold mb-3">{currentSub.packName}</h4>
                      <div className="grid grid-cols-2 gap-3 text-sm mb-4">
                        <div>
                          <p className="text-muted-foreground">Start Date</p>
                          <p className="font-medium">{new Date(currentSub.startDate).toLocaleDateString()}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Expiry Date</p>
                          <p className="font-medium">{new Date(currentSub.endDate).toLocaleDateString()}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Duration</p>
                          <p className="font-medium">{currentSub.duration || 1} months</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Monthly Price</p>
                          <p className="font-medium">₹{(currentSub.packPrice || 0).toFixed(2)}</p>
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
                              stbNumber: subscriber.stbNumber,
                              region: subscriber.region,
                              packName: currentSub.packName,
                              packPrice: currentSub.packPrice || 0,
                              duration: currentSub.duration || 1,
                              startDate: currentSub.startDate,
                              endDate: currentSub.endDate,
                              totalAmount: (currentSub.packPrice || 0) * (currentSub.duration || 1),
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
                              stbNumber: subscriber.stbNumber,
                              region: subscriber.region,
                              packName: currentSub.packName,
                              packPrice: currentSub.packPrice || 0,
                              duration: currentSub.duration || 1,
                              startDate: currentSub.startDate,
                              endDate: currentSub.endDate,
                              totalAmount: (currentSub.packPrice || 0) * (currentSub.duration || 1),
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
                          setEditingTransaction(null);
                          setCancelService('cable');
                          setShowCancelDialog(true);
                        }}
                        className="w-full"
                      >
                        Cancel Subscription
                      </Button>
                    </div>

                    {(subscriber as any).subscription_history && (subscriber as any).subscription_history.length > 0 && (
                      <>
                        <Separator />
                        <div>
                          <div className="flex items-center gap-2 mb-3">
                            <History className="h-4 w-4" />
                            <h4 className="font-semibold">Subscription History</h4>
                          </div>
                          <div className="space-y-2">
                            {(subscriber as any).subscription_history
                              .filter((s: any) => s.id !== (subscriber as any).current_subscription?.id)
                              .sort((a: any, b: any) => new Date(b.subscribedAt).getTime() - new Date(a.subscribedAt).getTime())
                              .map((sub: any) => (
                                <div key={sub.id} className="rounded-lg border p-3 text-sm">
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
              <CardContent>
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
                  <div className="text-center py-6 text-muted-foreground">
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
                {internetSub && internetStatus.isActive ? (
                  <div className="space-y-4">
                    <div className="rounded-lg border bg-primary/5 p-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium text-muted-foreground">Active Plan</span>
                        <div className="flex items-center gap-2">
                          <span className="text-xs px-2 py-1 rounded-full bg-green-500/10 text-green-700 dark:text-green-400">
                            Active
                          </span>
                          <span className={`text-xs px-2 py-1 rounded-full ${
                            internetStatus.statusColor === 'yellow'
                              ? 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400'
                              : 'bg-blue-500/10 text-blue-700 dark:text-blue-400'
                          }`}>
                            {internetStatus.statusText}
                          </span>
                        </div>
                      </div>
                      <h4 className="text-xl font-bold mb-3">{internetSub.packName}</h4>
                      <div className="grid grid-cols-2 gap-3 text-sm mb-4">
                        <div>
                          <p className="text-muted-foreground">Start Date</p>
                          <p className="font-medium">{new Date(internetSub.startDate).toLocaleDateString()}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Expiry Date</p>
                          <p className="font-medium">{new Date(internetSub.endDate).toLocaleDateString()}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Duration</p>
                          <p className="font-medium">{internetSub.duration || 1} months</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Monthly Price</p>
                          <p className="font-medium">₹{(internetSub.packPrice || 0).toFixed(2)}</p>
                        </div>
                      </div>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => {
                          setEditingTransaction(null);
                          setCancelService('internet');
                          setShowCancelDialog(true);
                        }}
                        className="w-full"
                      >
                        Cancel Plan
                      </Button>
                    </div>

                    {(subscriber as any).internet_subscription_history && (subscriber as any).internet_subscription_history.length > 0 && (
                      <>
                        <Separator />
                        <div>
                          <div className="flex items-center gap-2 mb-3">
                            <History className="h-4 w-4" />
                            <h4 className="font-semibold">Plan History</h4>
                          </div>
                          <div className="space-y-2">
                            {(subscriber as any).internet_subscription_history
                              .filter((s: any) => s.id !== internetSub?.id)
                              .sort((a: any, b: any) => new Date(b.subscribedAt).getTime() - new Date(a.subscribedAt).getTime())
                              .map((sub: any) => (
                                <div key={sub.id} className="rounded-lg border p-3 text-sm">
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
                      return (
                        <TableRow key={transaction.id}>
                          <TableCell className="text-sm">{formatDate(transaction.date)}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className="gap-1">
                              {svc === 'internet' ? <Wifi className="h-3 w-3" /> : <Tv className="h-3 w-3" />}
                              {svc === 'internet' ? 'Internet' : 'Cable'}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Badge variant={transaction.type === 'payment' ? 'default' : 'destructive'}>
                              {transaction.type === 'payment' ? 'Cash Received' : 'Bill'}
                            </Badge>
                          </TableCell>
                          <TableCell>{transaction.description}</TableCell>
                          <TableCell className={`text-right font-semibold ${
                            transaction.type === 'payment' ? 'text-success' : 'text-destructive'
                          }`}>
                            {transaction.type === 'payment' ? '+' : '-'}₹{transaction.amount.toFixed(2)}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex gap-1 justify-end">
                              <Button variant="ghost" size="sm" onClick={() => handleEditTransaction(transaction)}>
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button variant="ghost" size="sm" onClick={() => generateInvoicePDF(transaction, subscriber)}>
                                <Download className="h-4 w-4" />
                              </Button>
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

      <EditTransactionDialog
        open={showEditTransaction}
        onOpenChange={setShowEditTransaction}
        transaction={editingTransaction}
        onSubmit={handleUpdateTransaction}
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
            <AlertDialogDescription>
              Are you sure you want to delete {subscriber.name}? This will also delete all associated transactions. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={onDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
