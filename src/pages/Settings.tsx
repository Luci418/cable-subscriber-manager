import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { ArrowLeft, Save, Download, Upload, Building2, Tv, Wifi, Receipt } from 'lucide-react';
import { createBackup, restoreBackup } from '@/lib/storage';
import { useSettings, type ServiceType, type BusinessSettings } from '@/contexts/SettingsContext';
import { toast } from 'sonner';
import { usePermissions } from '@/lib/permissions';
import { RolesManagement } from '@/components/RolesManagement';

interface SettingsProps {
  onBack: () => void;
}

/**
 * All Business Configuration writes go through `useSettings()` → DB. Nothing
 * on this page touches localStorage. Form state is a local working copy that
 * is committed via `updateSettings()` on save; the context updates optimistically
 * and rolls back on error.
 */
export const Settings = ({ onBack }: SettingsProps) => {
  const { settings, loading, updateSettings, setEnabledServices } = useSettings();
  const perms = usePermissions();
  const [draft, setDraft] = useState<BusinessSettings | null>(settings);
  const readOnly = !perms.canModifySettings;

  useEffect(() => {
    if (settings) setDraft(settings);
  }, [settings]);

  if (loading || !draft) {
    return (
      <div className="p-6 text-sm text-muted-foreground">Loading settings…</div>
    );
  }

  const saveCompanyInfo = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    await updateSettings({
      name: draft.name,
      address: draft.address,
      phone: draft.phone,
      email: draft.email,
    });
    toast.success('Company settings saved');
  };

  const savePaymentSettings = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    await updateSettings({
      operator_upi_vpa: draft.operator_upi_vpa?.trim() || null,
      backdating_window_days: draft.backdating_window_days,
    });
    toast.success('Payment settings saved');
  };

  const saveReceiptSettings = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    await updateSettings({
      receipt_prefix: draft.receipt_prefix.trim() || 'RCP',
      receipt_footer: draft.receipt_footer,
      default_currency: draft.default_currency.trim() || 'INR',
      default_timezone: draft.default_timezone.trim() || 'Asia/Kolkata',
    });
    toast.success('Receipt & locale settings saved');
  };

  const handleBackup = () => {
    createBackup();
    toast.success('Backup created successfully');
  };

  const handleRestore = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        await restoreBackup(file);
        toast.success('Data restored successfully! Please refresh the page.');
        setTimeout(() => window.location.reload(), 2000);
      } catch (error) {
        toast.error('Failed to restore backup: ' + (error as Error).message);
      }
    };
    input.click();
  };

  return (
    <div className="space-y-6">
      <div>
        <Button variant="ghost" onClick={onBack} className="mb-4">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Subscribers
        </Button>
        <h1 className="text-3xl font-bold text-foreground">Settings</h1>
        <p className="text-muted-foreground">Business configuration is stored in your account database.</p>
        {readOnly && (
          <div className="mt-3 rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm">
            You have read-only access to Settings. Only an <span className="font-medium">Owner</span> can change business configuration.
          </div>
        )}
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <RolesManagement />
        {/* Company Information */}
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              Company Information
            </CardTitle>
            <CardDescription>Used on invoices and receipts.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={saveCompanyInfo} className="space-y-4">
              <div>
                <Label htmlFor="name">Company Name</Label>
                <Input
                  id="name"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  required
                />
              </div>
              <div>
                <Label htmlFor="address">Address</Label>
                <Textarea
                  id="address"
                  value={draft.address}
                  onChange={(e) => setDraft({ ...draft, address: e.target.value })}
                  rows={3}
                />
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <Label htmlFor="phone">Phone</Label>
                  <Input
                    id="phone"
                    type="tel"
                    value={draft.phone}
                    onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={draft.email}
                    onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                  />
                </div>
              </div>
              <Button type="submit">
                <Save className="mr-2 h-4 w-4" />
                Save Company Info
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Payment Settings */}
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Save className="h-5 w-5" />
              Payment Settings
            </CardTitle>
            <CardDescription>
              Operator UPI ID for receiving payments, and how far back transactions may be dated.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={savePaymentSettings} className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <Label htmlFor="upi_vpa">Operator UPI ID (VPA)</Label>
                  <Input
                    id="upi_vpa"
                    placeholder="yourname@bank"
                    value={draft.operator_upi_vpa ?? ''}
                    onChange={(e) => setDraft({ ...draft, operator_upi_vpa: e.target.value })}
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Required to accept UPI in Collect Payment. Leave blank to disable UPI.
                  </p>
                </div>
                <div>
                  <Label htmlFor="backdating">Backdating window (days)</Label>
                  <Input
                    id="backdating"
                    type="number"
                    min={0}
                    max={90}
                    value={draft.backdating_window_days}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        backdating_window_days: Math.max(0, Math.min(90, Number(e.target.value) || 0)),
                      })
                    }
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    0 = today only. Operators cannot date a transaction earlier than this window.
                  </p>
                </div>
              </div>
              <Button type="submit">
                <Save className="mr-2 h-4 w-4" />
                Save Payment Settings
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Receipt & Locale Settings */}
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Receipt className="h-5 w-5" />
              Receipts & Locale
            </CardTitle>
            <CardDescription>
              Receipt numbering prefix, footer line printed on every receipt, and locale defaults.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={saveReceiptSettings} className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <Label htmlFor="receipt_prefix">Receipt prefix</Label>
                  <Input
                    id="receipt_prefix"
                    value={draft.receipt_prefix}
                    onChange={(e) => setDraft({ ...draft, receipt_prefix: e.target.value })}
                    maxLength={10}
                  />
                </div>
                <div>
                  <Label htmlFor="default_currency">Default currency</Label>
                  <Input
                    id="default_currency"
                    value={draft.default_currency}
                    onChange={(e) => setDraft({ ...draft, default_currency: e.target.value })}
                    maxLength={8}
                  />
                </div>
                <div className="md:col-span-2">
                  <Label htmlFor="receipt_footer">Receipt footer</Label>
                  <Input
                    id="receipt_footer"
                    value={draft.receipt_footer}
                    onChange={(e) => setDraft({ ...draft, receipt_footer: e.target.value })}
                  />
                </div>
                <div className="md:col-span-2">
                  <Label htmlFor="default_timezone">Default timezone</Label>
                  <Input
                    id="default_timezone"
                    value={draft.default_timezone}
                    onChange={(e) => setDraft({ ...draft, default_timezone: e.target.value })}
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    IANA name (e.g. <code>Asia/Kolkata</code>). Used for date/time display defaults.
                  </p>
                </div>
              </div>
              <Button type="submit">
                <Save className="mr-2 h-4 w-4" />
                Save Receipt Settings
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Service Modules */}
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wifi className="h-5 w-5" />
              Service Modules
            </CardTitle>
            <CardDescription>
              Enable the services you offer. You can run Cable, Internet, or both.
              Turning a service off hides its UI but keeps all underlying data safe.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {(['cable', 'internet'] as ServiceType[]).map((svc) => {
              const enabled = draft.enabled_services.includes(svc);
              const Icon = svc === 'cable' ? Tv : Wifi;
              const label = svc === 'cable' ? 'Cable TV' : 'Internet (ISP)';
              const desc = svc === 'cable'
                ? 'Set-top boxes, channel packs, monthly cable subscriptions.'
                : 'ONU/Router devices, internet plans, separate internet balance.';
              return (
                <div key={svc} className="flex items-center justify-between gap-4 rounded-lg border p-4">
                  <div className="flex items-start gap-3 min-w-0">
                    <Icon className="h-5 w-5 mt-0.5 text-muted-foreground shrink-0" />
                    <div className="min-w-0">
                      <p className="font-medium text-foreground">{label}</p>
                      <p className="text-sm text-muted-foreground">{desc}</p>
                    </div>
                  </div>
                  <Switch
                    checked={enabled}
                    onCheckedChange={async (checked) => {
                      const current = new Set(draft.enabled_services);
                      if (checked) current.add(svc); else current.delete(svc);
                      if (current.size === 0) {
                        toast.error('At least one service must be enabled.');
                        return;
                      }
                      const next = Array.from(current) as ServiceType[];
                      setDraft({ ...draft, enabled_services: next });
                      await setEnabledServices(next);
                      toast.success(`${label} ${checked ? 'enabled' : 'disabled'}`);
                    }}
                  />
                </div>
              );
            })}
          </CardContent>
        </Card>

        {/* Backup & Restore — operates on the legacy localStorage data caches only.
            Business configuration is in the DB and survives backup/restore automatically. */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Download className="h-5 w-5" />
              Backup Data
            </CardTitle>
            <CardDescription>Export local caches to a backup file</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              Business configuration is stored in your account database and does not require backup.
              This export covers any legacy local caches.
            </p>
            <Button onClick={handleBackup} variant="outline" className="w-full">
              <Download className="mr-2 h-4 w-4" />
              Download Backup
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5" />
              Restore Data
            </CardTitle>
            <CardDescription>Import data from a backup file</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              Restore data from a previous backup. An automatic backup will be created before restoring.
            </p>
            <Button onClick={handleRestore} variant="outline" className="w-full">
              <Upload className="mr-2 h-4 w-4" />
              Upload Backup
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
