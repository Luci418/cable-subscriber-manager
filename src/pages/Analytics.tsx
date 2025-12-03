import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { ArrowLeft, TrendingUp, Users, DollarSign, Calendar } from 'lucide-react';
import { BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { useAuth } from '@/hooks/useAuth';
import { useSubscribers } from '@/hooks/useSubscribers';
import { useTransactions } from '@/hooks/useTransactions';
import type { Database } from '@/integrations/supabase/types';

type Subscriber = Database["public"]["Tables"]["subscribers"]["Row"];
type Transaction = Database["public"]["Tables"]["transactions"]["Row"];

interface AnalyticsProps {
  onBack: () => void;
  onFilterPack?: (pack: string) => void;
  onFilterRegion?: (region: string) => void;
  onFilterBalance?: (status: string) => void;
}

export const Analytics = ({ onBack, onFilterPack, onFilterRegion, onFilterBalance }: AnalyticsProps) => {
  const { user } = useAuth();
  const { subscribers, loading: subscribersLoading } = useSubscribers(user?.id);
  const { transactions, loading: transactionsLoading } = useTransactions(user?.id);
  const [timeRange, setTimeRange] = useState<'7d' | '30d' | '90d' | 'all'>('30d');

  const loading = subscribersLoading || transactionsLoading;

  // Calculate key metrics
  const totalSubscribers = subscribers.length;
  const totalRevenue = transactions
    .filter(t => t.type === 'payment')
    .reduce((sum, t) => sum + t.amount, 0);
  const totalCharges = transactions
    .filter(t => t.type === 'charge')
    .reduce((sum, t) => sum + t.amount, 0);
  const netRevenue = totalRevenue - totalCharges;
  const totalBalance = subscribers.reduce((sum, s) => sum + s.balance, 0);

  // Filter transactions by time range
  const getFilteredTransactions = () => {
    if (timeRange === 'all') return transactions;
    
    const now = new Date();
    const days = timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : 90;
    const cutoffDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    
    return transactions.filter(t => new Date(t.date) >= cutoffDate);
  };

  // Revenue trend data (daily for last period)
  const getRevenueTrendData = () => {
    const filtered = getFilteredTransactions();
    const dailyData: { [key: string]: { payments: number; charges: number } } = {};

    filtered.forEach(t => {
      const dateKey = new Date(t.date).toLocaleDateString('en-IN');
      if (!dailyData[dateKey]) {
        dailyData[dateKey] = { payments: 0, charges: 0 };
      }
      if (t.type === 'payment') {
        dailyData[dateKey].payments += t.amount;
      } else {
        dailyData[dateKey].charges += t.amount;
      }
    });

    return Object.entries(dailyData)
      .sort((a, b) => new Date(a[0]).getTime() - new Date(b[0]).getTime())
      .map(([date, data]) => ({
        date,
        payments: data.payments,
        charges: data.charges,
        net: data.payments - data.charges,
      }));
  };

  // Subscriber growth data
  const getSubscriberGrowthData = () => {
    const monthlyData: { [key: string]: number } = {};
    
    subscribers.forEach(s => {
      const monthKey = new Date(s.created_at).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
      monthlyData[monthKey] = (monthlyData[monthKey] || 0) + 1;
    });

    let cumulative = 0;
    return Object.entries(monthlyData)
      .map(([month, count]) => {
        cumulative += count;
        return { month, new: count, total: cumulative };
      });
  };

  // Pack distribution
  const getPackDistribution = () => {
    const packCounts: { [key: string]: number } = {};
    subscribers.forEach(s => {
      const packName = s.current_pack || 'No Pack';
      packCounts[packName] = (packCounts[packName] || 0) + 1;
    });

    return Object.entries(packCounts).map(([name, value]) => ({ name, value }));
  };

  // Region distribution
  const getRegionDistribution = () => {
    const regionCounts: { [key: string]: number } = {};
    subscribers.forEach(s => {
      const regionName = s.region || 'Unknown';
      regionCounts[regionName] = (regionCounts[regionName] || 0) + 1;
    });

    return Object.entries(regionCounts).map(([name, value]) => ({ name, value }));
  };

  // Balance distribution
  const getBalanceDistribution = () => {
    const positive = subscribers.filter(s => s.balance > 0).length;
    const negative = subscribers.filter(s => s.balance < 0).length;
    const zero = subscribers.filter(s => s.balance === 0).length;

    return [
      { name: 'Debt (Due)', value: positive },
      { name: 'Credit (Advance)', value: negative },
      { name: 'Zero Balance', value: zero },
    ].filter(item => item.value > 0);
  };

  const COLORS = ['hsl(var(--primary))', 'hsl(var(--accent))', 'hsl(var(--secondary))', 'hsl(var(--warning))', 'hsl(var(--success))'];

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-muted-foreground">Loading analytics...</p>
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
            <h1 className="text-2xl sm:text-3xl font-bold text-foreground">Analytics</h1>
            <p className="text-sm text-muted-foreground">Business insights</p>
          </div>
          <div className="flex flex-wrap gap-1 sm:gap-2">
            <Button size="sm" variant={timeRange === '7d' ? 'default' : 'outline'} onClick={() => setTimeRange('7d')}>7D</Button>
            <Button size="sm" variant={timeRange === '30d' ? 'default' : 'outline'} onClick={() => setTimeRange('30d')}>30D</Button>
            <Button size="sm" variant={timeRange === '90d' ? 'default' : 'outline'} onClick={() => setTimeRange('90d')}>90D</Button>
            <Button size="sm" variant={timeRange === 'all' ? 'default' : 'outline'} onClick={() => setTimeRange('all')}>All</Button>
          </div>
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Subscribers</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalSubscribers}</div>
            <p className="text-xs text-muted-foreground">Active subscribers</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">₹{totalRevenue.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">All-time payments</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Net Revenue</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">₹{netRevenue.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">Revenue minus charges</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Outstanding</CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${totalBalance > 0 ? 'text-destructive' : 'text-success'}`}>
              ₹{Math.abs(totalBalance).toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground">
              {totalBalance > 0 ? 'Due from subscribers' : 'Credit with subscribers'}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <Tabs defaultValue="revenue" className="space-y-4">
        <TabsList>
          <TabsTrigger value="revenue">Revenue Trends</TabsTrigger>
          <TabsTrigger value="growth">Subscriber Growth</TabsTrigger>
          <TabsTrigger value="distribution">Distribution</TabsTrigger>
        </TabsList>

        <TabsContent value="revenue" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Revenue & Charges Over Time</CardTitle>
              <CardDescription>Daily breakdown of payments and charges</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={350}>
                <LineChart data={getRevenueTrendData()}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="payments" stroke="hsl(var(--success))" name="Payments" strokeWidth={2} />
                  <Line type="monotone" dataKey="charges" stroke="hsl(var(--destructive))" name="Charges" strokeWidth={2} />
                  <Line type="monotone" dataKey="net" stroke="hsl(var(--primary))" name="Net Revenue" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="growth" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Subscriber Growth</CardTitle>
              <CardDescription>Monthly new subscribers and cumulative total</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={350}>
                <BarChart data={getSubscriberGrowthData()}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="new" fill="hsl(var(--primary))" name="New Subscribers" />
                  <Bar dataKey="total" fill="hsl(var(--accent))" name="Total Subscribers" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="distribution" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Pack Distribution</CardTitle>
                <CardDescription>Subscribers by package type</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={getPackDistribution()}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                      outerRadius={80}
                      fill="#8884d8"
                      dataKey="value"
                      onClick={(data) => {
                        if (onFilterPack && data.name !== 'No Pack') {
                          onFilterPack(data.name);
                          onBack();
                        }
                      }}
                      cursor="pointer"
                    >
                      {getPackDistribution().map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Region Distribution</CardTitle>
                <CardDescription>Subscribers by region</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={getRegionDistribution()}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                      outerRadius={80}
                      fill="#8884d8"
                      dataKey="value"
                      onClick={(data) => {
                        if (onFilterRegion && data.name !== 'Unknown') {
                          onFilterRegion(data.name);
                          onBack();
                        }
                      }}
                      cursor="pointer"
                    >
                      {getRegionDistribution().map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Balance Status</CardTitle>
                <CardDescription>Subscriber balance distribution</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={getBalanceDistribution()}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, value }) => `${name}: ${value}`}
                      outerRadius={80}
                      fill="#8884d8"
                      dataKey="value"
                      onClick={(data) => {
                        if (onFilterBalance) {
                          const statusMap: { [key: string]: string } = {
                            'Debt (Due)': 'positive',
                            'Credit (Advance)': 'negative',
                            'Zero Balance': 'zero'
                          };
                          onFilterBalance(statusMap[data.name]);
                          onBack();
                        }
                      }}
                      cursor="pointer"
                    >
                      {getBalanceDistribution().map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};
