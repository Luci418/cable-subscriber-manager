import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertTriangle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

interface VoidedRow {
  id: string;
  amount: number;
  type: string;
  service_type: string | null;
  voided_at: string | null;
  void_reason_code: string | null;
  void_reason: string | null;
  subscriber_id: string | null;
  subscriber?: { name: string | null; subscriber_id: string | null } | null;
}

/**
 * Operator-visible audit widget: every void that happened in the last 7 days.
 * Voids are legitimate but rare; surfacing them prevents them from being
 * a quiet way to make money disappear. Counts and individual rows are shown.
 */
export const RecentVoidsCard = () => {
  const { user } = useAuth();
  const [rows, setRows] = useState<VoidedRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    setLoading(true);
    (supabase as any)
      .from('transactions')
      .select('id, amount, type, service_type, voided_at, void_reason_code, void_reason, subscriber_id, subscriber:subscribers!transactions_subscriber_id_fkey(name, subscriber_id)')
      .eq('user_id', user.id)
      .eq('status', 'voided')
      .gte('voided_at', since)
      .order('voided_at', { ascending: false })
      .limit(50)
      .then(({ data }: any) => { setRows(data || []); setLoading(false); });
  }, [user]);

  const formatReason = (code: string | null) =>
    code ? code.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()) : '—';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-warning" />
          Recent Voids
          <Badge variant="outline">{rows.length}</Badge>
        </CardTitle>
        <CardDescription>
          Transactions voided in the last 7 days. Voids are permanent ledger events —
          if anything here looks wrong, investigate before more posts.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground py-4">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">No voids in the last 7 days.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Voided</TableHead>
                <TableHead>Subscriber</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Note</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(r => (
                <TableRow key={r.id}>
                  <TableCell className="text-sm">
                    {r.voided_at ? new Date(r.voided_at).toLocaleString() : '—'}
                  </TableCell>
                  <TableCell className="text-sm">
                    {r.subscriber?.name ?? '—'}{' '}
                    {r.subscriber?.subscriber_id && (
                      <span className="text-muted-foreground">({r.subscriber.subscriber_id})</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={r.type === 'payment' ? 'default' : 'destructive'}>
                      {r.type === 'payment' ? 'Cash Received' : 'Bill'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-semibold">
                    ₹{Number(r.amount).toFixed(2)}
                  </TableCell>
                  <TableCell className="text-sm">{formatReason(r.void_reason_code)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{r.void_reason ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
};
