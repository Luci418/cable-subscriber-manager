import { useState } from 'react';
import { Subscriber } from '@/lib/storage';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Search, Plus, MoreHorizontal, Upload, Download, HardDrive } from 'lucide-react';
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
    if (balanceFilter === 'positive') matchesBalance = s.balance > 0;
    else if (balanceFilter === 'negative') matchesBalance = s.balance < 0;
    else if (balanceFilter === 'zero') matchesBalance = s.balance === 0;
    
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
              <Button variant="outline" size="sm">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onManagePacks}>
                Manage Packs
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onManageRegions}>
                Manage Regions
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onManageStbs}>
                <HardDrive className="h-4 w-4 mr-2" />
                STB Inventory
              </DropdownMenuItem>
              <DropdownMenuSeparator />
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
            const stbNum = (subscriber as any).stb_number || subscriber.stbNumber || 'N/A';
            const pack = (subscriber as any).current_pack || subscriber.pack || 'No Pack';
            return (
              <Card 
                key={subscriber.id}
                className="cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => onSelectSubscriber(subscriber.id)}
              >
                <CardHeader className="pb-3">
                  <div className="flex justify-between items-start">
                    <div>
                      <CardTitle className="text-lg">{subscriber.name}</CardTitle>
                       <p className="text-sm text-muted-foreground mt-1">
                         {subscriber.mobile} • STB: {stbNum} • {subscriber.region || 'No Region'}
                       </p>
                    </div>
                    <Badge variant="secondary">{pack}</Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex justify-between items-center">
                    <div className="text-sm text-muted-foreground">
                      {subscriber.latitude && subscriber.longitude ? (
                        <span>📍 {subscriber.latitude.toFixed(4)}, {subscriber.longitude.toFixed(4)}</span>
                      ) : (
                        <span>No coordinates</span>
                      )}
                    </div>
                    <div className={`font-semibold ${getBalanceColor(subscriber.balance || 0)}`}>
                      ₹{(subscriber.balance || 0).toFixed(2)}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
};
