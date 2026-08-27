import { format } from 'date-fns';
import { DateRange } from 'react-day-picker';
import { CalendarIcon, Tv, Wifi } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';

export type ServiceFilter = 'all' | 'cable' | 'internet';
export type PresetKey = '7d' | '30d' | '90d' | 'ytd' | 'all' | 'custom';

export const PRESETS: { key: PresetKey; label: string; days: number | 'ytd' | 'all' }[] = [
  { key: '7d', label: '7D', days: 7 },
  { key: '30d', label: '30D', days: 30 },
  { key: '90d', label: '90D', days: 90 },
  { key: 'ytd', label: 'YTD', days: 'ytd' },
  { key: 'all', label: 'All', days: 'all' },
];

export const AnalyticsFilterBar = ({
  service, onServiceChange, bothEnabled, cableEnabled, internetEnabled,
  preset, onPresetChange, customRange, onCustomRangeChange, compare, onCompareToggle,
}: {
  service: ServiceFilter;
  onServiceChange: (v: ServiceFilter) => void;
  bothEnabled: boolean;
  cableEnabled: boolean;
  internetEnabled: boolean;
  preset: PresetKey;
  onPresetChange: (p: PresetKey) => void;
  customRange: DateRange | undefined;
  onCustomRangeChange: (r: DateRange | undefined) => void;
  compare: boolean;
  onCompareToggle: () => void;
}) => (
  <Card className="border-dashed">
    <CardContent className="p-3">
      <div className="flex flex-wrap items-center gap-2">
        {bothEnabled && (
          <Tabs value={service} onValueChange={(v) => onServiceChange(v as ServiceFilter)}>
            <TabsList className="h-9">
              <TabsTrigger value="all" className="text-xs">All Services</TabsTrigger>
              {cableEnabled && <TabsTrigger value="cable" className="text-xs"><Tv className="h-3 w-3 mr-1" />Cable</TabsTrigger>}
              {internetEnabled && <TabsTrigger value="internet" className="text-xs"><Wifi className="h-3 w-3 mr-1" />Internet</TabsTrigger>}
            </TabsList>
          </Tabs>
        )}

        <div className="flex flex-wrap gap-1 ml-auto">
          {PRESETS.map((p) => (
            <Button
              key={p.key}
              size="sm"
              variant={preset === p.key ? 'default' : 'outline'}
              onClick={() => { onPresetChange(p.key); onCustomRangeChange(undefined); }}
            >
              {p.label}
            </Button>
          ))}
          <Popover>
            <PopoverTrigger asChild>
              <Button size="sm" variant={preset === 'custom' ? 'default' : 'outline'}>
                <CalendarIcon className="h-4 w-4 mr-1" />
                {preset === 'custom' && customRange?.from
                  ? `${format(customRange.from, 'd MMM')}${customRange.to ? ` – ${format(customRange.to, 'd MMM')}` : ''}`
                  : 'Custom'}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar
                mode="range"
                selected={customRange}
                onSelect={(r) => { onCustomRangeChange(r); if (r?.from) onPresetChange('custom'); }}
                numberOfMonths={2}
              />
            </PopoverContent>
          </Popover>
          <Button size="sm" variant={compare ? 'default' : 'outline'} onClick={onCompareToggle}>
            Compare
          </Button>
        </div>
      </div>
    </CardContent>
  </Card>
);
