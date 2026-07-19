import { useEffect } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { AppShell } from './AppShell';
import { AppDataProvider } from '@/contexts/AppDataContext';
import { ConfirmHost } from '@/lib/confirm';
import { PermissionsProvider } from '@/lib/permissions';

/**
 * AppLayout — protected shell layout. Redirects unauthenticated users
 * to /auth, mounts the AppShell (sidebar + top bar + mobile nav), and
 * provides the shared AppData context to all nested routes.
 */
export default function AppLayout() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !user) navigate('/auth');
  }, [user, loading, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }
  if (!user) return null;

  return (
    <AppDataProvider>
      <AppShell>
        <Outlet />
      </AppShell>
      <ConfirmHost />
    </AppDataProvider>
  );
}
