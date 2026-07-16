import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  ArrowLeft, TrendingUp, TrendingDown, Users, IndianRupee, Wallet, UserPlus,
  UserMinus, Percent, Download, CalendarIcon, Tv, Wifi, Minus, Clock, ArrowRight,
} from 'lucide-react';
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { format, subDays, startOfDay, endOfDay, differenceInDays, eachDayOfInterval } from 'date-fns';
import { DateRange } from 'react-day-picker';
import { useAuth } from '@/hooks/useAuth';
import { useAppData } from '@/contexts/AppDataContext';
import { useEnabledServices } from '@/hooks/useEnabledServices';
import { useProviders } from '@/hooks/useProviders';
import { cn } from '@/lib/utils';

type ServiceFilter = 'all' | 'cable' | 'internet';
type PresetKey = '7d' | '30d' | '90d' | 'ytd' | 'all' | 'custom';

interface AnalyticsProps {
  onBack: () => void;
  onFilterPack?: (pack: string) => void;
  onFilterRegion?: (region: string) => void;
  onFilterBalance?: (status: string) => void;
}

// ---------- helpers ----------
const inr = (n: number) => `₹${Math.round(Math.abs(n)).toLocaleString('en-IN')}`;
const pct = (cur: number, prev: number) => {
  if (prev === 0) return cur === 0 ? 0 : 100;
  return ((cur - prev) / Math.abs(prev)) * 100;
};
const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const PRESETS: { key: PresetKey; label: string; days: number | 'ytd' | 'all' }[] = [
  { key: '7d', label: '7D', days: 7 },
  { key: '30d', label: '30D', days: 30 },
  { key: '90d', label: '90D', days: 90 },
  { key: 'ytd', label: 'YTD', days: 'ytd' },
  { key: 'all', label: 'All', days: 'all' },
];

const COLORS = [
  'hsl(217 91% 60%)', 'hsl(142 71% 45%)', 'hsl(38 92% 50%)', 'hsl(0 84% 60%)',
  'hsl(280 70% 55%)', 'hsl(190 85% 45%)', 'hsl(330 75% 55%)', 'hsl(20 90% 55%)',
];

export const Analytics = ({ onBack, onFilterPack, onFilterRegion, onFilterBalance }: AnalyticsProps) => {
  const { user } = useAuth();
  // Reuse the shared AppData context so we don't duplicate the subscribers
  // + transactions fetch that Home/Customers/Billing already perform.
  const { subscribers, loading: subsLoading, transactions } = useAppData();
  const txnLoading = false;
  const { cableEnabled, internetEnabled, bothEnabled } = useEnabledServices();
  const { providers } = useProviders(user?.id);

  const [service, setService] = useState<ServiceFilter>('all');
  const [preset, setPreset] = useState<PresetKey>('30d');
  const [customRange, setCustomRange] = useState<DateRange | undefined>();
  const [compare, setCompare] = useState(true);

  const loading = subsLoading || txnLoading;

  // ---------- date range resolution ----------
  const { range, prevRange, label } = useMemo(() => {
    const now = endOfDay(new Date());
    let from: Date;
    let to: Date = now;
    if (preset === 'custom' && customRange?.from) {
      from = startOfDay(customRange.from);
      to = endOfDay(customRange.to ?? customRange.from);
    } else if (preset === 'ytd') {
      from = startOfDay(new Date(now.getFullYear(), 0, 1));
    } else if (preset === 'all') {
      // span = earliest transaction or subscriber
      const earliestTxn = transactions.reduce<number>((min, t) => Math.min(min, +new Date(t.date)), Date.now());
      const earliestSub = subscribers.reduce<number>((min, s) => Math.min(min, +new Date(s.created_at)), Date.now());
      from = startOfDay(new Date(Math.min(earliestTxn, earliestSub)));
    } else {
      const days = (PRESETS.find(p => p.key === preset)?.days as number) ?? 30;
      from = startOfDay(subDays(now, days - 1));
    }
    const span = Math.max(1, differenceInDays(to, from) + 1);
    const prevTo = endOfDay(subDays(from, 1));
    const prevFrom = startOfDay(subDays(prevTo, span - 1));
    const lbl = `${format(from, 'd MMM yyyy')} – ${format(to, 'd MMM yyyy')}`;
    return { range: { from, to }, prevRange: { from: prevFrom, to: prevTo }, label: lbl };
  }, [preset, customRange, transactions, subscribers]);

  // ---------- filtered txns by service & range ----------
  const matchService = (svc: string | null | undefined) =>
    service === 'all' || (svc || 'cable') === service;

  const txnsAll = useMemo(() =>
    transactions.filter(t => matchService((t as any).service_type)),
    [transactions, service]
  );

  const txnsInRange = useMemo(() =>
    txnsAll.filter(t => {
      const d = +new Date(t.date);
      return d >= +range.from && d <= +range.to;
    }), [txnsAll, range]);

  const txnsPrev = useMemo(() =>
    txnsAll.filter(t => {
      const d = +new Date(t.date);
      return d >= +prevRange.from && d <= +prevRange.to;
    }), [txnsAll, prevRange]);

  // ---------- subscribers filtered by service ----------
  const subsScoped = useMemo(() => subscribers.filter(s => {
    if (service === 'all') return true;
    const svcs = (s as any).services?.length ? (s as any).services : ['cable'];
    return svcs.includes(service);
  }), [subscribers, service]);

  // ---------- KPI metrics ----------
  // Exclude voided originals and reversal counter-entries from every revenue /
  // charges aggregation. This mirrors the DB balance trigger
  // (recalc_subscriber_balance, which filters `status NOT IN ('voided','reversal')`).
  // Without this filter, a voided ₹1,000 payment + its ₹1,000 reversal row
  // double-counted as ₹2,200 in analytics (review doc Part 6).
  const isLive = (t: typeof transactions[number]) =>
    (t as any).status !== 'voided' && (t as any).status !== 'reversal';

  const sum = (arr: typeof transactions, type: 'payment' | 'charge') =>
    arr.filter(t => t.type === type && isLive(t)).reduce((s, t) => s + Number(t.amount || 0), 0);

  const revenue = sum(txnsInRange, 'payment');
  const revenuePrev = sum(txnsPrev, 'payment');
  const charges = sum(txnsInRange, 'charge');
  const chargesPrev = sum(txnsPrev, 'charge');

  const net = revenue - charges;
  const netPrev = revenuePrev - chargesPrev;
  const collectionEff = charges > 0 ? (revenue / charges) * 100 : revenue > 0 ? 100 : 0;
  const collectionEffPrev = chargesPrev > 0 ? (revenuePrev / chargesPrev) * 100 : revenuePrev > 0 ? 100 : 0;

  const outstanding = useMemo(() => subsScoped.reduce((s, sub) => {
    if (service === 'cable') return s + Number(sub.cable_balance || 0);
    if (service === 'internet') return s + Number((sub as any).internet_balance || 0);
    return s + Number(sub.cable_balance || 0) + Number((sub as any).internet_balance || 0);
  }, 0), [subsScoped, service]);

  const newSubs = subsScoped.filter(s => {
    const d = +new Date(s.created_at);
    return d >= +range.from && d <= +range.to;
  }).length;
  const newSubsPrev = subsScoped.filter(s => {
    const d = +new Date(s.created_at);
    return d >= +prevRange.from && d <= +prevRange.to;
  }).length;

  // Expired/churned: subscribers with expired subs in range.
  // Reads from the normalised timeline arrays (Phase 4b). The active arrays
  // exclude expired/cancelled subs, so we can derive history = timeline
  // entries with status !== 'active'.
  const churned = useMemo(() => {
    let count = 0;
    subsScoped.forEach(s => {
      const histories: any[] = [];
      if (service !== 'internet') histories.push(...((s as any)._timelineCable || []));
      if (service !== 'cable') histories.push(...((s as any)._timelineInternet || []));
      histories.forEach(h => {
        if (h?.status === 'expired' && h?.endDate) {
          const d = +new Date(h.endDate);
          if (d >= +range.from && d <= +range.to) count++;
        }
      });
    });
    return count;
  }, [subsScoped, service, range]);

  const activeSubs = subsScoped.filter(s => {
    const cableLen = ((s as any)._activeCable || []).length;
    const internetLen = ((s as any)._activeInternet || []).length;
    if (service === 'cable') return cableLen > 0;
    if (service === 'internet') return internetLen > 0;
    return cableLen > 0 || internetLen > 0;
  }).length;

  const arpu = activeSubs > 0 ? revenue / activeSubs : 0;
  const arpuPrev = (() => {
    // active count is point-in-time; use same denominator for stable comparison
    return activeSubs > 0 ? revenuePrev / activeSubs : 0;
  })();

  // Subscriptions expiring in the next 7 days (across scoped services).
  // Operators check this daily — it drives renewal nudges.
  const expiring7d = useMemo(() => {
    const now = Date.now();
    const cutoff = now + 7 * 86400000;
    let count = 0;
    subsScoped.forEach((s) => {
      const actives: any[] = [];
      if (service !== 'internet') actives.push(...((s as any)._activeCable || []));
      if (service !== 'cable') actives.push(...((s as any)._activeInternet || []));
      actives.forEach((a) => {
        if (!a?.endDate) return;
        const t = +new Date(a.endDate);
        if (t >= now && t <= cutoff) count++;
      });
    });
    return count;
  }, [subsScoped, service]);

  // ---------- time series ----------
  const timeseries = useMemo(() => {
    const days = eachDayOfInterval({ start: range.from, end: range.to });
    const map = new Map<string, { payments: number; charges: number; prev: number }>();
    days.forEach(d => map.set(isoDay(d), { payments: 0, charges: 0, prev: 0 }));

    txnsInRange.forEach(t => {
      if (!isLive(t)) return;
      const k = isoDay(new Date(t.date));
      const e = map.get(k);
      if (!e) return;
      if (t.type === 'payment') e.payments += Number(t.amount || 0);
      else if (t.type === 'charge') e.charges += Number(t.amount || 0);
    });

    if (compare) {
      const span = days.length;
      txnsPrev.forEach(t => {
        const d = new Date(t.date);
        if (t.type !== 'payment' || !isLive(t)) return;
        const offset = differenceInDays(d, prevRange.from);
        if (offset < 0 || offset >= span) return;
        const k = isoDay(days[offset]);
        const e = map.get(k);
        if (e) e.prev += Number(t.amount || 0);
      });
    }


    return days.map(d => {
      const k = isoDay(d);
      const e = map.get(k)!;
      return {
        date: format(d, days.length > 60 ? 'd MMM' : 'd MMM'),
        payments: e.payments,
        charges: e.charges,
        net: e.payments - e.charges,
        prev: e.prev,
      };
    });
  }, [range, txnsInRange, txnsPrev, prevRange, compare]);

  // ---------- service split timeseries (only when service==='all') ----------
  const serviceSplit = useMemo(() => {
    const days = eachDayOfInterval({ start: range.from, end: range.to });
    const map = new Map<string, { cable: number; internet: number }>();
    days.forEach(d => map.set(isoDay(d), { cable: 0, internet: 0 }));
    txnsInRange.forEach(t => {
      if (t.type !== 'payment' || !isLive(t)) return;
      const k = isoDay(new Date(t.date));
      const e = map.get(k);
      if (!e) return;
      const svc = (t as any).service_type || 'cable';
      if (svc === 'internet') e.internet += Number(t.amount || 0);
      else e.cable += Number(t.amount || 0);
    });

    return days.map(d => ({ date: format(d, 'd MMM'), ...map.get(isoDay(d))! }));
  }, [range, txnsInRange]);

  // ---------- top tables ----------
  const subsById = useMemo(() => {
    const m = new Map<string, typeof subscribers[number]>();
    subscribers.forEach(s => m.set(s.id, s));
    return m;
  }, [subscribers]);

  const topSubscribers = useMemo(() => {
    const agg = new Map<string, { revenue: number; txns: number }>();
    txnsInRange.filter(t => t.type === 'payment' && isLive(t)).forEach(t => {

      const cur = agg.get(t.subscriber_id) || { revenue: 0, txns: 0 };
      cur.revenue += Number(t.amount || 0);
      cur.txns += 1;
      agg.set(t.subscriber_id, cur);
    });
    return Array.from(agg.entries())
      .map(([id, v]) => ({ sub: subsById.get(id), ...v }))
      .filter(r => r.sub)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);
  }, [txnsInRange, subsById]);

  const topDefaulters = useMemo(() => {
    return subsScoped
      .map(s => {
        const bal = service === 'cable' ? Number(s.cable_balance || 0)
          : service === 'internet' ? Number((s as any).internet_balance || 0)
          : Number(s.cable_balance || 0) + Number((s as any).internet_balance || 0);
        return { sub: s, balance: bal };
      })
      .filter(r => r.balance > 0)
      .sort((a, b) => b.balance - a.balance)
      .slice(0, 10);
  }, [subsScoped, service]);

  // ---------- pack performance ----------
  // Batch B: source pack names from active-subscription arrays instead of the
  // retired current_pack / current_internet_pack cached labels. Multi-device
  // subscribers correctly contribute one count per active pack.
  const packPerf = useMemo(() => {
    const map = new Map<string, { subs: number; revenue: number }>();
    const bump = (k: string, dSubs: number, dRev: number) => {
      const cur = map.get(k) || { subs: 0, revenue: 0 };
      cur.subs += dSubs; cur.revenue += dRev;
      map.set(k, cur);
    };
    subsScoped.forEach(s => {
      if (service === 'all' || service === 'cable') {
        ((s as any)._activeCable || []).forEach((sub: any) => {
          if (sub?.packName) bump(`${sub.packName} · Cable`, 1, 0);
        });
      }
      if (service === 'all' || service === 'internet') {
        ((s as any)._activeInternet || []).forEach((sub: any) => {
          if (sub?.packName) bump(`${sub.packName} · Internet`, 1, 0);
        });
      }
    });
    // Approximate revenue per pack by attributing payments to the subscriber's
    // primary active pack on the same service.
    txnsInRange.filter(t => t.type === 'payment' && isLive(t)).forEach(t => {
      const s = subsById.get(t.subscriber_id);
      if (!s) return;
      const svc = (t as any).service_type || 'cable';
      const actives: any[] = svc === 'internet' ? ((s as any)._activeInternet || []) : ((s as any)._activeCable || []);
      const packName = actives[0]?.packName;
      if (!packName) return;
      bump(`${packName} · ${svc === 'internet' ? 'Internet' : 'Cable'}`, 0, Number(t.amount || 0));
    });
    return Array.from(map.entries())
      .map(([name, v]) => ({ name, ...v, arpu: v.subs ? v.revenue / v.subs : 0 }))
      .sort((a, b) => b.revenue - a.revenue);
  }, [subsScoped, txnsInRange, subsById, service]);

  // ---------- region performance ----------
  const regionPerf = useMemo(() => {
    const map = new Map<string, { subs: number; revenue: number; outstanding: number }>();
    subsScoped.forEach(s => {
      const k = s.region || 'Unassigned';
      const cur = map.get(k) || { subs: 0, revenue: 0, outstanding: 0 };
      cur.subs += 1;
      const bal = service === 'cable' ? Number(s.cable_balance || 0)
        : service === 'internet' ? Number((s as any).internet_balance || 0)
        : Number(s.cable_balance || 0) + Number((s as any).internet_balance || 0);
      if (bal > 0) cur.outstanding += bal;
      map.set(k, cur);
    });
    txnsInRange.filter(t => t.type === 'payment' && isLive(t)).forEach(t => {

      const s = subsById.get(t.subscriber_id);
      if (!s) return;
      const k = s.region || 'Unassigned';
      const cur = map.get(k) || { subs: 0, revenue: 0, outstanding: 0 };
      cur.revenue += Number(t.amount || 0);
      map.set(k, cur);
    });
    return Array.from(map.entries())
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.revenue - a.revenue);
  }, [subsScoped, txnsInRange, subsById, service]);

  // ---------- provider performance ----------
  const providerPerf = useMemo(() => {
    const providerById = new Map(providers.map(p => [p.id, p]));
    const map = new Map<string, { name: string; service: string; subs: number; revenue: number; outstanding: number }>();

    const ensure = (id: string | null | undefined, fallbackSvc: string) => {
      const pid = id || `__none_${fallbackSvc}`;
      const prov = id ? providerById.get(id) : undefined;
      const name = prov?.name || 'Unassigned';
      const svc = prov?.service_type || fallbackSvc;
      const key = `${pid}::${svc}`;
      if (!map.has(key)) map.set(key, { name, service: svc, subs: 0, revenue: 0, outstanding: 0 });
      return map.get(key)!;
    };

    subsScoped.forEach(s => {
      const svcs = (s as any).services?.length ? (s as any).services : ['cable'];
      if ((service === 'all' || service === 'cable') && svcs.includes('cable')) {
        const e = ensure((s as any).cable_provider_id, 'cable');
        e.subs += 1;
        const bal = Number((s as any).cable_balance || 0);
        if (bal > 0) e.outstanding += bal;
      }
      if ((service === 'all' || service === 'internet') && svcs.includes('internet')) {
        const e = ensure((s as any).internet_provider_id, 'internet');
        e.subs += 1;
        const bal = Number((s as any).internet_balance || 0);
        if (bal > 0) e.outstanding += bal;
      }
    });

    txnsInRange.filter(t => t.type === 'payment' && isLive(t)).forEach(t => {
      const svc = (t as any).service_type || 'cable';
      const e = ensure((t as any).provider_id, svc);
      e.revenue += Number(t.amount || 0);
    });

    return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue);
  }, [providers, subsScoped, txnsInRange, service]);


  // ---------- aging buckets ----------
  const aging = useMemo(() => {
    const lastPay = new Map<string, number>();
    transactions.filter(t => t.type === 'payment' && isLive(t)).forEach(t => {
      const cur = lastPay.get(t.subscriber_id) || 0;
      const d = +new Date(t.date);
      if (d > cur) lastPay.set(t.subscriber_id, d);
    });
    const buckets = [
      { name: '0-30 days', value: 0, range: [0, 30] },
      { name: '31-60 days', value: 0, range: [31, 60] },
      { name: '61-90 days', value: 0, range: [61, 90] },
      { name: '90+ days', value: 0, range: [91, Infinity] },
      { name: 'Never paid', value: 0, range: [-1, -1] },
    ];
    const now = Date.now();
    subsScoped.forEach(s => {
      const bal = service === 'cable' ? Number(s.cable_balance || 0)
        : service === 'internet' ? Number((s as any).internet_balance || 0)
        : Number(s.cable_balance || 0) + Number((s as any).internet_balance || 0);
      if (bal <= 0) return;
      const lp = lastPay.get(s.id);
      if (!lp) { buckets[4].value += bal; return; }
      const days = Math.floor((now - lp) / 86400000);
      for (const b of buckets) {
        const [lo, hi] = b.range;
        if (lo < 0) continue;
        if (days >= lo && days <= hi) { b.value += bal; break; }
      }
    });
    return buckets.filter(b => b.value > 0);
  }, [subsScoped, transactions, service]);

  // ---------- distributions ----------
  const packDist = useMemo(() => packPerf.map(p => ({ name: p.name, value: p.subs })), [packPerf]);
  const regionDist = useMemo(() => regionPerf.map(r => ({ name: r.name, value: r.subs })), [regionPerf]);
  const balanceDist = useMemo(() => {
    let debt = 0, credit = 0, zero = 0;
    subsScoped.forEach(s => {
      const lines: number[] = [];
      const svcs = (s as any).services?.length ? (s as any).services : ['cable'];
      if ((service === 'all' || service === 'cable') && svcs.includes('cable')) lines.push(Number(s.cable_balance || 0));
      if ((service === 'all' || service === 'internet') && svcs.includes('internet')) lines.push(Number((s as any).internet_balance || 0));
      lines.forEach(b => { if (b > 0) debt++; else if (b < 0) credit++; else zero++; });
    });
    return [
      { name: 'Debt (Due)', value: debt },
      { name: 'Credit (Advance)', value: credit },
      { name: 'Zero Balance', value: zero },
    ].filter(x => x.value > 0);
  }, [subsScoped, service]);

  // ---------- CSV export ----------
  const exportCsv = () => {
    const rows: string[] = [];
    rows.push(`Analytics export,${label},Service: ${service}`);
    rows.push('');
    rows.push('Metric,Current,Previous,Change %');
    const r = (n: string, c: number, p: number) => rows.push(`${n},${c.toFixed(2)},${p.toFixed(2)},${pct(c, p).toFixed(1)}`);
    r('Revenue', revenue, revenuePrev);
    r('Charges', charges, chargesPrev);
    r('Net', net, netPrev);
    r('Collection Efficiency %', collectionEff, collectionEffPrev);
    r('New Subscribers', newSubs, newSubsPrev);
    rows.push('');
    rows.push('Top Subscribers by Revenue');
    rows.push('Name,Subscriber ID,Revenue,Transactions');
    topSubscribers.forEach(t => rows.push(`"${t.sub!.name}",${t.sub!.subscriber_id},${t.revenue},${t.txns}`));
    rows.push('');
    rows.push('Top Defaulters');
    rows.push('Name,Subscriber ID,Outstanding');
    topDefaulters.forEach(t => rows.push(`"${t.sub.name}",${t.sub.subscriber_id},${t.balance}`));
    rows.push('');
    rows.push('Pack Performance');
    rows.push('Pack,Subscribers,Revenue,ARPU');
    packPerf.forEach(p => rows.push(`"${p.name}",${p.subs},${p.revenue.toFixed(2)},${p.arpu.toFixed(2)}`));
    rows.push('');
    rows.push('Region Performance');
    rows.push('Region,Subscribers,Revenue,Outstanding');
    regionPerf.forEach(p => rows.push(`"${p.name}",${p.subs},${p.revenue.toFixed(2)},${p.outstanding.toFixed(2)}`));
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `analytics-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-muted-foreground">Loading analytics...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div>
            <Button variant="ghost" onClick={onBack} className="mb-2 -ml-3">
              <ArrowLeft className="mr-2 h-4 w-4" />Back
            </Button>
            <h1 className="text-2xl sm:text-3xl font-bold text-foreground">Analytics</h1>
            <p className="text-sm text-muted-foreground">{label}{compare && ' · vs previous period'}</p>
          </div>
          <Button variant="outline" size="sm" onClick={exportCsv}>
            <Download className="mr-2 h-4 w-4" />Export CSV
          </Button>
        </div>

        {/* Filter bar */}
        <Card className="border-dashed">
          <CardContent className="p-3 sm:p-4">
            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
              {bothEnabled && (
                <Tabs value={service} onValueChange={(v) => setService(v as ServiceFilter)}>
                  <TabsList className="h-9">
                    <TabsTrigger value="all" className="text-xs">All Services</TabsTrigger>
                    {cableEnabled && <TabsTrigger value="cable" className="text-xs"><Tv className="h-3 w-3 mr-1" />Cable</TabsTrigger>}
                    {internetEnabled && <TabsTrigger value="internet" className="text-xs"><Wifi className="h-3 w-3 mr-1" />Internet</TabsTrigger>}
                  </TabsList>
                </Tabs>
              )}

              <div className="flex flex-wrap gap-1 ml-auto">
                {PRESETS.map(p => (
                  <Button key={p.key} size="sm" variant={preset === p.key ? 'default' : 'outline'}
                    onClick={() => { setPreset(p.key); setCustomRange(undefined); }}>
                    {p.label}
                  </Button>
                ))}
                <Popover>
                  <PopoverTrigger asChild>
                    <Button size="sm" variant={preset === 'custom' ? 'default' : 'outline'}>
                      <CalendarIcon className="h-4 w-4 mr-1" />
                      {preset === 'custom' && customRange?.from
                        ? `${format(customRange.from, 'd MMM')}${customRange.to ? ` – ${format(customRange.to, 'd MMM')}` : ''}`
                        : 'Custom'}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="end">
                    <Calendar mode="range" selected={customRange}
                      onSelect={(r) => { setCustomRange(r); if (r?.from) setPreset('custom'); }}
                      numberOfMonths={2} />
                  </PopoverContent>
                </Popover>
                <Button size="sm" variant={compare ? 'default' : 'outline'} onClick={() => setCompare(c => !c)}>
                  Compare
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Operational KPI scorecards — 6 metrics operators act on daily. Clickable → filtered destinations. */}
      <div className="grid gap-3 sm:gap-4 grid-cols-2 lg:grid-cols-3">
        <KpiCard label="Active Subscribers" value={activeSubs.toLocaleString('en-IN')} delta={0}
          icon={<Users className="h-4 w-4" />} compare={false} sub={`${subsScoped.length} total`}
          to="/customers?status=active" />
        <KpiCard label="Collected vs Charged" value={`${inr(revenue)} / ${inr(charges)}`} delta={pct(revenue, revenuePrev)}
          icon={<IndianRupee className="h-4 w-4" />} compare={compare} prevLabel={inr(revenuePrev)}
          to="/billing" />
        <KpiCard label="Collection Rate" value={`${collectionEff.toFixed(0)}%`}
          delta={pct(collectionEff, collectionEffPrev)} icon={<Percent className="h-4 w-4" />}
          compare={compare} prevLabel={`${collectionEffPrev.toFixed(0)}%`}
          to="/billing" />
        <KpiCard label="Expiring in 7 days" value={expiring7d.toLocaleString('en-IN')} delta={0}
          icon={<Clock className="h-4 w-4" />} compare={false}
          sub="Renewals to nudge"
          tone={expiring7d > 0 ? 'danger' : undefined}
          to="/billing?status=expiring" />
        <KpiCard label="Outstanding Balance" value={inr(outstanding)} delta={0}
          icon={<Wallet className="h-4 w-4" />} compare={false}
          sub={outstanding > 0 ? 'Due from subscribers' : 'Credit with subscribers'}
          tone={outstanding > 0 ? 'danger' : 'success'}
          to="/customers?balance=dues" />
        <KpiCard label="ARPU" value={inr(arpu)} delta={pct(arpu, arpuPrev)}
          icon={<IndianRupee className="h-4 w-4" />} compare={compare} prevLabel={inr(arpuPrev)}
          sub="Avg revenue per active sub" />
      </div>

      {/* Main charts */}
      <Tabs defaultValue="revenue" className="space-y-4">
        <TabsList className="flex flex-wrap h-auto">
          <TabsTrigger value="revenue">Revenue</TabsTrigger>
          <TabsTrigger value="services">Services Split</TabsTrigger>
          <TabsTrigger value="growth">Subscribers</TabsTrigger>
          <TabsTrigger value="aging">Outstanding Aging</TabsTrigger>
          <TabsTrigger value="distribution">Distribution</TabsTrigger>
        </TabsList>

        <TabsContent value="revenue">
          <Card>
            <CardHeader>
              <CardTitle>Revenue Over Time</CardTitle>
              <CardDescription>
                Payments collected{compare && ', dashed line shows previous period for comparison'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={360}>
                <AreaChart data={timeseries}>
                  <defs>
                    <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : v} />
                  <Tooltip
                    contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 8 }}
                    formatter={(v: any) => inr(Number(v))} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Area type="monotone" dataKey="payments" stroke="hsl(var(--primary))" fill="url(#rev)" name="Payments" strokeWidth={2} />
                  <Line type="monotone" dataKey="charges" stroke="hsl(var(--destructive))" name="Charges" strokeWidth={1.5} dot={false} />
                  {compare && <Line type="monotone" dataKey="prev" stroke="hsl(var(--muted-foreground))" name="Previous period" strokeDasharray="4 4" strokeWidth={1.5} dot={false} />}
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="services">
          <Card>
            <CardHeader>
              <CardTitle>Cable vs Internet Revenue</CardTitle>
              <CardDescription>Daily payment split across services</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={360}>
                <BarChart data={serviceSplit}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : v} />
                  <Tooltip formatter={(v: any) => inr(Number(v))}
                    contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 8 }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="cable" stackId="s" fill="hsl(217 91% 60%)" name="Cable" />
                  <Bar dataKey="internet" stackId="s" fill="hsl(142 71% 45%)" name="Internet" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="growth">
          <Card>
            <CardHeader>
              <CardTitle>Acquisition vs Churn</CardTitle>
              <CardDescription>New subscribers vs expired subscriptions per day</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={360}>
                <BarChart data={(() => {
                  const days = eachDayOfInterval({ start: range.from, end: range.to });
                  const map = new Map<string, { newC: number; churnC: number }>();
                  days.forEach(d => map.set(isoDay(d), { newC: 0, churnC: 0 }));
                  subsScoped.forEach(s => {
                    const k = isoDay(new Date(s.created_at));
                    if (map.has(k)) map.get(k)!.newC += 1;
                  });
                  subsScoped.forEach(s => {
                    const hs: any[] = [];
                    if (service !== 'internet') hs.push(...((s as any)._timelineCable || []));
                    if (service !== 'cable') hs.push(...((s as any)._timelineInternet || []));
                    hs.forEach(h => {
                      if (h?.status === 'expired' && h?.endDate) {
                        const k = isoDay(new Date(h.endDate));
                        if (map.has(k)) map.get(k)!.churnC += 1;
                      }
                    });
                  });
                  return days.map(d => ({ date: format(d, 'd MMM'), ...map.get(isoDay(d))! }));
                })()}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 8 }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="newC" fill="hsl(142 71% 45%)" name="New" />
                  <Bar dataKey="churnC" fill="hsl(0 84% 60%)" name="Churned" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="aging">
          <Card>
            <CardHeader>
              <CardTitle>Outstanding by Age</CardTitle>
              <CardDescription>How long dues have been pending (based on last payment)</CardDescription>
            </CardHeader>
            <CardContent>
              {aging.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">No outstanding dues 🎉</p>
              ) : (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={aging} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis type="number" tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : v} tick={{ fontSize: 11 }} />
                    <YAxis dataKey="name" type="category" width={100} tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(v: any) => inr(Number(v))}
                      contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 8 }} />
                    <Bar dataKey="value" name="Outstanding" radius={[0, 4, 4, 0]}>
                      {aging.map((_, i) => (
                        <Cell key={i} fill={['hsl(142 71% 45%)','hsl(38 92% 50%)','hsl(20 90% 55%)','hsl(0 84% 60%)','hsl(280 70% 55%)'][i]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="distribution">
          <div className="grid gap-4 md:grid-cols-2">
            <DistroPie title="Pack Distribution" data={packDist} onClick={(n) => onFilterPack?.(n.split(' · ')[0])} onBack={onBack} />
            <DistroPie title="Region Distribution" data={regionDist} onClick={(n) => n !== 'Unassigned' && onFilterRegion?.(n)} onBack={onBack} />
            <DistroPie title="Balance Status" data={balanceDist} onClick={(n) => {
              const map: Record<string, string> = { 'Debt (Due)': 'positive', 'Credit (Advance)': 'negative', 'Zero Balance': 'zero' };
              if (map[n]) onFilterBalance?.(map[n]);
            }} onBack={onBack} labelValue />
          </div>
        </TabsContent>
      </Tabs>

      {/* Top tables */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Top Subscribers by Revenue</CardTitle>
            <CardDescription>Highest paying customers in this period</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Subscriber</TableHead>
                  <TableHead className="text-right">Txns</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topSubscribers.length === 0 && (
                  <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-6">No payments in this period</TableCell></TableRow>
                )}
                {topSubscribers.map((r, i) => (
                  <TableRow key={r.sub!.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="w-6 justify-center text-xs">{i + 1}</Badge>
                        <div>
                          <div className="font-medium text-sm">{r.sub!.name}</div>
                          <div className="text-xs text-muted-foreground">{r.sub!.subscriber_id}</div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-right text-sm">{r.txns}</TableCell>
                    <TableCell className="text-right font-medium">{inr(r.revenue)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Top Defaulters</CardTitle>
            <CardDescription>Largest outstanding balances right now</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Subscriber</TableHead>
                  <TableHead>Region</TableHead>
                  <TableHead className="text-right">Outstanding</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topDefaulters.length === 0 && (
                  <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-6">No outstanding dues</TableCell></TableRow>
                )}
                {topDefaulters.map((r, i) => (
                  <TableRow key={r.sub.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="w-6 justify-center text-xs">{i + 1}</Badge>
                        <div>
                          <div className="font-medium text-sm">{r.sub.name}</div>
                          <div className="text-xs text-muted-foreground">{r.sub.subscriber_id}</div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{r.sub.region || '—'}</TableCell>
                    <TableCell className="text-right font-medium text-destructive">{inr(r.balance)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Pack Performance</CardTitle>
            <CardDescription>Subscribers, revenue and ARPU per pack</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pack</TableHead>
                  <TableHead className="text-right">Subscribers</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                  <TableHead className="text-right">ARPU</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {packPerf.length === 0 && (
                  <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">No packs assigned</TableCell></TableRow>
                )}
                {packPerf.map(p => (
                  <TableRow key={p.name}>
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell className="text-right">{p.subs}</TableCell>
                    <TableCell className="text-right">{inr(p.revenue)}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{inr(p.arpu)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Region Performance</CardTitle>
            <CardDescription>Revenue and outstanding by region</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Region</TableHead>
                  <TableHead className="text-right">Subscribers</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                  <TableHead className="text-right">Outstanding</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {regionPerf.map(r => (
                  <TableRow key={r.name}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell className="text-right">{r.subs}</TableCell>
                    <TableCell className="text-right">{inr(r.revenue)}</TableCell>
                    <TableCell className={cn('text-right', r.outstanding > 0 && 'text-destructive')}>{inr(r.outstanding)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Provider Performance</CardTitle>
            <CardDescription>Revenue, active subscribers and outstanding by upstream provider</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Provider</TableHead>
                  <TableHead>Service</TableHead>
                  <TableHead className="text-right">Subscribers</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                  <TableHead className="text-right">Outstanding</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {providerPerf.length === 0 && (
                  <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">No provider data yet</TableCell></TableRow>
                )}
                {providerPerf.map(p => (
                  <TableRow key={`${p.name}-${p.service}`}>
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell className="capitalize">
                      <span className="inline-flex items-center gap-1">
                        {p.service === 'internet' ? <Wifi className="h-3.5 w-3.5" /> : <Tv className="h-3.5 w-3.5" />}
                        {p.service}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">{p.subs}</TableCell>
                    <TableCell className="text-right">{inr(p.revenue)}</TableCell>
                    <TableCell className={cn('text-right', p.outstanding > 0 && 'text-destructive')}>{inr(p.outstanding)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

    </div>
  );
};

// ============ subcomponents ============

interface KpiCardProps {
  label: string;
  value: string;
  delta: number;
  icon: React.ReactNode;
  compare: boolean;
  prevLabel?: string;
  sub?: string;
  tone?: 'success' | 'danger';
  negativeAware?: boolean;
  value_?: number;
  /** When provided, the card becomes a clickable link to a filtered view. */
  to?: string;
}
const KpiCard = ({ label, value, delta, icon, compare, prevLabel, sub, tone, negativeAware, value_, to }: KpiCardProps) => {
  const up = delta > 0.5;
  const down = delta < -0.5;
  const flat = !up && !down;
  const valColor = tone === 'danger' ? 'text-destructive'
    : tone === 'success' ? 'text-success'
    : negativeAware && (value_ ?? 0) < 0 ? 'text-destructive'
    : 'text-foreground';
  const inner = (
    <Card className={cn(to && 'transition-shadow hover:shadow-md cursor-pointer h-full')}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-xs sm:text-sm font-medium text-muted-foreground">{label}</CardTitle>
        <div className="text-muted-foreground flex items-center gap-1">
          {icon}
          {to && <ArrowRight className="h-3 w-3 opacity-40" />}
        </div>
      </CardHeader>
      <CardContent>
        <div className={cn('text-xl sm:text-2xl font-bold', valColor)}>{value}</div>
        {compare ? (
          <div className="flex items-center gap-1.5 mt-1 text-xs">
            <span className={cn('inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded font-medium',
              up && 'bg-success/10 text-success',
              down && 'bg-destructive/10 text-destructive',
              flat && 'bg-muted text-muted-foreground'
            )}>
              {up && <TrendingUp className="h-3 w-3" />}
              {down && <TrendingDown className="h-3 w-3" />}
              {flat && <Minus className="h-3 w-3" />}
              {Math.abs(delta).toFixed(1)}%
            </span>
            {prevLabel && <span className="text-muted-foreground">vs {prevLabel}</span>}
          </div>
        ) : sub ? (
          <p className="text-xs text-muted-foreground mt-1">{sub}</p>
        ) : null}
      </CardContent>
    </Card>
  );
  return to ? <Link to={to} className="block">{inner}</Link> : inner;
};

interface DistroPieProps {
  title: string;
  data: { name: string; value: number }[];
  onClick: (name: string) => void;
  onBack: () => void;
  labelValue?: boolean;
}
const DistroPie = ({ title, data, onClick, onBack, labelValue }: DistroPieProps) => (
  <Card>
    <CardHeader>
      <CardTitle>{title}</CardTitle>
    </CardHeader>
    <CardContent>
      {data.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">No data</p>
      ) : (
        <ResponsiveContainer width="100%" height={280}>
          <PieChart>
            <Pie data={data} cx="50%" cy="50%" outerRadius={80} dataKey="value"
              label={({ name, value, percent }) => labelValue ? `${name}: ${value}` : `${name}: ${(percent * 100).toFixed(0)}%`}
              labelLine={false}
              onClick={(d: any) => { onClick(d.name); onBack(); }}
              cursor="pointer">
              {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
            </Pie>
            <Tooltip contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 8 }} />
          </PieChart>
        </ResponsiveContainer>
      )}
    </CardContent>
  </Card>
);
