import { Loader2 } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { SubscriberDetail } from '@/components/SubscriberDetail';
import { EmptyState } from '@/components/ui-ext';
import { Button } from '@/components/ui/button';
import { useAppData } from '@/contexts/AppDataContext';

/**
 * "/customers/:id/:tab" — subscriber detail as a first-class page.
 *
 * Batch 3 additions:
 *  - The active tab is driven from the URL (`:tab` segment). Tab changes
 *    push a new URL entry, so browser back/forward moves between sections
 *    of the profile.
 *  - The onBack callback has been removed — the top-bar breadcrumb is now
 *    the primary way back to the customer list.
 *
 * Mutation refresh: subscriber-side mutations (payment, cancel, pair)
 * call the shared AppData reload functions so navigating back to
 * /customers or /billing renders fresh balances. Verified as part of
 * Batch 3 pre-flight — the AppDataProvider is the single source and
 * both hooks it exposes are invalidated together.
 */
const VALID_TABS = new Set(['overview', 'subscriptions', 'devices', 'ledger', 'credentials']);

export default function CustomerDetail() {
  const { id, tab } = useParams<{ id: string; tab: string }>();
  const navigate = useNavigate();
  const {
    subscribers,
    transactions,
    loading,
    updateSubscriber,
    deleteSubscriber,
    addTransaction,
    reloadSubscribers,
    reloadTransactions,
  } = useAppData();

  const activeTab = tab && VALID_TABS.has(tab) ? tab : 'overview';

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Route param `:id` carries the human-readable subscriber_id (e.g. NORTH-001)
  // so URLs are shareable. Internal DB writes still use subscriber.id (UUID).
  const subscriber = subscribers.find((s) => (s as any).subscriber_id === id);
  if (!subscriber) {
    return (
      <EmptyState
        title="Customer not found"
        description="This customer may have been removed or the link is stale."
        action={<Button onClick={() => navigate('/customers')}>Back to customers</Button>}
      />
    );
  }

  const selectedTransactions = transactions.filter((t) => t.subscriber_id === subscriber.id);

  return (
    <SubscriberDetail
      subscriber={subscriber as any}
      transactions={selectedTransactions as any}
      activeTab={activeTab}
      onTabChange={(next) => navigate(`/customers/${id}/${next}`, { replace: false })}
      onAddTransaction={async (data: any) => {
        const subAny: any = subscriber;
        const svc: 'cable' | 'internet' = data.service_type
          ?? (subAny.services?.includes('internet') && !subAny.services?.includes('cable') ? 'internet' : 'cable');
        const providerId = data.provider_id
          ?? (svc === 'internet' ? subAny.internet_provider_id : subAny.cable_provider_id)
          ?? null;
        const source =
          data.type === 'payment' ? 'manual_payment' :
          data.type === 'adjustment' ? 'adjustment' :
          'manual_charge';

        const ok = await addTransaction({
          subscriber_id: subscriber.id,
          type: data.type,
          amount: data.amount,
          description: data.description,
          service_type: svc,
          provider_id: providerId,
          source,
          date: new Date().toISOString(),
        } as any);
        if (ok) {
          reloadSubscribers();
          toast.success('Transaction added successfully!');
        }
      }}
      onEdit={async (updates: any) => {
        const ok = await updateSubscriber(subscriber.id, updates);
        if (ok) toast.success('Subscriber updated successfully!');
        return ok;
      }}
      onDelete={async () => {
        const ok = await deleteSubscriber(subscriber.id);
        if (ok) {
          toast.success('Subscriber deleted successfully');
          navigate('/customers');
        }
      }}
      onReload={() => {
        reloadSubscribers();
        reloadTransactions();
      }}
    />
  );
}
