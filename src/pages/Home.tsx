import { Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Dashboard } from '@/components/Dashboard';
import { useAppData } from '@/contexts/AppDataContext';

/**
 * Home route ("/") — thin wrapper around Dashboard that adapts the
 * component's imperative onNavigate/onSelectSubscriber props to
 * router navigation. Dashboard itself remains presentation-only.
 */
export default function Home() {
  const navigate = useNavigate();
  const { subscribers, transactions, loading } = useAppData();

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <Dashboard
      subscribers={subscribers as any}
      transactions={transactions as any}
      onNavigate={(id) => {
        // Dashboard still emits legacy NavIds; translate to routes.
        const map: Record<string, string> = {
          dashboard: '/',
          customers: '/customers',
          billing: '/billing',
          complaints: '/complaints',
          equipment: '/equipment',
          analytics: '/analytics',
          settings: '/settings',
        };
        navigate(map[id] ?? '/');
      }}
      onSelectSubscriber={(id) => navigate(`/customers/${id}`)}
    />
  );
}
