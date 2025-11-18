import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";

type Subscriber = Database["public"]["Tables"]["subscribers"]["Row"];
type SubscriberInsert = Database["public"]["Tables"]["subscribers"]["Insert"];
type SubscriberUpdate = Database["public"]["Tables"]["subscribers"]["Update"];

export const useSubscribers = (userId: string | undefined) => {
  const [subscribers, setSubscribers] = useState<Subscriber[]>([]);
  const [loading, setLoading] = useState(true);

  const loadSubscribers = async () => {
    if (!userId) return;
    
    setLoading(true);
    const { data, error } = await supabase
      .from("subscribers")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) {
      toast.error("Failed to load subscribers");
      console.error(error);
    } else {
      setSubscribers(data || []);
    }
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
      toast.error("Failed to add subscriber");
      console.error(error);
      return false;
    }

    if (data) setSubscribers((prev) => [data, ...prev]);
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
      toast.error("Failed to update subscriber");
      console.error(error);
      return false;
    }

    if (data) setSubscribers((prev) => prev.map((s) => (s.id === id ? { ...s, ...data } : s)));
    return true;
  };

  const deleteSubscriber = async (id: string) => {
    const { error } = await supabase
      .from("subscribers")
      .delete()
      .eq("id", id);

    if (error) {
      toast.error("Failed to delete subscriber");
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