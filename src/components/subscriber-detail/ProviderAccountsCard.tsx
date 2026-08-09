import { useCallback, useEffect, useState } from 'react';
import { Loader2, Pencil, Save, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { friendlyDbError } from '@/lib/dbErrors';
import { usePermissions } from '@/lib/permissions';

interface ProviderAccountsCardProps {
  subscriberId: string;
  /** Provider ids attached to the subscriber, in display order. */
  providerIds: (string | null | undefined)[];
}

interface Row {
  providerId: string;
  providerName: string;
  serviceType: string;
  label: string;
  value: string;
  planName: string | null;
  planEnd: string | null;
  lastSeen: string | null;
}

/**
 * PROVIDER ACCOUNTS — the operator-visible face of
 * `subscriber_provider_state.provider_customer_number`.
 *
 * A manually entered provider identifier is a first-class deterministic
 * identity key for provider sync (INV-52): once saved here, the next import
 * matches this customer on account number instead of proposing a new
 * prospect. Writes go through `save_provider_account`, which role-gates the
 * edit and refuses a number already claimed by another customer.
 */
export function ProviderAccountsCard({ subscriberId, providerIds }: ProviderAccountsCardProps) {
  const perms = usePermissions();
  const canEdit = perms.isAdmin;
  const ids = [...new Set(providerIds.filter((p): p is string => !!p))];

  const [rows, setRows] = useState<Row[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (ids.length === 0) {
      setRows([]);
      return;
    }
    const [provRes, stateRes] = await Promise.all([
      (supabase as any).from('providers').select('id, name, service_type, identifier_label').in('id', ids),
      (supabase as any)
        .from('subscriber_provider_state')
        .select('provider_id, provider_customer_number, provider_plan_name, provider_plan_end, last_seen_in_snapshot_at')
        .eq('subscriber_id', subscriberId),
    ]);
    if (provRes.error || stateRes.error) {
      toast.error('Failed to load provider accounts');
      setRows([]);
      return;
    }
    const stateByProvider: Record<string, any> = {};
    for (const s of stateRes.data ?? []) stateByProvider[s.provider_id] = s;
    setRows(
      ids.map((id) => {
        const p = (provRes.data ?? []).find((x: any) => x.id === id);
        const st = stateByProvider[id];
        return {
          providerId: id,
          providerName: p?.name ?? 'Unknown provider',
          serviceType: p?.service_type ?? '',
          label: p?.identifier_label || 'Account Number',
          value: st?.provider_customer_number ?? '',
          planName: st?.provider_plan_name ?? null,
          planEnd: st?.provider_plan_end ?? null,
          lastSeen: st?.last_seen_in_snapshot_at ?? null,
        };
      }),
    );
  }, [subscriberId, ids.join(',')]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (row: Row) => {
    setSaving(true);
    const { error } = await (supabase as any).rpc('save_provider_account', {
      p_subscriber_id: subscriberId,
      p_provider_id: row.providerId,
      p_account_number: draft.trim() || null,
    });
    setSaving(false);
    if (error) {
      toast.error(friendlyDbError(error, 'Could not save the provider account'));
      return;
    }
    toast.success(draft.trim() ? `${row.label} saved` : `${row.label} cleared`);
    setEditing(null);
    void load();
  };

  if (rows === null) {
    return (
      <Card>
        <CardContent className="p-4 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading provider accounts…
        </CardContent>
      </Card>
    );
  }
  if (rows.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Provider accounts</CardTitle>
        <p className="text-xs text-muted-foreground">
          Used to match this customer in provider reports. Entering it here stops the next import
          creating a duplicate prospect.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.map((row) => {
          const isEditing = editing === row.providerId;
          return (
            <div key={row.providerId} className="rounded-lg border p-3 space-y-2">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div>
                  <p className="text-sm font-medium">{row.providerName}</p>
                  <p className="text-xs text-muted-foreground capitalize">{row.serviceType}</p>
                </div>
                {canEdit && !isEditing && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setEditing(row.providerId);
                      setDraft(row.value);
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5 mr-1" />
                    {row.value ? 'Edit' : 'Add'}
                  </Button>
                )}
              </div>

              {isEditing ? (
                <div className="flex items-center gap-2">
                  <Input
                    autoFocus
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder={row.label}
                    className="h-9"
                  />
                  <Button size="sm" disabled={saving} onClick={() => save(row)}>
                    {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                  </Button>
                  <Button size="sm" variant="ghost" disabled={saving} onClick={() => setEditing(null)}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ) : (
                <p className="text-sm">
                  <span className="text-muted-foreground">{row.label}: </span>
                  <span className="font-mono">{row.value || 'Not recorded'}</span>
                </p>
              )}

              {(row.planName || row.planEnd) && (
                <p className="text-xs text-muted-foreground">
                  Provider plan: {row.planName || '—'}
                  {row.planEnd && ` · valid to ${new Date(row.planEnd).toLocaleDateString('en-IN')}`}
                </p>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
