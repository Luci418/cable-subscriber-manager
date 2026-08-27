import { useState } from 'react';
import { HeroChart, HeroMetric } from './HeroChart';
import { KpiRow, KpiValues } from './KpiRow';
import { RankedList } from './RankedList';
import { compactInr, inr } from './AnalyticsPrimitives';

/**
 * The landing surface: one full-width chart, the numbers underneath, and three
 * short lists that answer "who paid", "who owes", "how old is the money".
 */
export const OverviewTab = ({
  timeseries,
  aging,
  compare,
  prevLabel,
  kpi,
  topSubscribers,
  topDefaulters,
  onGoTo,
}: {
  timeseries: any[];
  aging: { name: string; value: number }[];
  compare: boolean;
  prevLabel: string;
  kpi: KpiValues & {
    chargesPrev: number;
    net: number;
    netPrev: number;
    newSubs: number;
    newSubsPrev: number;
  };
  topSubscribers: { sub: any; revenue: number; txns: number }[];
  topDefaulters: { sub: any; balance: number }[];
  onGoTo: (tab: string) => void;
}) => {
  const [metricKey, setMetricKey] = useState('payments');

  const metrics: HeroMetric[] = [
    { key: 'payments', label: 'Collected', total: kpi.revenue, prevTotal: kpi.revenuePrev, format: inr, axisFormat: compactInr },
    { key: 'charges', label: 'Charged', total: kpi.charges, prevTotal: kpi.chargesPrev, format: inr, axisFormat: compactInr },
    { key: 'net', label: 'Net', total: kpi.net, prevTotal: kpi.netPrev, format: inr, axisFormat: compactInr },
    { key: 'newC', label: 'New subscribers', total: kpi.newSubs, prevTotal: kpi.newSubsPrev, format: (n) => `${Math.round(n)}`, shape: 'bar' },
  ];

  const agingTotal = aging.reduce((s, a) => s + a.value, 0);

  return (
    <div className="space-y-5">
      <HeroChart
        title={metrics.find((m) => m.key === metricKey)?.label ?? 'Collected'}
        series={timeseries}
        metrics={metrics}
        activeKey={metricKey}
        onSelect={setMetricKey}
        compare={compare}
        prevLabel={prevLabel}
      />

      <KpiRow v={kpi} compare={compare} revenueSpark={timeseries.map((d) => d.payments)} />

      <div className="grid gap-4 lg:grid-cols-3">
        <RankedList
          title="Top by revenue"
          description="Who paid the most this period"
          items={topSubscribers.map((r) => ({
            id: r.sub.id,
            label: r.sub.name,
            sub: r.sub.subscriber_id,
            value: inr(r.revenue),
            raw: r.revenue,
            to: `/customers/${r.sub.subscriber_id}`,
          }))}
          empty="No payments in this period"
          onSeeAll={() => onGoTo('customers')}
        />
        <RankedList
          title="Needs attention"
          description="Largest outstanding balances"
          items={topDefaulters.map((r) => ({
            id: r.sub.id,
            label: r.sub.name,
            sub: r.sub.region || undefined,
            value: inr(r.balance),
            raw: r.balance,
            tone: 'danger' as const,
            to: `/customers/${r.sub.subscriber_id}`,
          }))}
          empty="No outstanding dues"
          onSeeAll={() => onGoTo('customers')}
        />
        <RankedList
          title="Where money sits"
          description={`${inr(agingTotal)} outstanding by age`}
          items={aging.map((a) => ({
            id: a.name,
            label: a.name,
            value: inr(a.value),
            raw: a.value,
          }))}
          empty="No outstanding dues"
          limit={5}
        />
      </div>
    </div>
  );
};
