import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react';
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
};

const AppDataCtx = createContext<Ctx | null>(null);

export function AppDataProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [demand, setDemand] = useState(false);
  const requestFullData = useCallback(() => setDemand(true), []);
  const subs = useSubscribers(user?.id, demand);
  const { transactions, addTransaction, reloadTransactions } = useTransactions(
    user?.id,
    undefined,
    demand,
  );

  return (
    <AppDataCtx.Provider
      value={{
        ...subs,
        transactions,
        addTransaction,
        reloadTransactions,
        requestFullData,
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
