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
import { MapPin, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { useRegions } from '@/hooks/useRegions';

// Phase 5.1: EditSubscriberDialog is the IDENTITY editor only.
// Device assignment (STB / ONU / Router) is no longer reachable from this
// form — it lives behind the Pair / Unpair / Replace workflows on the
// subscriber profile. Service capability is auto-declared by pair_device.
// This change also fixes the ONU dropdown bug (the dropdown was greyed out
// because the form coupled service toggles to device pickers).
interface SubscriberRow {
  id: string;
  name: string;
  mobile: string;
  region?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

interface EditSubscriberDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subscriber: SubscriberRow;
  onSubmit: (updates: Record<string, any>) => void;
}

export const EditSubscriberDialog = ({
  open,
  onOpenChange,
  subscriber,
  onSubmit,
}: EditSubscriberDialogProps) => {
  const { user } = useAuth();
  const { regions } = useRegions(user?.id);

  const [formData, setFormData] = useState({
    name: subscriber.name || '',
    mobile: subscriber.mobile || '',
    latitude: subscriber.latitude ?? undefined as number | undefined,
    longitude: subscriber.longitude ?? undefined as number | undefined,
    region: subscriber.region || '',
  });
  const [gettingLocation, setGettingLocation] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFormData({
      name: subscriber.name || '',
      mobile: subscriber.mobile || '',
      latitude: subscriber.latitude ?? undefined,
      longitude: subscriber.longitude ?? undefined,
      region: subscriber.region || '',
    });
  }, [open, subscriber]);

  const getCoordinates = () => {
    if (!navigator.geolocation) {
      toast.error('Geolocation is not supported by your browser');
      return;
    }
    setGettingLocation(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setFormData((p) => ({
          ...p,
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        }));
        toast.success('Location updated successfully!');
        setGettingLocation(false);
      },
      (error) => {
        toast.error('Failed to get location: ' + error.message);
        setGettingLocation(false);
      },
      { enableHighAccuracy: false, timeout: 5000, maximumAge: 0 }
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name.trim() || !formData.mobile.trim() || !formData.region) {
      toast.error('Please fill in name, mobile, and region');
      return;
    }
    if (!/^\d{7,15}$/.test(formData.mobile)) {
      toast.error('Mobile must be 7–15 digits, numbers only');
      return;
    }

    onSubmit({
      name: formData.name.trim(),
      mobile: formData.mobile,
      region: formData.region,
      latitude: formData.latitude ?? null,
      longitude: formData.longitude ?? null,
    });
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
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-mobile">Mobile Number *</Label>
            <Input
              id="edit-mobile"
              type="tel"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={15}
              value={formData.mobile}
              onChange={(e) =>
                setFormData({ ...formData, mobile: e.target.value.replace(/\D/g, '') })
              }
              placeholder="Digits only"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-region">Region/Cluster *</Label>
            <Select
              value={formData.region}
              onValueChange={(value) => setFormData({ ...formData, region: value })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select region" />
              </SelectTrigger>
              <SelectContent>
                {regions.map((region: any) => (
                  <SelectItem key={region.id} value={region.name}>
                    {region.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Location Coordinates</Label>
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
            {formData.latitude != null && formData.longitude != null && (
              <p className="text-sm text-muted-foreground">
                📍 {Number(formData.latitude).toFixed(6)}, {Number(formData.longitude).toFixed(6)}
              </p>
            )}
          </div>

          <p className="text-xs text-muted-foreground border-t pt-3">
            Device pairing, replacement and unpairing live on the subscriber profile under Cable / Internet.
          </p>

          <div className="flex gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="flex-1"
            >
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
