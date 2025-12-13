import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Trash2, Plus, Edit2, Archive, RotateCcw } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { usePacks } from '@/hooks/usePacks';
import { useAuth } from '@/hooks/useAuth';
import type { Database } from '@/integrations/supabase/types';

type Pack = Database["public"]["Tables"]["packs"]["Row"];

interface PackManagementDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const PackManagementDialog = ({ open, onOpenChange }: PackManagementDialogProps) => {
  const { user } = useAuth();
  const { packs, addPack, updatePack, deletePack, retirePack, reactivatePack } = usePacks(user?.id);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({ name: '', price: 0, channels: '' });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || formData.price <= 0) {
      toast.error('Please enter valid pack details');
      return;
    }

    if (editingId) {
      const success = await updatePack(editingId, { 
        name: formData.name, 
        price: formData.price,
        channels: formData.channels 
      });
      if (success) {
        toast.success('Pack updated successfully');
        setEditingId(null);
        setFormData({ name: '', price: 0, channels: '' });
      }
    } else {
      const success = await addPack({ 
        name: formData.name, 
        price: formData.price,
        channels: formData.channels 
      });
      if (success) {
        toast.success('Pack added successfully');
        setFormData({ name: '', price: 0, channels: '' });
      }
    }
  };

  const handleEdit = (pack: Pack) => {
    setEditingId(pack.id);
    setFormData({ name: pack.name, price: Number(pack.price), channels: pack.channels });
  };

  const handleDelete = async (id: string) => {
    if (confirm('Are you sure you want to delete this pack? This will only work if no customers are assigned to it.')) {
      const success = await deletePack(id);
      if (success) {
        toast.success('Pack deleted successfully');
      }
    }
  };

  const handleRetire = async (id: string) => {
    if (confirm('Retire this pack? It will be hidden from new subscriptions but existing customers will keep it.')) {
      const success = await retirePack(id);
      if (success) {
        toast.success('Pack retired successfully');
      }
    }
  };

  const handleReactivate = async (id: string) => {
    const success = await reactivatePack(id);
    if (success) {
      toast.success('Pack reactivated successfully');
    }
  };

  const activePacks = packs.filter(p => p.is_active !== false);
  const retiredPacks = packs.filter(p => p.is_active === false);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Manage Subscription Packs</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mb-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="pack-name">Pack Name</Label>
              <Input
                id="pack-name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="Enter pack name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pack-price">Price (₹)</Label>
              <Input
                id="pack-price"
                type="number"
                step="0.01"
                value={formData.price}
                onChange={(e) => setFormData({ ...formData, price: parseFloat(e.target.value) || 0 })}
                placeholder="Enter price"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="pack-channels">Channels</Label>
            <Input
              id="pack-channels"
              value={formData.channels}
              onChange={(e) => setFormData({ ...formData, channels: e.target.value })}
              placeholder="Enter channels (e.g., Star, Sony, etc.)"
            />
          </div>
          <Button type="submit" className="w-full">
            {editingId ? (
              <>
                <Edit2 className="mr-2 h-4 w-4" />
                Update Pack
              </>
            ) : (
              <>
                <Plus className="mr-2 h-4 w-4" />
                Add Pack
              </>
            )}
          </Button>
          {editingId && (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setEditingId(null);
                setFormData({ name: '', price: 0, channels: '' });
              }}
              className="w-full"
            >
              Cancel Edit
            </Button>
          )}
        </form>

        <div className="space-y-4">
          <div className="space-y-2">
            <h3 className="font-semibold">Active Packs</h3>
            {activePacks.length === 0 && (
              <p className="text-sm text-muted-foreground">No active packs</p>
            )}
            {activePacks.map((pack) => (
              <Card key={pack.id} className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">{pack.name}</p>
                    <p className="text-sm text-muted-foreground">₹{Number(pack.price).toFixed(2)}/month</p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleEdit(pack)}
                      title="Edit"
                    >
                      <Edit2 className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleRetire(pack.id)}
                      title="Retire (soft delete)"
                    >
                      <Archive className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => handleDelete(pack.id)}
                      title="Delete (only if unused)"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>

          {retiredPacks.length > 0 && (
            <div className="space-y-2">
              <h3 className="font-semibold text-muted-foreground">Retired Packs</h3>
              {retiredPacks.map((pack) => (
                <Card key={pack.id} className="p-4 opacity-60">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-medium">{pack.name}</p>
                        <Badge variant="secondary">Retired</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">₹{Number(pack.price).toFixed(2)}/month</p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleReactivate(pack.id)}
                        title="Reactivate"
                      >
                        <RotateCcw className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => handleDelete(pack.id)}
                        title="Delete (only if unused)"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
