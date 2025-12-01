import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Trash2, Plus } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { useAuth } from '@/hooks/useAuth';
import { useRegions } from '@/hooks/useRegions';

interface RegionManagementDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const RegionManagementDialog = ({ open, onOpenChange }: RegionManagementDialogProps) => {
  const { user } = useAuth();
  const { regions, addRegion, deleteRegion } = useRegions(user?.id);
  const [regionName, setRegionName] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!regionName.trim()) {
      toast.error('Please enter a region name');
      return;
    }

    const success = await addRegion({ name: regionName });
    if (success) {
      toast.success('Region added successfully');
      setRegionName('');
    }
  };

  const handleDelete = async (id: string) => {
    if (confirm('Are you sure you want to delete this region?')) {
      const success = await deleteRegion(id);
      if (success) {
        toast.success('Region deleted successfully');
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Manage Regions/Clusters</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mb-6">
          <div className="space-y-2">
            <Label htmlFor="region-name">Region Name</Label>
            <Input
              id="region-name"
              value={regionName}
              onChange={(e) => setRegionName(e.target.value)}
              placeholder="Enter region name"
            />
          </div>
          <Button type="submit" className="w-full">
            <Plus className="mr-2 h-4 w-4" />
            Add Region
          </Button>
        </form>

        <div className="space-y-2">
          <h3 className="font-semibold">Existing Regions</h3>
          {regions.map((region) => (
            <Card key={region.id} className="p-4">
              <div className="flex items-center justify-between">
                <p className="font-medium">{region.name}</p>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => handleDelete(region.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
};
