/**
 * SettingsContext — single source of truth for business configuration.
 *
 * The database (`public.settings`, one row per `auth.uid()`) is authoritative.
 * This context hydrates from the DB after login, exposes a `useSettings()` hook
 * for reads/writes, and performs a one-time, gated import of the legacy
 * localStorage `cable_company_settings` blob so existing installs are not lost.
 *
 * NO business configuration is read from or written to localStorage by this
 * module after the one-time import. localStorage is reserved for transient UI
 * state and auth-session storage handled by the Supabase client.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

export type ServiceType = 'cable' | 'internet';

export interface BusinessSettings {
  user_id: string;
  name: string;
  address: string;
  phone: string;
  email: string;
  enabled_services: ServiceType[];
  operator_upi_vpa: string | null;
  backdating_window_days: number;
  receipt_prefix: string;
  receipt_footer: string;
  default_currency: string;
  default_timezone: string;
  settings_version: number;
  updated_at: string;
}

/** Shape used by PDF helpers — derived from BusinessSettings. */
export interface CompanyForPdf {
  name: string;
  address: string;
  phone: string;
  email: string;
  receipt_footer: string;
}

export const settingsToCompany = (s: BusinessSettings): CompanyForPdf => ({
  name: s.name,
  address: s.address,
  phone: s.phone,
  email: s.email,
  receipt_footer: s.receipt_footer,
});

interface SettingsCtx {
  settings: BusinessSettings | null;
  loading: boolean;
  updateSettings: (patch: Partial<Omit<BusinessSettings, 'user_id' | 'updated_at'>>) => Promise<void>;
  enabledServices: ServiceType[];
  setEnabledServices: (next: ServiceType[]) => Promise<void>;
  cableEnabled: boolean;
  internetEnabled: boolean;
  bothEnabled: boolean;
}

const Ctx = createContext<SettingsCtx | null>(null);

const LEGACY_KEY = 'cable_company_settings';

/** Defaults that match the DB column defaults. Used to detect "row at defaults". */
const DB_DEFAULTS = {
  name: 'My Cable Company',
  address: '',
  phone: '',
  email: '',
  enabled_services: ['cable'] as ServiceType[],
  receipt_prefix: 'RCP',
  receipt_footer: 'Thank you for your business.',
  default_currency: 'INR',
  default_timezone: 'Asia/Kolkata',
  backdating_window_days: 7,
  operator_upi_vpa: null as string | null,
};

const rowIsAtDefaults = (s: BusinessSettings): boolean =>
  s.name === DB_DEFAULTS.name &&
  s.address === DB_DEFAULTS.address &&
  s.phone === DB_DEFAULTS.phone &&
  s.email === DB_DEFAULTS.email &&
  s.receipt_prefix === DB_DEFAULTS.receipt_prefix &&
  s.receipt_footer === DB_DEFAULTS.receipt_footer &&
  s.default_currency === DB_DEFAULTS.default_currency &&
  s.default_timezone === DB_DEFAULTS.default_timezone &&
  s.backdating_window_days === DB_DEFAULTS.backdating_window_days &&
  (s.operator_upi_vpa ?? null) === null &&
  s.enabled_services.length === 1 &&
  s.enabled_services[0] === 'cable';

interface LegacyBlob {
  name?: string;
  address?: string;
  phone?: string;
  email?: string;
  enabledServices?: ServiceType[];
  operator_upi_vpa?: string;
  backdating_window_days?: number;
}

/**
 * One-time import: if the DB row is still at defaults AND a legacy
 * localStorage blob exists, copy the legacy values into the DB and bump
 * settings_version to 2 so re-runs no-op. After success the legacy key is
 * deleted. Any failure is logged and the DB is left untouched.
 */
const maybeImportLegacy = async (
  current: BusinessSettings,
  apply: (
    patch: Partial<Omit<BusinessSettings, 'user_id' | 'updated_at'>>,
  ) => Promise<void>,
): Promise<void> => {
  if (current.settings_version >= 2) return;
  if (!rowIsAtDefaults(current)) {
    // Row already customised in DB — just bump version so we never check again.
    try { await apply({ settings_version: 2 }); } catch { /* best effort */ }
    return;
  }
  let raw: string | null;
  try { raw = localStorage.getItem(LEGACY_KEY); } catch { raw = null; }
  if (!raw) {
    try { await apply({ settings_version: 2 }); } catch { /* best effort */ }
    return;
  }
  try {
    const legacy = JSON.parse(raw) as LegacyBlob;
    const patch: Partial<BusinessSettings> = { settings_version: 2 };
    if (legacy.name) patch.name = legacy.name;
    if (legacy.address) patch.address = legacy.address;
    if (legacy.phone) patch.phone = legacy.phone;
    if (legacy.email) patch.email = legacy.email;
    if (legacy.enabledServices && legacy.enabledServices.length > 0) {
      patch.enabled_services = legacy.enabledServices.filter(
        (s) => s === 'cable' || s === 'internet',
      ) as ServiceType[];
      if (patch.enabled_services.length === 0) delete patch.enabled_services;
    }
    if (typeof legacy.operator_upi_vpa === 'string' && legacy.operator_upi_vpa.trim() !== '') {
      patch.operator_upi_vpa = legacy.operator_upi_vpa.trim();
    }
    if (typeof legacy.backdating_window_days === 'number') {
      patch.backdating_window_days = Math.max(0, Math.min(90, legacy.backdating_window_days));
    }
    await apply(patch);
    try { localStorage.removeItem(LEGACY_KEY); } catch { /* ignore */ }
    // eslint-disable-next-line no-console
    console.info('[settings] Imported legacy localStorage business configuration into DB.');
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[settings] Legacy import skipped:', err);
  }
};

export const SettingsProvider = ({ children }: { children: ReactNode }) => {
  const { user, loading: authLoading } = useAuth();
  const [settings, setSettings] = useState<BusinessSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const importedRef = useRef<string | null>(null);

  const fromRow = (row: any): BusinessSettings => ({
    user_id: row.user_id,
    name: row.name ?? DB_DEFAULTS.name,
    address: row.address ?? '',
    phone: row.phone ?? '',
    email: row.email ?? '',
    enabled_services: (row.enabled_services ?? ['cable']) as ServiceType[],
    operator_upi_vpa: row.operator_upi_vpa ?? null,
    backdating_window_days: row.backdating_window_days ?? 7,
    receipt_prefix: row.receipt_prefix ?? DB_DEFAULTS.receipt_prefix,
    receipt_footer: row.receipt_footer ?? DB_DEFAULTS.receipt_footer,
    default_currency: row.default_currency ?? DB_DEFAULTS.default_currency,
    default_timezone: row.default_timezone ?? DB_DEFAULTS.default_timezone,
    settings_version: row.settings_version ?? 1,
    updated_at: row.updated_at ?? new Date().toISOString(),
  });

  const applyPatch = useCallback(
    async (patch: Partial<Omit<BusinessSettings, 'user_id' | 'updated_at'>>) => {
      const uid = user?.id;
      if (!uid) throw new Error('Not authenticated');
      const dbPatch: Record<string, unknown> = { ...patch };
      const { data, error } = await supabase
        .from('settings' as any)
        .update(dbPatch)
        .eq('user_id', uid)
        .select()
        .single();
      if (error) throw error;
      setSettings(fromRow(data));
    },
    [user?.id],
  );

  const updateSettings = useCallback(
    async (patch: Partial<Omit<BusinessSettings, 'user_id' | 'updated_at'>>) => {
      const prev = settings;
      // Optimistic local update.
      if (prev) setSettings({ ...prev, ...patch } as BusinessSettings);
      try {
        await applyPatch(patch);
      } catch (e: any) {
        if (prev) setSettings(prev);
        toast.error(`Could not save settings: ${e?.message ?? 'unknown error'}`);
        throw e;
      }
    },
    [applyPatch, settings],
  );

  const setEnabledServices = useCallback(
    async (next: ServiceType[]) => {
      if (next.length === 0) {
        toast.error('At least one service must be enabled.');
        return;
      }
      await updateSettings({ enabled_services: next });
    },
    [updateSettings],
  );

  // Hydrate when the auth user becomes available; clear on sign-out.
  useEffect(() => {
    let cancelled = false;
    const hydrate = async () => {
      if (authLoading) return;
      if (!user) {
        setSettings(null);
        setLoading(false);
        importedRef.current = null;
        return;
      }
      setLoading(true);
      try {
        const { data: ensured, error: ensureErr } = await supabase.rpc(
          'ensure_settings_row' as any,
        );
        if (ensureErr) throw ensureErr;
        const row = Array.isArray(ensured) ? ensured[0] : ensured;
        if (cancelled || !row) return;
        const hydrated = fromRow(row);
        setSettings(hydrated);

        if (importedRef.current !== user.id) {
          importedRef.current = user.id;
          await maybeImportLegacy(hydrated, applyPatch);
        }
      } catch (e: any) {
        // eslint-disable-next-line no-console
        console.error('[settings] hydrate failed:', e);
        toast.error('Could not load business settings.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    hydrate();
    return () => { cancelled = true; };
  }, [user, authLoading, applyPatch]);

  const enabledServices = settings?.enabled_services ?? ['cable'];

  const value: SettingsCtx = {
    settings,
    loading: loading || authLoading,
    updateSettings,
    enabledServices,
    setEnabledServices,
    cableEnabled: enabledServices.includes('cable'),
    internetEnabled: enabledServices.includes('internet'),
    bothEnabled: enabledServices.includes('cable') && enabledServices.includes('internet'),
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
};

export const useSettings = (): SettingsCtx => {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider');
  return ctx;
};
