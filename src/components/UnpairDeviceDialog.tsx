import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Loader2 } from 'lucide-react';

type UnpairReason = 'customer_closed' | 'downgrade' | 'correction' | 'repair';
type ReturnStatus = 'available' | 'faulty';

interface UnpairDeviceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subscriberId: string;
  device: { id: string; serial_number: string; device_type: string } | null;
  onUnpaired?: () => void;
}

const REASONS: { value: UnpairReason; label: string }[] = [
  { value: 'customer_closed', label: 'Customer closed account' },
  { value: 'downgrade', label: 'Service downgrade' },
  { value: 'correction', label: 'Correction (assigned in error)' },
  { value: 'repair', label: 'Device sent for repair' },
];

export const UnpairDeviceDialog = ({
  open, onOpenChange, subscriberId, device, onUnpaired,
}: UnpairDeviceDialogProps) => {
  const [reason, setReason] = useState<UnpairReason>('customer_closed');
  const [returnStatus, setReturnStatus] = useState<ReturnStatus>('available');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setReason('customer_closed');
      setReturnStatus('available');
    }
  }, [open]);

  // Auto-default return status to 'faulty' when reason is 'repair'.
  useEffect(() => {
    if (reason === 'repair') setReturnStatus('faulty');
  }, [reason]);

  const handleSubmit = async () => {
    if (!device) return;
    setSubmitting(true);
    const { error } = await (supabase as any).rpc('unpair_device', {
      p_subscriber_id: subscriberId,
      p_device_id: device.id,
      p_reason: reason,
      p_return_status: returnStatus,
    });
    setSubmitting(false);
    if (error) {
      toast.error(error.message || 'Failed to unpair device');
      return;
    }
    toast.success(`${device.serial_number} unpaired (returned as ${returnStatus})`);
    onOpenChange(false);
    onUnpaired?.();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Unpair Device</DialogTitle>
          <DialogDescription>
            {device ? (
              <>Remove <span className="font-mono font-medium">{device.serial_number}</span> from this subscriber.</>
            ) : 'Remove device from this subscriber.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Reason</Label>
            <Select value={reason} onValueChange={(v) => setReason(v as UnpairReason)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {REASONS.map(r => (
                  <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Return device to inventory as</Label>
            <RadioGroup
              value={returnStatus}
              onValueChange={(v) => setReturnStatus(v as ReturnStatus)}
              className="grid grid-cols-2 gap-2"
            >
              <label className="flex items-center gap-2 rounded-md border p-3 cursor-pointer hover:bg-accent">
                <RadioGroupItem value="available" />
                <div>
                  <p className="text-sm font-medium">Available</p>
                  <p className="text-xs text-muted-foreground">Ready to pair again</p>
                </div>
              </label>
              <label className="flex items-center gap-2 rounded-md border p-3 cursor-pointer hover:bg-accent">
                <RadioGroupItem value="faulty" />
                <div>
                  <p className="text-sm font-medium">Faulty</p>
                  <p className="text-xs text-muted-foreground">Needs repair</p>
                </div>
              </label>
            </RadioGroup>
          </div>

          <p className="text-xs text-muted-foreground border-t pt-3">
            If an active subscription is still tied to this device, cancel the subscription first.
          </p>

          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button className="flex-1" onClick={handleSubmit} disabled={submitting}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Unpair'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
