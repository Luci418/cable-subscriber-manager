import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, ExternalLink } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';

/**
 * SubscriberComplaintsCard — self-contained loader for the complaints of a
 * single subscriber. Rendered inside the Overview tab so the operator sees
 * open tickets alongside billing state without having to switch pages.
 *
 * Kept self-fetching (no prop drilling through SubscriberDetail) because
 * complaints already live in `useComplaints` for the list page and adding
 * them to AppDataContext would refetch on every route change.
 */
interface Props {
  subscriberId: string;               // DB UUID
  subscriberIdText?: string | null;   // human-readable ID for deep links
}

interface Row {
  id: string;
  description: string;
  status: string;
  priority: string;
  created_at: string;
}

const STATUS_TONE: Record<string, string> = {
  pending: 'secondary',
  'in-progress': 'warning',
  resolved: 'success',
};

export function SubscriberComplaintsCard({ subscriberId, subscriberIdText }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    const { data, error } = await (supabase as any)
      .from('complaints')
      .select('id, description, status, priority, created_at')
      .eq('subscriber_id', subscriberId)
      .order('created_at', { ascending: false })
      .limit(5);
    if (error) setError(error.message || 'Failed to load complaints');
    else setRows((data as Row[]) || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [subscriberId]);

  const openCount = rows.filter((r) => r.status !== 'resolved').length;

  return (
    <Card>
      <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <AlertCircle className="h-4 w-4" />
          Complaints
          {openCount > 0 && (
            <Badge variant="warning" className="ml-1">{openCount} open</Badge>
          )}
        </CardTitle>
        <Button asChild variant="ghost" size="sm">
          <Link to={`/complaints?q=${encodeURIComponent(subscriberIdText || '')}`}>
            View all <ExternalLink className="h-3 w-3 ml-1" />
          </Link>
        </Button>
      </CardHeader>
      <CardContent className="pt-0">
        {loading ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : error ? (
          <div className="text-xs text-destructive flex items-center gap-2">
            <span>{error}</span>
            <Button size="sm" variant="outline" onClick={load}>Retry</Button>
          </div>
        ) : rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">No complaints on file.</p>
        ) : (
          <ul className="space-y-2">
            {rows.map((r) => (
              <li key={r.id} className="flex items-start justify-between gap-3 text-xs">
                <div className="min-w-0">
                  <p className="line-clamp-2">{r.description}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {new Date(r.created_at).toLocaleDateString('en-IN')}
                  </p>
                </div>
                <Badge variant={(STATUS_TONE[r.status] as any) || 'default'}>
                  {r.status}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
