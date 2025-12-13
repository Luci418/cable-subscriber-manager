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
    if (!userId) return false;

    const { data, error } = await supabase
      .from("regions")
      .insert({ ...region, user_id: userId })
      .select()
      .single();

    if (error) {
      toast.error("Failed to add region");
      console.error(error);
      return false;
    }

    if (data) {
      setRegions(prev => [data, ...prev]);
    }
    return true;
  };

  const checkRegionInUse = async (regionName: string): Promise<boolean> => {
    if (!userId) return false;
    
    const { data, error } = await supabase
      .rpc('is_region_in_use', { region_name: regionName, owner_id: userId });
    
    if (error) {
      console.error('Error checking region usage:', error);
      return true; // Assume in use on error to be safe
    }
    
    return data as boolean;
  };

  const deleteRegion = async (id: string) => {
    const region = regions.find(r => r.id === id);
    if (!region) return false;

    // Check if region is in use
    const inUse = await checkRegionInUse(region.name);
    if (inUse) {
      toast.error("Cannot delete region - customers are still assigned to it");
      return false;
    }

    const { error } = await supabase
      .from("regions")
      .delete()
      .eq("id", id);

    if (error) {
      toast.error("Failed to delete region");
      console.error(error);
      return false;
    }

    setRegions(prev => prev.filter(r => r.id !== id));
    return true;
  };

  return {
    regions,
    loading,
    addRegion,
    deleteRegion,
    checkRegionInUse,
    reloadRegions: loadRegions,
  };
};