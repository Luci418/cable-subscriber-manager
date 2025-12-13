import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";

type Pack = Database["public"]["Tables"]["packs"]["Row"];
type PackInsert = Database["public"]["Tables"]["packs"]["Insert"];
type PackUpdate = Database["public"]["Tables"]["packs"]["Update"];

export const usePacks = (userId: string | undefined) => {
  const [packs, setPacks] = useState<Pack[]>([]);
  const [loading, setLoading] = useState(true);

  const loadPacks = async () => {
    if (!userId) return;
    
    setLoading(true);
    const { data, error } = await supabase
      .from("packs")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) {
      toast.error("Failed to load packs");
      console.error(error);
    } else {
      setPacks(data || []);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadPacks();
  }, [userId]);

  // Get only active packs for dropdowns
  const getActivePacks = () => packs.filter(p => p.is_active !== false);

  const addPack = async (pack: Omit<PackInsert, "user_id">) => {
    if (!userId) return false;

    const { data, error } = await supabase
      .from("packs")
      .insert({ ...pack, user_id: userId, is_active: true })
      .select()
      .single();

    if (error) {
      toast.error("Failed to add pack");
      console.error(error);
      return false;
    }

    if (data) {
      setPacks(prev => [data, ...prev]);
    }
    return true;
  };

  const updatePack = async (id: string, updates: PackUpdate) => {
    const { data, error } = await supabase
      .from("packs")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      toast.error("Failed to update pack");
      console.error(error);
      return false;
    }

    if (data) {
      setPacks(prev => prev.map(pack => 
        pack.id === id ? data : pack
      ));
    }
    return true;
  };

  const checkPackInUse = async (packName: string): Promise<boolean> => {
    if (!userId) return false;
    
    const { data, error } = await supabase
      .rpc('is_pack_in_use', { pack_name: packName, owner_id: userId });
    
    if (error) {
      console.error('Error checking pack usage:', error);
      return true; // Assume in use on error to be safe
    }
    
    return data as boolean;
  };

  const deletePack = async (id: string) => {
    const pack = packs.find(p => p.id === id);
    if (!pack) return false;

    // Check if pack is in use
    const inUse = await checkPackInUse(pack.name);
    if (inUse) {
      toast.error("Cannot delete pack - customers are still assigned to it. Use 'Retire' to phase it out.");
      return false;
    }

    const { error } = await supabase
      .from("packs")
      .delete()
      .eq("id", id);

    if (error) {
      toast.error("Failed to delete pack");
      console.error(error);
      return false;
    }

    setPacks(prev => prev.filter(pack => pack.id !== id));
    return true;
  };

  const retirePack = async (id: string) => {
    return await updatePack(id, { is_active: false });
  };

  const reactivatePack = async (id: string) => {
    return await updatePack(id, { is_active: true });
  };

  return {
    packs,
    loading,
    addPack,
    updatePack,
    deletePack,
    retirePack,
    reactivatePack,
    getActivePacks,
    checkPackInUse,
    reloadPacks: loadPacks,
  };
};