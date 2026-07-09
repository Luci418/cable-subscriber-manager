import { ReactNode } from 'react';
import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { AppSidebar, MOBILE_NAV, type NavId } from './AppSidebar';
import { cn } from '@/lib/utils';

interface AppShellProps {
  children: ReactNode;
  active: NavId;
  onNavigate: (id: NavId) => void;
  header?: ReactNode;
}

/**
 * AppShell — persistent chrome: collapsible left rail + top bar (desktop),
 * top bar + fixed bottom nav (mobile).
 *
 * Batch 1 uses local nav state (id-based). Batch 2 will swap navigation for
 * real routes; consumers of this shell won't need to change because the
 * onNavigate/active contract stays.
 */
export function AppShell({ children, active, onNavigate, header }: AppShellProps) {
  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        <AppSidebar active={active} onNavigate={onNavigate} />

        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-14 flex items-center gap-2 border-b bg-card/70 backdrop-blur px-3 sm:px-4 sticky top-0 z-20">
            <SidebarTrigger className="text-muted-foreground" />
            <div className="h-4 w-px bg-border mx-1 hidden sm:block" />
            {header ?? <div className="text-sm text-muted-foreground truncate" />}
          </header>

          <main className="flex-1 pb-20 md:pb-6">
            <div className="px-4 sm:px-6 lg:px-8 py-6 max-w-[1400px] mx-auto w-full">
              {children}
            </div>
          </main>
        </div>

        {/* Mobile bottom nav — 5 slots max */}
        <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-card border-t border-border">
          <div className="grid grid-cols-5">
            {MOBILE_NAV.map((item) => (
              <button
                key={item.id}
                onClick={() => onNavigate(item.id)}
                className={cn(
                  'flex flex-col items-center justify-center gap-1 py-2 text-[10px] font-medium transition-colors',
                  active === item.id ? 'text-primary' : 'text-muted-foreground',
                )}
              >
                <item.icon className="h-5 w-5" />
                <span className="leading-none">{item.title}</span>
              </button>
            ))}
          </div>
        </nav>
      </div>
    </SidebarProvider>
  );
}
