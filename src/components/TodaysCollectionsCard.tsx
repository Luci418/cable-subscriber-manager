import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, Wallet } from 'lucide-react';
import { SectionCard, EmptyState, Money } from '@/components/ui-ext';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

/**
 * Today's Collections — operator's end-of-day reconciliation view.
 *
 * Lists every posted payment (or negative adjustment credit) recorded
 * today so the operator can confirm all cash/UPI receipts are in the
 * system before closing out. Rows link back to the customer profile;
 * export produces a CSV suitable for handover.
 */
interface Row {
  id: string;
  amount: number;
  date: string;
  service_type: string | null;
  description: string | null;
  source: string | null;
  subscriber_id: string | null;
  subscriber_name: string | null;
  subscriber_public_id: string | null;
  created_by: string | null;
  collected_by_name: string | null;
  payment_method: 'cash' | 'upi' | 'other' | null;
}

const todayISO = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
};
const tomorrowISO = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 1);
  return d.toISOString();
};

/**
 * Prefer the persisted `payment_method` column (populated by the Collect
 * Payment dialog and the Add Transaction dialog). Fall back to string
 * scraping only for historical rows that predate the column.
 */
const displayMethod = (r: Row): 'Cash' | 'UPI' | 'Other' => {
  if (r.payment_method === 'cash') return 'Cash';
  if (r.payment_method === 'upi') return 'UPI';
  if (r.payment_method === 'other') return 'Other';
  const s = `${r.description ?? ''} ${r.source ?? ''}`.toLowerCase();
  if (s.includes('upi')) return 'UPI';
  if (s.includes('cash')) return 'Cash';
  return 'Other';
};

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

const csvEscape = (v: unknown) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const TodaysCollectionsCard = () => {
  const { user } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      // Only "money in" today: payments (excluding refund reversals) with
      // a real posted status. FIFO/targeted allocation is orthogonal — the
      // operator cares about the raw receipt for reconciliation.
      const { data: txs, error } = await (supabase as any)
        .from('transactions')
        .select('id, amount, date, service_type, description, source, subscriber_id, created_by, type, status, payment_method')
        .eq('user_id', user.id)
        .eq('type', 'payment')
        .eq('status', 'posted')
        .neq('source', 'subscription_refund')
        .gte('date', todayISO())
        .lt('date', tomorrowISO())
        .order('date', { ascending: false });
      if (error) {
        console.error(error);
        toast.error('Failed to load today’s collections');
        if (!cancelled) setLoading(false);
        return;
      }

      const list = (txs ?? []) as any[];
      const subIds = Array.from(new Set(list.map((t) => t.subscriber_id).filter(Boolean)));
      const creatorIds = Array.from(new Set(list.map((t) => t.created_by).filter(Boolean)));

      const [subsRes, profRes] = await Promise.all([
        subIds.length
          ? (supabase as any).from('subscribers').select('id, name, subscriber_id').in('id', subIds)
          : Promise.resolve({ data: [] }),
        creatorIds.length
          ? (supabase as any).from('profiles').select('id, full_name, email').in('id', creatorIds)
          : Promise.resolve({ data: [] }),
      ]);
      const subMap = new Map<string, any>((subsRes?.data ?? []).map((s: any) => [s.id, s]));
      const profMap = new Map<string, any>((profRes?.data ?? []).map((p: any) => [p.id, p]));

      const enriched: Row[] = list.map((t) => {
        const sub = t.subscriber_id ? subMap.get(t.subscriber_id) : null;
        const prof = t.created_by ? profMap.get(t.created_by) : null;
        return {
          id: t.id,
          amount: Number(t.amount || 0),
          date: t.date,
          service_type: t.service_type ?? null,
          description: t.description ?? null,
          source: t.source ?? null,
          subscriber_id: t.subscriber_id,
          subscriber_name: sub?.name ?? null,
          subscriber_public_id: sub?.subscriber_id ?? null,
          created_by: t.created_by ?? null,
          collected_by_name: prof?.full_name || prof?.email || null,
        };
      });
      if (!cancelled) {
        setRows(enriched);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const total = useMemo(() => rows.reduce((s, r) => s + r.amount, 0), [rows]);

  const exportCsv = () => {
    const header = ['Time', 'Customer ID', 'Customer', 'Service', 'Method', 'Amount (₹)', 'Collected by', 'Description'];
    const lines = [header.join(',')];
    for (const r of rows) {
      lines.push(
        [
          fmtTime(r.date),
          r.subscriber_public_id ?? '',
          r.subscriber_name ?? '',
          r.service_type ?? '',
          inferMethod(r),
          r.amount.toFixed(2),
          r.collected_by_name ?? '',
          r.description ?? '',
        ]
          .map(csvEscape)
          .join(','),
      );
    }
    lines.push('');
    lines.push(['', '', '', '', 'Total', total.toFixed(2), '', ''].map(csvEscape).join(','));
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `collections-${stamp}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <SectionCard
      title="Today's collections"
      description="Every payment recorded today. Use this to reconcile cash and UPI before closing out."
      className="mb-6"
      padded={false}
      actions={
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">
            Total: <Money value={total} className="font-semibold text-foreground" />
          </span>
          <Button size="sm" variant="outline" onClick={exportCsv} disabled={rows.length === 0}>
            <Download className="h-3.5 w-3.5 mr-1.5" /> Export
          </Button>
        </div>
      }
    >
      {loading ? (
        <div className="p-6 text-sm text-muted-foreground">Loading today’s receipts…</div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Wallet className="h-5 w-5" />}
          title="No collections yet today"
          description="Payments recorded today will appear here for reconciliation."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground border-b">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Time</th>
                <th className="text-left px-4 py-2 font-medium">Customer</th>
                <th className="text-left px-4 py-2 font-medium hidden sm:table-cell">Service</th>
                <th className="text-left px-4 py-2 font-medium hidden md:table-cell">Method</th>
                <th className="text-left px-4 py-2 font-medium hidden lg:table-cell">Collected by</th>
                <th className="text-right px-4 py-2 font-medium">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-2 tabular-nums whitespace-nowrap">{fmtTime(r.date)}</td>
                  <td className="px-4 py-2 min-w-0">
                    {r.subscriber_public_id ? (
                      <Link
                        to={`/customers/${r.subscriber_public_id}`}
                        className="font-medium hover:underline"
                      >
                        {r.subscriber_name ?? r.subscriber_public_id}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                    {r.subscriber_public_id && (
                      <div className="text-xs text-muted-foreground font-mono">{r.subscriber_public_id}</div>
                    )}
                  </td>
                  <td className="px-4 py-2 hidden sm:table-cell">
                    {r.service_type ? (
                      <Badge variant="outline" className="capitalize">
                        {r.service_type}
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2 hidden md:table-cell">
                    <Badge variant="outline">{inferMethod(r)}</Badge>
                  </td>
                  <td className="px-4 py-2 hidden lg:table-cell text-muted-foreground truncate max-w-[200px]">
                    {r.collected_by_name ?? '—'}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Money value={r.amount} className="font-semibold" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
};
