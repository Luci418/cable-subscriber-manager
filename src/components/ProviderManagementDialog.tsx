import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Trash2, Plus, Edit2, Archive, RotateCcw, Tv, Wifi, Building } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useEnabledServices } from '@/hooks/useEnabledServices';
import { useProviders, type Provider, type ProviderServiceType } from '@/hooks/useProviders';

interface ProviderManagementDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const empty = { name: '', notes: '' };

export const ProviderManagementDialog = ({ open, onOpenChange }: ProviderManagementDialogProps) => {
  const { user } = useAuth();
  const { cableEnabled, internetEnabled } = useEnabledServices();
  const { providers, addProvider, updateProvider, deleteProvider, retireProvider, reactivateProvider } =
    useProviders(user?.id);

  const [activeService, setActiveService] = useState<ProviderServiceType>(
    cableEnabled ? 'cable' : 'internet'
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(empty);

  const reset = () => { setEditingId(null); setForm(empty); };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) { toast.error('Please enter a provider name'); return; }
    const payload = { name: form.name.trim(), service_type: activeService, notes: form.notes || null };
    const ok = editingId
      ? await updateProvider(editingId, payload)
      : await addProvider(payload);
    if (ok) { toast.success(editingId ? 'Provider updated' : 'Provider added'); reset(); }
  };

  const handleEdit = (p: Provider) => {
    setActiveService(p.service_type);
    setEditingId(p.id);
    setForm({ name: p.name, notes: p.notes || '' });
  };

  const handleDelete = async (id: string) => {
    const { confirm } = await import('@/lib/confirm');
    if (!(await confirm({
      title: 'Delete provider?',
      description: 'This only works if nothing references it (packs, subscriptions, transactions, subscribers). Otherwise, retire it instead.',
      confirmText: 'Delete',
      destructive: true,
    }))) return;
    const ok = await deleteProvider(id);
    if (ok) toast.success('Provider deleted');
  };

  const renderListFor = (service: ProviderServiceType) => {
    const list = providers.filter(p => p.service_type === service);
    const active = list.filter(p => p.is_active);
    const retired = list.filter(p => !p.is_active);

    const Row = ({ p, retiredView }: { p: Provider; retiredView?: boolean }) => (
      <Card className={`p-3 ${retiredView ? 'opacity-60' : ''}`}>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-medium truncate">{p.name}</p>
              {retiredView && <Badge variant="secondary">Retired</Badge>}
            </div>
            {p.notes && <p className="text-xs text-muted-foreground mt-0.5 truncate">{p.notes}</p>}
          </div>
          <div className="flex gap-1 shrink-0">
            {!retiredView ? (
              <>
                <Button variant="outline" size="sm" onClick={() => handleEdit(p)} title="Edit">
                  <Edit2 className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="sm" onClick={() => retireProvider(p.id).then(ok => ok && toast.success('Retired'))} title="Retire">
                  <Archive className="h-4 w-4" />
                </Button>
              </>
            ) : (
              <Button variant="outline" size="sm" onClick={() => reactivateProvider(p.id).then(ok => ok && toast.success('Reactivated'))} title="Reactivate">
                <RotateCcw className="h-4 w-4" />
              </Button>
            )}
            <Button variant="destructive" size="sm" onClick={() => handleDelete(p.id)} title="Delete">
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </Card>
    );

    return (
      <div className="space-y-3">
        <div className="space-y-2">
          <h3 className="font-semibold text-sm">Active</h3>
          {active.length === 0 && <p className="text-sm text-muted-foreground">No active providers</p>}
          {active.map(p => <Row key={p.id} p={p} />)}
        </div>
        {retired.length > 0 && (
          <div className="space-y-2">
            <h3 className="font-semibold text-sm text-muted-foreground">Retired</h3>
            {retired.map(p => <Row key={p.id} p={p} retiredView />)}
          </div>
        )}
      </div>
    );
  };

  const showTabs = cableEnabled && internetEnabled;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building className="h-5 w-5" /> Manage Providers
          </DialogTitle>
          <DialogDescription>
            Providers are the upstream networks supplying each service (e.g. BSNL, Fastnet, your own Cable/ISP network).
            Packs, subscriptions and transactions get tagged with their provider so analytics can split revenue by network.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeService} onValueChange={(v) => { reset(); setActiveService(v as ProviderServiceType); }}>
          {showTabs && (
            <TabsList className="w-full">
              <TabsTrigger value="cable" className="flex-1 gap-2"><Tv className="h-4 w-4" /> Cable</TabsTrigger>
              <TabsTrigger value="internet" className="flex-1 gap-2"><Wifi className="h-4 w-4" /> Internet</TabsTrigger>
            </TabsList>
          )}
          {(['cable','internet'] as ProviderServiceType[]).map(service => {
            const enabled = service === 'cable' ? cableEnabled : internetEnabled;
            if (!enabled) return null;
            return (
              <TabsContent key={service} value={service} className="space-y-5 mt-4">
                <form onSubmit={handleSubmit} className="space-y-3">
                  <div className="space-y-1.5">
                    <Label>Provider Name</Label>
                    <Input
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      placeholder={service === 'internet' ? 'e.g. BSNL, Fastnet, Own ISP' : 'e.g. Own Cable Network'}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Notes (optional)</Label>
                    <Input
                      value={form.notes}
                      onChange={(e) => setForm({ ...form, notes: e.target.value })}
                      placeholder="e.g. Leased line 100Mbps from BSNL"
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button type="submit" className="flex-1">
                      {editingId ? <><Edit2 className="mr-2 h-4 w-4" />Update Provider</> : <><Plus className="mr-2 h-4 w-4" />Add Provider</>}
                    </Button>
                    {editingId && <Button type="button" variant="outline" onClick={reset}>Cancel</Button>}
                  </div>
                </form>
                {renderListFor(service)}
              </TabsContent>
            );
          })}
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};
