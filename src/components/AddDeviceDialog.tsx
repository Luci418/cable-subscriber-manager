import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import { useStbInventory, DeviceType, DeviceServiceType } from '@/hooks/useStbInventory';
import { useAuth } from '@/hooks/useAuth';
import { useEnabledServices } from '@/hooks/useEnabledServices';

/**
 * Phase 6.5 Batch 4 — AddDeviceDialog.
 *
 * Replaces the sprawling StbInventoryDialog which mixed "add" with
 * per-device state changes (mark faulty, decommission, delete). Per-device
 * actions now live on /equipment/:serial, so this dialog is add-only.
 *
 * Opened from the Equipment toolbar as the primary action.
 */
interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded?: () => void;
}

const deviceLabel: Record<DeviceType, string> = {
  stb: 'Set-Top Box (STB)',
  onu: 'ONU',
  router: 'Router',
};

export function AddDeviceDialog({ open, onOpenChange, onAdded }: Props) {
  const { user } = useAuth();
  const { cableEnabled, internetEnabled } = useEnabledServices();
  const { addStb } = useStbInventory(user?.id);

  const defaultService: DeviceServiceType = cableEnabled ? 'cable' : 'internet';
  const [service, setService] = useState<DeviceServiceType>(defaultService);
  const [deviceType, setDeviceType] = useState<DeviceType>(defaultService === 'cable' ? 'stb' : 'onu');
  const [serial, setSerial] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setSerial('');
    setNotes('');
    setService(defaultService);
    setDeviceType(defaultService === 'cable' ? 'stb' : 'onu');
  };

  const handleServiceChange = (v: DeviceServiceType) => {
    setService(v);
    setDeviceType(v === 'cable' ? 'stb' : 'onu');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!serial.trim()) {
      toast.error('Enter a serial number');
      return;
    }
    setSubmitting(true);
    const ok = await addStb({
      serial_number: serial.trim(),
      notes: notes.trim() || undefined,
      device_type: deviceType,
      service_type: service,
    });
    setSubmitting(false);
    if (ok) {
      toast.success(`${deviceLabel[deviceType]} added to inventory`);
      reset();
      onOpenChange(false);
      onAdded?.();
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!submitting) { onOpenChange(o); if (!o) reset(); } }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add device to inventory</DialogTitle>
          <DialogDescription>
            Register a new STB, ONU, or router. Assignment and status changes happen from the device page after it's added.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          {cableEnabled && internetEnabled && (
            <div className="space-y-1.5">
              <Label>Service</Label>
              <Select value={service} onValueChange={(v) => handleServiceChange(v as DeviceServiceType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cable">Cable</SelectItem>
                  <SelectItem value="internet">Internet</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Device type</Label>
            <Select value={deviceType} onValueChange={(v) => setDeviceType(v as DeviceType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {service === 'cable' ? (
                  <SelectItem value="stb">Set-Top Box (STB)</SelectItem>
                ) : (
                  <>
                    <SelectItem value="onu">ONU</SelectItem>
                    <SelectItem value="router">Router</SelectItem>
                  </>
                )}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Serial / MAC</Label>
            <Input value={serial} onChange={(e) => setSerial(e.target.value)} placeholder="e.g. ABC-1234-XYZ" autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label>Notes (optional)</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Vendor batch, condition, etc." />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              <Plus className="h-4 w-4 mr-1.5" /> {submitting ? 'Adding…' : 'Add device'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
