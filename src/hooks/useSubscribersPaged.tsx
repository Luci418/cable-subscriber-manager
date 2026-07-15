import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { Subscriber } from '@/hooks/useSubscribers';
import type { SubscriptionBlob } from '@/lib/activeSubs';

/**
 * useSubscribersPaged — server-paginated subscriber query.
 *
 * The classic `useSubscribers` hook loads every subscriber in one shot to
 * feed dashboards, exports and aggregate analytics. That doesn't scale to
 * thousands of rows for the main Customers list. This hook queries the
 * `subscribers` table server-side with `.range()` + `.ilike()` + status /
 * service / balance filters, and only enriches the visible page with
 * active-subscription blobs from the two normalised views.
 */

export type ServiceFilter = 'all' | 'cable' | 'internet';
export type StatusFilter = 'all' | 'active' | 'prospect' | 'archived';
export type BalanceFilter = 'all' | 'dues' | 'credit' | 'settled';

export interface UseSubscribersPagedOptions {
  userId: string | undefined;
  search: string;
  service: ServiceFilter;
  region: string; // 'all' or a region name
  status: StatusFilter;
  balance: BalanceFilter;
  page: number; // 1-indexed
  pageSize: number;
  /** Bump to force refetch (e.g. after import). */
  refreshKey?: number;
}

export interface UseSubscribersPagedResult {
  rows: Subscriber[];
  total: number;
  loading: boolean;
  error: string | null;
}

export function useSubscribersPaged(opts: UseSubscribersPagedOptions): UseSubscribersPagedResult {
  const { userId, search, service, region, status, balance, page, pageSize, refreshKey } = opts;

  const [rows, setRows] = useState<Subscriber[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Debounce the search input on the hook side so callers don't have to.
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);

  const queryKey = useMemo(
    () => JSON.stringify({ userId, debouncedSearch, service, region, status, balance, page, pageSize, refreshKey }),
    [userId, debouncedSearch, service, region, status, balance, page, pageSize, refreshKey],
  );

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);

      // Server-side expire lapsed so the paged view is authoritative.
      try {
        await supabase.rpc('expire_lapsed_subscriptions');
      } catch {
        /* non-fatal */
      }

      let q = supabase
        .from('subscribers')
        .select('*', { count: 'exact' })
        .eq('user_id', userId);

      if (status !== 'all') q = q.eq('customer_status', status);
      if (region !== 'all') q = q.eq('region', region);
      if (service !== 'all') q = (q as any).contains('services', [service]);

      if (balance === 'dues') q = (q as any).or('cable_balance.gt.0,internet_balance.gt.0');
      else if (balance === 'credit') q = (q as any).or('cable_balance.lt.0,internet_balance.lt.0');
      else if (balance === 'settled')
        q = (q as any).eq('cable_balance', 0).eq('internet_balance', 0);

      if (debouncedSearch) {
        const s = debouncedSearch.replace(/[%,]/g, '');
        q = (q as any).or(
          `name.ilike.%${s}%,mobile.ilike.%${s}%,subscriber_id.ilike.%${s}%,stb_number.ilike.%${s}%`,
        );
      }

      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;
      q = q.order('created_at', { ascending: false }).range(from, to);

      const { data, count, error: qErr } = await q;
      if (cancelled) return;
      if (qErr) {
        setError(qErr.message);
        setRows([]);
        setTotal(0);
        setLoading(false);
        return;
      }

      const ids = (data ?? []).map((r: any) => r.id);
      let actives: Record<string, { cable: SubscriptionBlob[]; internet: SubscriptionBlob[] }> = {};
      if (ids.length) {
        const { data: viewRows } = await (supabase as any)
          .from('v_subscriber_active_subscription')
          .select('subscriber_id, service_type, blob')
          .eq('user_id', userId)
          .in('subscriber_id', ids);
        (viewRows ?? []).forEach((r: any) => {
          const bucket = (actives[r.subscriber_id] ??= { cable: [], internet: [] });
          if (r.service_type === 'internet') bucket.internet.push(r.blob);
          else bucket.cable.push(r.blob);
        });
      }

      const enriched: Subscriber[] = (data ?? []).map((r: any) => {
        const a = actives[r.id] ?? { cable: [], internet: [] };
        return {
          ...r,
          _activeCable: a.cable,
          _activeInternet: a.internet,
          _timelineCable: [],
          _timelineInternet: [],
        } as Subscriber;
      });

      setRows(enriched);
      setTotal(count ?? enriched.length);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey]);

  return { rows, total, loading, error };
}
