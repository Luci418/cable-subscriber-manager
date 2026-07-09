import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { SubscriberList } from '@/components/SubscriberList';
import { AddSubscriberForm } from '@/components/AddSubscriberForm';
import { SubscriberDetail } from '@/components/SubscriberDetail';
import { Analytics } from '@/pages/Analytics';
import { Complaints } from '@/pages/Complaints';
import { Settings } from '@/pages/Settings';
import { Billing } from '@/pages/Billing';
import { Dashboard } from '@/components/Dashboard';
import { ImportDialog } from '@/components/ImportDialog';
import { PackManagementDialog } from '@/components/PackManagementDialog';
import { RegionManagementDialog } from '@/components/RegionManagementDialog';
import { ProviderManagementDialog } from '@/components/ProviderManagementDialog';
import { StbInventoryDialog } from '@/components/StbInventoryDialog';
import { AppShell } from '@/components/AppShell';
import type { NavId } from '@/components/AppSidebar';
import { useAuth } from '@/hooks/useAuth';
import { useSubscribers } from '@/hooks/useSubscribers';
import { useTransactions } from '@/hooks/useTransactions';
import { exportToCSV } from '@/lib/csv';
import { generateSubscriberId } from '@/lib/subscriberIdGenerator';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

/**
 * Application entry.
 *
 * Batch 1 (Phase 6.5) wraps the existing view-state machine in AppShell so the
 * new sidebar/mobile nav + design system take effect immediately. Sub-views of
 * the customer workflow (list → detail, list → add) remain internal state.
 *
 * Batch 2 will migrate this to real React Router routes; the AppShell contract
 * (active NavId + onNavigate) stays the same, so pages need no changes then.
 */
type SubView = 'list' | 'add' | 'detail';

const Index = () => {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const { subscribers, loading: subsLoading, addSubscriber, updateSubscriber, deleteSubscriber, reloadSubscribers } = useSubscribers(user?.id);
  const { transactions, addTransaction: createTransaction, reloadTransactions } = useTransactions(user?.id);

  const [nav, setNav] = useState<NavId>('dashboard');
  const [subView, setSubView] = useState<SubView>('list');
  const [selectedSubscriberId, setSelectedSubscriberId] = useState<string | null>(null);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [showPackManagement, setShowPackManagement] = useState(false);
  const [showRegionManagement, setShowRegionManagement] = useState(false);
  const [showProviderManagement, setShowProviderManagement] = useState(false);
  const [showStbInventory, setShowStbInventory] = useState(false);
  const [packFilter, setPackFilter] = useState<string | undefined>();
  const [regionFilter, setRegionFilter] = useState<string | undefined>();
  const [balanceFilter, setBalanceFilter] = useState<string | undefined>();

  useEffect(() => {
    if (!authLoading && !user) navigate('/auth');
  }, [user, authLoading, navigate]);

  // Equipment "page" is served by the inventory dialog until Batch 3 refactors
  // it into a dedicated Assets page. Selecting the nav item opens the dialog;
  // closing it returns to the previous view.
  const handleNavigate = (id: NavId) => {
    if (id === 'equipment') {
      setShowStbInventory(true);
      return;
    }
    setNav(id);
    setSelectedSubscriberId(null);
    setSubView('list');
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }
  if (!user) return null;

  const handleAddSubscriber = async (data: any) => {
    const regionName = data.region || 'DEFAULT';
    const subscriberId = await generateSubscriberId(regionName, user.id);
    const services = data.services?.length ? data.services : ['cable'];

    const success = await addSubscriber({
      subscriber_id: subscriberId,
      name: data.name,
      mobile: data.mobile,
      stb_number: data.stbNumber || null,
      region: data.region || null,
      latitude: data.latitude || null,
      longitude: data.longitude || null,
      cable_balance: 0,
      internet_balance: 0,
      services,
      join_date: new Date().toISOString(),
    } as any);

    if (success) {
      try {
        const { supabase } = await import('@/integrations/supabase/client');
        const { data: row } = await supabase
          .from('subscribers')
          .select('id')
          .eq('subscriber_id', subscriberId)
          .eq('user_id', user.id)
          .maybeSingle();
        if (row?.id) {
          if (data.stbNumber) {
            await supabase
              .from('stb_inventory')
              .update({ status: 'assigned', subscriber_id: row.id })
              .eq('user_id', user.id)
              .eq('serial_number', data.stbNumber);
          }
          if (data.internetDeviceId) {
            await supabase
              .from('stb_inventory')
              .update({ status: 'assigned', subscriber_id: row.id })
              .eq('id', data.internetDeviceId);
          }
        }
      } catch (e) {
        console.warn('Failed to assign device(s) to new subscriber:', e);
      }
      toast.success(`Subscriber ${subscriberId} added successfully!`);
      setSubView('list');
    }
  };

  const handleSelectSubscriber = (id: string) => {
    setNav('customers');
    setSelectedSubscriberId(id);
    setSubView('detail');
  };

  const handleAddTransaction = async (data: { type: 'payment' | 'charge' | 'refund' | 'adjustment'; amount: number; description: string; service_type?: 'cable' | 'internet'; provider_id?: string | null }) => {
    if (!selectedSubscriberId) return;
    const subscriber = subscribers.find(s => s.id === selectedSubscriberId);
    if (!subscriber) return;

    const svc: 'cable' | 'internet' = data.service_type
      ?? ((subscriber as any).services?.includes('internet') && !(subscriber as any).services?.includes('cable') ? 'internet' : 'cable');
    const providerId = data.provider_id
      ?? (svc === 'internet' ? (subscriber as any).internet_provider_id : (subscriber as any).cable_provider_id)
      ?? null;
    const source =
      data.type === 'payment'    ? 'manual_payment' :
      data.type === 'adjustment' ? 'adjustment'     :
                                   'manual_charge';

    const success = await createTransaction({
      subscriber_id: selectedSubscriberId,
      type: data.type,
      amount: data.amount,
      description: data.description,
      service_type: svc,
      provider_id: providerId,
      source,
      date: new Date().toISOString(),
    } as any);
    if (success) {
      reloadSubscribers();
      toast.success('Transaction added successfully!');
    }
  };

  const handleEditSubscriber = async (updates: any): Promise<boolean> => {
    if (!selectedSubscriberId) return false;
    const success = await updateSubscriber(selectedSubscriberId, updates);
    if (success) toast.success('Subscriber updated successfully!');
    return success;
  };

  const handleDeleteSubscriber = async () => {
    if (!selectedSubscriberId) return;
    const success = await deleteSubscriber(selectedSubscriberId);
    if (success) {
      toast.success('Subscriber deleted successfully');
      setSubView('list');
    }
  };

  const handleExport = () => {
    exportToCSV(subscribers as any, transactions as any);
    toast.success('Data exported successfully!');
  };

  const selectedSubscriber = selectedSubscriberId ? subscribers.find(s => s.id === selectedSubscriberId) : null;
  const selectedTransactions = selectedSubscriberId
    ? transactions.filter(t => t.subscriber_id === selectedSubscriberId)
    : [];

  const goToList = () => setSubView('list');

  return (
    <AppShell active={nav} onNavigate={handleNavigate}>
      {subsLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : (
        <>
          {nav === 'dashboard' && (
            <Dashboard
              subscribers={subscribers as any}
              transactions={transactions as any}
              onNavigate={handleNavigate}
              onSelectSubscriber={handleSelectSubscriber}
            />
          )}

          {nav === 'customers' && subView === 'list' && (
            <SubscriberList
              subscribers={subscribers as any}
              onSelectSubscriber={handleSelectSubscriber}
              onAddNew={() => setSubView('add')}
              onExport={handleExport}
              onImport={() => setShowImportDialog(true)}
              onManagePacks={() => setShowPackManagement(true)}
              onManageRegions={() => setShowRegionManagement(true)}
              onManageProviders={() => setShowProviderManagement(true)}
              onManageStbs={() => setShowStbInventory(true)}
              initialPackFilter={packFilter}
              initialRegionFilter={regionFilter}
              initialBalanceFilter={balanceFilter}
            />
          )}

          {nav === 'customers' && subView === 'add' && (
            <AddSubscriberForm onSubmit={handleAddSubscriber} onCancel={goToList} />
          )}

          {nav === 'customers' && subView === 'detail' && selectedSubscriber && (
            <SubscriberDetail
              subscriber={selectedSubscriber as any}
              transactions={selectedTransactions as any}
              onBack={goToList}
              onAddTransaction={handleAddTransaction}
              onEdit={handleEditSubscriber}
              onDelete={handleDeleteSubscriber}
              onReload={() => { reloadSubscribers(); reloadTransactions(); }}
            />
          )}

          {nav === 'analytics' && (
            <Analytics
              onBack={() => handleNavigate('dashboard')}
              onFilterPack={(p) => { setPackFilter(p); setRegionFilter(undefined); setBalanceFilter(undefined); handleNavigate('customers'); }}
              onFilterRegion={(r) => { setRegionFilter(r); setPackFilter(undefined); setBalanceFilter(undefined); handleNavigate('customers'); }}
              onFilterBalance={(b) => { setBalanceFilter(b); setPackFilter(undefined); setRegionFilter(undefined); handleNavigate('customers'); }}
            />
          )}

          {nav === 'complaints' && <Complaints onBack={() => handleNavigate('dashboard')} />}
          {nav === 'billing' && <Billing onBack={() => handleNavigate('dashboard')} />}
          {nav === 'settings' && <Settings onBack={() => handleNavigate('dashboard')} />}
        </>
      )}

      <ImportDialog open={showImportDialog} onOpenChange={setShowImportDialog} onSuccess={reloadSubscribers} />
      <PackManagementDialog open={showPackManagement} onOpenChange={setShowPackManagement} />
      <RegionManagementDialog open={showRegionManagement} onOpenChange={setShowRegionManagement} />
      <ProviderManagementDialog open={showProviderManagement} onOpenChange={setShowProviderManagement} />
      <StbInventoryDialog open={showStbInventory} onOpenChange={setShowStbInventory} />
    </AppShell>
  );
};

export default Index;
