import { NavLink, useLocation } from 'react-router-dom';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar';
import { LayoutDashboard, Users, CreditCard, Router, MessageSquare, BarChart3, Settings as SettingsIcon, Tv, Wifi, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useEnabledServices } from '@/hooks/useEnabledServices';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';

/**
 * AppSidebar — left-rail navigation for the operator app.
 *
 * Grouped intentionally so future modules slot in without a redesign:
 *   Operations — day-to-day workflows (Dashboard, Customers, Billing, Complaints)
 *   Inventory  — assets and catalog (Equipment; future: Warehouse, Providers)
 *   Insights   — reporting (Analytics; future: Provider P&L, Network health)
 *   Admin      — configuration (Settings)
 *
 * Nav items also drive the mobile bottom nav (see AppShell) — a single source
 * of truth for navigation registration.
 */
export const NAV_GROUPS = [
  {
    label: 'Operations',
    items: [
      { title: 'Dashboard', url: '/', icon: LayoutDashboard, end: true },
      { title: 'Customers', url: '/customers', icon: Users },
      { title: 'Billing', url: '/billing', icon: CreditCard },
      { title: 'Complaints', url: '/complaints', icon: MessageSquare },
    ],
  },
  {
    label: 'Inventory',
    items: [{ title: 'Equipment', url: '/equipment', icon: Router }],
  },
  {
    label: 'Insights',
    items: [{ title: 'Analytics', url: '/analytics', icon: BarChart3 }],
  },
  {
    label: 'Admin',
    items: [{ title: 'Settings', url: '/settings', icon: SettingsIcon }],
  },
] as const;

// Flat list for the mobile bottom bar (only top workflows fit).
export const MOBILE_NAV = [
  { title: 'Home', url: '/', icon: LayoutDashboard, end: true },
  { title: 'Customers', url: '/customers', icon: Users },
  { title: 'Billing', url: '/billing', icon: CreditCard },
  { title: 'Equipment', url: '/equipment', icon: Router },
  { title: 'More', url: '/settings', icon: SettingsIcon },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === 'collapsed';
  const { pathname } = useLocation();
  const { cableEnabled, internetEnabled, bothEnabled } = useEnabledServices();
  const { signOut, user } = useAuth();

  const brand = bothEnabled ? 'Cable & Internet' : internetEnabled && !cableEnabled ? 'Internet Manager' : 'Cable TV Manager';
  const BrandIcon = internetEnabled && !cableEnabled ? Wifi : Tv;

  const isActive = (url: string, end?: boolean) =>
    end ? pathname === url : pathname === url || pathname.startsWith(url + '/');

  return (
    <Sidebar collapsible="icon" className="border-r">
      <SidebarHeader className="border-b border-sidebar-border">
        <div className="flex items-center gap-2.5 px-2 py-1.5">
          <div className="h-8 w-8 rounded-md bg-primary flex items-center justify-center shrink-0">
            <BrandIcon className="h-4 w-4 text-primary-foreground" />
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <div className="text-sm font-semibold text-sidebar-foreground truncate leading-tight">
                {brand}
              </div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Operator Console
              </div>
            </div>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent>
        {NAV_GROUPS.map((group) => (
          <SidebarGroup key={group.label}>
            {!collapsed && <SidebarGroupLabel>{group.label}</SidebarGroupLabel>}
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  const active = isActive(item.url, (item as any).end);
                  return (
                    <SidebarMenuItem key={item.url}>
                      <SidebarMenuButton asChild isActive={active} tooltip={item.title}>
                        <NavLink
                          to={item.url}
                          end={(item as any).end}
                          className={cn('flex items-center gap-2')}
                        >
                          <item.icon className="h-4 w-4" />
                          <span>{item.title}</span>
                        </NavLink>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border">
        <div className={cn('flex items-center gap-2 px-2 py-1.5', collapsed && 'justify-center')}>
          <div className="h-7 w-7 rounded-full bg-primary-muted text-primary flex items-center justify-center text-xs font-semibold shrink-0">
            {(user?.email?.[0] ?? 'U').toUpperCase()}
          </div>
          {!collapsed && (
            <>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium truncate text-sidebar-foreground">
                  {user?.email ?? 'Signed in'}
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={signOut}
                title="Sign out"
                className="h-7 w-7 text-muted-foreground hover:text-foreground"
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </>
          )}
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
