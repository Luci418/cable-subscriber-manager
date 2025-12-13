import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { Loader2, MapPin } from 'lucide-react';

interface AddSubscriberFormProps {
  onSubmit: (data: {
    name: string;
    mobile: string;
    stbNumber: string;
    latitude?: number;
    longitude?: number;
    region: string;
    balance: number;
    housePicture?: string;
  }) => void;
  onCancel: () => void;
}

export const AddSubscriberForm = ({ onSubmit, onCancel }: AddSubscriberFormProps) => {
  const [formData, setFormData] = useState({
    name: '',
    mobile: '',
    stbNumber: '',
    latitude: undefined as number | undefined,
    longitude: undefined as number | undefined,
    region: '',
    balance: 0,
    housePicture: undefined as string | undefined,
  });
  const [loading, setLoading] = useState(false);
  const [gettingLocation, setGettingLocation] = useState(false);
  const { user } = useAuth();
  const { regions } = useRegions(user?.id);
  const { stbs } = useStbInventory(user?.id);

  const availableStbs = stbs.filter(stb => stb.status === 'available');

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
        toast.success('Location captured successfully!');
        setGettingLocation(false);
      },
      (error) => {
        toast.error('Failed to get location: ' + error.message);
        setGettingLocation(false);
      },
      {
        enableHighAccuracy: false, // Faster, less accurate
        timeout: 5000, // 5 second timeout
        maximumAge: 0
      }
    );
  };

  const handleImageCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setFormData({ ...formData, housePicture: reader.result as string });
        toast.success('House picture captured!');
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.name || !formData.mobile || !formData.stbNumber || !formData.region) {
      toast.error('Please fill in all required fields');
      return;
    }

    setLoading(true);
    try {
      onSubmit(formData);
      toast.success('Subscriber added successfully!');
    } catch (error) {
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

          <div className="space-y-2">
            <Label htmlFor="stb">STB Number *</Label>
            <Select value={formData.stbNumber} onValueChange={(value) => setFormData({ ...formData, stbNumber: value })}>
              <SelectTrigger>
                <SelectValue placeholder="Select available STB" />
              </SelectTrigger>
              <SelectContent>
                {availableStbs.length === 0 ? (
                  <SelectItem value="" disabled>No available STBs in inventory</SelectItem>
                ) : (
                  availableStbs.map(stb => (
                    <SelectItem key={stb.id} value={stb.serial_number}>{stb.serial_number}</SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
            {availableStbs.length === 0 && (
              <p className="text-sm text-destructive">Add STBs to inventory first</p>
            )}
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
                    Get Coordinates
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
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Adding...
                </>
              ) : (
                'Add Subscriber'
              )}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
};
