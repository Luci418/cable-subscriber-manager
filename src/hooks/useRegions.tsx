import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";

type Region = Database["public"]["Tables"]["regions"]["Row"];
type RegionInsert = Database["public"]["Tables"]["regions"]["Insert"];

export const useRegions = (userId: string | undefined) => {
  const [regions, setRegions] = useState<Region[]>([]);
  const [loading, setLoading] = useState(true);

  const loadRegions = async () => {
    if (!userId) return;
    
    setLoading(true);
    const { data, error } = await supabase
      .from("regions")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) {
      toast.error("Failed to load regions");
      console.error(error);
    } else {
      setRegions(data || []);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadRegions();
  }, [userId]);

  const addRegion = async (region: Omit<RegionInsert, "user_id">) => {
    if (!userId) return;

    const { error } = await supabase
      .from("regions")
      .insert({ ...region, user_id: userId });

    if (error) {
      toast.error("Failed to add region");
      console.error(error);
      return false;
    }

    await loadRegions();
    return true;
  };

  const deleteRegion = async (id: string) => {
    const { error } = await supabase
      .from("regions")
      .delete()
      .eq("id", id);

    if (error) {
      toast.error("Failed to delete region");
      console.error(error);
      return false;
    }

    await loadRegions();
    return true;
  };

  return {
    regions,
    loading,
    addRegion,
    deleteRegion,
    reloadRegions: loadRegions,
  };
};