import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tv, Wifi } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AnalyticsCard, ShareBar, inr, useRowLimit } from './AnalyticsPrimitives';

/** Catalog — how packs, regions and upstream providers are performing. */
export const CatalogTab = ({
  packPerf,
  regionPerf,
  providerPerf,
}: {
  packPerf: { name: string; subs: number; revenue: number; arpu: number }[];
  regionPerf: { name: string; subs: number; revenue: number; outstanding: number }[];
  providerPerf: { name: string; service: string; subs: number; revenue: number; outstanding: number }[];
}) => {
  const packs = useRowLimit(packPerf);
  const regions = useRowLimit(regionPerf);
  const providers = useRowLimit(providerPerf);

  // Share bars read off the largest revenue in each table, so a row's width
  // says "how much of the total this is" at a glance.
  const maxPack = Math.max(1, ...packPerf.map((p) => p.revenue));
  const maxRegion = Math.max(1, ...regionPerf.map((r) => r.revenue));
  const maxProvider = Math.max(1, ...providerPerf.map((p) => p.revenue));

  return (
    <div className="space-y-4">
      <AnalyticsCard title="Pack performance" description="Subscribers, revenue and ARPU per pack" padded={false}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Pack</TableHead>
              <TableHead className="text-right">Subscribers</TableHead>
              <TableHead className="text-right">Revenue</TableHead>
              <TableHead className="text-right">ARPU</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {packPerf.length === 0 && (
              <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">No packs assigned</TableCell></TableRow>
            )}
            {packs.visible.map((p) => (
              <TableRow key={p.name}>
                <TableCell className="font-medium">
                  {p.name}
                  <div className="mt-1.5 max-w-[220px]"><ShareBar value={p.revenue} max={maxPack} /></div>
                </TableCell>
                <TableCell className="text-right">{p.subs}</TableCell>
                <TableCell className="text-right">{inr(p.revenue)}</TableCell>
                <TableCell className="text-right text-muted-foreground">{inr(p.arpu)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {packs.footer}
      </AnalyticsCard>

      <AnalyticsCard title="Region performance" description="Revenue and outstanding by region" padded={false}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Region</TableHead>
              <TableHead className="text-right">Subscribers</TableHead>
              <TableHead className="text-right">Revenue</TableHead>
              <TableHead className="text-right">Outstanding</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {regionPerf.length === 0 && (
              <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">No regions yet</TableCell></TableRow>
            )}
            {regions.visible.map((r) => (
              <TableRow key={r.name}>
                <TableCell className="font-medium">
                  {r.name}
                  <div className="mt-1.5 max-w-[220px]"><ShareBar value={r.revenue} max={maxRegion} /></div>
                </TableCell>
                <TableCell className="text-right">{r.subs}</TableCell>
                <TableCell className="text-right">{inr(r.revenue)}</TableCell>
                <TableCell className={cn('text-right', r.outstanding > 0 && 'text-destructive')}>{inr(r.outstanding)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {regions.footer}
      </AnalyticsCard>

      <AnalyticsCard
        title="Provider performance"
        description="Revenue, active subscribers and outstanding by upstream provider"
        padded={false}
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Provider</TableHead>
              <TableHead>Service</TableHead>
              <TableHead className="text-right">Subscribers</TableHead>
              <TableHead className="text-right">Revenue</TableHead>
              <TableHead className="text-right">Outstanding</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {providerPerf.length === 0 && (
              <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">No provider data yet</TableCell></TableRow>
            )}
            {providers.visible.map((p) => (
              <TableRow key={`${p.name}-${p.service}`}>
                <TableCell className="font-medium">
                  {p.name}
                  <div className="mt-1.5 max-w-[220px]"><ShareBar value={p.revenue} max={maxProvider} /></div>
                </TableCell>
                <TableCell className="capitalize">
                  <span className="inline-flex items-center gap-1">
                    {p.service === 'internet' ? <Wifi className="h-3.5 w-3.5" /> : <Tv className="h-3.5 w-3.5" />}
                    {p.service}
                  </span>
                </TableCell>
                <TableCell className="text-right">{p.subs}</TableCell>
                <TableCell className="text-right">{inr(p.revenue)}</TableCell>
                <TableCell className={cn('text-right', p.outstanding > 0 && 'text-destructive')}>{inr(p.outstanding)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {providers.footer}
      </AnalyticsCard>
    </div>
  );
};
