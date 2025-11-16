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

  const addPack = async (pack: Omit<PackInsert, "user_id">) => {
    if (!userId) return;

    const { error } = await supabase
      .from("packs")
      .insert({ ...pack, user_id: userId });

    if (error) {
      toast.error("Failed to add pack");
      console.error(error);
      return false;
    }

    await loadPacks();
    return true;
  };

  const updatePack = async (id: string, updates: PackUpdate) => {
    const { error } = await supabase
      .from("packs")
      .update(updates)
      .eq("id", id);

    if (error) {
      toast.error("Failed to update pack");
      console.error(error);
      return false;
    }

    await loadPacks();
    return true;
  };

  const deletePack = async (id: string) => {
    const { error } = await supabase
      .from("packs")
      .delete()
      .eq("id", id);

    if (error) {
      toast.error("Failed to delete pack");
      console.error(error);
      return false;
    }

    await loadPacks();
    return true;
  };

  return {
    packs,
    loading,
    addPack,
    updatePack,
    deletePack,
    reloadPacks: loadPacks,
  };
};