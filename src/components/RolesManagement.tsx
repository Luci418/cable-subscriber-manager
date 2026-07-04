/**
 * Phase 6 · Roles Management (Owner-only)
 *
 * Lists every user of this tenant with their current app roles and lets an
 * Owner grant or revoke roles. Backed by the `list_users_with_roles()` RPC
 * (SECURITY DEFINER, gated to owners) and direct writes against
 * `public.user_roles` (RLS also owner-only).
 *
 * Intentionally out of scope for this batch: user invitations, password
 * resets, email flows, multi-tenant admin. New staff members sign up
 * through the normal /auth page — they land with NO role, then an Owner
 * assigns one from this screen. The empty-state below spells that out.
 */
import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { ShieldCheck, UserPlus, Users, Info } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { usePermissions, type AppRole } from '@/lib/permissions';
import { toast } from 'sonner';

interface Row {
  user_id: string;
  email: string | null;
  full_name: string | null;
  roles: AppRole[];
}

const ROLES: { value: AppRole; label: string; blurb: string }[] = [
  { value: 'owner',            label: 'Owner',            blurb: 'Full access, including settings and role management.' },
  { value: 'admin_office',     label: 'Admin (Office)',   blurb: 'Cancel, refund, archive, void, device management. No role or settings changes.' },
  { value: 'collection_agent', label: 'Collection Agent', blurb: 'Record customer payments only.' },
  { value: 'technician',       label: 'Technician',       blurb: 'Pair, unpair and replace devices. No financial access.' },
];

export const RolesManagement = () => {
  const { user } = useAuth();
  const perms = usePermissions();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await (supabase as any).rpc('list_users_with_roles');
    if (error) {
      toast.error('Failed to load users: ' + error.message);
      setRows([]);
    } else {
      setRows((data ?? []) as Row[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (perms.isOwner) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perms.isOwner]);

  if (perms.loading) return null;
  if (!perms.isOwner) return null;

  const toggleRole = async (targetUserId: string, role: AppRole, checked: boolean) => {
    // Guard: an owner may not revoke their own owner role — prevents a
    // tenant from ending up with zero owners.
    if (!checked && role === 'owner' && targetUserId === user?.id) {
      toast.error('You cannot revoke your own Owner role.');
      return;
    }
    setSaving(`${targetUserId}:${role}`);
    try {
      if (checked) {
        const { error } = await (supabase as any)
          .from('user_roles')
          .insert({ user_id: targetUserId, role, granted_by: user?.id });
        if (error) { toast.error(error.message); return; }
        toast.success(`${role} granted`);
      } else {
        const { error } = await (supabase as any)
          .from('user_roles')
          .delete()
          .eq('user_id', targetUserId)
          .eq('role', role);
        if (error) { toast.error(error.message); return; }
        toast.success(`${role} revoked`);
      }
      await load();
    } finally {
      setSaving(null);
    }
  };

  return (
    <Card className="md:col-span-2">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5" />
          Roles & Access
        </CardTitle>
        <CardDescription>
          Grant staff members the roles they need. Users start with no role —
          they can sign in but see no data or actions until you grant a role.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground flex gap-2">
          <Info className="h-4 w-4 shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-foreground mb-1">How to add a staff member</p>
            <p>
              Ask them to sign up at the login page using their own email. Their
              account will appear here with no role — check the appropriate role
              below to grant access. Invitations and email onboarding are not
              built yet; you provision access manually here.
            </p>
          </div>
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading users…</p>
        ) : rows.length === 0 ? (
          <div className="text-sm text-muted-foreground flex items-center gap-2 py-6">
            <Users className="h-4 w-4" /> No users yet.
          </div>
        ) : (
          <div className="space-y-3">
            {rows.map(row => (
              <div key={row.user_id} className="rounded-lg border p-3 space-y-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{row.full_name || row.email || row.user_id}</p>
                    {row.email && row.full_name && (
                      <p className="text-xs text-muted-foreground truncate">{row.email}</p>
                    )}
                    {row.user_id === user?.id && (
                      <Badge variant="outline" className="text-[10px] mt-1">You</Badge>
                    )}
                  </div>
                  <div className="flex gap-1 flex-wrap">
                    {row.roles.length === 0 ? (
                      <Badge variant="secondary" className="text-[10px]">No role</Badge>
                    ) : (
                      row.roles.map(r => (
                        <Badge key={r} className="text-[10px]">{r}</Badge>
                      ))
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {ROLES.map(r => {
                    const checked = row.roles.includes(r.value);
                    const key = `${row.user_id}:${r.value}`;
                    return (
                      <label key={r.value}
                        className="flex items-start gap-2 rounded border p-2 cursor-pointer hover:bg-muted/40 transition-colors">
                        <Checkbox
                          checked={checked}
                          disabled={saving === key}
                          onCheckedChange={(v) => toggleRole(row.user_id, r.value, !!v)}
                        />
                        <div className="min-w-0">
                          <p className="text-sm font-medium">{r.label}</p>
                          <p className="text-xs text-muted-foreground">{r.blurb}</p>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <UserPlus className="h-4 w-4 mr-2" /> Refresh
        </Button>
      </CardContent>
    </Card>
  );
};
