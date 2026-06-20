import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Loader2, ArrowLeftRight, Tv, Wifi } from 'lucide-react';

type ServiceType = 'cable' | 'internet';

interface OldDevice {
  id: string;
  serial_number: string;
  device_type: 'stb' | 'onu' | 'router';
  service_type: ServiceType;
}

interface AvailableDevice {
  id: string;
  serial_number: string;
  device_type: 'stb' | 'onu' | 'router';
  service_type: ServiceType;
  created_at: string;
  notes: string | null;
}

interface ReplaceDeviceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subscriberId: string;
  subscriberName: string;
  /** The device currently on the card the operator clicked Replace from. */
  oldDevice: OldDevice | null;
  onReplaced?: () => void;
}

const deviceLabel: Record<string, string> = { stb: 'STB', onu: 'ONU', router: 'Router' };

/**
 * Phase 5.2 — Replace Device UI.
 *
 * Backed by the `replace_device` RPC shipped in Phase 3.6. The RPC atomically:
 *   - flips the OLD device row to status='faulty', subscriber_id=NULL
 *   - flips the NEW device row to status='assigned', subscriber_id=<sub>
 *   - re-points the active subscription's device_id / device_serial_snapshot
 *   - closes the open device_assignment_log row and opens a new one with
 *     open_reason='replacement'
 *   - for cable, updates subscribers.stb_number to the new serial
 *
 * The dialog passes the OLD device's serial (from the card the operator
 * clicked) and the chosen NEW serial. Service-type matching is enforced both
 * client-side (we only list available devices of the same service_type) and
 * by the RPC.
 */
export const ReplaceDeviceDialog = ({
  open,
  onOpenChange,
  subscriberId,
  subscriberName,
  oldDevice,
  onReplaced,
}: ReplaceDeviceDialogProps) => {
  const { user } = useAuth();
  const [devices, setDevices] = useState<AvailableDevice[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [newDeviceId, setNewDeviceId] = useState<string>('');
  const [reason, setReason] = useState<'faulty' | 'upgraded' | 'returned' | 'replaced' | 'other'>('faulty');

  useEffect(() => {
    if (!open || !user?.id || !oldDevice) return;
    let cancelled = false;
    setNewDeviceId('');
    setReason('faulty');
    setLoading(true);
    (async () => {
      const { data, error } = await supabase
        .from('stb_inventory')
        .select('id, serial_number, device_type, service_type, created_at, notes')
        .eq('user_id', user.id)
        .eq('status', 'available')
        .eq('service_type', oldDevice.service_type)
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
  }, [open, user?.id, oldDevice?.id]);

  if (!oldDevice) return null;

  const Icon = oldDevice.service_type === 'cable' ? Tv : Wifi;
  const newDevice = devices.find((d) => d.id === newDeviceId);

  const handleReplace = async () => {
    if (!newDevice) {
      toast.error('Pick a replacement device');
      return;
    }
    setSubmitting(true);
    const { error } = await (supabase as any).rpc('replace_device', {
      p_subscriber_id: subscriberId,
      p_old_serial: oldDevice.serial_number,
      p_new_serial: newDevice.serial_number,
      p_reason: reason,
    });
    setSubmitting(false);
    if (error) {
      toast.error(error.message || 'Failed to replace device');
      return;
    }
    toast.success(`Replaced ${oldDevice.serial_number} with ${newDevice.serial_number}`);
    onOpenChange(false);
    onReplaced?.();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowLeftRight className="h-5 w-5" /> Replace Device
          </DialogTitle>
          <DialogDescription>
            Swap a {deviceLabel[oldDevice.device_type]} on {subscriberName}'s account.
            The active subscription stays intact and is re-pointed to the new device.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Old device summary */}
          <div className="rounded-lg border bg-muted/40 p-3 space-y-1">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Removing</p>
            <div className="flex items-center gap-2 flex-wrap">
              <Icon className="h-4 w-4" />
              <span className="font-mono font-medium">{oldDevice.serial_number}</span>
              <Badge variant="outline">{deviceLabel[oldDevice.device_type]}</Badge>
            </div>
          </div>

          {/* Reason */}
          <div className="space-y-2">
            <Label>Reason</Label>
            <Select value={reason} onValueChange={(v) => setReason(v as any)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="faulty">Faulty — old device goes to inventory as faulty</SelectItem>
                <SelectItem value="upgraded">Upgraded — customer wanted newer hardware</SelectItem>
                <SelectItem value="returned">Returned — customer returned old device</SelectItem>
                <SelectItem value="replaced">Replaced — generic swap</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              The old device is marked <span className="font-medium">faulty</span> in inventory
              regardless of reason — it must be triaged before going back into circulation.
            </p>
          </div>

          {/* New device picker */}
          <div className="space-y-2">
            <Label>
              Replacement {deviceLabel[oldDevice.device_type]} (same service type)
            </Label>
            {loading ? (
              <div className="flex justify-center py-4">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : devices.length === 0 ? (
              <div className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
                No available {oldDevice.service_type === 'cable' ? 'STBs' : 'ONUs / Routers'} in inventory.
                Add one through the Inventory screen first.
              </div>
            ) : (
              <Select value={newDeviceId} onValueChange={setNewDeviceId}>
                <SelectTrigger><SelectValue placeholder="Choose a replacement device" /></SelectTrigger>
                <SelectContent className="bg-popover max-h-72">
                  {devices.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      <span className="font-mono">{d.serial_number}</span>
                      {' '}· {deviceLabel[d.device_type]}
                      {d.notes ? ` · ${d.notes}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="flex gap-2 pt-2">
            <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button
              className="flex-1"
              disabled={!newDeviceId || submitting || loading}
              onClick={handleReplace}
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Replace Device'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
