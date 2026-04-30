import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { ArrowLeft, Save, Download, Upload, Building2, Tv, Wifi } from 'lucide-react';
import { getCompanySettings, saveCompanySettings, createBackup, restoreBackup, CompanySettings, ServiceType } from '@/lib/storage';
import { toast } from 'sonner';

interface SettingsProps {
  onBack: () => void;
}

export const Settings = ({ onBack }: SettingsProps) => {
  const [settings, setSettings] = useState<CompanySettings>(getCompanySettings());

  const handleSaveSettings = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    saveCompanySettings(settings);
    toast.success('Company settings saved successfully');
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
        <p className="text-muted-foreground">Manage company details and data backup</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Company Settings */}
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              Company Information
            </CardTitle>
            <CardDescription>Update your company details for invoices and receipts</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSaveSettings} className="space-y-4">
              <div>
                <Label htmlFor="name">Company Name</Label>
                <Input
                  id="name"
                  value={settings.name}
                  onChange={(e) => setSettings({ ...settings, name: e.target.value })}
                  required
                />
              </div>
              <div>
                <Label htmlFor="address">Address</Label>
                <Textarea
                  id="address"
                  value={settings.address}
                  onChange={(e) => setSettings({ ...settings, address: e.target.value })}
                  required
                  rows={3}
                />
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <Label htmlFor="phone">Phone</Label>
                  <Input
                    id="phone"
                    type="tel"
                    value={settings.phone}
                    onChange={(e) => setSettings({ ...settings, phone: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={settings.email}
                    onChange={(e) => setSettings({ ...settings, email: e.target.value })}
                    required
                  />
                </div>
              </div>
              <Button type="submit">
                <Save className="mr-2 h-4 w-4" />
                Save Settings
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Service Modules — toggle Cable / Internet at any time. Disabling does NOT delete data. */}
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
              const enabled = (settings.enabledServices ?? ['cable']).includes(svc);
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
                    onCheckedChange={(checked) => {
                      const current = new Set(settings.enabledServices ?? ['cable']);
                      if (checked) current.add(svc); else current.delete(svc);
                      if (current.size === 0) {
                        toast.error('At least one service must be enabled.');
                        return;
                      }
                      const next = { ...settings, enabledServices: Array.from(current) as ServiceType[] };
                      setSettings(next);
                      saveCompanySettings(next);
                      toast.success(`${label} ${checked ? 'enabled' : 'disabled'}`);
                    }}
                  />
                </div>
              );
            })}
          </CardContent>
        </Card>

        {/* Backup & Restore */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Download className="h-5 w-5" />
              Backup Data
            </CardTitle>
            <CardDescription>Export all your data to a backup file</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              Create a complete backup of all subscribers, transactions, packs, regions, complaints, and settings.
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
              Restore all data from a previous backup. An automatic backup will be created before restoring.
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
