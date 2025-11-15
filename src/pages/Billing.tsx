import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ArrowLeft, Calendar, CreditCard, History, Play, Settings as SettingsIcon } from 'lucide-react';
import { getSubscribers, getBillingHistory, addBillingHistory, getPackPrice, calculateNextBillingDate, updateSubscriber, addTransaction, BillingHistory, Subscriber } from '@/lib/storage';
import { toast } from 'sonner';

interface BillingProps {
  onBack: () => void;
}

export const Billing = ({ onBack }: BillingProps) => {
  const [subscribers, setSubscribers] = useState<Subscriber[]>([]);
  const [billingHistory, setBillingHistory] = useState<BillingHistory[]>([]);
  const [upcomingCharges, setUpcomingCharges] = useState<Array<{ subscriber: Subscriber; daysUntil: number }>>([]);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = () => {
    const allSubscribers = getSubscribers();
    setSubscribers(allSubscribers);
    setBillingHistory(getBillingHistory().sort((a, b) => 
      new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime()
    ));

    // Calculate upcoming charges
    const today = new Date();
    const upcoming = allSubscribers
      .filter(s => s.autoChargeEnabled && s.nextBillingDate)
      .map(s => {
        const nextDate = new Date(s.nextBillingDate!);
        const daysUntil = Math.ceil((nextDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        return { subscriber: s, daysUntil };
      })
      .filter(item => item.daysUntil >= 0 && item.daysUntil <= 30)
      .sort((a, b) => a.daysUntil - b.daysUntil);

    setUpcomingCharges(upcoming);
  };

  const processAutoBilling = () => {
    const today = new Date().toISOString().split('T')[0];
    let chargedCount = 0;

    subscribers.forEach(subscriber => {
      if (!subscriber.autoChargeEnabled || !subscriber.nextBillingDate || !subscriber.billingCycle) {
        return;
      }

      const nextBillingDate = new Date(subscriber.nextBillingDate);
      const currentDate = new Date(today);

      if (nextBillingDate <= currentDate) {
        const amount = getPackPrice(subscriber.pack);
        
        // Add transaction
        const transaction = addTransaction({
          subscriberId: subscriber.id,
          subscriberName: subscriber.name,
          type: 'charge',
          amount,
          description: `Auto-billing: ${subscriber.billingCycle} charge for ${subscriber.pack}`,
        });

        // Update subscriber balance and next billing date
        const newBalance = subscriber.balance - amount;
        const newNextBillingDate = calculateNextBillingDate(today, subscriber.billingCycle);
        
        updateSubscriber(subscriber.id, {
          balance: newBalance,
          nextBillingDate: newNextBillingDate,
          lastBillingDate: today,
        });

        // Add to billing history
        addBillingHistory({
          subscriberId: subscriber.id,
          subscriberName: subscriber.name,
          billingCycle: subscriber.billingCycle,
          amount,
          dueDate: subscriber.nextBillingDate,
          transactionId: transaction.id,
          status: 'charged',
        });

        chargedCount++;
      }
    });

    if (chargedCount > 0) {
      toast.success(`Auto-billing completed! ${chargedCount} subscriber(s) charged.`);
      loadData();
    } else {
      toast.info('No subscribers due for billing today.');
    }
  };

  const enableAutoBillingForSubscriber = (subscriberId: string) => {
    const subscriber = subscribers.find(s => s.id === subscriberId);
    if (!subscriber) return;

    const nextBillingDate = calculateNextBillingDate(
      new Date().toISOString().split('T')[0],
      subscriber.billingCycle || 'monthly'
    );

    updateSubscriber(subscriberId, {
      autoChargeEnabled: true,
      nextBillingDate,
      billingCycle: subscriber.billingCycle || 'monthly',
    });

    toast.success('Auto-billing enabled for ' + subscriber.name);
    loadData();
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

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'charged': return 'success';
      case 'scheduled': return 'secondary';
      case 'failed': return 'destructive';
      default: return 'default';
    }
  };

  const activeSubscribers = subscribers.filter(s => s.autoChargeEnabled);
  const inactiveSubscribers = subscribers.filter(s => !s.autoChargeEnabled);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Button variant="ghost" onClick={onBack} className="mb-4">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Subscribers
          </Button>
          <h1 className="text-3xl font-bold text-foreground">Billing Management</h1>
          <p className="text-muted-foreground">Automated billing cycles and subscription history</p>
        </div>
        <Button onClick={processAutoBilling} size="lg">
          <Play className="mr-2 h-4 w-4" />
          Run Auto-Billing Now
        </Button>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <SettingsIcon className="h-4 w-4" />
              Active Auto-Billing
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
              Due This Month
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{upcomingCharges.length}</div>
            <p className="text-xs text-muted-foreground">
              upcoming charges
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <CreditCard className="h-4 w-4" />
              Total Billed (All Time)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              ₹{billingHistory
                .filter(h => h.status === 'charged')
                .reduce((sum, h) => sum + h.amount, 0)
                .toLocaleString('en-IN')}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <History className="h-4 w-4" />
              Total Charges
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{billingHistory.length}</div>
            <p className="text-xs text-muted-foreground">
              billing events
            </p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="upcoming" className="space-y-4">
        <TabsList>
          <TabsTrigger value="upcoming">Upcoming Charges</TabsTrigger>
          <TabsTrigger value="active">Active Subscriptions</TabsTrigger>
          <TabsTrigger value="inactive">Inactive</TabsTrigger>
          <TabsTrigger value="history">Billing History</TabsTrigger>
        </TabsList>

        <TabsContent value="upcoming" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Upcoming Charges (Next 30 Days)</CardTitle>
              <CardDescription>Subscribers scheduled for auto-billing</CardDescription>
            </CardHeader>
            <CardContent>
              {upcomingCharges.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">No upcoming charges in the next 30 days</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Subscriber</TableHead>
                      <TableHead>Cycle</TableHead>
                      <TableHead>Due Date</TableHead>
                      <TableHead>Days Until</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {upcomingCharges.map(({ subscriber, daysUntil }) => (
                      <TableRow key={subscriber.id}>
                        <TableCell>
                          <div>
                            <p className="font-medium">{subscriber.name}</p>
                            <p className="text-sm text-muted-foreground">{subscriber.id}</p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{getCycleLabel(subscriber.billingCycle!)}</Badge>
                        </TableCell>
                        <TableCell>{new Date(subscriber.nextBillingDate!).toLocaleDateString('en-IN')}</TableCell>
                        <TableCell>
                          <Badge variant={daysUntil <= 3 ? 'destructive' : 'secondary'}>
                            {daysUntil === 0 ? 'Today' : `${daysUntil} days`}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-semibold">
                          ₹{getPackPrice(subscriber.pack).toFixed(2)}
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
              <CardTitle>Active Auto-Billing Subscriptions</CardTitle>
              <CardDescription>Subscribers with automatic billing enabled</CardDescription>
            </CardHeader>
            <CardContent>
              {activeSubscribers.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">No active auto-billing subscriptions</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Subscriber</TableHead>
                      <TableHead>Pack</TableHead>
                      <TableHead>Cycle</TableHead>
                      <TableHead>Next Billing</TableHead>
                      <TableHead>Last Billed</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {activeSubscribers.map(subscriber => (
                      <TableRow key={subscriber.id}>
                        <TableCell>
                          <div>
                            <p className="font-medium">{subscriber.name}</p>
                            <p className="text-sm text-muted-foreground">{subscriber.mobile}</p>
                          </div>
                        </TableCell>
                        <TableCell>{subscriber.pack}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{getCycleLabel(subscriber.billingCycle!)}</Badge>
                        </TableCell>
                        <TableCell>
                          {subscriber.nextBillingDate 
                            ? new Date(subscriber.nextBillingDate).toLocaleDateString('en-IN')
                            : 'Not set'}
                        </TableCell>
                        <TableCell>
                          {subscriber.lastBillingDate 
                            ? new Date(subscriber.lastBillingDate).toLocaleDateString('en-IN')
                            : 'Never'}
                        </TableCell>
                        <TableCell className="text-right font-semibold">
                          ₹{getPackPrice(subscriber.pack).toFixed(2)}
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
              <CardDescription>Subscribers without auto-billing enabled</CardDescription>
            </CardHeader>
            <CardContent>
              {inactiveSubscribers.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">All subscribers have auto-billing enabled!</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Subscriber</TableHead>
                      <TableHead>Pack</TableHead>
                      <TableHead>Region</TableHead>
                      <TableHead>Balance</TableHead>
                      <TableHead className="text-right">Action</TableHead>
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
                        <TableCell>{subscriber.pack}</TableCell>
                        <TableCell>{subscriber.region}</TableCell>
                        <TableCell>
                          <span className={subscriber.balance >= 0 ? 'text-success' : 'text-destructive'}>
                            ₹{subscriber.balance.toFixed(2)}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button 
                            size="sm" 
                            variant="outline"
                            onClick={() => enableAutoBillingForSubscriber(subscriber.id)}
                          >
                            Enable Auto-Billing
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Billing History</CardTitle>
              <CardDescription>Complete record of all billing events</CardDescription>
            </CardHeader>
            <CardContent>
              {billingHistory.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">No billing history yet</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Subscriber</TableHead>
                      <TableHead>Cycle</TableHead>
                      <TableHead>Due Date</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {billingHistory.map(entry => (
                      <TableRow key={entry.id}>
                        <TableCell className="text-sm">
                          {new Date(entry.generatedAt).toLocaleDateString('en-IN')}
                        </TableCell>
                        <TableCell>
                          <div>
                            <p className="font-medium">{entry.subscriberName}</p>
                            <p className="text-sm text-muted-foreground">{entry.subscriberId}</p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{getCycleLabel(entry.billingCycle)}</Badge>
                        </TableCell>
                        <TableCell>{new Date(entry.dueDate).toLocaleDateString('en-IN')}</TableCell>
                        <TableCell>
                          <Badge variant={getStatusColor(entry.status) as any}>
                            {entry.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-semibold">
                          ₹{entry.amount.toFixed(2)}
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
