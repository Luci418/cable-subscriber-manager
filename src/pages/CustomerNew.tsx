import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { AddSubscriberForm } from '@/components/AddSubscriberForm';
import { useAuth } from '@/hooks/useAuth';
import { useAppData } from '@/contexts/AppDataContext';
import { generateSubscriberId } from '@/lib/subscriberIdGenerator';

/**
 * "/customers/new" — dedicated route for creating a subscriber.
 *
 * Making this a real page (rather than a modal off the list) lets
 * operators bookmark or link to onboarding, and the browser Back button
 * returns to the list they came from. On success we route to the newly
 * created customer's profile so onboarding flows straight into billing
 * setup without an extra click.
 */
export default function CustomerNew() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { addSubscriber } = useAppData();

  const handleSubmit = async (data: any) => {
    if (!user) return;
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

    if (!success) return;

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
        toast.success(`Subscriber ${subscriberId} added successfully!`);
        navigate(`/customers/${row.subscriber_id}`);
        return;
      }
    } catch (e) {
      console.warn('Failed to assign device(s) to new subscriber:', e);
    }
    toast.success(`Subscriber ${subscriberId} added successfully!`);
    navigate('/customers');
  };

  return <AddSubscriberForm onSubmit={handleSubmit} onCancel={() => navigate('/customers')} />;
}
