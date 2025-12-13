import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { MapPin, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Subscriber, getPacks, getRegions, calculateNextBillingDate } from '@/lib/storage';
import { useAuth } from '@/hooks/useAuth';
import { useStbInventory } from '@/hooks/useStbInventory';

interface EditSubscriberDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subscriber: Subscriber;
  onSubmit: (updates: Partial<Subscriber>) => void;
}

export const EditSubscriberDialog = ({
  open,
  onOpenChange,
  subscriber,
  onSubmit,
}: EditSubscriberDialogProps) => {
  const [formData, setFormData] = useState({
    name: subscriber.name,
    mobile: subscriber.mobile,
    stbNumber: subscriber.stbNumber,
    latitude: subscriber.latitude,
    longitude: subscriber.longitude,
    region: subscriber.region,
    billingCycle: subscriber.billingCycle || ('monthly' as const),
    autoChargeEnabled: subscriber.autoChargeEnabled || false,
  });
  const [gettingLocation, setGettingLocation] = useState(false);
  const [regions, setRegions] = useState<Array<{ id: string; name: string }>>([]);
  const { user } = useAuth();
  const { stbs } = useStbInventory(user?.id);

  // Available STBs include: those with 'available' status OR the currently assigned one
  const availableStbs = stbs.filter(stb => 
    stb.status === 'available' || stb.serial_number === subscriber.stbNumber
  );

  useEffect(() => {
    if (open) {
      setFormData({
        name: subscriber.name,
        mobile: subscriber.mobile,
        stbNumber: subscriber.stbNumber,
        latitude: subscriber.latitude,
        longitude: subscriber.longitude,
        region: subscriber.region,
        billingCycle: subscriber.billingCycle || 'monthly',
        autoChargeEnabled: subscriber.autoChargeEnabled || false,
      });
      setRegions(getRegions());
    }
  }, [open, subscriber]);

  const getCoordinates = () => {
    if (!navigator.geolocation) {
      toast.error('Geolocation is not supported by your browser');
      return;
    }

    setGettingLocation(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setFormData({
          ...formData,
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
        toast.success('Location updated successfully!');
        setGettingLocation(false);
      },
      (error) => {
        toast.error('Failed to get location: ' + error.message);
        setGettingLocation(false);
      },
      {
        enableHighAccuracy: false,
        timeout: 5000,
        maximumAge: 0
      }
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name || !formData.mobile || !formData.stbNumber || !formData.region) {
      toast.error('Please fill in all required fields');
      return;
    }

    const updates: any = { ...formData };

    // If auto-charge is being enabled for the first time, set next billing date
    if (formData.autoChargeEnabled && !subscriber?.autoChargeEnabled) {
      updates.nextBillingDate = calculateNextBillingDate(
        new Date().toISOString().split('T')[0],
        formData.billingCycle
      );
    }

    onSubmit(updates);
    toast.success('Subscriber updated successfully!');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Subscriber</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-name">Full Name *</Label>
            <Input
              id="edit-name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="Enter full name"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-mobile">Mobile Number *</Label>
            <Input
              id="edit-mobile"
              type="tel"
              value={formData.mobile}
              onChange={(e) => setFormData({ ...formData, mobile: e.target.value })}
              placeholder="Enter mobile number"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-stb">STB Number *</Label>
            <Select value={formData.stbNumber} onValueChange={(value) => setFormData({ ...formData, stbNumber: value })}>
              <SelectTrigger>
                <SelectValue placeholder="Select STB" />
              </SelectTrigger>
              <SelectContent>
                {availableStbs.map(stb => (
                  <SelectItem key={stb.id} value={stb.serial_number}>
                    {stb.serial_number} {stb.serial_number === subscriber.stbNumber ? '(current)' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Location Coordinates</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={getCoordinates}
                disabled={gettingLocation}
                className="w-full"
              >
                {gettingLocation ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Getting Location...
                  </>
                ) : (
                  <>
                    <MapPin className="mr-2 h-4 w-4" />
                    Update Coordinates
                  </>
                )}
              </Button>
            </div>
            {formData.latitude && formData.longitude && (
              <p className="text-sm text-muted-foreground">
                📍 {formData.latitude.toFixed(6)}, {formData.longitude.toFixed(6)}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-region">Region/Cluster *</Label>
            <Select value={formData.region} onValueChange={(value) => setFormData({ ...formData, region: value })}>
              <SelectTrigger>
                <SelectValue placeholder="Select region" />
              </SelectTrigger>
              <SelectContent>
                {regions.map(region => (
                  <SelectItem key={region.id} value={region.name}>{region.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-4 border-t pt-4">
            <h3 className="font-semibold">Billing Settings</h3>
            
            <div className="space-y-2">
              <Label htmlFor="billingCycle">Billing Cycle</Label>
              <Select 
                value={formData.billingCycle} 
                onValueChange={(value: any) => setFormData({ ...formData, billingCycle: value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="quarterly">Quarterly (3 months)</SelectItem>
                  <SelectItem value="semi-annually">Semi-Annually (6 months)</SelectItem>
                  <SelectItem value="yearly">Yearly</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="autoCharge">Auto-Billing</Label>
                <p className="text-sm text-muted-foreground">
                  Automatically charge subscriber on billing cycle
                </p>
              </div>
              <Switch
                id="autoCharge"
                checked={formData.autoChargeEnabled}
                onCheckedChange={(checked) => setFormData({ ...formData, autoChargeEnabled: checked })}
              />
            </div>
          </div>

          <div className="flex gap-2 pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} className="flex-1">
              Cancel
            </Button>
            <Button type="submit" className="flex-1">
              Save Changes
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
