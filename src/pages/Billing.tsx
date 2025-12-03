import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ArrowLeft, Calendar, CreditCard, History, Play, Settings as SettingsIcon } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useSubscribers } from '@/hooks/useSubscribers';
import { usePacks } from '@/hooks/usePacks';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { Database } from '@/integrations/supabase/types';

type Subscriber = Database["public"]["Tables"]["subscribers"]["Row"];
type BillingHistoryRow = Database["public"]["Tables"]["billing_history"]["Row"];

interface BillingProps {
  onBack: () => void;
}

export const Billing = ({ onBack }: BillingProps) => {
  const { user } = useAuth();
  const { subscribers, loading: subscribersLoading, reloadSubscribers } = useSubscribers(user?.id);
  const { packs } = usePacks(user?.id);
  const [billingHistory, setBillingHistory] = useState<BillingHistoryRow[]>([]);
  const [upcomingCharges, setUpcomingCharges] = useState<Array<{ subscriber: Subscriber; daysUntil: number }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user?.id) {
      loadBillingHistory();
    }
  }, [user?.id]);

  useEffect(() => {
    // Calculate upcoming charges based on current subscriptions
    if (subscribers.length > 0) {
      const today = new Date();
      const upcoming = subscribers
        .filter(s => {
          const currentSub = s.current_subscription as any;
          return currentSub && currentSub.endDate;
        })
        .map(s => {
          const currentSub = s.current_subscription as any;
          const endDate = new Date(currentSub.endDate);
          const daysUntil = Math.ceil((endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
          return { subscriber: s, daysUntil };
        })
        .filter(item => item.daysUntil >= 0 && item.daysUntil <= 30)
        .sort((a, b) => a.daysUntil - b.daysUntil);

      setUpcomingCharges(upcoming);
    }
  }, [subscribers]);

  const loadBillingHistory = async () => {
    const { data, error } = await supabase
      .from('billing_history')
      .select('*')
      .eq('user_id', user?.id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Failed to load billing history:', error);
    } else {
      setBillingHistory(data || []);
    }
    setLoading(false);
  };

  const getPackPrice = (packName: string | null): number => {
    if (!packName) return 0;
    const pack = packs.find(p => p.name === packName);
    return pack?.price || 0;
  };

  const getCycleLabel = (cycle: string) => {
    const labels: Record<string, string> = {
      monthly: 'Monthly',
      quarterly: 'Quarterly (3 months)',
      'semi-annually': 'Semi-Annually (6 months)',
      yearly: 'Yearly',
    };
    return labels[cycle] || cycle;
  };

  // Get subscribers with active subscriptions
  const activeSubscribers = subscribers.filter(s => {
    const currentSub = s.current_subscription as any;
    if (!currentSub) return false;
    const daysLeft = Math.ceil((new Date(currentSub.endDate).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
    return daysLeft > 0;
  });

  // Get subscribers without active subscriptions
  const inactiveSubscribers = subscribers.filter(s => {
    const currentSub = s.current_subscription as any;
    if (!currentSub) return true;
    const daysLeft = Math.ceil((new Date(currentSub.endDate).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
    return daysLeft <= 0;
  });

  if (subscribersLoading || loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-muted-foreground">Loading billing data...</p>
      </div>
    );
  }

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
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <SettingsIcon className="h-4 w-4" />
              Active Subscriptions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{activeSubscribers.length}</div>
            <p className="text-xs text-muted-foreground">
              of {subscribers.length} subscribers
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
            <div className="text-2xl font-bold">{upcomingCharges.length}</div>
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
              ₹{subscribers
                .filter(s => s.balance > 0)
                .reduce((sum, s) => sum + s.balance, 0)
                .toLocaleString('en-IN')}
            </div>
            <p className="text-xs text-muted-foreground">
              due from subscribers
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
            <div className="text-2xl font-bold">{inactiveSubscribers.length}</div>
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
              <CardDescription>Subscribers whose subscriptions are ending soon</CardDescription>
            </CardHeader>
            <CardContent>
              {upcomingCharges.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">No subscriptions expiring in the next 30 days</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Subscriber</TableHead>
                      <TableHead>Package</TableHead>
                      <TableHead>Expiry Date</TableHead>
                      <TableHead>Days Left</TableHead>
                      <TableHead className="text-right">Balance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {upcomingCharges.map(({ subscriber, daysUntil }) => {
                      const currentSub = subscriber.current_subscription as any;
                      return (
                        <TableRow key={subscriber.id}>
                          <TableCell>
                            <div>
                              <p className="font-medium">{subscriber.name}</p>
                              <p className="text-sm text-muted-foreground">{subscriber.subscriber_id}</p>
                            </div>
                          </TableCell>
                          <TableCell>{currentSub?.packName || subscriber.current_pack}</TableCell>
                          <TableCell>{new Date(currentSub?.endDate).toLocaleDateString('en-IN')}</TableCell>
                          <TableCell>
                            <Badge variant={daysUntil <= 7 ? 'destructive' : 'secondary'}>
                              {daysUntil === 0 ? 'Today' : `${daysUntil} days`}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <span className={subscriber.balance > 0 ? 'text-destructive' : 'text-success'}>
                              ₹{subscriber.balance.toFixed(2)}
                            </span>
                          </TableCell>
                        </TableRow>
                      );
                    })}
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
              {activeSubscribers.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">No active subscriptions</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Subscriber</TableHead>
                      <TableHead>Pack</TableHead>
                      <TableHead>Start Date</TableHead>
                      <TableHead>End Date</TableHead>
                      <TableHead>Duration</TableHead>
                      <TableHead className="text-right">Balance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {activeSubscribers.map(subscriber => {
                      const currentSub = subscriber.current_subscription as any;
                      return (
                        <TableRow key={subscriber.id}>
                          <TableCell>
                            <div>
                              <p className="font-medium">{subscriber.name}</p>
                              <p className="text-sm text-muted-foreground">{subscriber.mobile}</p>
                            </div>
                          </TableCell>
                          <TableCell>{currentSub?.packName || subscriber.current_pack}</TableCell>
                          <TableCell>
                            {currentSub?.startDate 
                              ? new Date(currentSub.startDate).toLocaleDateString('en-IN')
                              : 'N/A'}
                          </TableCell>
                          <TableCell>
                            {currentSub?.endDate 
                              ? new Date(currentSub.endDate).toLocaleDateString('en-IN')
                              : 'N/A'}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">{currentSub?.duration || 1} month(s)</Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <span className={subscriber.balance > 0 ? 'text-destructive' : 'text-success'}>
                              ₹{subscriber.balance.toFixed(2)}
                            </span>
                          </TableCell>
                        </TableRow>
                      );
                    })}
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
              <CardDescription>Subscribers without an active subscription</CardDescription>
            </CardHeader>
            <CardContent>
              {inactiveSubscribers.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">All subscribers have active subscriptions!</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Subscriber</TableHead>
                      <TableHead>Last Pack</TableHead>
                      <TableHead>Region</TableHead>
                      <TableHead className="text-right">Balance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {inactiveSubscribers.map(subscriber => (
                      <TableRow key={subscriber.id}>
                        <TableCell>
                          <div>
                            <p className="font-medium">{subscriber.name}</p>
                            <p className="text-sm text-muted-foreground">{subscriber.mobile}</p>
                          </div>
                        </TableCell>
                        <TableCell>{subscriber.current_pack || 'None'}</TableCell>
                        <TableCell>{subscriber.region || 'N/A'}</TableCell>
                        <TableCell className="text-right">
                          <span className={subscriber.balance > 0 ? 'text-destructive' : 'text-success'}>
                            ₹{subscriber.balance.toFixed(2)}
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
    </div>
  );
};
