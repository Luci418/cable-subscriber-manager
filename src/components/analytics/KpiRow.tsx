import { Link } from 'react-router-dom';
import { LineChart, Line, ResponsiveContainer } from 'recharts';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DeltaPill, inr, pct } from './AnalyticsPrimitives';

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
  netMargin: number;
  marginKnown: boolean;
};

interface CellProps {
  label: string;
  value: string;
  sub?: string;
  delta?: number;
  compare: boolean;
  to?: string;
  spark?: number[];
  tone?: 'danger' | 'success';
}

const Cell = ({ label, value, sub, delta, compare, to, spark, tone }: CellProps) => {
  const body = (
    <div className={cn('h-full px-3 py-2.5', to && 'transition-colors hover:bg-accent/40')}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground truncate">{label}</span>
        {to && <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground/40" />}
      </div>
      <div
        className={cn(
          'mt-0.5 text-lg sm:text-xl font-semibold leading-tight tabular-nums',
          tone === 'danger' && 'text-destructive',
          tone === 'success' && 'text-success',
        )}
      >
        {value}
      </div>
      <div className="mt-1 flex items-center gap-2">
        {compare && delta !== undefined ? <DeltaPill delta={delta} /> : null}
        {sub && <span className="text-[11px] text-muted-foreground truncate">{sub}</span>}
      </div>
      {spark && spark.length > 1 && (
        <div className="mt-1 h-6">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={spark.map((v, i) => ({ i, v }))}>
              <Line
                type="monotone" dataKey="v" stroke="hsl(var(--chart-1))"
                strokeWidth={1.5} dot={false} isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
  return to ? <Link to={to} className="block h-full">{body}</Link> : body;
};

/**
 * Secondary numbers, sitting under the hero chart. Every metric the operator
 * acts on daily is here — the chart above answers "how is it trending".
 */
export const KpiRow = ({
  v,
  compare,
  revenueSpark,
}: {
  v: KpiValues;
  compare: boolean;
  revenueSpark?: number[];
}) => (
  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 divide-x divide-y sm:divide-y-0 divide-border rounded-lg border border-border bg-card overflow-hidden">
    <Cell
      label="Collected" value={inr(v.revenue)} compare={compare}
      delta={pct(v.revenue, v.revenuePrev)} sub={`of ${inr(v.charges)} charged`}
      spark={revenueSpark} to="/billing"
    />
    <Cell
      label="Collection rate" value={`${v.collectionEff.toFixed(0)}%`} compare={compare}
      delta={pct(v.collectionEff, v.collectionEffPrev)} to="/billing"
    />
    <Cell
      label="Outstanding" value={inr(v.outstanding)} compare={false}
      sub={v.outstanding > 0 ? 'due from subscribers' : 'credit held'}
      tone={v.outstanding > 0 ? 'danger' : 'success'} to="/customers?balance=dues"
    />
    <Cell
      label="Active subscribers" value={v.activeSubs.toLocaleString('en-IN')} compare={false}
      sub={`${v.totalSubs} total`} to="/customers?status=active"
    />
    <Cell
      label="ARPU" value={inr(v.arpu)} compare={compare}
      delta={pct(v.arpu, v.arpuPrev)} sub="per active subscriber"
    />
    <Cell
      label="Net margin" value={v.marginKnown ? inr(v.netMargin) : '—'} compare={false}
      sub={v.marginKnown ? 'after provider cost' : 'set pack costs'}
      tone={v.marginKnown ? (v.netMargin >= 0 ? 'success' : 'danger') : undefined}
    />
  </div>
);
