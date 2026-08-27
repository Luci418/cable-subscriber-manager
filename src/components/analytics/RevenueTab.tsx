import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tv, Wifi } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AnalyticsCard, DistroPie, inr, tooltipStyle, useRowLimit } from './AnalyticsPrimitives';

const kFmt = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : `${v}`);

/** Revenue — service split, distribution mix and margin. */
export const RevenueTab = ({
  serviceSplit,
  bothEnabled,
  packDist,
  regionDist,
  balanceDist,
  marginTotals,
  marginPerProvider,
  marginPerPack,
  onFilterPack,
  onFilterRegion,
  onFilterBalance,
  onBack,
}: {
  serviceSplit: any[];
  bothEnabled: boolean;
  packDist: { name: string; value: number }[];
  regionDist: { name: string; value: number }[];
  balanceDist: { name: string; value: number }[];
  marginTotals: { gross: number; cost: number; net: number; packsMissingCost: number };
  marginPerProvider: any[];
  marginPerPack: any[];
  onFilterPack?: (v: string) => void;
  onFilterRegion?: (v: string) => void;
  onFilterBalance?: (v: string) => void;
  onBack: () => void;
}) => {
  const providers = useRowLimit(marginPerProvider);
  const packs = useRowLimit(marginPerPack);

  return (
    <div className="space-y-4">
      {bothEnabled && (
        <AnalyticsCard title="Cable vs Internet revenue" description="Daily payment split across services">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={serviceSplit}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={kFmt} />
              <Tooltip formatter={(v: any) => inr(Number(v))} contentStyle={tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="cable" stackId="s" fill="hsl(217 91% 60%)" name="Cable" />
              <Bar dataKey="internet" stackId="s" fill="hsl(142 71% 45%)" name="Internet" />
            </BarChart>
          </ResponsiveContainer>
        </AnalyticsCard>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <DistroPie title="Pack distribution" data={packDist} onBack={onBack}
          onClick={(n) => onFilterPack?.(n.split(' · ')[0])} />
        <DistroPie title="Region distribution" data={regionDist} onBack={onBack}
          onClick={(n) => n !== 'Unassigned' && onFilterRegion?.(n)} />
        <DistroPie title="Balance status" data={balanceDist} onBack={onBack} labelValue
          onClick={(n) => {
            const map: Record<string, string> = {
              'Debt (Due)': 'positive', 'Credit (Advance)': 'negative', 'Zero Balance': 'zero',
            };
            if (map[n]) onFilterBalance?.(map[n]);
          }} />
      </div>

      <AnalyticsCard
        title="Margin"
        description={
          <>
            Gross revenue minus upstream provider cost (each pack's <em>Provider cost</em> × active subscribers).
            {marginTotals.packsMissingCost > 0 && (
              <> {marginTotals.packsMissingCost} pack{marginTotals.packsMissingCost === 1 ? '' : 's'} with active subs have no cost set — excluded from totals.</>
            )}
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-md border p-3">
            <div className="text-xs text-muted-foreground">Gross revenue</div>
            <div className="text-xl font-bold mt-1">{inr(marginTotals.gross)}</div>
          </div>
          <div className="rounded-md border p-3">
            <div className="text-xs text-muted-foreground">Provider cost</div>
            <div className="text-xl font-bold mt-1 text-destructive">{inr(marginTotals.cost)}</div>
          </div>
          <div className="rounded-md border p-3">
            <div className="text-xs text-muted-foreground">Net margin</div>
            <div className={cn('text-xl font-bold mt-1', marginTotals.net >= 0 ? 'text-success' : 'text-destructive')}>
              {inr(marginTotals.net)}
              {marginTotals.gross > 0 && (
                <span className="text-xs font-normal text-muted-foreground ml-2">
                  ({((marginTotals.net / marginTotals.gross) * 100).toFixed(1)}%)
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="mt-6">
          <h3 className="text-sm font-semibold mb-2">Margin per provider</h3>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Provider</TableHead>
                  <TableHead className="text-right">Subscribers</TableHead>
                  <TableHead className="text-right">Gross</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead className="text-right">Net</TableHead>
                  <TableHead className="text-right">Margin %</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {marginPerProvider.length === 0 && (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">No data</TableCell></TableRow>
                )}
                {providers.visible.map((p, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium">{p.providerName}</TableCell>
                    <TableCell className="text-right">{p.subs}</TableCell>
                    <TableCell className="text-right">{inr(p.gross)}</TableCell>
                    <TableCell className="text-right">
                      {p.hasCost ? inr(p.cost) : <span className="text-xs text-muted-foreground italic">cost not set</span>}
                    </TableCell>
                    <TableCell className={cn('text-right', p.net != null && (p.net >= 0 ? 'text-success' : 'text-destructive'))}>
                      {p.net != null ? inr(p.net) : '—'}
                    </TableCell>
                    <TableCell className={cn('text-right', p.marginPct != null && (p.marginPct >= 0 ? 'text-success' : 'text-destructive'))}>
                      {p.marginPct != null ? `${p.marginPct.toFixed(1)}%` : '—'}
                      {!p.hasCost && p.missingCostPacks > 0 && (
                        <div className="text-[10px] text-muted-foreground">{p.missingCostPacks} pack{p.missingCostPacks === 1 ? '' : 's'} missing cost</div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {providers.footer}
          </div>
        </div>

        <div className="mt-6">
          <h3 className="text-sm font-semibold mb-2">Margin per pack</h3>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pack</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead className="text-right">Subs</TableHead>
                  <TableHead className="text-right">Gross</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead className="text-right">Net</TableHead>
                  <TableHead className="text-right">Margin %</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {marginPerPack.length === 0 && (
                  <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">No active packs</TableCell></TableRow>
                )}
                {packs.visible.map((r) => (
                  <TableRow key={r.key}>
                    <TableCell className="font-medium">
                      {r.packName}
                      <span className="ml-2 inline-flex items-center gap-1 text-xs text-muted-foreground capitalize">
                        {r.service === 'internet' ? <Wifi className="h-3 w-3" /> : <Tv className="h-3 w-3" />}
                        {r.service}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{r.providerName}</TableCell>
                    <TableCell className="text-right">{r.subs}</TableCell>
                    <TableCell className="text-right">{inr(r.gross)}</TableCell>
                    <TableCell className="text-right">
                      {r.cost != null ? inr(r.cost) : <span className="text-xs text-muted-foreground italic">cost not set</span>}
                    </TableCell>
                    <TableCell className={cn('text-right', r.net != null && (r.net >= 0 ? 'text-success' : 'text-destructive'))}>
                      {r.net != null ? inr(r.net) : '—'}
                    </TableCell>
                    <TableCell className={cn('text-right', r.marginPct != null && (r.marginPct >= 0 ? 'text-success' : 'text-destructive'))}>
                      {r.marginPct != null ? `${r.marginPct.toFixed(1)}%` : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {packs.footer}
          </div>
        </div>
      </AnalyticsCard>
    </div>
  );
};
