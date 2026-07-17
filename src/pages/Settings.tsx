import { useEffect, useState } from 'react';
import { NavLink, useParams, Navigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, Scale } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Save, Download, Upload, Building2, Tv, Wifi, Receipt, CreditCard, Layers, ShieldCheck, Database } from 'lucide-react';
import { PageHeader, SectionCard } from '@/components/ui-ext';
import { cn } from '@/lib/utils';
import { createBackup, restoreBackup } from '@/lib/storage';
import { useSettings, type ServiceType, type BusinessSettings } from '@/contexts/SettingsContext';
import { toast } from 'sonner';
import { usePermissions } from '@/lib/permissions';
import { RolesManagement } from '@/components/RolesManagement';

/**
 * Settings — sub-route driven (Batch 3).
 *
 * URL: /settings/{company | payment | services | receipts | roles | backup}
 * Each section is a bookmarkable sub-route; the shared shell renders the
 * side-nav and reuses PageHeader/SectionCard so future sections drop in
 * without further layout work. No new settings fields were introduced —
 * this batch only reorganises what already exists.
 */
interface NavEntry {
  slug: string;
  label: string;
  icon: React.ComponentType<any>;
  hint?: string;
}

const SECTIONS: NavEntry[] = [
  { slug: 'company',  label: 'Company',       icon: Building2,   hint: 'Name, address, contact' },
  { slug: 'payment',  label: 'Payment',       icon: CreditCard,  hint: 'UPI VPA, backdating' },
  { slug: 'services', label: 'Services',      icon: Layers,      hint: 'Enabled service modules' },
  { slug: 'receipts', label: 'Receipts',      icon: Receipt,     hint: 'Prefix, footer, locale' },
  { slug: 'roles',    label: 'Team & Roles',  icon: ShieldCheck, hint: 'Staff and permissions' },
  { slug: 'backup',   label: 'Backup',        icon: Database,    hint: 'Export & restore' },
];

export const Settings = () => {
  const { section = 'company' } = useParams<{ section: string }>();
  const known = SECTIONS.find((s) => s.slug === section);
  const { settings, loading, updateSettings, setEnabledServices } = useSettings();
  const perms = usePermissions();
  const [draft, setDraft] = useState<BusinessSettings | null>(settings);
  const readOnly = !perms.canModifySettings;

  useEffect(() => {
    if (settings) setDraft(settings);
  }, [settings]);

  if (!known) return <Navigate to="/settings/company" replace />;

  if (loading || !draft) {
    return <div className="p-6 text-sm text-muted-foreground">Loading settings…</div>;
  }

  const saveCompanyInfo = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    await updateSettings({ name: draft.name, address: draft.address, phone: draft.phone, email: draft.email });
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
    <>
      <PageHeader
        title="Settings"
        description="Configure your business, payment, and staff access. Changes save to your account database."
      />

      {readOnly && (
        <div className="mb-4 rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm">
          You have read-only access to Settings. Only an <span className="font-medium">Owner</span> can change business configuration.
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-[220px_1fr]">
        <nav className="rounded-lg border bg-card p-2 h-max">
          <ul className="space-y-0.5">
            {SECTIONS.map((s) => (
              <li key={s.slug}>
                <NavLink
                  to={`/settings/${s.slug}`}
                  className={({ isActive }) =>
                    cn(
                      'flex items-start gap-3 rounded-md px-3 py-2 text-sm transition-colors',
                      isActive
                        ? 'bg-accent text-accent-foreground'
                        : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                    )
                  }
                >
                  <s.icon className="h-4 w-4 mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <div className="font-medium leading-tight">{s.label}</div>
                    {s.hint && <div className="text-[11px] opacity-70 truncate">{s.hint}</div>}
                  </div>
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0 space-y-6">
          {section === 'company' && (
            <SectionCard title="Company information" description="Used on invoices and receipts.">
              <form onSubmit={saveCompanyInfo} className="space-y-4">
                <div>
                  <Label htmlFor="name">Company Name</Label>
                  <Input id="name" value={draft.name}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })} required />
                </div>
                <div>
                  <Label htmlFor="address">Address</Label>
                  <Textarea id="address" value={draft.address} rows={3}
                    onChange={(e) => setDraft({ ...draft, address: e.target.value })} />
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <Label htmlFor="phone">Phone</Label>
                    <Input id="phone" type="tel" value={draft.phone}
                      onChange={(e) => setDraft({ ...draft, phone: e.target.value })} />
                  </div>
                  <div>
                    <Label htmlFor="email">Email</Label>
                    <Input id="email" type="email" value={draft.email}
                      onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
                  </div>
                </div>
                <Button type="submit" disabled={readOnly}>
                  <Save className="mr-2 h-4 w-4" /> Save
                </Button>
              </form>
            </SectionCard>
          )}

          {section === 'payment' && (
            <SectionCard title="Payment settings" description="How you receive payments and how far back transactions may be dated.">
              <form onSubmit={savePaymentSettings} className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <Label htmlFor="upi_vpa">Operator UPI ID (VPA)</Label>
                    <Input id="upi_vpa" placeholder="yourname@bank" value={draft.operator_upi_vpa ?? ''}
                      onChange={(e) => setDraft({ ...draft, operator_upi_vpa: e.target.value })} />
                    <p className="text-xs text-muted-foreground mt-1">
                      Required to accept UPI in Collect Payment. Leave blank to disable UPI.
                    </p>
                  </div>
                  <div>
                    <Label htmlFor="backdating">Backdating window (days)</Label>
                    <Input id="backdating" type="number" min={0} max={90}
                      value={draft.backdating_window_days}
                      onChange={(e) => setDraft({ ...draft,
                        backdating_window_days: Math.max(0, Math.min(90, Number(e.target.value) || 0)) })} />
                    <p className="text-xs text-muted-foreground mt-1">
                      0 = today only. Operators cannot date a transaction earlier than this window.
                    </p>
                  </div>
                </div>
                <Button type="submit" disabled={readOnly}>
                  <Save className="mr-2 h-4 w-4" /> Save
                </Button>
              </form>
            </SectionCard>
          )}

          {section === 'services' && (
            <SectionCard
              title="Service modules"
              description="Enable the services you offer. Turning a service off hides its UI but keeps all underlying data safe."
            >
              <div className="space-y-3">
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
                        disabled={readOnly}
                        onCheckedChange={async (checked) => {
                          const current = new Set(draft.enabled_services);
                          if (checked) current.add(svc); else current.delete(svc);
                          if (current.size === 0) { toast.error('At least one service must be enabled.'); return; }
                          const next = Array.from(current) as ServiceType[];
                          setDraft({ ...draft, enabled_services: next });
                          await setEnabledServices(next);
                          toast.success(`${label} ${checked ? 'enabled' : 'disabled'}`);
                        }}
                      />
                    </div>
                  );
                })}
              </div>
            </SectionCard>
          )}

          {section === 'receipts' && (
            <SectionCard
              title="Receipts & locale"
              description="Receipt numbering prefix, footer line printed on every receipt, and locale defaults."
            >
              <form onSubmit={saveReceiptSettings} className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <Label htmlFor="receipt_prefix">Receipt prefix</Label>
                    <Input id="receipt_prefix" value={draft.receipt_prefix} maxLength={10}
                      onChange={(e) => setDraft({ ...draft, receipt_prefix: e.target.value })} />
                  </div>
                  <div>
                    <Label htmlFor="default_currency">Default currency</Label>
                    <Input id="default_currency" value={draft.default_currency} maxLength={8}
                      onChange={(e) => setDraft({ ...draft, default_currency: e.target.value })} />
                  </div>
                  <div className="md:col-span-2">
                    <Label htmlFor="receipt_footer">Receipt footer</Label>
                    <Input id="receipt_footer" value={draft.receipt_footer}
                      onChange={(e) => setDraft({ ...draft, receipt_footer: e.target.value })} />
                  </div>
                  <div className="md:col-span-2">
                    <Label htmlFor="default_timezone">Default timezone</Label>
                    <Input id="default_timezone" value={draft.default_timezone}
                      onChange={(e) => setDraft({ ...draft, default_timezone: e.target.value })} />
                    <p className="text-xs text-muted-foreground mt-1">
                      IANA name (e.g. <code>Asia/Kolkata</code>). Used for date/time display defaults.
                    </p>
                  </div>
                </div>
                <Button type="submit" disabled={readOnly}>
                  <Save className="mr-2 h-4 w-4" /> Save
                </Button>
              </form>
            </SectionCard>
          )}

          {section === 'roles' && <RolesManagement />}

          {section === 'backup' && (
            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <SectionCard title="Backup data" description="Export local caches to a backup file.">
                  <p className="text-sm text-muted-foreground mb-4">
                    Business configuration is stored in your account database and does not require backup.
                    This export covers any legacy local caches.
                  </p>
                  <Button onClick={handleBackup} variant="outline" className="w-full">
                    <Download className="mr-2 h-4 w-4" /> Download backup
                  </Button>
                </SectionCard>
                <SectionCard title="Restore data" description="Import data from a backup file.">
                  <p className="text-sm text-muted-foreground mb-4">
                    Restore data from a previous backup. An automatic backup will be created before restoring.
                  </p>
                  <Button onClick={handleRestore} variant="outline" className="w-full">
                    <Upload className="mr-2 h-4 w-4" /> Upload backup
                  </Button>
                </SectionCard>
              </div>

              {perms.isOwner && (
                <SectionCard
                  title="Reconcile all balances"
                  description="Recompute every subscriber's cable and internet balances from the transaction ledger. Any drift is corrected and logged to the audit trail."
                >
                  <p className="text-sm text-muted-foreground mb-4">
                    Run this if you suspect a balance mismatch, or as a monthly integrity check. Owner-only.
                    Runs in one pass over your entire subscriber base — expect it to take a few seconds on large accounts.
                  </p>
                  <ReconcileAllButton />
                </SectionCard>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
};
