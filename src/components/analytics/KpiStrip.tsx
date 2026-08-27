import { Users, IndianRupee, Percent, Clock, Wallet } from 'lucide-react';
import { KpiCard, inr, pct } from './AnalyticsPrimitives';

export type KpiValues = {
  activeSubs: number;
  totalSubs: number;
  revenue: number;
  revenuePrev: number;
  charges: number;
  collectionEff: number;
  collectionEffPrev: number;
  expiring7d: number;
  outstanding: number;
  arpu: number;
  arpuPrev: number;
};

/**
 * The six numbers an operator acts on daily, rendered as one compact strip
 * instead of six full cards. Each cell links to the filtered destination.
 */
export const KpiStrip = ({ v, compare }: { v: KpiValues; compare: boolean }) => (
  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 divide-y sm:divide-y-0 divide-x-0 sm:divide-x divide-border rounded-lg border border-border bg-card overflow-hidden">
    <KpiCard
      label="Active Subscribers" value={v.activeSubs.toLocaleString('en-IN')} delta={0}
      icon={<Users className="h-3.5 w-3.5" />} compare={false} sub={`${v.totalSubs} total`}
      to="/customers?status=active"
    />
    <KpiCard
      label="Collected / Charged" value={`${inr(v.revenue)} / ${inr(v.charges)}`}
      delta={pct(v.revenue, v.revenuePrev)} icon={<IndianRupee className="h-3.5 w-3.5" />}
      compare={compare} prevLabel={inr(v.revenuePrev)} to="/billing"
    />
    <KpiCard
      label="Collection Rate" value={`${v.collectionEff.toFixed(0)}%`}
      delta={pct(v.collectionEff, v.collectionEffPrev)} icon={<Percent className="h-3.5 w-3.5" />}
      compare={compare} prevLabel={`${v.collectionEffPrev.toFixed(0)}%`} to="/billing"
    />
    <KpiCard
      label="Expiring in 7 days" value={v.expiring7d.toLocaleString('en-IN')} delta={0}
      icon={<Clock className="h-3.5 w-3.5" />} compare={false} sub="Renewals to nudge"
      tone={v.expiring7d > 0 ? 'danger' : undefined} to="/billing?status=expiring"
    />
    <KpiCard
      label="Outstanding" value={inr(v.outstanding)} delta={0}
      icon={<Wallet className="h-3.5 w-3.5" />} compare={false}
      sub={v.outstanding > 0 ? 'Due from subscribers' : 'Credit with subscribers'}
      tone={v.outstanding > 0 ? 'danger' : 'success'} to="/customers?balance=dues"
    />
    <KpiCard
      label="ARPU" value={inr(v.arpu)} delta={pct(v.arpu, v.arpuPrev)}
      icon={<IndianRupee className="h-3.5 w-3.5" />} compare={compare} prevLabel={inr(v.arpuPrev)}
      sub="Avg revenue per active sub"
    />
  </div>
);
