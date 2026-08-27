import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { TrendingUp, TrendingDown, Minus, ArrowRight } from 'lucide-react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { cn } from '@/lib/utils';

/** Shared formatters + palette for every analytics surface. */
export const inr = (n: number) => `₹${Math.round(Math.abs(n)).toLocaleString('en-IN')}`;
export const pct = (cur: number, prev: number) => {
  if (prev === 0) return cur === 0 ? 0 : 100;
  return ((cur - prev) / Math.abs(prev)) * 100;
};
export const COLORS = [
  'hsl(217 91% 60%)', 'hsl(142 71% 45%)', 'hsl(38 92% 50%)', 'hsl(0 84% 60%)',
  'hsl(280 70% 55%)', 'hsl(190 85% 45%)', 'hsl(330 75% 55%)', 'hsl(20 90% 55%)',
];

/** Card shell used by every chart / table block so headers stay consistent. */
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
  <Card className={className}>
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
          {expanded ? 'Show top 10' : `Show all ${rows.length}`}
        </Button>
      </div>
    ) : null;
  return { visible, footer };
}

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

export const KpiCard = ({
  label, value, delta, icon, compare, prevLabel, sub, tone, negativeAware, value_, to,
}: KpiCardProps) => {
  const up = delta > 0.5;
  const down = delta < -0.5;
  const flat = !up && !down;
  const valColor = tone === 'danger' ? 'text-destructive'
    : tone === 'success' ? 'text-success'
    : negativeAware && (value_ ?? 0) < 0 ? 'text-destructive'
    : 'text-foreground';
  const inner = (
    <div
      className={cn(
        'h-full px-3 py-2.5 text-left',
        to && 'transition-colors hover:bg-accent/40 cursor-pointer',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground truncate">{label}</span>
        <span className="text-muted-foreground flex items-center gap-1 shrink-0">
          {icon}
          {to && <ArrowRight className="h-3 w-3 opacity-40" />}
        </span>
      </div>
      <div className={cn('text-lg sm:text-xl font-semibold leading-tight mt-0.5 tabular-nums', valColor)}>
        {value}
      </div>
      {compare ? (
        <div className="flex items-center gap-1.5 mt-1 text-[11px]">
          <span className={cn('inline-flex items-center gap-0.5 px-1 py-0.5 rounded font-medium',
            up && 'bg-success/10 text-success',
            down && 'bg-destructive/10 text-destructive',
            flat && 'bg-muted text-muted-foreground',
          )}>
            {up && <TrendingUp className="h-3 w-3" />}
            {down && <TrendingDown className="h-3 w-3" />}
            {flat && <Minus className="h-3 w-3" />}
            {Math.abs(delta).toFixed(1)}%
          </span>
          {prevLabel && <span className="text-muted-foreground truncate">vs {prevLabel}</span>}
        </div>
      ) : sub ? (
        <p className="text-[11px] text-muted-foreground mt-1 truncate">{sub}</p>
      ) : null}
    </div>
  );
  return to ? <Link to={to} className="block h-full">{inner}</Link> : inner;
};

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
          <Tooltip contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 8 }} />
        </PieChart>
      </ResponsiveContainer>
    )}
  </AnalyticsCard>
);

/** Shared Recharts tooltip styling. */
export const tooltipStyle = {
  background: 'hsl(var(--popover))',
  border: '1px solid hsl(var(--border))',
  borderRadius: 8,
} as const;
