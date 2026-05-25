import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { friendlyDbError } from "@/lib/dbErrors";
import type { Database } from "@/integrations/supabase/types";

type ComplaintRow = Database["public"]["Tables"]["complaints"]["Row"];

export interface ComplaintWithSubscriber extends ComplaintRow {
  subscriber_name?: string;
  subscriber_id_text?: string;
}

export const useComplaints = (userId: string | undefined) => {
  const [complaints, setComplaints] = useState<ComplaintWithSubscriber[]>([]);
  const [loading, setLoading] = useState(true);

  const loadComplaints = async () => {
    if (!userId) return;

    setLoading(true);
    const { data, error } = await supabase
      .from("complaints")
      .select(`
        *,
        subscribers:subscriber_id ( name, subscriber_id )
      `)
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) {
      toast.error(friendlyDbError(error, "Failed to load complaints"));
      console.error(error);
    } else {
      // Flatten joined subscriber data
      const normalized = (data || []).map((row: any) => ({
        ...row,
        subscriber_name: row.subscribers?.name,
        subscriber_id_text: row.subscribers?.subscriber_id,
      })) as ComplaintWithSubscriber[];
      setComplaints(normalized);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadComplaints();
  }, [userId]);

  const addComplaint = async (complaint: {
    subscriber_id: string;
    description: string;
    category: string;
    priority: string;
    status?: string;
  }) => {
    if (!userId) return null;

    const { data, error } = await supabase
      .from("complaints")
      .insert({
        subscriber_id: complaint.subscriber_id,
        description: complaint.description,
        category: complaint.category,
        priority: complaint.priority,
        status: complaint.status || "pending",
        user_id: userId,
        date: new Date().toISOString(),
      })
      .select(`
        *,
        subscribers:subscriber_id ( name, subscriber_id )
      `)
      .single();

    if (error) {
      toast.error(friendlyDbError(error, "Failed to register complaint"));
      console.error(error);
      return null;
    }

    const normalized = {
      ...data,
      subscriber_name: (data as any).subscribers?.name,
      subscriber_id_text: (data as any).subscribers?.subscriber_id,
    } as ComplaintWithSubscriber;

    setComplaints((prev) => [normalized, ...prev]);
    return normalized;
  };

  const updateComplaint = async (
    id: string,
    updates: {
      status?: string;
      resolved_date?: string | null;
      resolution_notes?: string | null;
    }
  ) => {
    const { data, error } = await supabase
      .from("complaints")
      .update(updates)
      .eq("id", id)
      .select(`
        *,
        subscribers:subscriber_id ( name, subscriber_id )
      `)
      .single();

    if (error) {
      toast.error(friendlyDbError(error, "Failed to update complaint"));
      console.error(error);
      return null;
    }

    const normalized = {
      ...data,
      subscriber_name: (data as any).subscribers?.name,
      subscriber_id_text: (data as any).subscribers?.subscriber_id,
    } as ComplaintWithSubscriber;

    setComplaints((prev) =>
      prev.map((c) => (c.id === id ? { ...c, ...normalized } : c))
    );
    return normalized;
  };

  const deleteComplaint = async (id: string) => {
    const { error } = await supabase.from("complaints").delete().eq("id", id);

    if (error) {
      toast.error(friendlyDbError(error, "Failed to delete complaint"));
      console.error(error);
      return false;
    }

    setComplaints((prev) => prev.filter((c) => c.id !== id));
    return true;
  };

  return {
    complaints,
    loading,
    addComplaint,
    updateComplaint,
    deleteComplaint,
    reloadComplaints: loadComplaints,
  };
};
