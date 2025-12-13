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
import { StbInventoryDialog } from '@/components/StbInventoryDialog';
import { useAuth } from '@/hooks/useAuth';
import { useSubscribers } from '@/hooks/useSubscribers';
import { useTransactions } from '@/hooks/useTransactions';
import { exportToCSV } from '@/lib/csv';
import { toast } from 'sonner';
import { Tv, BarChart3, MessageSquare, Settings as SettingsIcon, MoreVertical, Calendar, LogOut, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

type View = 'list' | 'add' | 'detail' | 'analytics' | 'complaints' | 'settings' | 'billing';

const Index = () => {
  const navigate = useNavigate();
  const { user, loading: authLoading, signOut } = useAuth();
  const { subscribers, loading: subsLoading, addSubscriber, updateSubscriber, deleteSubscriber, reloadSubscribers } = useSubscribers(user?.id);
  const { transactions, addTransaction: createTransaction, reloadTransactions } = useTransactions(user?.id);
  
  const [view, setView] = useState<View>('list');
  const [selectedSubscriberId, setSelectedSubscriberId] = useState<string | null>(null);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [showPackManagement, setShowPackManagement] = useState(false);
  const [showRegionManagement, setShowRegionManagement] = useState(false);
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
    const subscriberId = `SUB${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const success = await addSubscriber({
      subscriber_id: subscriberId,
      name: data.name,
      mobile: data.mobile,
      stb_number: data.stbNumber || null,
      current_pack: null,
      region: data.region || null,
      latitude: data.latitude || null,
      longitude: data.longitude || null,
      balance: 0,
      join_date: new Date().toISOString(),
      current_subscription: null,
      subscription_history: [],
    });

    if (success) {
      toast.success('Subscriber added successfully!');
      setView('list');
    }
  };

  const handleSelectSubscriber = (id: string) => {
    setSelectedSubscriberId(id);
    setView('detail');
  };

  const handleAddTransaction = async (data: { type: 'payment' | 'charge' | 'refund'; amount: number; description: string }) => {
    if (!selectedSubscriberId) return;
    
    const subscriber = subscribers.find(s => s.id === selectedSubscriberId);
    if (!subscriber) return;

    const success = await createTransaction({
      subscriber_id: selectedSubscriberId,
      type: data.type,
      amount: data.amount,
      description: data.description,
      date: new Date().toISOString(),
    });

    if (success) {
      // Update subscriber balance (positive = debt, negative = credit)
      const currentBalance = subscriber.balance || 0;
      let newBalance = currentBalance;
      
      if (data.type === 'payment') {
        // Payment reduces debt
        newBalance = currentBalance - data.amount;
      } else if (data.type === 'charge') {
        // Charge increases debt
        newBalance = currentBalance + data.amount;
      } else if (data.type === 'refund') {
        // Refund reduces debt
        newBalance = currentBalance - data.amount;
      }

      await updateSubscriber(selectedSubscriberId, { balance: newBalance });
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

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-lg bg-primary flex items-center justify-center">
                <Tv className="h-6 w-6 text-primary-foreground" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-foreground">Cable TV Manager</h1>
                <p className="text-sm text-muted-foreground">Subscriber & Billing Management</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {view === 'list' && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="icon">
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => setView('analytics')}>
                      <BarChart3 className="mr-2 h-4 w-4" />
                      Analytics
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setView('billing')}>
                      <Calendar className="mr-2 h-4 w-4" />
                      Billing
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setView('complaints')}>
                      <MessageSquare className="mr-2 h-4 w-4" />
                      Complaints
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setView('settings')}>
                      <SettingsIcon className="mr-2 h-4 w-4" />
                      Settings
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              <Button variant="outline" size="icon" onClick={signOut} title="Sign Out">
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </header>

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

      <StbInventoryDialog
        open={showStbInventory}
        onOpenChange={setShowStbInventory}
      />
    </div>
  );
};

export default Index;