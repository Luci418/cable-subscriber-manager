import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { Plus, Upload } from 'lucide-react';
import { useStbInventory, DeviceType, DeviceServiceType, StbInsert } from '@/hooks/useStbInventory';
import { useAuth } from '@/hooks/useAuth';
import { useEnabledServices } from '@/hooks/useEnabledServices';

/**
 * Phase 6.5 Batch 4 — AddDeviceDialog.
 *
 * Replaces the sprawling StbInventoryDialog which mixed "add" with
 * per-device state changes (mark faulty, decommission, delete). Per-device
 * actions now live on /equipment/:serial, so this dialog is add-only.
 *
 * Single and bulk both write `vc_id` alongside `serial_number` for cable
 * STBs: provider imports match on VC Id first and serial second, so a device
 * loaded without its VC Id will not auto-match on a Hathway report.
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
  const { addStb, addStbsBulk } = useStbInventory(user?.id);

  const defaultService: DeviceServiceType = cableEnabled ? 'cable' : 'internet';
  const [service, setService] = useState<DeviceServiceType>(defaultService);
  const [deviceType, setDeviceType] = useState<DeviceType>(defaultService === 'cable' ? 'stb' : 'onu');
  const [serial, setSerial] = useState('');
  const [vcId, setVcId] = useState('');
  const [notes, setNotes] = useState('');
  const [bulkText, setBulkText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setSerial('');
    setVcId('');
    setNotes('');
    setBulkText('');
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
      vc_id: service === 'cable' ? (vcId.trim() || null) : null,
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

  const handleBulk = async (e: React.FormEvent) => {
    e.preventDefault();
    const rows: StbInsert[] = [];
    let malformed = 0;
    for (const raw of bulkText.split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      const [serialCell, vcCell] = line.split(/[,\t;]/).map(c => (c ?? '').trim());
      if (!serialCell) { malformed++; continue; }
      rows.push({
        serial_number: serialCell,
        vc_id: service === 'cable' ? (vcCell || null) : null,
        device_type: deviceType,
        service_type: service,
      });
    }
    if (rows.length === 0) {
      toast.error('Nothing to import — paste one device per line');
      return;
    }
    setSubmitting(true);
    const res = await addStbsBulk(rows);
    setSubmitting(false);
    if (res.error) {
      toast.error(res.error);
      return;
    }
    const parts = [`${res.added} added`];
    if (res.skipped) parts.push(`${res.skipped} skipped (duplicate)`);
    if (malformed) parts.push(`${malformed} unreadable`);
    toast.success(parts.join(' · '));
    reset();
    onOpenChange(false);
    onAdded?.();
  };

  const serviceAndTypeFields = (
    <>
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
    </>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!submitting) { onOpenChange(o); if (!o) reset(); } }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add device to inventory</DialogTitle>
          <DialogDescription>
            Register a new STB, ONU, or router. Assignment and status changes happen from the device page after it's added.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="single">
          <TabsList className="w-full">
            <TabsTrigger value="single" className="flex-1">Single</TabsTrigger>
            <TabsTrigger value="bulk" className="flex-1">Bulk paste</TabsTrigger>
          </TabsList>

          <TabsContent value="single" className="mt-4">
            <form onSubmit={handleSubmit} className="space-y-3">
              {serviceAndTypeFields}
              <div className="space-y-1.5">
                <Label>Serial / MAC</Label>
                <Input value={serial} onChange={(e) => setSerial(e.target.value)} placeholder="e.g. ABC-1234-XYZ" autoFocus />
              </div>
              {service === 'cable' && (
                <div className="space-y-1.5">
                  <Label>VC Id <span className="text-muted-foreground font-normal">— recommended</span></Label>
                  <Input value={vcId} onChange={(e) => setVcId(e.target.value)} placeholder="e.g. 0123456789" />
                  <p className="text-xs text-muted-foreground">
                    Provider reports are matched on VC Id first. Without it, this box will need manual matching on every import.
                  </p>
                </div>
              )}
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
          </TabsContent>

          <TabsContent value="bulk" className="mt-4">
            <form onSubmit={handleBulk} className="space-y-3">
              {serviceAndTypeFields}
              <div className="space-y-1.5">
                <Label>Paste devices</Label>
                <Textarea
                  rows={8}
                  value={bulkText}
                  onChange={(e) => setBulkText(e.target.value)}
                  placeholder={service === 'cable' ? 'serial, vc id\nABC-1234, 0123456789\nABC-1235, 0123456790' : 'serial\nONU-0001\nONU-0002'}
                  className="font-mono text-xs"
                />
                <p className="text-xs text-muted-foreground">
                  One device per line{service === 'cable' ? ', serial first then VC Id (comma or tab separated)' : ''}.
                  Duplicates are skipped.
                </p>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
                  Cancel
                </Button>
                <Button type="submit" disabled={submitting}>
                  <Upload className="h-4 w-4 mr-1.5" /> {submitting ? 'Importing…' : 'Import devices'}
                </Button>
              </DialogFooter>
            </form>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
