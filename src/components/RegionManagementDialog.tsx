import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getRegions, addRegion, deleteRegion, Region } from '@/lib/storage';
import { toast } from 'sonner';
import { Trash2, Plus } from 'lucide-react';
import { Card } from '@/components/ui/card';

interface RegionManagementDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const RegionManagementDialog = ({ open, onOpenChange }: RegionManagementDialogProps) => {
  const [regions, setRegions] = useState<Region[]>([]);
  const [regionName, setRegionName] = useState('');

  useEffect(() => {
    if (open) {
      loadRegions();
    }
  }, [open]);

  const loadRegions = () => {
    setRegions(getRegions());
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!regionName.trim()) {
      toast.error('Please enter a region name');
      return;
    }

    addRegion({ name: regionName });
    toast.success('Region added successfully');
    setRegionName('');
    loadRegions();
  };

  const handleDelete = (id: string) => {
    if (confirm('Are you sure you want to delete this region?')) {
      deleteRegion(id);
      toast.success('Region deleted successfully');
      loadRegions();
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
