import { createContext, useContext, ReactNode } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useSubscribers } from '@/hooks/useSubscribers';
import { useTransactions } from '@/hooks/useTransactions';

/**
 * AppDataContext — shared subscribers/transactions state for the routed
 * shell. Previously the single Index page owned this state; with real
 * routes the pages that need it (Home, Customers, CustomerDetail,
 * BillingRoute) subscribe here so we don't refetch per route.
 *
 * Kept intentionally thin: no fetching orchestration, no dialog state.
 * Each page owns its own dialog/UI state; reloads happen through the
 * exposed reload functions.
 */
type Ctx = ReturnType<typeof useSubscribers> & {
  transactions: ReturnType<typeof useTransactions>['transactions'];
  addTransaction: ReturnType<typeof useTransactions>['addTransaction'];
  reloadTransactions: ReturnType<typeof useTransactions>['reloadTransactions'];
};

const AppDataCtx = createContext<Ctx | null>(null);

export function AppDataProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const subs = useSubscribers(user?.id);
  const { transactions, addTransaction, reloadTransactions } = useTransactions(user?.id);

  return (
    <AppDataCtx.Provider value={{ ...subs, transactions, addTransaction, reloadTransactions }}>
      {children}
    </AppDataCtx.Provider>
  );
}

export function useAppData() {
  const ctx = useContext(AppDataCtx);
  if (!ctx) throw new Error('useAppData must be used inside AppDataProvider');
  return ctx;
}
