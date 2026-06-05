import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { Trash2, Plus, Edit2, Archive, RotateCcw, Tv, Wifi } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { usePacks } from '@/hooks/usePacks';
import { useAuth } from '@/hooks/useAuth';
import { useEnabledServices } from '@/hooks/useEnabledServices';
import { useProviders } from '@/hooks/useProviders';
import type { Database } from '@/integrations/supabase/types';

type Pack = Database["public"]["Tables"]["packs"]["Row"] & {
  service_type?: string;
  billing_type?: string;
  validity_days?: number | null;
  provider_id?: string | null;
};

type ServiceType = 'cable' | 'internet';
type BillingType = 'postpaid' | 'prepaid';

interface PackManagementDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const emptyForm = {
  name: '',
  price: 0,
  channels: '',
  billing_type: 'postpaid' as BillingType,
  validity_days: 30,
  provider_id: '' as string,
};

export const PackManagementDialog = ({ open, onOpenChange }: PackManagementDialogProps) => {
  const { user } = useAuth();
  const { cableEnabled, internetEnabled } = useEnabledServices();
  const { packs, addPack, updatePack, deletePack, retirePack, reactivatePack } = usePacks(user?.id);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [activeService, setActiveService] = useState<ServiceType>(
    cableEnabled ? 'cable' : 'internet'
  );
  const [formData, setFormData] = useState(emptyForm);

  const resetForm = () => {
    setEditingId(null);
    setFormData(emptyForm);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || formData.price <= 0) {
      toast.error('Please enter a valid name and price');
      return;
    }
    if (formData.billing_type === 'prepaid' && (!formData.validity_days || formData.validity_days < 1)) {
      toast.error('Prepaid plans need a validity (days)');
      return;
    }

    const payload: any = {
      name: formData.name,
      price: formData.price,
      channels: activeService === 'internet' ? (formData.channels || '-') : formData.channels,
      service_type: activeService,
      billing_type: formData.billing_type,
      validity_days: formData.billing_type === 'prepaid' ? formData.validity_days : null,
    };

    const success = editingId
      ? await updatePack(editingId, payload)
      : await addPack(payload);

    if (success) {
      toast.success(editingId ? 'Pack updated' : 'Pack added');
      resetForm();
    }
  };

  const handleEdit = (pack: Pack) => {
    setActiveService((pack.service_type as ServiceType) || 'cable');
    setEditingId(pack.id);
    setFormData({
      name: pack.name,
      price: Number(pack.price),
      channels: pack.channels || '',
      billing_type: (pack.billing_type as BillingType) || 'postpaid',
      validity_days: pack.validity_days ?? 30,
    });
  };

  const handleDelete = async (id: string) => {
    if (confirm('Delete this pack? Only works if no customers are assigned.')) {
      const ok = await deletePack(id);
      if (ok) toast.success('Pack deleted');
    }
  };

  const handleRetire = async (id: string) => {
    if (confirm('Retire this pack? It will be hidden from new subscriptions.')) {
      const ok = await retirePack(id);
      if (ok) toast.success('Pack retired');
    }
  };

  const handleReactivate = async (id: string) => {
    const ok = await reactivatePack(id);
    if (ok) toast.success('Pack reactivated');
  };

  const renderPacksFor = (service: ServiceType) => {
    const list = (packs as Pack[]).filter(p => (p.service_type || 'cable') === service);
    const active = list.filter(p => p.is_active !== false);
    const retired = list.filter(p => p.is_active === false);

    const PackCard = ({ pack, retiredView }: { pack: Pack; retiredView?: boolean }) => (
      <Card className={`p-4 ${retiredView ? 'opacity-60' : ''}`}>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-medium truncate">{pack.name}</p>
              <Badge variant="outline" className="capitalize">
                {pack.billing_type || 'postpaid'}
              </Badge>
              {retiredView && <Badge variant="secondary">Retired</Badge>}
            </div>
            <p className="text-sm text-muted-foreground">
              ₹{Number(pack.price).toFixed(2)}
              {pack.billing_type === 'prepaid'
                ? ` / ${pack.validity_days || 30} days`
                : ' / month'}
            </p>
            {service === 'cable' && pack.channels && pack.channels !== '-' && (
              <p className="text-xs text-muted-foreground mt-0.5 truncate">{pack.channels}</p>
            )}
          </div>
          <div className="flex gap-1 shrink-0">
            {!retiredView ? (
              <>
                <Button variant="outline" size="sm" onClick={() => handleEdit(pack)} title="Edit">
                  <Edit2 className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="sm" onClick={() => handleRetire(pack.id)} title="Retire">
                  <Archive className="h-4 w-4" />
                </Button>
              </>
            ) : (
              <Button variant="outline" size="sm" onClick={() => handleReactivate(pack.id)} title="Reactivate">
                <RotateCcw className="h-4 w-4" />
              </Button>
            )}
            <Button variant="destructive" size="sm" onClick={() => handleDelete(pack.id)} title="Delete">
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </Card>
    );

    return (
      <div className="space-y-4">
        <div className="space-y-2">
          <h3 className="font-semibold text-sm">Active</h3>
          {active.length === 0 && <p className="text-sm text-muted-foreground">No active packs</p>}
          {active.map(p => <PackCard key={p.id} pack={p} />)}
        </div>
        {retired.length > 0 && (
          <div className="space-y-2">
            <h3 className="font-semibold text-sm text-muted-foreground">Retired</h3>
            {retired.map(p => <PackCard key={p.id} pack={p} retiredView />)}
          </div>
        )}
      </div>
    );
  };

  const showServiceTabs = cableEnabled && internetEnabled;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Manage Packages</DialogTitle>
        </DialogHeader>

        <Tabs
          value={activeService}
          onValueChange={(v) => { resetForm(); setActiveService(v as ServiceType); }}
        >
          {showServiceTabs && (
            <TabsList className="w-full">
              <TabsTrigger value="cable" className="flex-1 gap-2">
                <Tv className="h-4 w-4" /> Cable
              </TabsTrigger>
              <TabsTrigger value="internet" className="flex-1 gap-2">
                <Wifi className="h-4 w-4" /> Internet
              </TabsTrigger>
            </TabsList>
          )}

          {(['cable', 'internet'] as ServiceType[]).map(service => {
            const enabled = service === 'cable' ? cableEnabled : internetEnabled;
            if (!enabled) return null;
            return (
              <TabsContent key={service} value={service} className="space-y-6 mt-4">
                <form onSubmit={handleSubmit} className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label>Pack Name</Label>
                      <Input
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        placeholder={service === 'internet' ? 'e.g. 100 Mbps Unlimited' : 'e.g. Premium HD'}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Price (₹)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={formData.price || ''}
                        onChange={(e) => setFormData({ ...formData, price: parseFloat(e.target.value) || 0 })}
                        placeholder="0.00"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label>Billing</Label>
                      <Select
                        value={formData.billing_type}
                        onValueChange={(v) => setFormData({ ...formData, billing_type: v as BillingType })}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="postpaid">Postpaid (monthly)</SelectItem>
                          <SelectItem value="prepaid">Prepaid (recharge)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {formData.billing_type === 'prepaid' && (
                      <div className="space-y-1.5">
                        <Label>Validity (days)</Label>
                        <Input
                          type="number"
                          min={1}
                          value={formData.validity_days}
                          onChange={(e) => setFormData({ ...formData, validity_days: parseInt(e.target.value) || 0 })}
                        />
                      </div>
                    )}
                  </div>

                  {service === 'cable' && (
                    <div className="space-y-1.5">
                      <Label>Channels</Label>
                      <Input
                        value={formData.channels}
                        onChange={(e) => setFormData({ ...formData, channels: e.target.value })}
                        placeholder="e.g. Star, Sony, Zee..."
                      />
                    </div>
                  )}

                  <div className="flex gap-2">
                    <Button type="submit" className="flex-1">
                      {editingId ? <><Edit2 className="mr-2 h-4 w-4" />Update Pack</> : <><Plus className="mr-2 h-4 w-4" />Add Pack</>}
                    </Button>
                    {editingId && (
                      <Button type="button" variant="outline" onClick={resetForm}>Cancel</Button>
                    )}
                  </div>
                </form>

                {renderPacksFor(service)}
              </TabsContent>
            );
          })}
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};
