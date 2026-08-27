import {
  AreaChart, Area, BarChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { cn } from '@/lib/utils';
import { ChartFrame, DeltaPill, chartTheme } from './AnalyticsPrimitives';

export interface HeroMetric {
  key: string;
  label: string;
  /** Headline total for the current period. */
  total: number;
  /** Same metric for the comparison period (enables the delta pill). */
  prevTotal?: number;
  /** How the headline and tooltip values are printed. */
  format: (n: number) => string;
  /** Short axis formatter; defaults to `format`. */
  axisFormat?: (n: number) => string;
  /** Bars suit counts, area suits money. */
  shape?: 'area' | 'bar';
}

/**
 * One full-width chart showing a single metric at a time, YouTube-Studio style:
 * big number, delta, plot, and a pill switcher for the other metrics.
 */
export const HeroChart = ({
  title,
  series,
  metrics,
  activeKey,
  onSelect,
  compare,
  prevLabel,
  compareKey = 'prev',
}: {
  title: string;
  series: any[];
  metrics: HeroMetric[];
  activeKey: string;
  onSelect: (key: string) => void;
  compare: boolean;
  prevLabel?: string;
  /** Series key holding the previous-period values (only used for money metrics). */
  compareKey?: string;
}) => {
  const metric = metrics.find((m) => m.key === activeKey) ?? metrics[0];
  const axisFmt = metric.axisFormat ?? metric.format;
  const showCompare = compare && metric.prevTotal !== undefined && metric.key === metrics[0].key;

  return (
    <ChartFrame
      title={title}
      headline={
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-3xl font-semibold tabular-nums leading-none">
            {metric.format(metric.total)}
          </span>
          {compare && metric.prevTotal !== undefined && (
            <>
              <DeltaPill
                delta={
                  metric.prevTotal === 0
                    ? metric.total === 0 ? 0 : 100
                    : ((metric.total - metric.prevTotal) / Math.abs(metric.prevTotal)) * 100
                }
              />
              {prevLabel && (
                <span className="text-xs text-muted-foreground">vs {prevLabel}</span>
              )}
            </>
          )}
        </div>
      }
      actions={
        <div className="flex flex-wrap gap-1">
          {metrics.map((m) => (
            <button
              key={m.key}
              onClick={() => onSelect(m.key)}
              className={cn(
                'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                m.key === activeKey
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent',
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
      }
    >
      <div className="h-[240px] sm:h-[340px]">
        <ResponsiveContainer width="100%" height="100%">
          {metric.shape === 'bar' ? (
            <BarChart data={series} margin={{ left: 4, right: 8, top: 8 }}>
              <CartesianGrid {...chartTheme.grid} />
              <XAxis dataKey="date" {...chartTheme.axis} minTickGap={24} />
              <YAxis {...chartTheme.axis} width={48} tickFormatter={axisFmt} allowDecimals={false} />
              <Tooltip
                contentStyle={chartTheme.tooltip}
                cursor={{ fill: 'hsl(var(--muted))', opacity: 0.5 }}
                formatter={(v: any) => [metric.format(Number(v)), metric.label]}
              />
              <Bar dataKey={metric.key} fill="hsl(var(--chart-1))" radius={[3, 3, 0, 0]} animationDuration={400} />
            </BarChart>
          ) : (
            <AreaChart data={series} margin={{ left: 4, right: 8, top: 8 }}>
              <defs>
                <linearGradient id="heroFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--chart-1))" stopOpacity={0.28} />
                  <stop offset="100%" stopColor="hsl(var(--chart-1))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid {...chartTheme.grid} />
              <XAxis dataKey="date" {...chartTheme.axis} minTickGap={24} />
              <YAxis {...chartTheme.axis} width={48} tickFormatter={axisFmt} />
              <Tooltip
                contentStyle={chartTheme.tooltip}
                cursor={chartTheme.cursor}
                formatter={(v: any, n: any) => [metric.format(Number(v)), n === 'prev' ? 'Previous period' : metric.label]}
              />
              {showCompare && (
                <Line
                  type="monotone" dataKey={compareKey} stroke="hsl(var(--muted-foreground))"
                  strokeDasharray="4 4" strokeWidth={1.5} dot={false} animationDuration={400}
                />
              )}
              <Area
                type="monotone" dataKey={metric.key} stroke="hsl(var(--chart-1))"
                strokeWidth={2} fill="url(#heroFill)" dot={false} animationDuration={400}
              />
            </AreaChart>
          )}
        </ResponsiveContainer>
      </div>
    </ChartFrame>
  );
};
