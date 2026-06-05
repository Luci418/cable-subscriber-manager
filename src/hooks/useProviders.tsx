import { useState, useEffect } from "react";
import { friendlyDbError } from "@/lib/dbErrors";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type ProviderServiceType = "cable" | "internet";

export interface Provider {
  id: string;
  user_id: string;
  name: string;
  service_type: ProviderServiceType;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export const useProviders = (userId: string | undefined) => {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);

  const loadProviders = async () => {
    if (!userId) return;
    setLoading(true);
    const { data, error } = await (supabase as any)
      .from("providers")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: true });

    if (error) {
      toast.error("Failed to load providers");
      console.error(error);
    } else {
      setProviders((data as Provider[]) || []);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadProviders();
  }, [userId]);

  const addProvider = async (input: {
    name: string;
    service_type: ProviderServiceType;
    notes?: string | null;
  }) => {
    if (!userId) return false;
    const { data, error } = await (supabase as any)
      .from("providers")
      .insert({ ...input, user_id: userId, is_active: true })
      .select()
      .single();

    if (error) {
      toast.error(friendlyDbError(error, "Failed to add provider"));
      return false;
    }
    if (data) setProviders(prev => [...prev, data as Provider]);
    return true;
  };

  const updateProvider = async (id: string, updates: Partial<Provider>) => {
    const { data, error } = await (supabase as any)
      .from("providers")
      .update(updates)
      .eq("id", id)
      .select()
      .single();
    if (error) {
      toast.error(friendlyDbError(error, "Failed to update provider"));
      return false;
    }
    if (data) setProviders(prev => prev.map(p => (p.id === id ? (data as Provider) : p)));
    return true;
  };

  const checkProviderInUse = async (id: string): Promise<boolean> => {
    const { data, error } = await (supabase as any).rpc("is_provider_in_use", { provider_uuid: id });
    if (error) {
      console.error("is_provider_in_use failed", error);
      return true;
    }
    return Boolean(data);
  };

  const deleteProvider = async (id: string) => {
    const inUse = await checkProviderInUse(id);
    if (inUse) {
      toast.error("Cannot delete provider — packs, subscribers or transactions still reference it. Retire it instead.");
      return false;
    }
    const { error } = await (supabase as any).from("providers").delete().eq("id", id);
    if (error) {
      toast.error(friendlyDbError(error, "Failed to delete provider"));
      return false;
    }
    setProviders(prev => prev.filter(p => p.id !== id));
    return true;
  };

  const retireProvider = (id: string) => updateProvider(id, { is_active: false });
  const reactivateProvider = (id: string) => updateProvider(id, { is_active: true });

  const getActiveProviders = (service?: ProviderServiceType) =>
    providers.filter(p => p.is_active && (!service || p.service_type === service));

  const getProvidersFor = (service: ProviderServiceType) =>
    providers.filter(p => p.service_type === service);

  return {
    providers,
    loading,
    addProvider,
    updateProvider,
    deleteProvider,
    retireProvider,
    reactivateProvider,
    checkProviderInUse,
    getActiveProviders,
    getProvidersFor,
    reloadProviders: loadProviders,
  };
};
