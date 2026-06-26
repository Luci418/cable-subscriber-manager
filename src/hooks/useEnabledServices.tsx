/**
 * Backwards-compatible shim over the new SettingsContext.
 *
 * Historically this hook read `enabledServices` from localStorage. As of the
 * DB-authoritative settings migration, the source of truth is the
 * `public.settings` row hydrated by SettingsProvider. This file keeps the
 * `useEnabledServices()` import path working for the rest of the codebase.
 */
import { useSettings, type ServiceType } from '@/contexts/SettingsContext';

export type { ServiceType };

export const useEnabledServices = () => {
  const { enabledServices, setEnabledServices, cableEnabled, internetEnabled, bothEnabled } =
    useSettings();
  return {
    services: enabledServices,
    setEnabledServices,
    cableEnabled,
    internetEnabled,
    bothEnabled,
  };
};
