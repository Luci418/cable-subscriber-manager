import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { AnalyticsCard, inr, tooltipStyle, useRowLimit } from './AnalyticsPrimitives';

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
      <AnalyticsCard
        title="Acquisition vs churn"
        description="New subscribers vs expired subscriptions per day"
      >
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={growthSeries}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip contentStyle={tooltipStyle} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="newC" fill="hsl(142 71% 45%)" name="New" />
            <Bar dataKey="churnC" fill="hsl(0 84% 60%)" name="Churned" />
          </BarChart>
        </ResponsiveContainer>
      </AnalyticsCard>

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
