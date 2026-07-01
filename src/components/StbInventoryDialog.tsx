import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Trash2, Plus, Wrench, RotateCcw, XCircle, Tv, Wifi, History } from 'lucide-react';
import { DeviceTimelineDialog } from './DeviceTimelineDialog';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useStbInventory, StbStatus, DeviceType, DeviceServiceType, StbInventoryItem } from '@/hooks/useStbInventory';
import { useAuth } from '@/hooks/useAuth';
import { useEnabledServices } from '@/hooks/useEnabledServices';

interface StbInventoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const statusColors: Record<StbStatus, string> = {
  available: 'bg-green-500',
  assigned: 'bg-blue-500',
  faulty: 'bg-yellow-500',
  decommissioned: 'bg-red-500',
};

const deviceLabel: Record<DeviceType, string> = {
  stb: 'STB',
  onu: 'ONU',
  router: 'Router',
};

export const StbInventoryDialog = ({ open, onOpenChange }: StbInventoryDialogProps) => {
  const { user } = useAuth();
  const { cableEnabled, internetEnabled } = useEnabledServices();
  const {
    stbs,
    addStb,
    deleteStb,
    markAsFaulty,
    markAsRepaired,
    decommission,
  } = useStbInventory(user?.id);

  const [activeService, setActiveService] = useState<DeviceServiceType>(
    cableEnabled ? 'cable' : 'internet'
  );
  const [serialNumber, setSerialNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [deviceType, setDeviceType] = useState<DeviceType>('stb');
  const [historySerial, setHistorySerial] = useState<string | null>(null);
  const [faultyTarget, setFaultyTarget] = useState<StbInventoryItem | null>(null);
  const [faultyReason, setFaultyReason] = useState('');
  const [faultySubmitting, setFaultySubmitting] = useState(false);

  // Default device type when switching service tabs
  const handleServiceChange = (svc: DeviceServiceType) => {
    setActiveService(svc);
    setDeviceType(svc === 'cable' ? 'stb' : 'onu');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!serialNumber.trim()) {
      toast.error('Please enter a serial number');
      return;
    }

    const success = await addStb({
      serial_number: serialNumber.trim(),
      notes: notes.trim() || undefined,
      device_type: deviceType,
      service_type: activeService,
    });
    if (success) {
      toast.success(`${deviceLabel[deviceType]} added`);
      setSerialNumber('');
      setNotes('');
    }
  };

  const handleDelete = async (id: string) => {
    if (confirm('Delete this device from inventory?')) {
      const ok = await deleteStb(id);
      if (ok) toast.success('Device deleted');
    }
  };

  const handleMarkFaulty = async (id: string) => {
    // `prompt` returns null when the user clicks Cancel — abort entirely so
    // we don't silently mark the device faulty. Empty string ("OK" with no
    // text) is treated as "no reason provided" and proceeds.
    const reason = prompt('Reason (optional):');
    if (reason === null) return;
    const ok = await markAsFaulty(id, reason || undefined);
    if (ok) toast.success('Marked as faulty');
  };


  const handleRepair = async (id: string) => {
    const ok = await markAsRepaired(id);
    if (ok) toast.success('Marked as repaired');
  };

  const handleDecommission = async (id: string) => {
    if (!confirm('Decommission this device?')) return;
    const reason = prompt('Reason (optional):');
    if (reason === null) return;
    const ok = await decommission(id, reason || undefined);
    if (ok) toast.success('Decommissioned');
  };


  // Filter inventory for the active service tab. Legacy rows without
  // service_type are treated as cable to preserve existing data.
  const serviceStbs = stbs.filter(
    (s: any) => (s.service_type || 'cable') === activeService
  );

  const buckets = {
    available: serviceStbs.filter(s => s.status === 'available'),
    assigned: serviceStbs.filter(s => s.status === 'assigned'),
    faulty: serviceStbs.filter(s => s.status === 'faulty'),
    decommissioned: serviceStbs.filter(s => s.status === 'decommissioned'),
  };

  const renderCard = (stb: StbInventoryItem, showActions = true) => (
    <Card key={stb.id} className="p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-mono font-medium truncate">{stb.serial_number}</p>
            <Badge variant="outline">{deviceLabel[stb.device_type] || 'STB'}</Badge>
            <Badge className={statusColors[stb.status]}>{stb.status}</Badge>
          </div>
          {stb.notes && <p className="text-sm text-muted-foreground mt-1">{stb.notes}</p>}
        </div>
        {showActions && (
          <div className="flex gap-1 shrink-0">
            <Button variant="outline" size="sm" onClick={() => setHistorySerial(stb.serial_number)} title="Device History">
              <History className="h-4 w-4" />
            </Button>
            {stb.status === 'available' && (
              <>
                <Button variant="outline" size="sm" onClick={() => handleMarkFaulty(stb.id)} title="Mark Faulty">
                  <Wrench className="h-4 w-4" />
                </Button>
                <Button variant="destructive" size="sm" onClick={() => handleDelete(stb.id)} title="Delete">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </>
            )}
            {stb.status === 'faulty' && (
              <>
                <Button variant="outline" size="sm" onClick={() => handleRepair(stb.id)} title="Mark Repaired">
                  <RotateCcw className="h-4 w-4" />
                </Button>
                <Button variant="destructive" size="sm" onClick={() => handleDecommission(stb.id)} title="Decommission">
                  <XCircle className="h-4 w-4" />
                </Button>
              </>
            )}
            {stb.status === 'assigned' && (
              <Button variant="outline" size="sm" onClick={() => handleMarkFaulty(stb.id)} title="Mark Faulty (will unassign)">
                <Wrench className="h-4 w-4" />
              </Button>
            )}
          </div>
        )}
      </div>
    </Card>
  );

  const showServiceTabs = cableEnabled && internetEnabled;
  const dialogTitle = !cableEnabled && internetEnabled
    ? 'ONU / Router Inventory'
    : !internetEnabled && cableEnabled
      ? 'STB Inventory'
      : 'Device Inventory';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
        </DialogHeader>

        <Tabs value={activeService} onValueChange={(v) => handleServiceChange(v as DeviceServiceType)}>
          {showServiceTabs && (
            <TabsList className="w-full">
              <TabsTrigger value="cable" className="flex-1 gap-2">
                <Tv className="h-4 w-4" /> Cable (STB)
              </TabsTrigger>
              <TabsTrigger value="internet" className="flex-1 gap-2">
                <Wifi className="h-4 w-4" /> Internet (ONU/Router)
              </TabsTrigger>
            </TabsList>
          )}

          {(['cable', 'internet'] as DeviceServiceType[]).map(svc => {
            const enabled = svc === 'cable' ? cableEnabled : internetEnabled;
            if (!enabled) return null;
            return (
              <TabsContent key={svc} value={svc} className="mt-4 space-y-4">
                <form onSubmit={handleSubmit} className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="space-y-1.5">
                      <Label>Device Type</Label>
                      <Select value={deviceType} onValueChange={(v) => setDeviceType(v as DeviceType)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {svc === 'cable' ? (
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
                      <Input
                        value={serialNumber}
                        onChange={(e) => setSerialNumber(e.target.value)}
                        placeholder="Enter serial number"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Notes</Label>
                      <Input
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder="Optional"
                      />
                    </div>
                  </div>
                  <Button type="submit" className="w-full">
                    <Plus className="mr-2 h-4 w-4" />
                    Add to Inventory
                  </Button>
                </form>

                <div className="grid grid-cols-4 gap-2 text-center text-sm">
                  <div className="p-2 rounded bg-muted">
                    <p className="font-semibold text-lg">{buckets.available.length}</p>
                    <p className="text-muted-foreground text-xs">Available</p>
                  </div>
                  <div className="p-2 rounded bg-muted">
                    <p className="font-semibold text-lg">{buckets.assigned.length}</p>
                    <p className="text-muted-foreground text-xs">Assigned</p>
                  </div>
                  <div className="p-2 rounded bg-muted">
                    <p className="font-semibold text-lg">{buckets.faulty.length}</p>
                    <p className="text-muted-foreground text-xs">Faulty</p>
                  </div>
                  <div className="p-2 rounded bg-muted">
                    <p className="font-semibold text-lg">{buckets.decommissioned.length}</p>
                    <p className="text-muted-foreground text-xs">Retired</p>
                  </div>
                </div>

                <Tabs defaultValue="available">
                  <TabsList className="w-full">
                    <TabsTrigger value="available" className="flex-1">Available</TabsTrigger>
                    <TabsTrigger value="assigned" className="flex-1">Assigned</TabsTrigger>
                    <TabsTrigger value="faulty" className="flex-1">Faulty</TabsTrigger>
                    <TabsTrigger value="decommissioned" className="flex-1">Retired</TabsTrigger>
                  </TabsList>

                  {(['available', 'assigned', 'faulty', 'decommissioned'] as const).map(b => (
                    <TabsContent key={b} value={b} className="space-y-2 mt-3">
                      {buckets[b].length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-4">No devices</p>
                      ) : (
                        buckets[b].map(stb => renderCard(stb, b !== 'decommissioned'))
                      )}
                    </TabsContent>
                  ))}
                </Tabs>
              </TabsContent>
            );
          })}
        </Tabs>
      </DialogContent>
      {historySerial && (
        <DeviceTimelineDialog
          open={!!historySerial}
          onOpenChange={(o) => { if (!o) setHistorySerial(null); }}
          deviceSerial={historySerial}
        />
      )}
    </Dialog>
  );
};
