import { createContext, useContext, useEffect, useMemo, useState, ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import type { User, Session } from "@supabase/supabase-js";

/**
 * Auth is a SINGLETON.
 *
 * `useAuth()` is called from ~30 components. When each call site owned its own
 * state it also owned its own `getSession()` round-trip and its own
 * `onAuthStateChange` subscription — so every page and dialog started life in
 * `loading: true` and rendered a spinner until its private request came back.
 * That was the bulk of the perceived "loading buffer" between screens.
 *
 * Now the session is resolved once by `AuthProvider` and every consumer reads
 * the already-settled value. Public API is unchanged.
 */
interface AuthState {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signOut: () => Promise<void>;
  isAuthenticated: boolean;
}

const AuthCtx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setUser(s?.user ?? null);
      setLoading(false);
    });

    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setUser(s?.user ?? null);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      session,
      loading,
      isAuthenticated: !!user,
      signOut: async () => {
        await supabase.auth.signOut();
        navigate("/auth");
      },
    }),
    [user, session, loading, navigate],
  );

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export const useAuth = (): AuthState => {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
};
