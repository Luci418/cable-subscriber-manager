import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Loader2, Tv, Wifi } from 'lucide-react';

type ServiceType = 'cable' | 'internet';

interface PairDeviceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subscriberId: string;
  subscriberName: string;
  service: ServiceType;
  onPaired?: () => void;
}

interface AvailableDevice {
  id: string;
  serial_number: string;
  device_type: 'stb' | 'onu' | 'router';
  service_type: ServiceType;
  created_at: string;
  notes: string | null;
}

const deviceLabel: Record<string, string> = { stb: 'STB', onu: 'ONU', router: 'Router' };

export const PairDeviceDialog = ({
  open,
  onOpenChange,
  subscriberId,
  subscriberName,
  service,
  onPaired,
}: PairDeviceDialogProps) => {
  const { user } = useAuth();
  const [devices, setDevices] = useState<AvailableDevice[]>([]);
  const [loading, setLoading] = useState(false);
  const [pairingId, setPairingId] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !user?.id) return;
    let cancelled = false;
    setLoading(true);
    // Query is the enforcement: only status='available' AND matching service_type.
    // Faulty / assigned / decommissioned are excluded at the query level, not by UI hiding.
    (async () => {
      const { data, error } = await supabase
        .from('stb_inventory')
        .select('id, serial_number, device_type, service_type, created_at, notes')
        .eq('user_id', user.id)
        .eq('status', 'available')
        .eq('service_type', service)
        .order('created_at', { ascending: true });
      if (cancelled) return;
      if (error) {
        console.error(error);
        toast.error('Failed to load available devices');
        setDevices([]);
      } else {
        setDevices((data as AvailableDevice[]) || []);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [open, user?.id, service]);

  const handlePair = async (device: AvailableDevice) => {
    setPairingId(device.id);
    const { error } = await (supabase as any).rpc('pair_device', {
      p_subscriber_id: subscriberId,
      p_device_id: device.id,
      p_reason: 'installation',
    });
    setPairingId(null);
    if (error) {
      toast.error(error.message || 'Failed to pair device');
      return;
    }
    toast.success(`${deviceLabel[device.device_type]} ${device.serial_number} paired to ${subscriberName}`);
    onOpenChange(false);
    onPaired?.();
  };

  const Icon = service === 'cable' ? Tv : Wifi;
  const title = service === 'cable' ? 'Pair STB' : 'Pair ONU / Router';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon className="h-5 w-5" />
            {title}
          </DialogTitle>
          <DialogDescription>
            Select an available device from inventory to assign to {subscriberName}.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : devices.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground space-y-1">
            <p className="text-sm">No available {service === 'cable' ? 'STBs' : 'ONUs / Routers'} in inventory.</p>
            <p className="text-xs">Add devices through the Inventory screen first.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {devices.map((d) => (
              <div key={d.id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono font-medium">{d.serial_number}</span>
                    <Badge variant="outline">{deviceLabel[d.device_type] || d.device_type}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Added {new Date(d.created_at).toLocaleDateString()}
                    {d.notes ? ` · ${d.notes}` : ''}
                  </p>
                </div>
                <Button size="sm" onClick={() => handlePair(d)} disabled={pairingId === d.id}>
                  {pairingId === d.id ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Pair'}
                </Button>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
