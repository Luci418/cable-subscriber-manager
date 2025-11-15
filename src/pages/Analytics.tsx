import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { ArrowLeft, TrendingUp, Users, DollarSign, Package, MapPin, Calendar } from 'lucide-react';
import { getSubscribers, getTransactions, getPacks, Transaction, Subscriber } from '@/lib/storage';
import { BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface AnalyticsProps {
  onBack: () => void;
  onFilterPack?: (pack: string) => void;
  onFilterRegion?: (region: string) => void;
  onFilterBalance?: (status: string) => void;
}

export const Analytics = ({ onBack, onFilterPack, onFilterRegion, onFilterBalance }: AnalyticsProps) => {
  const [subscribers, setSubscribers] = useState<Subscriber[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [timeRange, setTimeRange] = useState<'7d' | '30d' | '90d' | 'all'>('30d');

  useEffect(() => {
    setSubscribers(getSubscribers());
    setTransactions(getTransactions());
  }, []);

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
      const monthKey = new Date(s.createdAt).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
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
      packCounts[s.pack] = (packCounts[s.pack] || 0) + 1;
    });

    return Object.entries(packCounts).map(([name, value]) => ({ name, value }));
  };

  // Region distribution
  const getRegionDistribution = () => {
    const regionCounts: { [key: string]: number } = {};
    subscribers.forEach(s => {
      regionCounts[s.region] = (regionCounts[s.region] || 0) + 1;
    });

    return Object.entries(regionCounts).map(([name, value]) => ({ name, value }));
  };

  // Balance distribution
  const getBalanceDistribution = () => {
    const positive = subscribers.filter(s => s.balance > 0).length;
    const negative = subscribers.filter(s => s.balance < 0).length;
    const zero = subscribers.filter(s => s.balance === 0).length;

    return [
      { name: 'Credit Balance', value: positive },
      { name: 'Debit Balance', value: negative },
      { name: 'Zero Balance', value: zero },
    ].filter(item => item.value > 0);
  };

  const COLORS = ['hsl(var(--primary))', 'hsl(var(--accent))', 'hsl(var(--secondary))', 'hsl(var(--warning))', 'hsl(var(--success))'];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Button variant="ghost" onClick={onBack} className="mb-4">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Subscribers
          </Button>
          <h1 className="text-3xl font-bold text-foreground">Analytics Dashboard</h1>
          <p className="text-muted-foreground">Comprehensive insights into your cable TV business</p>
        </div>
        <div className="flex gap-2">
          <Button variant={timeRange === '7d' ? 'default' : 'outline'} onClick={() => setTimeRange('7d')}>7 Days</Button>
          <Button variant={timeRange === '30d' ? 'default' : 'outline'} onClick={() => setTimeRange('30d')}>30 Days</Button>
          <Button variant={timeRange === '90d' ? 'default' : 'outline'} onClick={() => setTimeRange('90d')}>90 Days</Button>
          <Button variant={timeRange === 'all' ? 'default' : 'outline'} onClick={() => setTimeRange('all')}>All Time</Button>
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
            <CardTitle className="text-sm font-medium">Total Balance</CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${totalBalance >= 0 ? 'text-success' : 'text-destructive'}`}>
              ₹{totalBalance.toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground">Outstanding balance</p>
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
                        if (onFilterPack) {
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
                        if (onFilterRegion) {
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
                            'Credit Balance': 'positive',
                            'Debit Balance': 'negative',
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