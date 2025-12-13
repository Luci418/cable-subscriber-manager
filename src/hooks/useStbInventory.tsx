import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type StbStatus = 'available' | 'assigned' | 'faulty' | 'decommissioned';

export interface StbInventoryItem {
  id: string;
  serial_number: string;
  status: StbStatus;
  subscriber_id: string | null;
  user_id: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface StbInsert {
  serial_number: string;
  status?: StbStatus;
  subscriber_id?: string | null;
  notes?: string | null;
}

export interface StbUpdate {
  serial_number?: string;
  status?: StbStatus;
  subscriber_id?: string | null;
  notes?: string | null;
}

export const useStbInventory = (userId: string | undefined) => {
  const [stbs, setStbs] = useState<StbInventoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  const loadStbs = async () => {
    if (!userId) return;
    
    setLoading(true);
    const { data, error } = await supabase
      .from("stb_inventory")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) {
      toast.error("Failed to load STB inventory");
      console.error(error);
    } else {
      setStbs((data as StbInventoryItem[]) || []);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadStbs();
  }, [userId]);

  const addStb = async (stb: StbInsert) => {
    if (!userId) return false;

    // Check if serial number already exists
    const existing = stbs.find(s => s.serial_number === stb.serial_number);
    if (existing) {
      toast.error("STB with this serial number already exists");
      return false;
    }

    const { data, error } = await supabase
      .from("stb_inventory")
      .insert({ ...stb, user_id: userId })
      .select()
      .single();

    if (error) {
      toast.error("Failed to add STB");
      console.error(error);
      return false;
    }

    if (data) {
      setStbs(prev => [data as StbInventoryItem, ...prev]);
    }
    return true;
  };

  const updateStb = async (id: string, updates: StbUpdate) => {
    const { data, error } = await supabase
      .from("stb_inventory")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      toast.error("Failed to update STB");
      console.error(error);
      return false;
    }

    if (data) {
      setStbs(prev => prev.map(stb => 
        stb.id === id ? (data as StbInventoryItem) : stb
      ));
    }
    return true;
  };

  const deleteStb = async (id: string) => {
    const stb = stbs.find(s => s.id === id);
    if (stb?.status === 'assigned') {
      toast.error("Cannot delete an assigned STB. Unassign it first.");
      return false;
    }

    const { error } = await supabase
      .from("stb_inventory")
      .delete()
      .eq("id", id);

    if (error) {
      toast.error("Failed to delete STB");
      console.error(error);
      return false;
    }

    setStbs(prev => prev.filter(stb => stb.id !== id));
    return true;
  };

  const assignStb = async (stbId: string, subscriberId: string) => {
    const stb = stbs.find(s => s.id === stbId);
    if (!stb) {
      toast.error("STB not found");
      return false;
    }

    if (stb.status !== 'available') {
      toast.error(`Cannot assign STB - current status: ${stb.status}`);
      return false;
    }

    return await updateStb(stbId, { 
      status: 'assigned', 
      subscriber_id: subscriberId 
    });
  };

  const unassignStb = async (stbId: string) => {
    return await updateStb(stbId, { 
      status: 'available', 
      subscriber_id: null 
    });
  };

  const markAsFaulty = async (stbId: string, notes?: string) => {
    const stb = stbs.find(s => s.id === stbId);
    if (stb?.status === 'assigned') {
      // Unassign first, then mark faulty
      await updateStb(stbId, { 
        status: 'faulty', 
        subscriber_id: null,
        notes: notes || 'Marked as faulty' 
      });
    } else {
      await updateStb(stbId, { 
        status: 'faulty', 
        notes: notes || 'Marked as faulty' 
      });
    }
    return true;
  };

  const markAsRepaired = async (stbId: string) => {
    return await updateStb(stbId, { 
      status: 'available', 
      notes: 'Repaired and available' 
    });
  };

  const decommission = async (stbId: string, reason?: string) => {
    const stb = stbs.find(s => s.id === stbId);
    if (stb?.status === 'assigned') {
      toast.error("Cannot decommission an assigned STB. Unassign it first.");
      return false;
    }

    return await updateStb(stbId, { 
      status: 'decommissioned', 
      notes: reason || 'Decommissioned' 
    });
  };

  const getAvailableStbs = () => stbs.filter(s => s.status === 'available');
  const getAssignedStbs = () => stbs.filter(s => s.status === 'assigned');
  const getFaultyStbs = () => stbs.filter(s => s.status === 'faulty');
  const getStbBySerialNumber = (serialNumber: string) => 
    stbs.find(s => s.serial_number === serialNumber);
  const getStbBySubscriberId = (subscriberId: string) =>
    stbs.find(s => s.subscriber_id === subscriberId);

  return {
    stbs,
    loading,
    addStb,
    updateStb,
    deleteStb,
    assignStb,
    unassignStb,
    markAsFaulty,
    markAsRepaired,
    decommission,
    getAvailableStbs,
    getAssignedStbs,
    getFaultyStbs,
    getStbBySerialNumber,
    getStbBySubscriberId,
    reloadStbs: loadStbs,
  };
};
