import {
  AreaChart, Area, BarChart, Bar, Line, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { AnalyticsCard, inr, tooltipStyle } from './AnalyticsPrimitives';

const kFmt = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : `${v}`);

/** Overview — how money came in over the period, and how old the dues are. */
export const OverviewTab = ({
  timeseries,
  aging,
  compare,
}: {
  timeseries: any[];
  aging: { name: string; value: number }[];
  compare: boolean;
}) => (
  <div className="grid gap-4 xl:grid-cols-2">
    <AnalyticsCard
      title="Revenue over time"
      description={`Payments collected${compare ? ', dashed line shows the previous period' : ''}`}
    >
      <ResponsiveContainer width="100%" height={300}>
        <AreaChart data={timeseries}>
          <defs>
            <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.4} />
              <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} tickFormatter={kFmt} />
          <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => inr(Number(v))} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Area type="monotone" dataKey="payments" stroke="hsl(var(--primary))" fill="url(#rev)" name="Payments" strokeWidth={2} />
          <Line type="monotone" dataKey="charges" stroke="hsl(var(--destructive))" name="Charges" strokeWidth={1.5} dot={false} />
          {compare && <Line type="monotone" dataKey="prev" stroke="hsl(var(--muted-foreground))" name="Previous period" strokeDasharray="4 4" strokeWidth={1.5} dot={false} />}
        </AreaChart>
      </ResponsiveContainer>
    </AnalyticsCard>

    <AnalyticsCard
      title="Outstanding by age"
      description="How long dues have been pending, based on the last payment"
    >
      {aging.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">No outstanding dues</p>
      ) : (
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={aging} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis type="number" tickFormatter={kFmt} tick={{ fontSize: 11 }} />
            <YAxis dataKey="name" type="category" width={100} tick={{ fontSize: 11 }} />
            <Tooltip formatter={(v: any) => inr(Number(v))} contentStyle={tooltipStyle} />
            <Bar dataKey="value" name="Outstanding" radius={[0, 4, 4, 0]}>
              {aging.map((_, i) => (
                <Cell key={i} fill={['hsl(142 71% 45%)', 'hsl(38 92% 50%)', 'hsl(20 90% 55%)', 'hsl(0 84% 60%)', 'hsl(280 70% 55%)'][i]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </AnalyticsCard>
  </div>
);
