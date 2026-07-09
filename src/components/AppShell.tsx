import { ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { AppSidebar, MOBILE_NAV } from './AppSidebar';
import { cn } from '@/lib/utils';

/**
 * AppShell — persistent application chrome.
 *
 * Layout:
 *  - Desktop: collapsible left rail + top bar (trigger, breadcrumbs slot) + main
 *  - Mobile: top bar + fixed bottom nav
 *
 * All authenticated pages mount inside this shell (via router Outlet or as
 * children). New modules register in AppSidebar.NAV_GROUPS — no changes here.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        <AppSidebar />

        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-14 flex items-center gap-2 border-b bg-card/60 backdrop-blur px-3 sm:px-4 sticky top-0 z-20">
            <SidebarTrigger className="text-muted-foreground" />
            <div className="h-4 w-px bg-border mx-1 hidden sm:block" />
            {/* Breadcrumb / context slot — pages can portal into this later */}
            <div className="text-sm text-muted-foreground truncate" id="app-breadcrumb-slot" />
          </header>

          <main className="flex-1 pb-20 md:pb-6">
            <div className="px-4 sm:px-6 lg:px-8 py-6 max-w-[1400px] mx-auto w-full">
              {children}
            </div>
          </main>
        </div>

        {/* Mobile bottom nav */}
        <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-card border-t border-border">
          <div className="grid grid-cols-5">
            {MOBILE_NAV.map((item) => {
              const active = item.end ? pathname === item.url : pathname === item.url || pathname.startsWith(item.url + '/');
              return (
                <NavLink
                  key={item.url}
                  to={item.url}
                  end={item.end}
                  className={cn(
                    'flex flex-col items-center justify-center gap-1 py-2 text-[10px] font-medium transition-colors',
                    active ? 'text-primary' : 'text-muted-foreground',
                  )}
                >
                  <item.icon className="h-5 w-5" />
                  <span className="leading-none">{item.title}</span>
                </NavLink>
              );
            })}
          </div>
        </nav>
      </div>
    </SidebarProvider>
  );
}
