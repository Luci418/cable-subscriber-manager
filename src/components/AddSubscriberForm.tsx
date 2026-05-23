import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { useRegions } from '@/hooks/useRegions';
import { useStbInventory } from '@/hooks/useStbInventory';
import { useEnabledServices } from '@/hooks/useEnabledServices';
import { Loader2, MapPin, Tv, Wifi } from 'lucide-react';

interface AddSubscriberFormProps {
  onSubmit: (data: {
    name: string;
    mobile: string;
    services: ('cable' | 'internet')[];
    stbNumber: string;
    internetDeviceId?: string;
    latitude?: number;
    longitude?: number;
    region: string;
    balance: number;
    housePicture?: string;
  }) => void;
  onCancel: () => void;
}

export const AddSubscriberForm = ({ onSubmit, onCancel }: AddSubscriberFormProps) => {
  const { user } = useAuth();
  const { cableEnabled, internetEnabled } = useEnabledServices();
  const { regions } = useRegions(user?.id);
  const { stbs } = useStbInventory(user?.id);

  const [formData, setFormData] = useState({
    name: '',
    mobile: '',
    services: [
      ...(cableEnabled ? ['cable' as const] : []),
      ...(internetEnabled && !cableEnabled ? ['internet' as const] : []),
    ] as ('cable' | 'internet')[],
    stbNumber: '',
    internetDeviceId: '',
    latitude: undefined as number | undefined,
    longitude: undefined as number | undefined,
    region: '',
    balance: 0,
    housePicture: undefined as string | undefined,
  });
  const [loading, setLoading] = useState(false);
  const [gettingLocation, setGettingLocation] = useState(false);

  const wantsCable = formData.services.includes('cable');
  const wantsInternet = formData.services.includes('internet');

  // Available devices, segmented by service. Fall back to legacy rows
  // (no service_type/device_type) on the cable side.
  const availableStbs = stbs.filter(
    (s: any) => s.status === 'available' && (s.service_type || 'cable') === 'cable'
  );
  const availableInternetDevices = stbs.filter(
    (s: any) => s.status === 'available' && s.service_type === 'internet'
  );

  const toggleService = (svc: 'cable' | 'internet', checked: boolean) => {
    setFormData(prev => ({
      ...prev,
      services: checked
        ? [...prev.services, svc]
        : prev.services.filter(s => s !== svc),
      // Clear the corresponding device selection when toggling off
      ...(svc === 'cable' && !checked ? { stbNumber: '' } : {}),
      ...(svc === 'internet' && !checked ? { internetDeviceId: '' } : {}),
    }));
  };

  const getCoordinates = () => {
    if (!navigator.geolocation) {
      toast.error('Geolocation not supported');
      return;
    }
    setGettingLocation(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setFormData(prev => ({
          ...prev,
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        }));
        toast.success('Location captured!');
        setGettingLocation(false);
      },
      (error) => {
        toast.error('Failed: ' + error.message);
        setGettingLocation(false);
      },
      { enableHighAccuracy: false, timeout: 5000, maximumAge: 0 }
    );
  };

  const handleImageCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setFormData(prev => ({ ...prev, housePicture: reader.result as string }));
        toast.success('House picture captured');
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name.trim() || !formData.mobile.trim() || !formData.region) {
      toast.error('Please fill in name, mobile, and region');
      return;
    }
    if (!/^\d{7,15}$/.test(formData.mobile)) {
      toast.error('Mobile must be 7–15 digits, numbers only');
      return;
    }
    if (formData.services.length === 0) {
      toast.error('Select at least one service');
      return;
    }
    if (wantsCable && !formData.stbNumber) {
      toast.error('Select an STB for the Cable service');
      return;
    }
    if (wantsInternet && !formData.internetDeviceId) {
      toast.error('Select an ONU/Router for the Internet service');
      return;
    }

    setLoading(true);
    try {
      onSubmit(formData);
    } catch {
      toast.error('Failed to add subscriber');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add New Subscriber</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Full Name *</Label>
            <Input
              id="name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="Enter full name"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="mobile">Mobile Number *</Label>
            <Input
              id="mobile"
              type="tel"
              value={formData.mobile}
              onChange={(e) => setFormData({ ...formData, mobile: e.target.value })}
              placeholder="Enter mobile number"
              required
            />
          </div>

          {/* Services — only render the chooser when both modules are enabled */}
          {(cableEnabled && internetEnabled) && (
            <div className="space-y-2">
              <Label>Services *</Label>
              <div className="grid grid-cols-2 gap-2">
                <label className="flex items-center gap-2 rounded-md border p-3 cursor-pointer hover:bg-accent">
                  <Checkbox
                    checked={wantsCable}
                    onCheckedChange={(c) => toggleService('cable', !!c)}
                  />
                  <Tv className="h-4 w-4" />
                  <span className="text-sm font-medium">Cable</span>
                </label>
                <label className="flex items-center gap-2 rounded-md border p-3 cursor-pointer hover:bg-accent">
                  <Checkbox
                    checked={wantsInternet}
                    onCheckedChange={(c) => toggleService('internet', !!c)}
                  />
                  <Wifi className="h-4 w-4" />
                  <span className="text-sm font-medium">Internet</span>
                </label>
              </div>
            </div>
          )}

          {/* Cable device picker */}
          {wantsCable && (
            <div className="space-y-2">
              <Label>STB (Cable)</Label>
              <Select
                value={formData.stbNumber}
                onValueChange={(value) => setFormData({ ...formData, stbNumber: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select available STB (optional)" />
                </SelectTrigger>
                <SelectContent>
                  {availableStbs.length === 0 ? (
                    <div className="px-2 py-3 text-sm text-muted-foreground text-center">
                      No available STBs
                    </div>
                  ) : (
                    availableStbs.map(stb => (
                      <SelectItem key={stb.id} value={stb.serial_number}>
                        {stb.serial_number}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Internet device picker */}
          {wantsInternet && (
            <div className="space-y-2">
              <Label>ONU / Router (Internet)</Label>
              <Select
                value={formData.internetDeviceId}
                onValueChange={(value) => setFormData({ ...formData, internetDeviceId: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select available device (optional)" />
                </SelectTrigger>
                <SelectContent>
                  {availableInternetDevices.length === 0 ? (
                    <div className="px-2 py-3 text-sm text-muted-foreground text-center">
                      No available ONU/Router. Add one in Inventory.
                    </div>
                  ) : (
                    availableInternetDevices.map((d: any) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.serial_number} ({d.device_type?.toUpperCase() || 'ONU'})
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
          )}

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
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Getting Location...</>
              ) : (
                <><MapPin className="mr-2 h-4 w-4" />Get Coordinates</>
              )}
            </Button>
            {formData.latitude && formData.longitude && (
              <p className="text-sm text-muted-foreground">
                📍 {formData.latitude.toFixed(6)}, {formData.longitude.toFixed(6)}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="housePicture">House Picture</Label>
            <Input
              id="housePicture"
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleImageCapture}
            />
            {formData.housePicture && (
              <img src={formData.housePicture} alt="House" className="w-full h-40 object-cover rounded-md mt-2" />
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="region">Region/Cluster *</Label>
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

          <div className="space-y-2">
            <Label htmlFor="balance">Initial Balance</Label>
            <Input
              id="balance"
              type="number"
              step="0.01"
              value={formData.balance}
              onChange={(e) => setFormData({ ...formData, balance: parseFloat(e.target.value) || 0 })}
              placeholder="0.00"
            />
          </div>

          <div className="flex gap-2 pt-4">
            <Button type="button" variant="outline" onClick={onCancel} className="flex-1">
              Cancel
            </Button>
            <Button type="submit" disabled={loading} className="flex-1">
              {loading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Adding...</> : 'Add Subscriber'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
};
