import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { friendlyDbError } from "@/lib/dbErrors";
import type { Database } from "@/integrations/supabase/types";
import type { EnrichedSubscriber, SubscriptionBlob } from "@/lib/activeSubs";

type SubscriberRow = Database["public"]["Tables"]["subscribers"]["Row"];
type SubscriberInsert = Database["public"]["Tables"]["subscribers"]["Insert"];
type SubscriberUpdate = Database["public"]["Tables"]["subscribers"]["Update"];

// What components see: the DB row + the four normalised subscription arrays.
export type Subscriber = SubscriberRow & EnrichedSubscriber;

export const useSubscribers = (userId: string | undefined) => {
  const [subscribers, setSubscribers] = useState<Subscriber[]>([]);
  const [loading, setLoading] = useState(true);

  const loadSubscribers = async () => {
    if (!userId) return;

    setLoading(true);
    // Eagerly expire any lapsed subscriptions server-side BEFORE fetching,
    // so the UI always reflects authoritative server state (no client-side lazy cleanup).
    try {
      await supabase.rpc("expire_lapsed_subscriptions");
    } catch (e) {
      console.warn("expire_lapsed_subscriptions RPC failed (non-fatal):", e);
    }

    // Three reads in parallel:
    //   1. subscribers — base row
    //   2. v_subscriber_active_subscription — one row PER ACTIVE subscription
    //      (multi-device subscribers may have multiple rows per service)
    //   3. v_subscriber_subscription_timeline — every subscription (active + history)
    //
    // Both views return a `blob` jsonb column shaped exactly like the legacy
    // `current_subscription` JSON so components can keep reading `.packName`,
    // `.endDate`, `.subscriptionId`, etc. without translation.
    const [subsRes, activesRes, timelineRes] = await Promise.all([
      supabase
        .from("subscribers")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false }),
      (supabase as any)
        .from("v_subscriber_active_subscription")
        .select("subscriber_id, service_type, blob")
        .eq("user_id", userId),
      (supabase as any)
        .from("v_subscriber_subscription_timeline")
        .select("subscriber_id, service_type, blob")
        .eq("user_id", userId),
    ]);

    if (subsRes.error) {
      toast.error("Failed to load subscribers");
      console.error(subsRes.error);
      setLoading(false);
      return;
    }
    if (activesRes.error) console.warn("active subs view read failed:", activesRes.error);
    if (timelineRes.error) console.warn("timeline view read failed:", timelineRes.error);

    // Group by (subscriber_id, service_type) → array of blobs.
    const groupBy = (rows: any[] | null) => {
      const out: Record<string, { cable: SubscriptionBlob[]; internet: SubscriptionBlob[] }> = {};
      (rows || []).forEach((r) => {
        const bucket = (out[r.subscriber_id] ??= { cable: [], internet: [] });
        const blob = r.blob as SubscriptionBlob;
        if (r.service_type === "internet") bucket.internet.push(blob);
        else bucket.cable.push(blob);
      });
      return out;
    };

    const actives = groupBy(activesRes.data as any[] | null);
    const timeline = groupBy(timelineRes.data as any[] | null);

    const enriched: Subscriber[] = (subsRes.data || []).map((s) => {
      const a = actives[s.id] ?? { cable: [], internet: [] };
      const t = timeline[s.id] ?? { cable: [], internet: [] };
      return {
        ...s,
        _activeCable: a.cable,
        _activeInternet: a.internet,
        _timelineCable: t.cable,
        _timelineInternet: t.internet,
      } as Subscriber;
    });

    setSubscribers(enriched);
    setLoading(false);
  };

  useEffect(() => {
    loadSubscribers();
  }, [userId]);

  const addSubscriber = async (subscriber: Omit<SubscriberInsert, "user_id">) => {
    if (!userId) return;

    const { data, error } = await supabase
      .from("subscribers")
      .insert({ ...subscriber, user_id: userId })
      .select()
      .single();

    if (error) {
      toast.error(friendlyDbError(error, "Failed to add subscriber"));
      console.error(error);
      return false;
    }

    if (data) {
      // New subscriber has no subscriptions yet — attach empty arrays so
      // downstream consumers don't have to null-check.
      const enriched: Subscriber = {
        ...(data as any),
        _activeCable: [],
        _activeInternet: [],
        _timelineCable: [],
        _timelineInternet: [],
      };
      setSubscribers((prev) => [enriched, ...prev]);
    }
    return true;
  };

  const updateSubscriber = async (id: string, updates: SubscriberUpdate) => {
    const { data, error } = await supabase
      .from("subscribers")
      .update(updates)
      .eq("id", id)
      .select()
      .maybeSingle();

    if (error) {
      toast.error(friendlyDbError(error, "Failed to update subscriber"));
      console.error(error);
      return false;
    }

    if (!data) {
      // No row matched — RLS blocked the update, the id was wrong, or the
      // row was deleted mid-flight. Postgres does NOT surface this as an
      // error, so we must translate it ourselves. Returning true here would
      // let callers show a false "saved" toast (see Add-Service regression).
      toast.error("Update did not apply — the record may have been removed or you may not have permission.");
      return false;
    }

    setSubscribers((prev) =>
      prev.map((s) =>
        s.id === id
          ? {
              ...s,
              ...data,
              // Preserve the normalised arrays — they aren't returned by
              // an UPDATE on the subscribers table.
              _activeCable: s._activeCable,
              _activeInternet: s._activeInternet,
              _timelineCable: s._timelineCable,
              _timelineInternet: s._timelineInternet,
            }
          : s
      )
    );
    return true;
  };


  const deleteSubscriber = async (id: string) => {
    const { error } = await supabase
      .from("subscribers")
      .delete()
      .eq("id", id);

    if (error) {
      toast.error(friendlyDbError(error, "Failed to delete subscriber"));
      console.error(error);
      return false;
    }

    setSubscribers((prev) => prev.filter((s) => s.id !== id));
    return true;
  };

  return {
    subscribers,
    loading,
    addSubscriber,
    updateSubscriber,
    deleteSubscriber,
    reloadSubscribers: loadSubscribers,
  };
};
