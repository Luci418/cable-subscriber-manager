/**
 * Phase 6 · Role foundation — CLIENT MIRROR of server-side helpers.
 *
 * ⚠️ Security boundary: the database is the authority. Every gated RPC and
 * write path re-checks the role server-side (see the `can_*` SQL functions
 * and the `transactions_enforce_void_role` trigger). This module exists ONLY
 * to hide/disable buttons so an operator without permission never sees a
 * dead-end action — never to make security decisions on the client.
 *
 * Role → allowed action matrix (mirrors the SQL helpers):
 *
 *   Action                    | owner | admin_office | collection_agent | technician
 *   --------------------------|-------|--------------|------------------|-----------
 *   void_transaction          |   ✓   |      ✓       |                  |
 *   cancel_subscription       |   ✓   |      ✓       |                  |
 *   archive/reactivate cust.  |   ✓   |      ✓       |                  |
 *   pair/unpair/replace dev.  |   ✓   |      ✓       |                  |     ✓
 *   collect payment           |   ✓   |      ✓       |        ✓         |
 *   modify settings           |   ✓   |              |                  |
 */
import { createContext, useContext, useEffect, useState, type ReactNode, createElement } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export type AppRole = 'owner' | 'admin_office' | 'collection_agent' | 'technician';

interface Permissions {
  loading: boolean;
  roles: AppRole[];
  isOwner: boolean;
  isAdmin: boolean;               // owner OR admin_office
  isCollectionAgent: boolean;
  isTechnician: boolean;
  canVoidTransaction: boolean;
  canCancelSubscription: boolean;
  /**
   * Archive and reactivate share the same role set. `canManageCustomerLifecycle`
   * is the canonical name; `canArchiveCustomer` is kept as a deprecated alias
   * for backwards compatibility with older call sites and will be removed in a
   * future cleanup.
   */
  canManageCustomerLifecycle: boolean;
  /** @deprecated use canManageCustomerLifecycle */
  canArchiveCustomer: boolean;
  canPairDevice: boolean;
  canReplaceDevice: boolean;
  canCollectPayment: boolean;
  canModifySettings: boolean;
  canViewCredentials: boolean;
}

const EMPTY: Permissions = {
  loading: true,
  roles: [],
  isOwner: false,
  isAdmin: false,
  isCollectionAgent: false,
  isTechnician: false,
  canVoidTransaction: false,
  canCancelSubscription: false,
  canManageCustomerLifecycle: false,
  canArchiveCustomer: false,
  canPairDevice: false,
  canReplaceDevice: false,
  canCollectPayment: false,
  canModifySettings: false,
  canViewCredentials: false,
};

/**
 * Named permission helper for the Credentials tab.
 * See file header comment. Future phases may extend this with
 * job-assignment conditions without changing consumers.
 */
export const canViewCredentials = (roles: AppRole[]): boolean =>
  roles.includes('owner') || roles.includes('admin_office') || roles.includes('technician');

const derive = (roles: AppRole[]): Permissions => {
  const has = (r: AppRole) => roles.includes(r);
  const isOwner = has('owner');
  const isAdmin = isOwner || has('admin_office');
  const isCollectionAgent = has('collection_agent');
  const isTechnician = has('technician');
  return {
    loading: false,
    roles,
    isOwner,
    isAdmin,
    isCollectionAgent,
    isTechnician,
    canVoidTransaction:         isAdmin,
    canCancelSubscription:      isAdmin,
    canManageCustomerLifecycle: isAdmin,
    canArchiveCustomer:         isAdmin,
    canPairDevice:              isAdmin || isTechnician,
    canReplaceDevice:           isAdmin || isTechnician,
    canCollectPayment:          isAdmin || isCollectionAgent,
    canModifySettings:          isOwner,
    canViewCredentials:         canViewCredentials(roles),
  };
};


/**
 * PermissionsProvider — fetches the signed-in user's roles ONCE per session
 * (on login) and caches them in context. Role changes require re-login.
 * Mount this inside AppLayout so every consumer reads synchronously.
 */
const PermissionsCtx = createContext<Permissions>(EMPTY);

export const PermissionsProvider = ({ children }: { children: ReactNode }) => {
  const { user, loading: authLoading } = useAuth();
  const [state, setState] = useState<Permissions>(EMPTY);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (authLoading) return;
      if (!user) { setState({ ...EMPTY, loading: false }); return; }
      const { data, error } = await (supabase as any)
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id);
      if (cancelled) return;
      if (error) {
        console.warn('[permissions] failed to load roles:', error);
        setState({ ...EMPTY, loading: false });
        return;
      }
      const roles = ((data ?? []) as { role: AppRole }[]).map(r => r.role);
      setState(derive(roles));
    };
    load();
    return () => { cancelled = true; };
  }, [user?.id, authLoading]);

  return createElement(PermissionsCtx.Provider, { value: state }, children);
};

/**
 * Hook: read cached permissions from context. Synchronous — no RPC per mount.
 */
export const usePermissions = (): Permissions => useContext(PermissionsCtx);
