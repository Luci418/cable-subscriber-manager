import { useState, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
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
import { MapPin, Loader2, Tv, Wifi } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useRegions } from '@/hooks/useRegions';
import { useStbInventory } from '@/hooks/useStbInventory';
import { useEnabledServices } from '@/hooks/useEnabledServices';

// Accepts the raw subscribers DB row shape (snake_case) enriched with the
// normalised subscription arrays produced by `useSubscribers`.
interface SubscriberRow {
  id: string;
  name: string;
  mobile: string;
  stb_number?: string | null;
  region?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  services?: string[] | null;
  _activeCable?: any[];
  _activeInternet?: any[];
}


interface EditSubscriberDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subscriber: SubscriberRow;
  // Returns a partial of the subscribers row (snake_case columns).
  onSubmit: (updates: Record<string, any>) => void;
}

export const EditSubscriberDialog = ({
  open,
  onOpenChange,
  subscriber,
  onSubmit,
}: EditSubscriberDialogProps) => {
  const { user } = useAuth();
  const { cableEnabled, internetEnabled } = useEnabledServices();
  const { regions } = useRegions(user?.id);
  const { stbs, reloadStbs } = useStbInventory(user?.id) as any;

  const initialServices = useMemo<('cable' | 'internet')[]>(
    () =>
      (subscriber.services && subscriber.services.length > 0
        ? subscriber.services
        : ['cable']) as ('cable' | 'internet')[],
    [subscriber]
  );

  const [formData, setFormData] = useState({
    name: subscriber.name || '',
    mobile: subscriber.mobile || '',
    stbNumber: subscriber.stb_number || '',
    internetDeviceId: '' as string, // id of the assigned internet device row
    latitude: subscriber.latitude ?? undefined,
    longitude: subscriber.longitude ?? undefined,
    region: subscriber.region || '',
    services: initialServices,
  });
  const [originalInternetDeviceId, setOriginalInternetDeviceId] = useState<string>('');
  const [gettingLocation, setGettingLocation] = useState(false);

  const wantsCable = formData.services.includes('cable');
  const wantsInternet = formData.services.includes('internet');

  // Reseed whenever the dialog opens for a (possibly different) subscriber.
  useEffect(() => {
    if (!open) return;
    setFormData({
      name: subscriber.name || '',
      mobile: subscriber.mobile || '',
      stbNumber: subscriber.stb_number || '',
      internetDeviceId: '',
      latitude: subscriber.latitude ?? undefined,
      longitude: subscriber.longitude ?? undefined,
      region: subscriber.region || '',
      services: initialServices,
    });
    setOriginalInternetDeviceId('');

    // Look up the currently-assigned internet device for this subscriber.
    (async () => {
      const { data } = await supabase
        .from('stb_inventory')
        .select('id')
        .eq('subscriber_id', subscriber.id)
        .in('device_type', ['onu', 'router'])
        .maybeSingle();
      const id = (data as any)?.id || '';
      setOriginalInternetDeviceId(id);
      setFormData((p) => ({ ...p, internetDeviceId: id }));
    })();
  }, [open, subscriber, initialServices]);

  // Cable STB picker: available rows plus the currently-assigned one.
  const cableStbOptions = stbs.filter(
    (s: any) =>
      (s.service_type || 'cable') === 'cable' &&
      (s.status === 'available' || s.serial_number === subscriber.stb_number)
  );

  // Internet device picker: available rows plus the currently-assigned one.
  const internetDeviceOptions = stbs.filter(
    (s: any) =>
      s.service_type === 'internet' &&
      (s.status === 'available' || s.id === originalInternetDeviceId)
  );

  // Service uncheck is blocked while there's an active subscription on that
  // service. This prevents impossible states (subscription rows orphaned from
  // their service line) — operator must Cancel the subscription first.
  // Reads from the normalised active arrays (Phase 4b) — true when any
  // device on that service has an active subscription, supporting future
  // multi-device subscribers.
  const hasActiveCableSub = (subscriber._activeCable?.length || 0) > 0;
  const hasActiveInternetSub = (subscriber._activeInternet?.length || 0) > 0;

  const toggleService = (svc: 'cable' | 'internet', checked: boolean) => {
    if (!checked) {
      if (svc === 'cable' && hasActiveCableSub) {
        toast.error('Cancel the active Cable subscription before removing the service.');
        return;
      }
      if (svc === 'internet' && hasActiveInternetSub) {
        toast.error('Cancel the active Internet plan before removing the service.');
        return;
      }
    }
    setFormData((prev) => ({
      ...prev,
      services: checked
        ? Array.from(new Set([...prev.services, svc]))
        : prev.services.filter((s) => s !== svc),
      ...(svc === 'cable' && !checked ? { stbNumber: '' } : {}),
      ...(svc === 'internet' && !checked ? { internetDeviceId: '' } : {}),
    }));
  };


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

    // ---- Reconcile inventory assignments ----
    // Cable STB
    const prevStb = subscriber.stb_number || '';
    const newStb = wantsCable ? formData.stbNumber : '';
    try {
      if (prevStb && prevStb !== newStb) {
        await supabase
          .from('stb_inventory')
          .update({ status: 'available', subscriber_id: null })
          .eq('user_id', user!.id)
          .eq('serial_number', prevStb);
      }
      if (newStb && newStb !== prevStb) {
        await supabase
          .from('stb_inventory')
          .update({ status: 'assigned', subscriber_id: subscriber.id })
          .eq('user_id', user!.id)
          .eq('serial_number', newStb);
      }
    } catch (err) {
      console.warn('Cable STB reconcile failed:', err);
    }

    // Internet device
    const prevDev = originalInternetDeviceId;
    const newDev = wantsInternet ? formData.internetDeviceId : '';
    try {
      if (prevDev && prevDev !== newDev) {
        await supabase
          .from('stb_inventory')
          .update({ status: 'available', subscriber_id: null })
          .eq('id', prevDev);
      }
      if (newDev && newDev !== prevDev) {
        await supabase
          .from('stb_inventory')
          .update({ status: 'assigned', subscriber_id: subscriber.id })
          .eq('id', newDev);
      }
    } catch (err) {
      console.warn('Internet device reconcile failed:', err);
    }

    // ---- Build subscriber update (snake_case DB columns) ----
    const updates: Record<string, any> = {
      name: formData.name.trim(),
      mobile: formData.mobile,
      region: formData.region,
      latitude: formData.latitude ?? null,
      longitude: formData.longitude ?? null,
      services: formData.services,
      stb_number: wantsCable ? formData.stbNumber : null,
    };

    // If cable was removed, clear its plan label (active subscription rows
    // are gone via Cancel — this just drops the cached pack name on the row).
    if (!wantsCable) {
      updates.current_pack = null;
    }
    // If internet was removed, clear its plan label.
    if (!wantsInternet) {
      updates.current_internet_pack = null;
    }

    onSubmit(updates);
    reloadStbs?.();
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

          {/* Services chooser — only when both modules are enabled globally */}
          {cableEnabled && internetEnabled && (
            <div className="space-y-2">
              <Label>Services *</Label>
              <div className="grid grid-cols-2 gap-2">
                <label className={`flex items-center gap-2 rounded-md border p-3 ${hasActiveCableSub && wantsCable ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer hover:bg-accent'}`}>
                  <Checkbox
                    checked={wantsCable}
                    onCheckedChange={(c) => toggleService('cable', !!c)}
                    disabled={hasActiveCableSub && wantsCable}
                  />
                  <Tv className="h-4 w-4" />
                  <span className="text-sm font-medium">Cable</span>
                </label>
                <label className={`flex items-center gap-2 rounded-md border p-3 ${hasActiveInternetSub && wantsInternet ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer hover:bg-accent'}`}>
                  <Checkbox
                    checked={wantsInternet}
                    onCheckedChange={(c) => toggleService('internet', !!c)}
                    disabled={hasActiveInternetSub && wantsInternet}
                  />
                  <Wifi className="h-4 w-4" />
                  <span className="text-sm font-medium">Internet</span>
                </label>
              </div>
              <p className="text-xs text-muted-foreground">
                {(hasActiveCableSub || hasActiveInternetSub)
                  ? 'Active subscriptions must be cancelled before removing their service.'
                  : 'Removing a service unassigns its device and clears the active plan. Balances are kept.'}
              </p>
            </div>
          )}


          {wantsCable && (
            <div className="space-y-2">
              <Label>STB (Cable) *</Label>
              <Select
                value={formData.stbNumber}
                onValueChange={(value) => setFormData({ ...formData, stbNumber: value })}
                disabled={hasActiveCableSub}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select STB" />
                </SelectTrigger>
                <SelectContent>
                  {cableStbOptions.length === 0 ? (
                    <div className="px-2 py-3 text-sm text-muted-foreground text-center">
                      No available STBs
                    </div>
                  ) : (
                    cableStbOptions.map((stb: any) => (
                      <SelectItem key={stb.id} value={stb.serial_number}>
                        {stb.serial_number}
                        {stb.serial_number === subscriber.stb_number ? ' (current)' : ''}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              {hasActiveCableSub && (
                <p className="text-xs text-muted-foreground">
                  STB is locked while a cable subscription is active. Cancel the subscription to reassign.
                </p>
              )}
            </div>
          )}


          {wantsInternet && (
            <div className="space-y-2">
              <Label>ONU / Router (Internet) *</Label>
              <Select
                value={formData.internetDeviceId}
                onValueChange={(value) =>
                  setFormData({ ...formData, internetDeviceId: value })
                }
                disabled={hasActiveInternetSub}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select ONU/Router" />
                </SelectTrigger>
                <SelectContent>
                  {internetDeviceOptions.length === 0 ? (
                    <div className="px-2 py-3 text-sm text-muted-foreground text-center">
                      No available ONU/Router. Add one in Inventory.
                    </div>
                  ) : (
                    internetDeviceOptions.map((d: any) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.serial_number} ({(d.device_type || 'onu').toUpperCase()})
                        {d.id === originalInternetDeviceId ? ' (current)' : ''}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              {hasActiveInternetSub && (
                <p className="text-xs text-muted-foreground">
                  Internet device is locked while an internet plan is active. Cancel the plan to reassign.
                </p>
              )}
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

          <div className="flex gap-2 pt-4">
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
