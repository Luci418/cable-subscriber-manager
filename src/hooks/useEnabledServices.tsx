import { useState, useEffect, useCallback } from 'react';
import { getCompanySettings, saveCompanySettings, ServiceType } from '@/lib/storage';

/**
 * Reactive hook for the operator's enabled service modules (Cable / Internet).
 *
 * Why this exists: settings are stored in localStorage, but React components
 * don't re-render when localStorage mutates. This hook listens for both the
 * native `storage` event (cross-tab) and a custom `services-changed` event
 * (same-tab) so any toggle in Settings instantly reshapes the rest of the UI
 * — header title, toolbars, subscriber cards, detail tabs, etc.
 */
const EVENT = 'enabled-services-changed';

export const useEnabledServices = () => {
  const [services, setServices] = useState<ServiceType[]>(
    () => getCompanySettings().enabledServices ?? ['cable']
  );

  useEffect(() => {
    const refresh = () => setServices(getCompanySettings().enabledServices ?? ['cable']);
    window.addEventListener('storage', refresh);
    window.addEventListener(EVENT, refresh);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener(EVENT, refresh);
    };
  }, []);

  const setEnabledServices = useCallback((next: ServiceType[]) => {
    const settings = getCompanySettings();
    saveCompanySettings({ ...settings, enabledServices: next });
    window.dispatchEvent(new Event(EVENT));
    setServices(next);
  }, []);

  return {
    services,
    setEnabledServices,
    cableEnabled: services.includes('cable'),
    internetEnabled: services.includes('internet'),
    bothEnabled: services.includes('cable') && services.includes('internet'),
  };
};
