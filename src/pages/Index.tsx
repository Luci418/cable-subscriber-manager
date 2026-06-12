import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { SubscriberList } from '@/components/SubscriberList';
import { AddSubscriberForm } from '@/components/AddSubscriberForm';
import { SubscriberDetail } from '@/components/SubscriberDetail';
import { Analytics } from '@/pages/Analytics';
import { Complaints } from '@/pages/Complaints';
import { Settings } from '@/pages/Settings';
import { Billing } from '@/pages/Billing';
import { ImportDialog } from '@/components/ImportDialog';
import { PackManagementDialog } from '@/components/PackManagementDialog';
import { RegionManagementDialog } from '@/components/RegionManagementDialog';
import { ProviderManagementDialog } from '@/components/ProviderManagementDialog';
import { StbInventoryDialog } from '@/components/StbInventoryDialog';
import { useAuth } from '@/hooks/useAuth';
import { useSubscribers } from '@/hooks/useSubscribers';
import { useTransactions } from '@/hooks/useTransactions';
import { exportToCSV } from '@/lib/csv';
import { generateSubscriberId } from '@/lib/subscriberIdGenerator';
import { toast } from 'sonner';
import { Tv, BarChart3, MessageSquare, Settings as SettingsIcon, Calendar, LogOut, Loader2, Users, Wifi } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useEnabledServices } from '@/hooks/useEnabledServices';

type View = 'list' | 'add' | 'detail' | 'analytics' | 'complaints' | 'settings' | 'billing';

const Index = () => {
  const navigate = useNavigate();
  const { user, loading: authLoading, signOut } = useAuth();
  const { cableEnabled, internetEnabled, bothEnabled } = useEnabledServices();
  const { subscribers, loading: subsLoading, addSubscriber, updateSubscriber, deleteSubscriber, reloadSubscribers } = useSubscribers(user?.id);
  const { transactions, addTransaction: createTransaction, reloadTransactions } = useTransactions(user?.id);
  
  const [view, setView] = useState<View>('list');
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
    if (!authLoading && !user) {
      navigate('/auth');
    }
  }, [user, authLoading, navigate]);

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return null;
  }

  const handleAddSubscriber = async (data: any) => {
    // Generate region-based subscriber ID (e.g., NORTH-001, DOWNTOWN-002)
    const regionName = data.region || 'DEFAULT';
    const subscriberId = await generateSubscriberId(regionName, user.id);

    const services = (data.services && data.services.length > 0) ? data.services : ['cable'];

    const success = await addSubscriber({
      subscriber_id: subscriberId,
      name: data.name,
      mobile: data.mobile,
      stb_number: data.stbNumber || null,
      current_pack: null,
      region: data.region || null,
      latitude: data.latitude || null,
      longitude: data.longitude || null,
      cable_balance: 0,
      internet_balance: 0,
      services,
      join_date: new Date().toISOString(),
      current_subscription: null,
      subscription_history: [],
    } as any);

    if (success) {
      // Resolve the freshly-inserted row so we can wire up inventory rows.
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
      setView('list');
    }
  };

  const handleSelectSubscriber = (id: string) => {
    setSelectedSubscriberId(id);
    setView('detail');
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

    // Source enum: manual_charge | manual_payment | subscription_charge |
    // subscription_refund | reversal | adjustment. Manual entries route to
    // the matching source so reports can split cash vs non-cash cleanly (D7).
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
      // Phase 1 (ADR-012): the transactions_recalc_balance trigger is the
      // sole writer of cable_balance / internet_balance. We used to do a
      // second UPDATE here, which raced the trigger. Now we just reload.
      reloadSubscribers();
      toast.success('Transaction added successfully!');
    }
  };

  const handleEditSubscriber = async (updates: any) => {
    if (!selectedSubscriberId) return;
    
    const success = await updateSubscriber(selectedSubscriberId, updates);
    if (success) {
      toast.success('Subscriber updated successfully!');
    }
  };

  const handleDeleteSubscriber = async () => {
    if (!selectedSubscriberId) return;
    
    const success = await deleteSubscriber(selectedSubscriberId);
    if (success) {
      toast.success('Subscriber deleted successfully');
      setView('list');
    }
  };

  const handleExport = () => {
    exportToCSV(subscribers as any, transactions as any);
    toast.success('Data exported successfully!');
  };

  const handleImportSuccess = () => {
    reloadSubscribers();
  };

  const handleSubscriberReload = () => {
    reloadSubscribers();
    reloadTransactions();
  };

  const selectedSubscriber = selectedSubscriberId 
    ? subscribers.find(s => s.id === selectedSubscriberId)
    : null;

  const selectedTransactions = selectedSubscriberId
    ? transactions.filter(t => t.subscriber_id === selectedSubscriberId)
    : [];

  // Top-level navigation items shown in the desktop header tab strip
  // and in the mobile bottom-nav bar. Adding entries here is the only
  // place to register a new top-level page (keeps nav DRY across breakpoints).
  const navItems: { id: View; label: string; icon: typeof Users }[] = [
    { id: 'list', label: 'Subscribers', icon: Users },
    { id: 'analytics', label: 'Analytics', icon: BarChart3 },
    { id: 'billing', label: 'Billing', icon: Calendar },
    { id: 'complaints', label: 'Complaints', icon: MessageSquare },
    { id: 'settings', label: 'Settings', icon: SettingsIcon },
  ];

  // Detail/add are sub-views of "list" — highlight the Subscribers tab for them.
  const activeNav: View = view === 'detail' || view === 'add' ? 'list' : view;

  const handleNavClick = (id: View) => {
    setView(id);
    setSelectedSubscriberId(null);
  };

  // Dynamic header — reflects which service modules the operator runs.
  // Avoids the "Cable TV Manager" label feeling wrong for an internet-only or dual-service operator.
  const appTitle = bothEnabled
    ? 'Cable & Internet Manager'
    : internetEnabled && !cableEnabled
      ? 'Internet Manager'
      : 'Cable TV Manager';
  const HeaderIcon = internetEnabled && !cableEnabled ? Wifi : Tv;

  return (
    <div className="min-h-screen bg-background pb-16 md:pb-0">
      <header className="border-b bg-card sticky top-0 z-30">
        <div className="container mx-auto px-4 py-3 sm:py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="h-10 w-10 sm:h-11 sm:w-11 rounded-lg bg-primary flex items-center justify-center shrink-0">
                <HeaderIcon className="h-5 w-5 sm:h-6 sm:w-6 text-primary-foreground" />
              </div>
              <div className="min-w-0">
                <h1 className="text-lg sm:text-2xl font-bold text-foreground truncate">{appTitle}</h1>
                <p className="text-xs sm:text-sm text-muted-foreground hidden sm:block">Subscriber & Billing Management</p>
              </div>
            </div>
            <Button variant="outline" size="icon" onClick={signOut} title="Sign Out" className="shrink-0">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>

          {/* Desktop tab strip */}
          <nav className="hidden md:flex items-center gap-1 mt-3 -mb-3 overflow-x-auto scrollbar-hide">
            {navItems.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => handleNavClick(id)}
                className={cn(
                  'flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap',
                  activeNav === id
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      {/* Mobile bottom nav — keeps every feature one tap away on phones */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-30 bg-card border-t">
        <div className="grid grid-cols-5">
          {navItems.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => handleNavClick(id)}
              className={cn(
                'flex flex-col items-center justify-center gap-1 py-2 text-[10px] font-medium transition-colors',
                activeNav === id ? 'text-primary' : 'text-muted-foreground'
              )}
            >
              <Icon className="h-5 w-5" />
              <span className="leading-none">{label}</span>
            </button>
          ))}
        </div>
      </nav>

      <main className="container mx-auto px-4 py-4 sm:py-6">
        {subsLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
          <>
            {view === 'list' && (
              <SubscriberList
                subscribers={subscribers as any}
                onSelectSubscriber={handleSelectSubscriber}
                onAddNew={() => setView('add')}
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

            {view === 'add' && (
              <AddSubscriberForm
                onSubmit={handleAddSubscriber}
                onCancel={() => setView('list')}
              />
            )}

            {view === 'detail' && selectedSubscriber && (
              <SubscriberDetail
                subscriber={selectedSubscriber as any}
                transactions={selectedTransactions as any}
                onBack={() => setView('list')}
                onAddTransaction={handleAddTransaction}
                onEdit={handleEditSubscriber}
                onDelete={handleDeleteSubscriber}
                onReload={handleSubscriberReload}
              />
            )}

            {view === 'analytics' && (
              <Analytics 
                onBack={() => setView('list')} 
                onFilterPack={(pack) => { setPackFilter(pack); setRegionFilter(undefined); setBalanceFilter(undefined); }}
                onFilterRegion={(region) => { setRegionFilter(region); setPackFilter(undefined); setBalanceFilter(undefined); }}
                onFilterBalance={(status) => { setBalanceFilter(status); setPackFilter(undefined); setRegionFilter(undefined); }}
              />
            )}

            {view === 'complaints' && (
              <Complaints onBack={() => setView('list')} />
            )}

            {view === 'billing' && (
              <Billing onBack={() => setView('list')} />
            )}

            {view === 'settings' && (
              <Settings onBack={() => setView('list')} />
            )}
          </>
        )}
      </main>

      <ImportDialog
        open={showImportDialog}
        onOpenChange={setShowImportDialog}
        onSuccess={handleImportSuccess}
      />

      <PackManagementDialog
        open={showPackManagement}
        onOpenChange={setShowPackManagement}
      />

      <RegionManagementDialog
        open={showRegionManagement}
        onOpenChange={setShowRegionManagement}
      />

      <ProviderManagementDialog
        open={showProviderManagement}
        onOpenChange={setShowProviderManagement}
      />

      <StbInventoryDialog
        open={showStbInventory}
        onOpenChange={setShowStbInventory}
      />
    </div>
  );
};

export default Index;