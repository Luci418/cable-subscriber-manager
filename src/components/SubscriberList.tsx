import { useState } from 'react';
import { Subscriber } from '@/lib/storage';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Search, Plus, Settings2, Upload, Download, HardDrive, Package, MapPin, Wifi, Tv } from 'lucide-react';
import { useEnabledServices } from '@/hooks/useEnabledServices';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';

interface SubscriberListProps {
  subscribers: Subscriber[];
  onSelectSubscriber: (id: string) => void;
  onAddNew: () => void;
  onExport: () => void;
  onImport: () => void;
  onManagePacks: () => void;
  onManageRegions: () => void;
  onManageStbs: () => void;
  initialPackFilter?: string;
  initialRegionFilter?: string;
  initialBalanceFilter?: string;
}

export const SubscriberList = ({
  subscribers,
  onSelectSubscriber,
  onAddNew,
  onExport,
  onImport,
  onManagePacks,
  onManageRegions,
  onManageStbs,
  initialPackFilter,
  initialRegionFilter,
  initialBalanceFilter,
}: SubscriberListProps) => {
  const { cableEnabled, internetEnabled, bothEnabled } = useEnabledServices();
  const [search, setSearch] = useState('');
  const [packFilter, setPackFilter] = useState<string>(initialPackFilter || 'all');
  const [regionFilter, setRegionFilter] = useState<string>(initialRegionFilter || 'all');
  const [balanceFilter, setBalanceFilter] = useState<string>(initialBalanceFilter || 'all');

  // Use database field names: current_pack and stb_number
  const packs = Array.from(new Set(subscribers.map(s => (s as any).current_pack || s.pack).filter(Boolean)));
  const regions = Array.from(new Set(subscribers.map(s => s.region).filter(Boolean)));

  const filteredSubscribers = subscribers.filter(s => {
    const searchLower = search.toLowerCase().trim();
    const stbNum = (s as any).stb_number || s.stbNumber || '';
    const pack = (s as any).current_pack || s.pack || '';
    
    const matchesSearch = !searchLower || 
      s.name.toLowerCase().includes(searchLower) ||
      s.mobile.toLowerCase().includes(searchLower) ||
      stbNum.toLowerCase().includes(searchLower) ||
      s.id.toLowerCase().includes(searchLower);
    
    const matchesPack = packFilter === 'all' || pack === packFilter;
    const matchesRegion = regionFilter === 'all' || s.region === regionFilter;
    
    let matchesBalance = true;
    if (balanceFilter === 'positive') matchesBalance = s.cable_balance > 0;
    else if (balanceFilter === 'negative') matchesBalance = s.cable_balance < 0;
    else if (balanceFilter === 'zero') matchesBalance = s.cable_balance === 0;
    
    return matchesSearch && matchesPack && matchesRegion && matchesBalance;
  });

  const getBalanceColor = (balance: number) => {
    if (balance > 0) return 'text-success';
    if (balance < 0) return 'text-destructive';
    return 'text-muted-foreground';
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <div className="flex-1 w-full sm:w-auto">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
            <Input
              placeholder="Search by name, mobile, or STB..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>
        
        <div className="flex flex-wrap gap-2 w-full sm:w-auto">
          <Select value={packFilter} onValueChange={setPackFilter}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Filter by pack" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Packs</SelectItem>
              {packs.filter(Boolean).map((pack, idx) => (
                <SelectItem key={`pack-${pack}-${idx}`} value={pack}>{pack}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={regionFilter} onValueChange={setRegionFilter}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Filter by region" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Regions</SelectItem>
              {regions.filter(Boolean).map((region, idx) => (
                <SelectItem key={`region-${region}-${idx}`} value={region}>{region}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={balanceFilter} onValueChange={setBalanceFilter}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Filter by balance" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Balances</SelectItem>
              <SelectItem value="positive">Credit</SelectItem>
              <SelectItem value="negative">Debit</SelectItem>
              <SelectItem value="zero">Zero</SelectItem>
            </SelectContent>
          </Select>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2">
                <Settings2 className="h-4 w-4" />
                <span className="hidden sm:inline">Manage</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Catalog</DropdownMenuLabel>
              <DropdownMenuItem onClick={onManagePacks}>
                <Package className="h-4 w-4 mr-2" />
                Packs {bothEnabled && <span className="ml-auto text-xs text-muted-foreground">Cable + Internet</span>}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onManageRegions}>
                <MapPin className="h-4 w-4 mr-2" />
                Regions
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Inventory</DropdownMenuLabel>
              {/* Inventory label adapts: cable-only → "STBs", internet-only → "ONU / Routers", both → unified label */}
              <DropdownMenuItem onClick={onManageStbs}>
                {internetEnabled && !cableEnabled ? (
                  <><Wifi className="h-4 w-4 mr-2" /> ONU / Router Inventory</>
                ) : bothEnabled ? (
                  <><HardDrive className="h-4 w-4 mr-2" /> Device Inventory</>
                ) : (
                  <><Tv className="h-4 w-4 mr-2" /> STB Inventory</>
                )}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Data</DropdownMenuLabel>
              <DropdownMenuItem onClick={onImport}>
                <Upload className="h-4 w-4 mr-2" />
                Import
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onExport}>
                <Download className="h-4 w-4 mr-2" />
                Export
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          
          <Button onClick={onAddNew}>
            <Plus className="h-4 w-4 mr-2" />
            Add Subscriber
          </Button>
        </div>
      </div>

      <div className="grid gap-4">
        {filteredSubscribers.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-muted-foreground">
                {search || packFilter !== 'all' || regionFilter !== 'all' || balanceFilter !== 'all'
                  ? 'No subscribers found matching your criteria'
                  : 'No subscribers yet. Add your first subscriber to get started!'}
              </p>
            </CardContent>
          </Card>
        ) : (
          filteredSubscribers.map(subscriber => {
            const sAny = subscriber as any;
            const stbNum = sAny.stb_number || subscriber.stbNumber || '';
            const cablePack = sAny.current_pack || subscriber.pack || '';
            const internetPack = sAny.current_internet_pack || '';
            const cableSub = sAny.current_subscription;
            const internetSub = sAny.internet_subscription;
            const services: string[] = sAny.services || ['cable'];
            const hasCable = cableEnabled && services.includes('cable');
            const hasInternet = internetEnabled && services.includes('internet');

            const formatExpiry = (sub: any) => {
              if (!sub?.endDate) return null;
              const d = new Date(sub.endDate);
              const days = Math.ceil((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
              const dateStr = d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
              if (days < 0) return { text: `Expired ${dateStr}`, tone: 'text-destructive' };
              if (days <= 5) return { text: `${dateStr} • ${days}d left`, tone: 'text-warning' };
              return { text: `${dateStr} • ${days}d left`, tone: 'text-muted-foreground' };
            };

            const ServiceStrip = ({
              icon: Icon,
              label,
              pack,
              expiry,
              balance,
            }: {
              icon: typeof Tv;
              label: string;
              pack: string;
              expiry: ReturnType<typeof formatExpiry>;
              balance: number;
            }) => (
              <div className="flex items-center justify-between gap-3 py-2 px-3 rounded-md bg-muted/40">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="text-xs font-medium text-muted-foreground w-14 shrink-0">{label}</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">{pack || 'No pack'}</div>
                    {expiry && <div className={`text-xs ${expiry.tone}`}>{expiry.text}</div>}
                  </div>
                </div>
                <div className={`text-sm font-semibold whitespace-nowrap ${getBalanceColor(balance)}`}>
                  ₹{balance.toFixed(0)}
                </div>
              </div>
            );

            return (
              <Card
                key={subscriber.id}
                className="cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => onSelectSubscriber(subscriber.id)}
              >
                <CardHeader className="pb-3">
                  <div className="flex justify-between items-start gap-3">
                    <div className="min-w-0">
                      <CardTitle className="text-lg truncate">{subscriber.name}</CardTitle>
                      <p className="text-sm text-muted-foreground mt-1 truncate">
                        {subscriber.mobile}
                        {subscriber.region && <> • {subscriber.region}</>}
                        {stbNum && <> • {stbNum}</>}
                      </p>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      {hasCable && (
                        <Badge variant="secondary" className="gap-1">
                          <Tv className="h-3 w-3" /> Cable
                        </Badge>
                      )}
                      {hasInternet && (
                        <Badge variant="secondary" className="gap-1">
                          <Wifi className="h-3 w-3" /> Net
                        </Badge>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  {hasCable && (
                    <ServiceStrip
                      icon={Tv}
                      label="Cable"
                      pack={cablePack}
                      expiry={formatExpiry(cableSub)}
                      balance={subscriber.cable_balance || 0}
                    />
                  )}
                  {hasInternet && (
                    <ServiceStrip
                      icon={Wifi}
                      label="Internet"
                      pack={internetPack}
                      expiry={formatExpiry(internetSub)}
                      balance={(subscriber as any).internet_balance || 0}
                    />
                  )}
                  {!hasCable && !hasInternet && (
                    <p className="text-sm text-muted-foreground text-center py-2">
                      No active services
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
};
