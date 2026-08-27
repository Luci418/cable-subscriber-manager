import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { AnalyticsCard, ChartFrame, chartTheme, inr, useRowLimit } from './AnalyticsPrimitives';

/** Customers — growth, best payers, biggest defaulters. */
export const CustomersTab = ({
  growthSeries,
  topSubscribers,
  topDefaulters,
}: {
  growthSeries: { date: string; newC: number; churnC: number }[];
  topSubscribers: { sub: any; revenue: number; txns: number }[];
  topDefaulters: { sub: any; balance: number }[];
}) => {
  const payers = useRowLimit(topSubscribers);
  const defaulters = useRowLimit(topDefaulters);

  return (
    <div className="space-y-4">
      <ChartFrame
        title="Acquisition vs churn"
        description="New subscribers vs expired subscriptions per day"
      >
        <div className="h-[240px] sm:h-[320px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={growthSeries} margin={{ left: 4, right: 8, top: 8 }}>
              <CartesianGrid {...chartTheme.grid} />
              <XAxis dataKey="date" {...chartTheme.axis} minTickGap={24} />
              <YAxis {...chartTheme.axis} width={36} allowDecimals={false} />
              <Tooltip contentStyle={chartTheme.tooltip} cursor={{ fill: 'hsl(var(--muted))', opacity: 0.5 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="newC" fill="hsl(var(--chart-1))" name="New" radius={[3, 3, 0, 0]} />
              <Bar dataKey="churnC" fill="hsl(var(--chart-4))" name="Churned" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </ChartFrame>


      <div className="grid gap-4 xl:grid-cols-2">
        <AnalyticsCard
          title="Top subscribers by revenue"
          description="Highest paying customers in this period"
          padded={false}
        >
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
              {payers.visible.map((r, i) => (
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
          {payers.footer}
        </AnalyticsCard>

        <AnalyticsCard
          title="Top defaulters"
          description="Largest outstanding balances right now"
          padded={false}
        >
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
              {defaulters.visible.map((r, i) => (
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
          {defaulters.footer}
        </AnalyticsCard>
      </div>
    </div>
  );
};
