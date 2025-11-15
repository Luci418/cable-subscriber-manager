import { useState, useEffect } from 'react';
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
import {
  getSubscribers,
  getSubscriberTransactions,
  addSubscriber,
  addTransaction,
  updateSubscriber,
  deleteSubscriber,
  Subscriber,
  getTransactions,
} from '@/lib/storage';
import { exportToCSV } from '@/lib/csv';
import { toast } from 'sonner';
import { Tv, BarChart3, MessageSquare, Settings as SettingsIcon, MoreVertical, Calendar } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

type View = 'list' | 'add' | 'detail' | 'analytics' | 'complaints' | 'settings' | 'billing';

const Index = () => {
  const [view, setView] = useState<View>('list');
  const [subscribers, setSubscribers] = useState<Subscriber[]>([]);
  const [selectedSubscriberId, setSelectedSubscriberId] = useState<string | null>(null);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [showPackManagement, setShowPackManagement] = useState(false);
  const [showRegionManagement, setShowRegionManagement] = useState(false);
  const [packFilter, setPackFilter] = useState<string | undefined>();
  const [regionFilter, setRegionFilter] = useState<string | undefined>();
  const [balanceFilter, setBalanceFilter] = useState<string | undefined>();

  useEffect(() => {
    loadSubscribers();
  }, []);

  const loadSubscribers = () => {
    setSubscribers(getSubscribers());
  };

  const handleAddSubscriber = (data: any) => {
    addSubscriber({ ...data, pack: 'N/A' });
    loadSubscribers();
    setView('list');
  };

  const handleSelectSubscriber = (id: string) => {
    setSelectedSubscriberId(id);
    setView('detail');
  };

  const handleAddTransaction = (data: { type: 'payment' | 'charge'; amount: number; description: string }) => {
    if (selectedSubscriberId) {
      const subscriber = subscribers.find(s => s.id === selectedSubscriberId);
      addTransaction({
        subscriberId: selectedSubscriberId,
        subscriberName: subscriber?.name || 'Unknown',
        ...data,
      });
      loadSubscribers();
    }
  };

  const handleEditSubscriber = (updates: Partial<Subscriber>) => {
    if (selectedSubscriberId) {
      updateSubscriber(selectedSubscriberId, updates);
      loadSubscribers();
    }
  };

  const handleDeleteSubscriber = () => {
    if (selectedSubscriberId) {
      deleteSubscriber(selectedSubscriberId);
      toast.success('Subscriber deleted successfully');
      setView('list');
      loadSubscribers();
    }
  };

  const handleExport = () => {
    const transactions = getTransactions();
    exportToCSV(subscribers, transactions);
    toast.success('Data exported successfully!');
  };

  const handleImportSuccess = () => {
    loadSubscribers();
  };

  const selectedSubscriber = selectedSubscriberId 
    ? subscribers.find(s => s.id === selectedSubscriberId)
    : null;

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
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-4 sm:py-6">
        {view === 'list' && (
          <SubscriberList
            subscribers={subscribers}
            onSelectSubscriber={handleSelectSubscriber}
            onAddNew={() => setView('add')}
            onExport={handleExport}
            onImport={() => setShowImportDialog(true)}
            onManagePacks={() => setShowPackManagement(true)}
            onManageRegions={() => setShowRegionManagement(true)}
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
            subscriber={selectedSubscriber}
            transactions={getSubscriberTransactions(selectedSubscriber.id)}
            onBack={() => setView('list')}
            onAddTransaction={handleAddTransaction}
            onEdit={handleEditSubscriber}
            onDelete={handleDeleteSubscriber}
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
    </div>
  );
};

export default Index;
