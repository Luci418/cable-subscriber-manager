import { supabase } from '@/integrations/supabase/client';

/**
 * expire_lapsed_subscriptions used to be awaited before every subscriber
 * read, adding a full serial round-trip to the critical path of the
 * Customers list. It is a housekeeping sweep — the views already filter on
 * end_date, so the UI is correct without waiting for it.
 *
 * We now fire it once per session (and at most once every 60s), without
 * blocking the read.
 */
let lastRun = 0;

export function expireLapsedInBackground() {
  const now = Date.now();
  if (now - lastRun < 60_000) return;
  lastRun = now;
  void supabase.rpc('expire_lapsed_subscriptions').then(
    () => {},
    (e) => console.warn('expire_lapsed_subscriptions failed (non-fatal):', e),
  );
}
