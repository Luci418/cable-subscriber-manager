import { ReactNode } from 'react';
import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { AppSidebar, MOBILE_NAV } from './AppSidebar';
import { cn } from '@/lib/utils';
import { NavLink, useLocation } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';

interface AppShellProps {
  children: ReactNode;
  /** Optional right-aligned slot for the top bar (page actions, search, etc.). */
  headerRight?: ReactNode;
  /** Optional override for breadcrumb trail. When omitted, it is derived from the URL. */
  breadcrumbs?: { label: string; to?: string }[];
}

/**
 * AppShell — persistent chrome for the operator console.
 *
 * Batch 2: router-driven. The sidebar/mobile nav highlight from URL,
 * and the top bar renders breadcrumbs derived from the current path.
 * Individual pages inject their own breadcrumbs (e.g. customer name)
 * via the `breadcrumbs` prop when they know more than the URL alone.
 */
export function AppShell({ children, headerRight, breadcrumbs }: AppShellProps) {
  const { pathname } = useLocation();
  const crumbs = breadcrumbs ?? deriveBreadcrumbs(pathname);

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        <AppSidebar />

        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-14 flex items-center gap-2 border-b bg-card/70 backdrop-blur px-3 sm:px-4 sticky top-0 z-20">
            <SidebarTrigger className="text-muted-foreground" />
            <div className="h-4 w-px bg-border mx-1 hidden sm:block" />
            <nav className="flex items-center gap-1 min-w-0 flex-1 text-sm">
              {crumbs.map((c, i) => {
                const last = i === crumbs.length - 1;
                return (
                  <div key={i} className="flex items-center gap-1 min-w-0">
                    {i > 0 && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                    {last || !c.to ? (
                      <span className={cn('truncate', last ? 'text-foreground font-medium' : 'text-muted-foreground')}>
                        {c.label}
                      </span>
                    ) : (
                      <NavLink to={c.to} className="text-muted-foreground hover:text-foreground truncate">
                        {c.label}
                      </NavLink>
                    )}
                  </div>
                );
              })}
            </nav>
            {headerRight}
          </header>

          <main className="flex-1 pb-20 md:pb-6">
            <div className="px-4 sm:px-6 lg:px-8 py-6 max-w-[1400px] mx-auto w-full">{children}</div>
          </main>
        </div>

        <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-card border-t border-border">
          <div className="grid grid-cols-5">
            {MOBILE_NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={!item.matchPrefix}
                className={({ isActive }) =>
                  cn(
                    'flex flex-col items-center justify-center gap-1 py-2 text-[10px] font-medium transition-colors',
                    isActive ? 'text-primary' : 'text-muted-foreground',
                  )
                }
              >
                <item.icon className="h-5 w-5" />
                <span className="leading-none">{item.title}</span>
              </NavLink>
            ))}
          </div>
        </nav>
      </div>
    </SidebarProvider>
  );
}

const LABELS: Record<string, string> = {
  '': 'Dashboard',
  customers: 'Customers',
  billing: 'Billing',
  complaints: 'Complaints',
  equipment: 'Equipment',
  analytics: 'Analytics',
  settings: 'Settings',
  new: 'Add',
};

function deriveBreadcrumbs(pathname: string): { label: string; to?: string }[] {
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length === 0) return [{ label: 'Dashboard' }];
  const out: { label: string; to?: string }[] = [{ label: 'Dashboard', to: '/' }];
  let acc = '';
  parts.forEach((p, i) => {
    acc += '/' + p;
    const label = LABELS[p] ?? p;
    out.push({ label, to: i === parts.length - 1 ? undefined : acc });
  });
  return out;
}
