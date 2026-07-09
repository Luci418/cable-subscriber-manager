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
import { LayoutDashboard, Users, CreditCard, Router, MessageSquare, BarChart3, Settings as SettingsIcon, Tv, Wifi, LogOut, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useEnabledServices } from '@/hooks/useEnabledServices';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';

/**
 * Navigation registry. Adding a new module = one entry here. This drives
 * both the desktop sidebar and mobile bottom nav so they never drift.
 *
 * `id` is a stable string; the shell forwards it to the parent via
 * `onNavigate`. Phase 6.5 Batch 1 keeps nav in local state; Batch 2 will
 * swap this for real router routes without changing this registry.
 */
export type NavId =
  | 'dashboard'
  | 'customers'
  | 'billing'
  | 'complaints'
  | 'equipment'
  | 'analytics'
  | 'settings';

export interface NavItem {
  id: NavId;
  title: string;
  icon: LucideIcon;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Operations',
    items: [
      { id: 'dashboard', title: 'Dashboard', icon: LayoutDashboard },
      { id: 'customers', title: 'Customers', icon: Users },
      { id: 'billing', title: 'Billing', icon: CreditCard },
      { id: 'complaints', title: 'Complaints', icon: MessageSquare },
    ],
  },
  {
    label: 'Inventory',
    items: [{ id: 'equipment', title: 'Equipment', icon: Router }],
  },
  {
    label: 'Insights',
    items: [{ id: 'analytics', title: 'Analytics', icon: BarChart3 }],
  },
  {
    label: 'Admin',
    items: [{ id: 'settings', title: 'Settings', icon: SettingsIcon }],
  },
];

export const MOBILE_NAV: NavItem[] = [
  { id: 'dashboard', title: 'Home', icon: LayoutDashboard },
  { id: 'customers', title: 'Customers', icon: Users },
  { id: 'billing', title: 'Billing', icon: CreditCard },
  { id: 'equipment', title: 'Equipment', icon: Router },
  { id: 'settings', title: 'More', icon: SettingsIcon },
];

interface AppSidebarProps {
  active: NavId;
  onNavigate: (id: NavId) => void;
}

export function AppSidebar({ active, onNavigate }: AppSidebarProps) {
  const { state } = useSidebar();
  const collapsed = state === 'collapsed';
  const { cableEnabled, internetEnabled, bothEnabled } = useEnabledServices();
  const { signOut, user } = useAuth();

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
                  <SidebarMenuItem key={item.id}>
                    <SidebarMenuButton
                      isActive={active === item.id}
                      tooltip={item.title}
                      onClick={() => onNavigate(item.id)}
                    >
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
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
