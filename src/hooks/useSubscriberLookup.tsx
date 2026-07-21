import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

/**
 * useSubscriberLookup — debounced typeahead for subscriber comboboxes.
 *
 * Returns up to 20 matches by name / mobile / subscriber_id.
 * Use this in place of a full <Select> of every subscriber (which becomes
 * unusable past a few hundred rows).
 */

export interface LookupRow {
  id: string;
  subscriber_id: string;
  name: string;
  mobile: string;
  region: string | null;
}

export function useSubscriberLookup(userId: string | undefined, term: string, limit = 20) {
  const [rows, setRows] = useState<LookupRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [debounced, setDebounced] = useState(term);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(term.trim()), 200);
    return () => clearTimeout(t);
  }, [term]);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    setLoading(true);

    (async () => {
      let q = supabase
        .from('subscribers')
        .select('id, subscriber_id, name, mobile, region')
        .eq('user_id', userId)
        .order('name', { ascending: true })
        .limit(limit);

      if (debounced) {
        const s = debounced.replace(/[%,]/g, '');
        q = (q as any).or(
          `name.ilike.%${s}%,mobile.ilike.%${s}%,subscriber_id.ilike.%${s}%`,
        );
      }

      const { data } = await q;
      if (cancelled) return;
      setRows((data ?? []) as LookupRow[]);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [userId, debounced, limit]);

  return { rows, loading };
}
