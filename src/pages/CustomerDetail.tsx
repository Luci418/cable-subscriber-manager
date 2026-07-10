import { Loader2 } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { SubscriberDetail } from '@/components/SubscriberDetail';
import { EmptyState } from '@/components/ui-ext';
import { Button } from '@/components/ui/button';
import { useAppData } from '@/contexts/AppDataContext';

/**
 * "/customers/:id" — subscriber detail as a first-class page.
 *
 * Batch 2: routes replace the old parent-callback flow. Deep links
 * to a customer profile now work; the browser back button returns to
 * the filtered list they came from. The richer tabbed workspace
 * (Overview | Subscriptions | Devices | Ledger | Timeline) is Batch 3.
 */
export default function CustomerDetail() {
  const { id } = useParams<{ id: string }>();
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

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const subscriber = subscribers.find((s) => s.id === id);
  if (!subscriber) {
    return (
      <EmptyState
        title="Customer not found"
        description="This customer may have been removed or the link is stale."
        action={<Button onClick={() => navigate('/customers')}>Back to customers</Button>}
      />
    );
  }

  const selectedTransactions = transactions.filter((t) => t.subscriber_id === id);

  return (
    <SubscriberDetail
      subscriber={subscriber as any}
      transactions={selectedTransactions as any}
      onBack={() => navigate('/customers')}
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
