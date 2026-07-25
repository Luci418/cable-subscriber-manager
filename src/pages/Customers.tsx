import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { SubscriberList } from '@/components/SubscriberList';
import { ImportDialog } from '@/components/ImportDialog';
import { RegionManagementDialog } from '@/components/RegionManagementDialog';
import { useAppData } from '@/contexts/AppDataContext';
import { exportToCSV } from '@/lib/csv';

/**
 * Customers route — thin wrapper that owns the ancillary dialogs.
 *
 * Batch B: the list component is server-paginated and reads its own URL
 * filters, so this file no longer plumbs `initialXFilter` props. It still
 * feeds `AppData` reloads on import so the rest of the app sees fresh data.
 */
export default function Customers() {
  const navigate = useNavigate();
  const { subscribers, transactions, reloadSubscribers } = useAppData();

  const [showImport, setShowImport] = useState(false);
  const [showRegions, setShowRegions] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const handleExport = () => {
    exportToCSV(subscribers as any, transactions as any);
    toast.success('Data exported successfully!');
  };

  return (
    <>
      <SubscriberList
        onSelectSubscriber={(id) => navigate(`/customers/${id}`)}
        onAddNew={() => navigate('/customers/new')}
        onExport={handleExport}
        onImport={() => setShowImport(true)}
        onManagePacks={() => navigate('/catalog')}
        onManageRegions={() => setShowRegions(true)}
        onManageProviders={() => navigate('/catalog?tab=providers')}
        onManageStbs={() => navigate('/equipment')}
        refreshKey={refreshKey}
      />

      <ImportDialog
        open={showImport}
        onOpenChange={setShowImport}
        onSuccess={() => {
          reloadSubscribers();
          setRefreshKey((k) => k + 1);
        }}
      />
      <RegionManagementDialog open={showRegions} onOpenChange={setShowRegions} />
    </>
  );
}
