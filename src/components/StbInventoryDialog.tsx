import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Trash2, Plus, Wrench, RotateCcw, XCircle } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useStbInventory, StbStatus } from '@/hooks/useStbInventory';
import { useAuth } from '@/hooks/useAuth';

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

export const StbInventoryDialog = ({ open, onOpenChange }: StbInventoryDialogProps) => {
  const { user } = useAuth();
  const { 
    stbs, 
    addStb, 
    deleteStb, 
    markAsFaulty, 
    markAsRepaired, 
    decommission,
    getAvailableStbs,
    getAssignedStbs,
    getFaultyStbs,
  } = useStbInventory(user?.id);
  const [serialNumber, setSerialNumber] = useState('');
  const [notes, setNotes] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!serialNumber.trim()) {
      toast.error('Please enter a serial number');
      return;
    }

    const success = await addStb({ 
      serial_number: serialNumber.trim(),
      notes: notes.trim() || undefined,
    });
    if (success) {
      toast.success('STB added to inventory');
      setSerialNumber('');
      setNotes('');
    }
  };

  const handleDelete = async (id: string) => {
    if (confirm('Are you sure you want to delete this STB from inventory?')) {
      const success = await deleteStb(id);
      if (success) {
        toast.success('STB deleted');
      }
    }
  };

  const handleMarkFaulty = async (id: string) => {
    const reason = prompt('Enter reason for marking as faulty (optional):');
    const success = await markAsFaulty(id, reason || undefined);
    if (success) {
      toast.success('STB marked as faulty');
    }
  };

  const handleRepair = async (id: string) => {
    const success = await markAsRepaired(id);
    if (success) {
      toast.success('STB marked as repaired and available');
    }
  };

  const handleDecommission = async (id: string) => {
    if (confirm('Decommission this STB? It will be permanently removed from service.')) {
      const reason = prompt('Enter reason for decommissioning (optional):');
      const success = await decommission(id, reason || undefined);
      if (success) {
        toast.success('STB decommissioned');
      }
    }
  };

  const availableStbs = getAvailableStbs();
  const assignedStbs = getAssignedStbs();
  const faultyStbs = getFaultyStbs();
  const decommissionedStbs = stbs.filter(s => s.status === 'decommissioned');

  const renderStbCard = (stb: typeof stbs[0], showActions: boolean = true) => (
    <Card key={stb.id} className="p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <p className="font-mono font-medium">{stb.serial_number}</p>
            <Badge className={statusColors[stb.status]}>{stb.status}</Badge>
          </div>
          {stb.notes && (
            <p className="text-sm text-muted-foreground mt-1">{stb.notes}</p>
          )}
        </div>
        {showActions && (
          <div className="flex gap-1">
            {stb.status === 'available' && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleMarkFaulty(stb.id)}
                  title="Mark as Faulty"
                >
                  <Wrench className="h-4 w-4" />
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => handleDelete(stb.id)}
                  title="Delete"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </>
            )}
            {stb.status === 'faulty' && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleRepair(stb.id)}
                  title="Mark as Repaired"
                >
                  <RotateCcw className="h-4 w-4" />
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => handleDecommission(stb.id)}
                  title="Decommission"
                >
                  <XCircle className="h-4 w-4" />
                </Button>
              </>
            )}
            {stb.status === 'assigned' && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleMarkFaulty(stb.id)}
                title="Mark as Faulty (will unassign)"
              >
                <Wrench className="h-4 w-4" />
              </Button>
            )}
          </div>
        )}
      </div>
    </Card>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>STB Inventory Management</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mb-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="serial-number">Serial Number</Label>
              <Input
                id="serial-number"
                value={serialNumber}
                onChange={(e) => setSerialNumber(e.target.value)}
                placeholder="Enter STB serial number"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="notes">Notes (optional)</Label>
              <Input
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Any notes"
              />
            </div>
          </div>
          <Button type="submit" className="w-full">
            <Plus className="mr-2 h-4 w-4" />
            Add STB to Inventory
          </Button>
        </form>

        <div className="grid grid-cols-4 gap-2 mb-4 text-center text-sm">
          <div className="p-2 rounded bg-muted">
            <p className="font-semibold text-lg">{availableStbs.length}</p>
            <p className="text-muted-foreground">Available</p>
          </div>
          <div className="p-2 rounded bg-muted">
            <p className="font-semibold text-lg">{assignedStbs.length}</p>
            <p className="text-muted-foreground">Assigned</p>
          </div>
          <div className="p-2 rounded bg-muted">
            <p className="font-semibold text-lg">{faultyStbs.length}</p>
            <p className="text-muted-foreground">Faulty</p>
          </div>
          <div className="p-2 rounded bg-muted">
            <p className="font-semibold text-lg">{decommissionedStbs.length}</p>
            <p className="text-muted-foreground">Retired</p>
          </div>
        </div>

        <Tabs defaultValue="available">
          <TabsList className="w-full">
            <TabsTrigger value="available" className="flex-1">Available</TabsTrigger>
            <TabsTrigger value="assigned" className="flex-1">Assigned</TabsTrigger>
            <TabsTrigger value="faulty" className="flex-1">Faulty</TabsTrigger>
            <TabsTrigger value="decommissioned" className="flex-1">Retired</TabsTrigger>
          </TabsList>

          <TabsContent value="available" className="space-y-2 mt-4">
            {availableStbs.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">No available STBs</p>
            )}
            {availableStbs.map(stb => renderStbCard(stb))}
          </TabsContent>

          <TabsContent value="assigned" className="space-y-2 mt-4">
            {assignedStbs.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">No assigned STBs</p>
            )}
            {assignedStbs.map(stb => renderStbCard(stb))}
          </TabsContent>

          <TabsContent value="faulty" className="space-y-2 mt-4">
            {faultyStbs.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">No faulty STBs</p>
            )}
            {faultyStbs.map(stb => renderStbCard(stb))}
          </TabsContent>

          <TabsContent value="decommissioned" className="space-y-2 mt-4">
            {decommissionedStbs.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">No decommissioned STBs</p>
            )}
            {decommissionedStbs.map(stb => renderStbCard(stb, false))}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};