import { useMemo, useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Download } from 'lucide-react';
import { format, subDays, startOfDay, endOfDay, differenceInDays, eachDayOfInterval } from 'date-fns';
import { DateRange } from 'react-day-picker';
import { useAuth } from '@/hooks/useAuth';
import { useAppData } from '@/contexts/AppDataContext';
import { useEnabledServices } from '@/hooks/useEnabledServices';
import { useProviders } from '@/hooks/useProviders';
import { usePacks } from '@/hooks/usePacks';
import { AnalyticsFilterBar } from '@/components/analytics/AnalyticsFilterBar';
import { KpiStrip } from '@/components/analytics/KpiStrip';
import { OverviewTab } from '@/components/analytics/OverviewTab';
import { RevenueTab } from '@/components/analytics/RevenueTab';
import { CustomersTab } from '@/components/analytics/CustomersTab';
import { CatalogTab } from '@/components/analytics/CatalogTab';

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
  const { packs } = usePacks(user?.id);

  const [service, setService] = useState<ServiceFilter>('all');
  const [preset, setPreset] = useState<PresetKey>('30d');
  const [customRange, setCustomRange] = useState<DateRange | undefined>();
  const [compare, setCompare] = useState(true);
  const [tab, setTab] = useState('overview');

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

  // ---------- acquisition vs churn per day ----------
  // "New" = subscriber created that day. "Churned" = a subscription ended that
  // day and was not renewed (the subscriber is no longer active).
  const growthSeries = useMemo(() => {
    const days = eachDayOfInterval({ start: range.from, end: range.to });
    const map = new Map<string, { newC: number; churnC: number }>();
    days.forEach(d => map.set(isoDay(d), { newC: 0, churnC: 0 }));

    subsScoped.forEach(s => {
      const created = map.get(isoDay(new Date((s as any).created_at)));
      if (created) created.newC += 1;
      const end = (s as any).subscription_end;
      if (end) {
        const endDate = new Date(end);
        if (+endDate <= Date.now()) {
          const e = map.get(isoDay(endDate));
          if (e) e.churnC += 1;
        }
      }
    });

    return days.map(d => ({ date: format(d, 'd MMM'), ...map.get(isoDay(d))! }));
  }, [range, subsScoped]);



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

  // ---------- margin analysis (per pack / per provider) ----------
  // Uses each pack's `provider_cost` × current active-subscription count.
  // Packs without provider_cost set are excluded from cost totals and flagged
  // in the table as 'cost not set'.
  const marginPerPack = useMemo(() => {
    const packByKey = new Map<string, any>();
    (packs as any[]).forEach(p => {
      const svc = p.service_type || 'cable';
      if (service !== 'all' && svc !== service) return;
      packByKey.set(`${p.name}::${svc}`, p);
    });

    // count active subs per pack (from timeline arrays)
    const subCount = new Map<string, number>();
    subsScoped.forEach(s => {
      if (service === 'all' || service === 'cable') {
        ((s as any)._activeCable || []).forEach((a: any) => {
          if (!a?.packName) return;
          const k = `${a.packName}::cable`;
          subCount.set(k, (subCount.get(k) || 0) + 1);
        });
      }
      if (service === 'all' || service === 'internet') {
        ((s as any)._activeInternet || []).forEach((a: any) => {
          if (!a?.packName) return;
          const k = `${a.packName}::internet`;
          subCount.set(k, (subCount.get(k) || 0) + 1);
        });
      }
    });

    // attribute revenue from packPerf (already keyed as `${name} · ${Service}`)
    const revByKey = new Map<string, number>();
    packPerf.forEach(p => {
      // p.name = `${packName} · Cable|Internet`
      const idx = p.name.lastIndexOf(' · ');
      if (idx < 0) return;
      const packName = p.name.slice(0, idx);
      const svc = p.name.slice(idx + 3).toLowerCase();
      revByKey.set(`${packName}::${svc}`, p.revenue);
    });

    const rows: Array<{
      key: string;
      packName: string;
      service: string;
      providerId: string | null;
      providerName: string;
      subs: number;
      gross: number;
      unitCost: number | null;
      cost: number | null;
      net: number | null;
      marginPct: number | null;
    }> = [];

    const providerById = new Map(providers.map(p => [p.id, p]));

    // Include every active pack that has subscribers OR revenue OR is defined
    const allKeys = new Set<string>([...packByKey.keys(), ...subCount.keys(), ...revByKey.keys()]);
    allKeys.forEach(k => {
      const [packName, svc] = k.split('::');
      const p = packByKey.get(k);
      const subs = subCount.get(k) || 0;
      const gross = revByKey.get(k) || 0;
      if (subs === 0 && gross === 0) return;
      const unitCost = p?.provider_cost != null ? Number(p.provider_cost) : null;
      const cost = unitCost != null ? unitCost * subs : null;
      const net = cost != null ? gross - cost : null;
      const marginPct = cost != null && gross > 0 ? (net! / gross) * 100 : null;
      const providerId = p?.provider_id || null;
      rows.push({
        key: k,
        packName,
        service: svc,
        providerId,
        providerName: providerId ? (providerById.get(providerId)?.name || 'Unknown') : 'Unassigned',
        subs,
        gross,
        unitCost,
        cost,
        net,
        marginPct,
      });
    });
    return rows.sort((a, b) => b.gross - a.gross);
  }, [packs, subsScoped, packPerf, providers, service]);

  const marginPerProvider = useMemo(() => {
    const map = new Map<string, {
      providerName: string;
      subs: number;
      gross: number;
      cost: number;
      hasCost: boolean;
      missingCostPacks: number;
    }>();
    marginPerPack.forEach(r => {
      const key = `${r.providerName}::${r.service}`;
      const cur = map.get(key) || { providerName: `${r.providerName} · ${r.service === 'internet' ? 'Internet' : 'Cable'}`, subs: 0, gross: 0, cost: 0, hasCost: false, missingCostPacks: 0 };
      cur.subs += r.subs;
      cur.gross += r.gross;
      if (r.cost != null) { cur.cost += r.cost; cur.hasCost = true; }
      else { cur.missingCostPacks += 1; }
      map.set(key, cur);
    });
    return Array.from(map.values()).map(v => {
      const net = v.hasCost ? v.gross - v.cost : null;
      const marginPct = net != null && v.gross > 0 ? (net / v.gross) * 100 : null;
      return { ...v, net, marginPct };
    }).sort((a, b) => b.gross - a.gross);
  }, [marginPerPack]);

  const marginTotals = useMemo(() => {
    const gross = marginPerPack.reduce((s, r) => s + r.gross, 0);
    const cost = marginPerPack.reduce((s, r) => s + (r.cost || 0), 0);
    const packsMissingCost = marginPerPack.filter(r => r.cost == null && r.subs > 0).length;
    return { gross, cost, net: gross - cost, packsMissingCost };
  }, [marginPerPack]);




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
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div>
          <Button variant="ghost" onClick={onBack} className="mb-1 -ml-3">
            <ArrowLeft className="mr-2 h-4 w-4" />Back
          </Button>
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground">Analytics</h1>
          <p className="text-sm text-muted-foreground">{label}{compare && ' · vs previous period'}</p>
        </div>
        <Button variant="outline" size="sm" onClick={exportCsv}>
          <Download className="mr-2 h-4 w-4" />Export CSV
        </Button>
      </div>

      <AnalyticsFilterBar
        service={service}
        onServiceChange={setService}
        bothEnabled={bothEnabled}
        cableEnabled={cableEnabled}
        internetEnabled={internetEnabled}
        preset={preset}
        onPresetChange={setPreset}
        customRange={customRange}
        onCustomRangeChange={setCustomRange}
        compare={compare}
        onCompareToggle={() => setCompare(c => !c)}
      />

      <KpiStrip
        compare={compare}
        v={{
          activeSubs,
          totalSubs: subsScoped.length,
          revenue,
          revenuePrev,
          charges,
          collectionEff,
          collectionEffPrev,
          expiring7d,
          outstanding,
          arpu,
          arpuPrev,
        }}
      />

      {/* Four working surfaces — only the active one renders, so charts and
          tables outside the current tab cost nothing. */}
      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        <TabsList className="flex flex-wrap h-auto">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="revenue">Revenue</TabsTrigger>
          <TabsTrigger value="customers">Customers</TabsTrigger>
          <TabsTrigger value="catalog">Catalog</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-0">
          <OverviewTab timeseries={timeseries} aging={aging} compare={compare} />
        </TabsContent>

        <TabsContent value="revenue" className="mt-0">
          <RevenueTab
            serviceSplit={serviceSplit}
            bothEnabled={bothEnabled}
            packDist={packDist}
            regionDist={regionDist}
            balanceDist={balanceDist}
            marginTotals={marginTotals}
            marginPerProvider={marginPerProvider}
            marginPerPack={marginPerPack}
            onFilterPack={onFilterPack}
            onFilterRegion={onFilterRegion}
            onFilterBalance={onFilterBalance}
            onBack={onBack}
          />
        </TabsContent>

        <TabsContent value="customers" className="mt-0">
          <CustomersTab
            growthSeries={growthSeries}
            topSubscribers={topSubscribers as any}
            topDefaulters={topDefaulters as any}
          />
        </TabsContent>

        <TabsContent value="catalog" className="mt-0">
          <CatalogTab
            packPerf={packPerf}
            regionPerf={regionPerf}
            providerPerf={providerPerf as any}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
};
