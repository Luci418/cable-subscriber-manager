import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ArrowLeft, Calendar, CreditCard, History, Settings as SettingsIcon, Tv, Wifi, Wallet } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/hooks/useAuth';
import { useSubscribers } from '@/hooks/useSubscribers';
import { usePacks } from '@/hooks/usePacks';
import { useEnabledServices } from '@/hooks/useEnabledServices';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { friendlyDbError } from '@/lib/dbErrors';
import { RecentVoidsCard } from '@/components/RecentVoidsCard';
import type { Database } from '@/integrations/supabase/types';


type Subscriber = Database["public"]["Tables"]["subscribers"]["Row"];

interface BillingProps {
  onBack: () => void;
}

type ServiceFilter = 'all' | 'cable' | 'internet';

export const Billing = ({ onBack }: BillingProps) => {
  const { user } = useAuth();
  const { cableEnabled, internetEnabled, bothEnabled } = useEnabledServices();
  const { subscribers, loading: subscribersLoading, reloadSubscribers } = useSubscribers(user?.id);
  const { packs } = usePacks(user?.id);
  const loading = false;

  // Service filter. Default to whatever is enabled. When both services are
  // enabled we start with "All" so the operator sees the full picture first.
  const [serviceFilter, setServiceFilter] = useState<ServiceFilter>(() =>
    bothEnabled ? 'all' : internetEnabled && !cableEnabled ? 'internet' : 'cable'
  );

  // "Record payment" flow — operator-facing alternative to manually opening
  // a subscriber and adding a payment transaction. The ledger row created
  // here is identical to a hand-entered manual payment (source=manual_payment),
  // so the immutable ledger guarantees still apply.
  const [payLine, setPayLine] = useState<ServiceLine | null>(null);
  const [payAmount, setPayAmount] = useState<string>('');
  const [paySaving, setPaySaving] = useState(false);

  const openRecordPayment = (line: ServiceLine) => {
    setPayLine(line);
    setPayAmount(line.balance > 0 ? line.balance.toFixed(2) : '');
  };

  const submitRecordPayment = async () => {
    if (!payLine || !user?.id) return;
    const amount = Number(payAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error('Enter a positive amount.');
      return;
    }
    setPaySaving(true);
    const { error } = await (supabase.from('transactions') as any).insert({
      user_id: user.id,
      subscriber_id: payLine.subscriber.id,
      type: 'payment',
      amount,
      service_type: payLine.service,
      source: 'manual_payment',
      provider_id: payLine.service === 'cable'
        ? (payLine.subscriber as any).cable_provider_id
        : (payLine.subscriber as any).internet_provider_id,
      description: `Payment received — ${payLine.service === 'cable' ? 'Cable' : 'Internet'} dues`,
      date: new Date().toISOString(),
    });
    setPaySaving(false);
    if (error) {
      toast.error(friendlyDbError(error, 'Failed to record payment'));
      return;
    }
    toast.success(`Payment of ₹${amount.toFixed(2)} recorded.`);
    setPayLine(null);
    await reloadSubscribers();
  };



  // Per-subscriber view of one service line (cable or internet). We compute
  // this so all downstream metrics/tables share a single shape and the
  // "All" filter can simply concatenate both arrays.
  type ServiceLine = {
    subscriber: Subscriber;
    service: 'cable' | 'internet';
    sub: any | null;        // current_subscription / internet_subscription
    pack: string | null;    // current_pack / current_internet_pack
    balance: number;        // cable_balance / internet_balance
    daysUntil: number | null;
    isActive: boolean;
  };

  const allLines: ServiceLine[] = useMemo(() => {
    const out: ServiceLine[] = [];
    const today = new Date();
    const daysLeft = (endDate: string) =>
      Math.ceil((new Date(endDate).getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

    for (const s of subscribers) {
      const services = (s as any).services?.length ? (s as any).services : ['cable'];

      if (cableEnabled && services.includes('cable')) {
        const sub = s.current_subscription as any;
        const du = sub?.endDate ? daysLeft(sub.endDate) : null;
        out.push({
          subscriber: s,
          service: 'cable',
          sub,
          pack: s.current_pack,
          balance: Number(s.cable_balance || 0),
          daysUntil: du,
          isActive: du !== null && du > 0,
        });
      }

      if (internetEnabled && services.includes('internet')) {
        const sub = (s as any).internet_subscription;
        const du = sub?.endDate ? daysLeft(sub.endDate) : null;
        out.push({
          subscriber: s,
          service: 'internet',
          sub,
          pack: (s as any).current_internet_pack,
          balance: Number((s as any).internet_balance || 0),
          daysUntil: du,
          isActive: du !== null && du > 0,
        });
      }
    }
    return out;
  }, [subscribers, cableEnabled, internetEnabled]);

  const filteredLines = useMemo(
    () => (serviceFilter === 'all' ? allLines : allLines.filter(l => l.service === serviceFilter)),
    [allLines, serviceFilter]
  );

  const activeLines = filteredLines.filter(l => l.isActive);
  const inactiveLines = filteredLines.filter(l => !l.isActive);
  const upcomingLines = filteredLines
    .filter(l => l.daysUntil !== null && l.daysUntil >= 0 && l.daysUntil <= 30)
    .sort((a, b) => (a.daysUntil! - b.daysUntil!));
  const totalOutstanding = filteredLines
    .filter(l => l.balance > 0)
    .reduce((sum, l) => sum + l.balance, 0);

  const serviceLabel = serviceFilter === 'all' ? 'service lines' : serviceFilter === 'cable' ? 'cable services' : 'internet services';

  if (subscribersLoading || loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-muted-foreground">Loading billing data...</p>
      </div>
    );
  }

  const ServiceBadge = ({ service }: { service: 'cable' | 'internet' }) => (
    <Badge variant="outline" className="gap-1">
      {service === 'internet' ? <Wifi className="h-3 w-3" /> : <Tv className="h-3 w-3" />}
      {service === 'internet' ? 'Internet' : 'Cable'}
    </Badge>
  );

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <Button variant="ghost" onClick={onBack} className="mb-2">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
            <h1 className="text-2xl sm:text-3xl font-bold text-foreground">Billing</h1>
            <p className="text-sm text-muted-foreground">Subscription management</p>
          </div>

          {bothEnabled && (
            <div className="inline-flex rounded-lg border p-1 bg-background self-start">
              <Button
                variant={serviceFilter === 'all' ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setServiceFilter('all')}
              >
                All
              </Button>
              <Button
                variant={serviceFilter === 'cable' ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setServiceFilter('cable')}
              >
                <Tv className="h-3.5 w-3.5 mr-1" /> Cable
              </Button>
              <Button
                variant={serviceFilter === 'internet' ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setServiceFilter('internet')}
              >
                <Wifi className="h-3.5 w-3.5 mr-1" /> Internet
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <SettingsIcon className="h-4 w-4" />
              Active
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{activeLines.length}</div>
            <p className="text-xs text-muted-foreground">
              of {filteredLines.length} {serviceLabel}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              Expiring Soon
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{upcomingLines.length}</div>
            <p className="text-xs text-muted-foreground">
              within 30 days
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <CreditCard className="h-4 w-4" />
              Total Outstanding
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              ₹{totalOutstanding.toLocaleString('en-IN')}
            </div>
            <p className="text-xs text-muted-foreground">
              due across {serviceLabel}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <History className="h-4 w-4" />
              Inactive
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{inactiveLines.length}</div>
            <p className="text-xs text-muted-foreground">
              no active subscription
            </p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="expiring" className="space-y-4">
        <TabsList>
          <TabsTrigger value="expiring">Expiring Soon</TabsTrigger>
          <TabsTrigger value="active">Active Subscriptions</TabsTrigger>
          <TabsTrigger value="inactive">Inactive</TabsTrigger>
        </TabsList>

        <TabsContent value="expiring" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Subscriptions Expiring (Next 30 Days)</CardTitle>
              <CardDescription>Service lines ending soon</CardDescription>
            </CardHeader>
            <CardContent>
              {upcomingLines.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">No subscriptions expiring in the next 30 days</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Subscriber</TableHead>
                      {bothEnabled && <TableHead>Service</TableHead>}
                      <TableHead>Package</TableHead>
                      <TableHead>Expiry Date</TableHead>
                      <TableHead>Days Left</TableHead>
                      <TableHead className="text-right">Balance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {upcomingLines.map(line => (
                      <TableRow key={`${line.subscriber.id}-${line.service}`}>
                        <TableCell>
                          <div>
                            <p className="font-medium">{line.subscriber.name}</p>
                            <p className="text-sm text-muted-foreground">{line.subscriber.subscriber_id}</p>
                          </div>
                        </TableCell>
                        {bothEnabled && <TableCell><ServiceBadge service={line.service} /></TableCell>}
                        <TableCell>{line.sub?.packName || line.pack || '—'}</TableCell>
                        <TableCell>{line.sub?.endDate ? new Date(line.sub.endDate).toLocaleDateString('en-IN') : '—'}</TableCell>
                        <TableCell>
                          <Badge variant={line.daysUntil! <= 7 ? 'destructive' : 'secondary'}>
                            {line.daysUntil === 0 ? 'Today' : `${line.daysUntil} days`}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <span className={line.balance > 0 ? 'text-destructive' : 'text-success'}>
                            ₹{line.balance.toFixed(2)}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="active" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Active Subscriptions</CardTitle>
              <CardDescription>Subscribers with active package subscriptions</CardDescription>
            </CardHeader>
            <CardContent>
              {activeLines.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">No active subscriptions</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Subscriber</TableHead>
                      {bothEnabled && <TableHead>Service</TableHead>}
                      <TableHead>Pack</TableHead>
                      <TableHead>Start Date</TableHead>
                      <TableHead>End Date</TableHead>
                      <TableHead>Duration</TableHead>
                      <TableHead className="text-right">Balance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {activeLines.map(line => (
                      <TableRow key={`${line.subscriber.id}-${line.service}`}>
                        <TableCell>
                          <div>
                            <p className="font-medium">{line.subscriber.name}</p>
                            <p className="text-sm text-muted-foreground">{line.subscriber.mobile}</p>
                          </div>
                        </TableCell>
                        {bothEnabled && <TableCell><ServiceBadge service={line.service} /></TableCell>}
                        <TableCell>{line.sub?.packName || line.pack}</TableCell>
                        <TableCell>{line.sub?.startDate ? new Date(line.sub.startDate).toLocaleDateString('en-IN') : 'N/A'}</TableCell>
                        <TableCell>{line.sub?.endDate ? new Date(line.sub.endDate).toLocaleDateString('en-IN') : 'N/A'}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{line.sub?.duration || 1} month(s)</Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <span className={line.balance > 0 ? 'text-destructive' : 'text-success'}>
                            ₹{line.balance.toFixed(2)}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="inactive" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Inactive Subscriptions</CardTitle>
              <CardDescription>Service lines without an active subscription</CardDescription>
            </CardHeader>
            <CardContent>
              {inactiveLines.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">All {serviceLabel} have active subscriptions!</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Subscriber</TableHead>
                      {bothEnabled && <TableHead>Service</TableHead>}
                      <TableHead>Last Pack</TableHead>
                      <TableHead>Region</TableHead>
                      <TableHead className="text-right">Balance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {inactiveLines.map(line => (
                      <TableRow key={`${line.subscriber.id}-${line.service}`}>
                        <TableCell>
                          <div>
                            <p className="font-medium">{line.subscriber.name}</p>
                            <p className="text-sm text-muted-foreground">{line.subscriber.mobile}</p>
                          </div>
                        </TableCell>
                        {bothEnabled && <TableCell><ServiceBadge service={line.service} /></TableCell>}
                        <TableCell>{line.pack || 'None'}</TableCell>
                        <TableCell>{line.subscriber.region || 'N/A'}</TableCell>
                        <TableCell className="text-right">
                          <span className={line.balance > 0 ? 'text-destructive' : 'text-success'}>
                            ₹{line.balance.toFixed(2)}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <RecentVoidsCard />
    </div>
  );
};
