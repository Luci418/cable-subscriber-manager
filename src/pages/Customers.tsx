import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { SubscriberList } from '@/components/SubscriberList';
import { ImportDialog } from '@/components/ImportDialog';
import { RegionManagementDialog } from '@/components/RegionManagementDialog';
import { useAppDataLazy } from '@/contexts/AppDataContext';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { exportToCSV } from '@/lib/csv';

/**
 * Customers route — thin wrapper that owns the ancillary dialogs.
 *
 * The list component is server-paginated and reads its own URL filters, so
 * this page deliberately uses `useAppDataLazy`: it must NOT trigger a full
 * subscribers + transactions load just to render a paged list. Export pulls
 * the full dataset on demand instead.
 */
export default function Customers() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { reloadSubscribers } = useAppDataLazy();

  const [showImport, setShowImport] = useState(false);
  const [showRegions, setShowRegions] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    if (!user?.id || exporting) return;
    setExporting(true);
    try {
      const [subsRes, txnRes] = await Promise.all([
        supabase.from('subscribers').select('*').eq('user_id', user.id),
        supabase.from('transactions').select('*').eq('user_id', user.id),
      ]);
      if (subsRes.error || txnRes.error) {
        toast.error('Export failed — could not load data');
        return;
      }
      exportToCSV((subsRes.data ?? []) as any, (txnRes.data ?? []) as any);
      toast.success('Data exported successfully!');
    } finally {
      setExporting(false);
    }
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
