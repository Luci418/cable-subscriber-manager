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
import {
  LayoutDashboard,
  Users,
  CreditCard,
  Router,
  MessageSquare,
  BarChart3,
  Settings as SettingsIcon,
  Tv,
  Wifi,
  LogOut,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useEnabledServices } from '@/hooks/useEnabledServices';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';
import { NavLink, useLocation } from 'react-router-dom';

/**
 * Navigation registry. Batch 2 (Phase 6.5) migrates the sidebar to real
 * router-driven navigation using NavLink. Active-state highlighting is
 * derived from the URL rather than a prop, so any code path — a link, a
 * browser back button, a bookmark — keeps the sidebar in sync.
 *
 * We intentionally do NOT list routes for future modules (technician
 * credentials, field ops, warehouse). Those will be added when they exist.
 * "Equipment" stays as the label; the broader Asset Lifecycle rename waits
 * on the warehouse module.
 */
export interface NavItem {
  title: string;
  icon: LucideIcon;
  to: string;
  /** Match when the current URL starts with this prefix (for nested routes). */
  matchPrefix?: string;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Operations',
    items: [
      { to: '/', title: 'Dashboard', icon: LayoutDashboard },
      { to: '/customers', title: 'Customers', icon: Users, matchPrefix: '/customers' },
      { to: '/billing', title: 'Billing', icon: CreditCard },
      { to: '/complaints', title: 'Complaints', icon: MessageSquare },
    ],
  },
  {
    label: 'Inventory',
    items: [{ to: '/equipment', title: 'Equipment', icon: Router, matchPrefix: '/equipment' }],
  },
  {
    label: 'Insights',
    items: [{ to: '/analytics', title: 'Analytics', icon: BarChart3 }],
  },
  {
    label: 'Admin',
    items: [{ to: '/settings', title: 'Settings', icon: SettingsIcon }],
  },
];

export const MOBILE_NAV: NavItem[] = [
  { to: '/', title: 'Home', icon: LayoutDashboard },
  { to: '/customers', title: 'Customers', icon: Users, matchPrefix: '/customers' },
  { to: '/billing', title: 'Billing', icon: CreditCard },
  { to: '/equipment', title: 'Equipment', icon: Router, matchPrefix: '/equipment' },
  { to: '/settings', title: 'More', icon: SettingsIcon },
];

function isActivePath(pathname: string, item: NavItem): boolean {
  if (item.matchPrefix) return pathname === item.matchPrefix || pathname.startsWith(item.matchPrefix + '/');
  return pathname === item.to;
}

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === 'collapsed';
  const { cableEnabled, internetEnabled, bothEnabled } = useEnabledServices();
  const { signOut, user } = useAuth();
  const { pathname } = useLocation();

  const brand = bothEnabled
    ? 'Cable & Internet'
    : internetEnabled && !cableEnabled
      ? 'Internet Manager'
      : 'Cable TV Manager';
  const BrandIcon = internetEnabled && !cableEnabled ? Wifi : Tv;

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
                {group.items.map((item) => (
                  <SidebarMenuItem key={item.to}>
                    <SidebarMenuButton asChild isActive={isActivePath(pathname, item)} tooltip={item.title}>
                      <NavLink to={item.to} end={!item.matchPrefix}>
                        <item.icon className="h-4 w-4" />
                        <span>{item.title}</span>
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
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
