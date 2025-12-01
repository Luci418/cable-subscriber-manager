import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";

type Transaction = Database["public"]["Tables"]["transactions"]["Row"];
type TransactionInsert = Database["public"]["Tables"]["transactions"]["Insert"];
type TransactionUpdate = Database["public"]["Tables"]["transactions"]["Update"];

export const useTransactions = (userId: string | undefined, subscriberId?: string) => {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  const loadTransactions = async () => {
    if (!userId) return;
    
    setLoading(true);
    let query = supabase
      .from("transactions")
      .select("*")
      .eq("user_id", userId);

    if (subscriberId) {
      query = query.eq("subscriber_id", subscriberId);
    }

    const { data, error } = await query.order("date", { ascending: false });

    if (error) {
      toast.error("Failed to load transactions");
      console.error(error);
    } else {
      setTransactions(data || []);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadTransactions();
  }, [userId, subscriberId]);

  const addTransaction = async (transaction: Omit<TransactionInsert, "user_id">) => {
    if (!userId) return;

    const { data, error } = await supabase
      .from("transactions")
      .insert({ ...transaction, user_id: userId })
      .select()
      .single();

    if (error) {
      toast.error("Failed to add transaction");
      console.error(error);
      return false;
    }

    // Optimistic update
    if (data) {
      setTransactions(prev => [data, ...prev]);
    }
    return true;
  };

  const updateTransaction = async (id: string, updates: TransactionUpdate) => {
    const { error } = await supabase
      .from("transactions")
      .update(updates)
      .eq("id", id);

    if (error) {
      toast.error("Failed to update transaction");
      console.error(error);
      return false;
    }

    // Optimistic update
    setTransactions(prev => prev.map(txn => 
      txn.id === id ? { ...txn, ...updates } : txn
    ));
    return true;
  };

  const deleteTransaction = async (id: string) => {
    const { error } = await supabase
      .from("transactions")
      .delete()
      .eq("id", id);

    if (error) {
      toast.error("Failed to delete transaction");
      console.error(error);
      return false;
    }

    // Optimistic update
    setTransactions(prev => prev.filter(txn => txn.id !== id));
    return true;
  };

  return {
    transactions,
    loading,
    addTransaction,
    updateTransaction,
    deleteTransaction,
    reloadTransactions: loadTransactions,
  };
};