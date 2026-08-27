import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Shared formatters + palette for every analytics surface. */
export const inr = (n: number) => `₹${Math.round(Math.abs(n)).toLocaleString('en-IN')}`;
export const compactInr = (n: number) => {
  const a = Math.abs(n);
  if (a >= 10000000) return `₹${(n / 10000000).toFixed(1)}Cr`;
  if (a >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
  if (a >= 1000) return `₹${(n / 1000).toFixed(1)}k`;
  return `₹${Math.round(n)}`;
};
export const pct = (cur: number, prev: number) => {
  if (prev === 0) return cur === 0 ? 0 : 100;
  return ((cur - prev) / Math.abs(prev)) * 100;
};

/** Category ramp — themed, four steps. Deltas use success/destructive instead. */
export const COLORS = [
  'hsl(var(--chart-1))',
  'hsl(var(--chart-2))',
  'hsl(var(--chart-3))',
  'hsl(var(--chart-4))',
];

/** One place for axis / grid / tooltip styling so every chart matches. */
export const chartTheme = {
  grid: {
    stroke: 'hsl(var(--chart-grid))',
    strokeDasharray: '0',
    vertical: false,
  },
  axis: {
    tick: { fontSize: 11, fill: 'hsl(var(--muted-foreground))' },
    axisLine: false as const,
    tickLine: false as const,
  },
  tooltip: {
    background: 'hsl(var(--popover))',
    border: '1px solid hsl(var(--border))',
    borderRadius: 8,
    fontSize: 12,
    boxShadow: 'var(--shadow-md)',
  },
  cursor: { stroke: 'hsl(var(--muted-foreground))', strokeWidth: 1, strokeDasharray: '3 3' },
};

/** Back-compat alias used by a few charts. */
export const tooltipStyle = chartTheme.tooltip;

/** Small ▲/▼ pill used under headline numbers. */
export const DeltaPill = ({ delta, suffix }: { delta: number; suffix?: string }) => {
  const up = delta > 0.5;
  const down = delta < -0.5;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[11px] font-medium tabular-nums',
        up && 'bg-success/10 text-success',
        down && 'bg-destructive/10 text-destructive',
        !up && !down && 'bg-muted text-muted-foreground',
      )}
    >
      {up && <TrendingUp className="h-3 w-3" />}
      {down && <TrendingDown className="h-3 w-3" />}
      {!up && !down && <Minus className="h-3 w-3" />}
      {Math.abs(delta).toFixed(1)}%{suffix}
    </span>
  );
};

/**
 * Borderless chart wrapper — a title row, an optional headline, and the plot
 * sitting directly on the page. Used for every full-width chart.
 */
export const ChartFrame = ({
  title,
  description,
  headline,
  actions,
  className,
  children,
}: {
  title: string;
  description?: React.ReactNode;
  headline?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) => (
  <section className={cn('animate-fade-in', className)}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-sm font-medium text-muted-foreground">{title}</h2>
        {headline && <div className="mt-0.5">{headline}</div>}
        {description && <p className="text-xs text-muted-foreground mt-1">{description}</p>}
      </div>
      {actions}
    </div>
    <div className="mt-3">{children}</div>
  </section>
);

/** Card shell kept for table blocks so headers stay consistent. */
export const AnalyticsCard = ({
  title,
  description,
  className,
  padded = true,
  children,
}: {
  title: string;
  description?: React.ReactNode;
  className?: string;
  padded?: boolean;
  children: React.ReactNode;
}) => (
  <Card className={cn('animate-fade-in', className)}>
    <CardHeader className="pb-3">
      <CardTitle className="text-base">{title}</CardTitle>
      {description && <CardDescription>{description}</CardDescription>}
    </CardHeader>
    <CardContent className={padded ? undefined : 'p-0'}>{children}</CardContent>
  </Card>
);

/**
 * Keeps long tables short by default.
 *
 * Returns the visible slice plus a footer button. CSV export still writes the
 * full dataset — this only limits what's on screen.
 */
export function useRowLimit<T>(rows: T[], limit = 10) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? rows : rows.slice(0, limit);
  const footer =
    rows.length > limit ? (
      <div className="border-t p-2 text-center">
        <Button variant="ghost" size="sm" onClick={() => setExpanded((e) => !e)}>
          {expanded ? `Show top ${limit}` : `Show all ${rows.length}`}
        </Button>
      </div>
    ) : null;
  return { visible, footer };
}

/** Horizontal share-of-total bar rendered inside a table row. */
export const ShareBar = ({ value, max }: { value: number; max: number }) => (
  <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
    <div
      className="h-full rounded-full bg-primary/70 transition-all duration-500"
      style={{ width: `${max > 0 ? Math.max(2, (value / max) * 100) : 0}%` }}
    />
  </div>
);

interface DistroPieProps {
  title: string;
  data: { name: string; value: number }[];
  onClick: (name: string) => void;
  onBack: () => void;
  labelValue?: boolean;
}

export const DistroPie = ({ title, data, onClick, onBack, labelValue }: DistroPieProps) => (
  <AnalyticsCard title={title}>
    {data.length === 0 ? (
      <p className="text-sm text-muted-foreground py-8 text-center">No data</p>
    ) : (
      <ResponsiveContainer width="100%" height={260}>
        <PieChart>
          <Pie
            data={data} cx="50%" cy="50%" outerRadius={78} dataKey="value"
            label={({ name, value, percent }) =>
              labelValue ? `${name}: ${value}` : `${name}: ${(percent * 100).toFixed(0)}%`}
            labelLine={false}
            onClick={(d: any) => { onClick(d.name); onBack(); }}
            cursor="pointer"
          >
            {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
          </Pie>
          <Tooltip contentStyle={chartTheme.tooltip} />
        </PieChart>
      </ResponsiveContainer>
    )}
  </AnalyticsCard>
);
