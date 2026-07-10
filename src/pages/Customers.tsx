import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { SubscriberList } from '@/components/SubscriberList';
import { ImportDialog } from '@/components/ImportDialog';
import { PackManagementDialog } from '@/components/PackManagementDialog';
import { RegionManagementDialog } from '@/components/RegionManagementDialog';
import { ProviderManagementDialog } from '@/components/ProviderManagementDialog';
import { useAppData } from '@/contexts/AppDataContext';
import { exportToCSV } from '@/lib/csv';

/**
 * Customers route ("/customers").
 *
 * Batch 2 improvement: filter state lives in the URL search params
 * (?pack=&region=&balance=). This makes filter views bookmarkable and
 * lets Analytics deep-link into a filtered customer list — replacing
 * the parent-passed initial filter props from the old view-state model.
 *
 * Add-subscriber and per-subscriber navigation both route away
 * (/customers/new, /customers/:id), so the URL always reflects the
 * operator's current focus.
 */
export default function Customers() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { subscribers, transactions, loading, reloadSubscribers } = useAppData();

  const [showImport, setShowImport] = useState(false);
  const [showPacks, setShowPacks] = useState(false);
  const [showRegions, setShowRegions] = useState(false);
  const [showProviders, setShowProviders] = useState(false);

  const handleExport = () => {
    exportToCSV(subscribers as any, transactions as any);
    toast.success('Data exported successfully!');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <>
      <SubscriberList
        subscribers={subscribers as any}
        onSelectSubscriber={(id) => navigate(`/customers/${id}`)}
        onAddNew={() => navigate('/customers/new')}
        onExport={handleExport}
        onImport={() => setShowImport(true)}
        onManagePacks={() => setShowPacks(true)}
        onManageRegions={() => setShowRegions(true)}
        onManageProviders={() => setShowProviders(true)}
        onManageStbs={() => navigate('/equipment')}
        initialPackFilter={params.get('pack') ?? undefined}
        initialRegionFilter={params.get('region') ?? undefined}
        initialBalanceFilter={params.get('balance') ?? undefined}
      />

      <ImportDialog open={showImport} onOpenChange={setShowImport} onSuccess={reloadSubscribers} />
      <PackManagementDialog open={showPacks} onOpenChange={setShowPacks} />
      <RegionManagementDialog open={showRegions} onOpenChange={setShowRegions} />
      <ProviderManagementDialog open={showProviders} onOpenChange={setShowProviders} />
    </>
  );
}
