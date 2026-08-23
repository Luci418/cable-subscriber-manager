import { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useSubscribers } from '@/hooks/useSubscribers';
import { useTransactions } from '@/hooks/useTransactions';


/**
 * AppDataContext — shared subscribers/transactions state for the routed
 * shell.
 *
 * Loading is DEMAND-DRIVEN: the provider fetches nothing until a consumer
 * calls `useAppData()`. Routes that render their own server-paginated data
 * (e.g. Customers) use `useAppDataLazy()` so they don't pay for a full
 * subscribers + transactions load they never display.
 *
 * Kept intentionally thin: no fetching orchestration, no dialog state.
 */
type Ctx = ReturnType<typeof useSubscribers> & {
  transactions: ReturnType<typeof useTransactions>['transactions'];
  addTransaction: ReturnType<typeof useTransactions>['addTransaction'];
  reloadTransactions: ReturnType<typeof useTransactions>['reloadTransactions'];
  requestFullData: () => void;
  /**
   * Explicit invalidation for write actions that happen OUTSIDE the shared
   * hooks (e.g. a provider import commit, which creates customers, charges
   * and subscriptions server-side). Without this the profile of a
   * just-imported customer would only be guaranteed fresh after the 15s
   * age-out — a real window for "Customer not found" / stale balances.
   */
  invalidateAppData: () => void;
};


const AppDataCtx = createContext<Ctx | null>(null);

/** How long a loaded snapshot is considered fresh (ms). */
const STALE_AFTER_MS = 15_000;

export function AppDataProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [demand, setDemand] = useState(false);
  const lastLoadedAt = useRef(0);
  const subs = useSubscribers(user?.id, demand);
  const { transactions, addTransaction, reloadTransactions } = useTransactions(
    user?.id,
    undefined,
    demand,
  );

  // The hooks recreate their reload closures every render; keep them in refs
  // so `requestFullData` stays referentially stable for consumer effects.
  const reloadRef = useRef({ subs: subs.reloadSubscribers, txns: reloadTransactions });
  reloadRef.current = { subs: subs.reloadSubscribers, txns: reloadTransactions };
  const loadingRef = useRef(subs.loading);
  loadingRef.current = subs.loading;
  const demandRef = useRef(demand);
  demandRef.current = demand;

  // Stamp the snapshot time whenever a load finishes.
  useEffect(() => {
    if (demand && !subs.loading) lastLoadedAt.current = Date.now();
  }, [demand, subs.loading]);

  /**
   * Consumers call this on mount. The first call kicks off the load; later
   * calls refetch when the snapshot has gone stale — without this, a page
   * opened after an import (or after balances changed elsewhere) rendered
   * the snapshot taken when the shell first mounted, which surfaced as
   * "Customer not found" and stale balances/subscriptions.
   */
  const requestFullData = useCallback(() => {
    if (!demandRef.current) {
      setDemand(true);
      return;
    }
    if (loadingRef.current) return;
    if (Date.now() - lastLoadedAt.current > STALE_AFTER_MS) {
      lastLoadedAt.current = Date.now();
      reloadRef.current.subs();
      reloadRef.current.txns();
    }
  }, []);


  /** Mark the snapshot stale and refetch immediately if anyone is consuming it. */
  const invalidateAppData = useCallback(() => {
    lastLoadedAt.current = 0;
    if (!demandRef.current || loadingRef.current) return;
    lastLoadedAt.current = Date.now();
    reloadRef.current.subs();
    reloadRef.current.txns();
  }, []);

  return (
    <AppDataCtx.Provider
      value={{
        ...subs,
        transactions,
        addTransaction,
        reloadTransactions,
        requestFullData,
        invalidateAppData,
      }}
    >

      {children}
    </AppDataCtx.Provider>
  );
}

function useCtx() {
  const ctx = useContext(AppDataCtx);
  if (!ctx) throw new Error('useAppData must be used inside AppDataProvider');
  return ctx;
}

/** Reads shared data and triggers the full load on mount. */
export function useAppData() {
  const ctx = useCtx();
  const { requestFullData } = ctx;
  useEffect(() => {
    requestFullData();
  }, [requestFullData]);
  return ctx;
}

/** Access the context WITHOUT triggering the full subscribers/transactions load. */
export function useAppDataLazy() {
  return useCtx();
}
