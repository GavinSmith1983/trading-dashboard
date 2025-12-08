import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ShoppingCart, PoundSterling, TrendingUp, Package } from 'lucide-react';
import {
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { analyticsApi } from '../api';
import { Card, CardHeader, CardTitle, CardContent } from '../components/Card';
import Loading from '../components/Loading';
import ErrorMessage from '../components/ErrorMessage';

// Time range options
const TIME_RANGES = [
  { label: '1W', days: 7 },
  { label: '1M', days: 30 },
  { label: '3M', days: 90 },
  { label: '6M', days: 180 },
  { label: '12M', days: 365 },
  { label: '18M', days: 548 },
] as const;

// Channel colors
const CHANNEL_COLORS: Record<string, string> = {
  'Amazon': '#FF9900',
  'amazon': '#FF9900',
  'Amazon UK': '#FF9900',
  'eBay': '#0064D2',
  'ebay': '#0064D2',
  'eBay UK': '#0064D2',
  'B&Q': '#F77F00',
  'B&Q Marketplace': '#F77F00',
  'ManoMano': '#00A0DC',
  'ManoMano UK': '#00A0DC',
  'Shopify': '#96BF48',
  'OnBuy': '#E91E63',
  'Wayfair': '#7B1FA2',
  'Debenhams': '#9C27B0',
  'Unknown': '#9CA3AF',
};

const FALLBACK_COLORS = [
  '#8884d8', '#82ca9d', '#ffc658', '#ff7c43',
  '#a4de6c', '#d0ed57', '#83a6ed', '#8dd1e1',
];

const getChannelColor = (channel: string, index: number): string => {
  return CHANNEL_COLORS[channel] || FALLBACK_COLORS[index % FALLBACK_COLORS.length];
};

export default function Sales() {
  const [selectedTimeRange, setSelectedTimeRange] = useState(30); // Default 1 month
  const [unitPeriod, setUnitPeriod] = useState<'day' | 'week' | 'month'>('day');
  const [hiddenChannels, setHiddenChannels] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<'units' | 'revenue'>('revenue');

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['sales', selectedTimeRange],
    queryFn: () => analyticsApi.sales(selectedTimeRange, true), // includeDaily=true
  });

  // Get date range from response
  const dateRange = {
    from: data?.fromDate || '',
    to: data?.toDate || '',
  };

  // Build chart data
  const chartData = useMemo(() => {
    if (!data?.dailySales || !data?.fromDate || !data?.toDate) return [];

    // Generate all dates in range
    const allDates: string[] = [];
    const [startYear, startMonth, startDay] = data.fromDate.split('-').map(Number);
    const [endYear, endMonth, endDay] = data.toDate.split('-').map(Number);
    const current = new Date(Date.UTC(startYear, startMonth - 1, startDay));
    const end = new Date(Date.UTC(endYear, endMonth - 1, endDay));

    while (current <= end) {
      const year = current.getUTCFullYear();
      const month = String(current.getUTCMonth() + 1).padStart(2, '0');
      const day = String(current.getUTCDate()).padStart(2, '0');
      allDates.push(`${year}-${month}-${day}`);
      current.setUTCDate(current.getUTCDate() + 1);
    }

    const channels = data.channels || [];

    return allDates.map(date => {
      const daySales = data.dailySales![date] || {};
      const entry: Record<string, any> = { date };

      // Calculate total for the day
      let dayTotal = 0;
      let dayUnits = 0;

      channels.forEach(channel => {
        const channelData = daySales[channel] || { quantity: 0, revenue: 0 };
        entry[`units_${channel}`] = channelData.quantity;
        entry[`revenue_${channel}`] = Math.round(channelData.revenue * 100) / 100;
        dayTotal += channelData.revenue;
        dayUnits += channelData.quantity;
      });

      entry.totalRevenue = Math.round(dayTotal * 100) / 100;
      entry.totalUnits = dayUnits;

      return entry;
    });
  }, [data]);

  // Aggregate by week or month if selected
  const aggregatedChartData = useMemo(() => {
    if (unitPeriod === 'day' || chartData.length === 0) return chartData;

    const channels = data?.channels || [];
    const groups = new Map<string, typeof chartData>();

    for (const point of chartData) {
      let periodKey: string;
      const date = new Date(point.date);

      if (unitPeriod === 'week') {
        const day = date.getUTCDay();
        const diff = date.getUTCDate() - day + (day === 0 ? -6 : 1);
        const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), diff));
        periodKey = monday.toISOString().substring(0, 10);
      } else {
        periodKey = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-01`;
      }

      if (!groups.has(periodKey)) {
        groups.set(periodKey, []);
      }
      groups.get(periodKey)!.push(point);
    }

    return Array.from(groups.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([periodKey, points]) => {
        const aggregated: Record<string, any> = { date: periodKey };

        // Sum up channel data
        let totalRevenue = 0;
        let totalUnits = 0;

        channels.forEach(channel => {
          const unitsSum = points.reduce((sum, p) => sum + (p[`units_${channel}`] || 0), 0);
          const revenueSum = points.reduce((sum, p) => sum + (p[`revenue_${channel}`] || 0), 0);
          aggregated[`units_${channel}`] = unitsSum;
          aggregated[`revenue_${channel}`] = Math.round(revenueSum * 100) / 100;
          totalRevenue += revenueSum;
          totalUnits += unitsSum;
        });

        aggregated.totalRevenue = Math.round(totalRevenue * 100) / 100;
        aggregated.totalUnits = totalUnits;

        return aggregated;
      });
  }, [chartData, unitPeriod, data?.channels]);

  const toggleChannel = (channel: string) => {
    setHiddenChannels(prev => {
      const next = new Set(prev);
      if (next.has(channel)) {
        next.delete(channel);
      } else {
        next.add(channel);
      }
      return next;
    });
  };

  if (isLoading) {
    return (
      <div className="p-8">
        <Loading message="Loading sales data..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <ErrorMessage
          message={error instanceof Error ? error.message : 'Failed to load sales data'}
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  const channels = data?.channels || [];
  const totals = data?.totals || { quantity: 0, revenue: 0, orders: 0 };
  const totalsByChannel = data?.totalsByChannel || {};

  // Calculate averages
  const daysInRange = data?.days || selectedTimeRange;
  const avgDailyRevenue = daysInRange > 0 ? totals.revenue / daysInRange : 0;
  const avgDailyUnits = daysInRange > 0 ? totals.quantity / daysInRange : 0;
  const avgDailyOrders = daysInRange > 0 ? totals.orders / daysInRange : 0;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Sales Overview</h1>
          <p className="text-gray-500 mt-1">
            {dateRange.from} to {dateRange.to}
          </p>
        </div>
        <div className="flex gap-4">
          {/* View Mode Selector */}
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
            <button
              onClick={() => setViewMode('revenue')}
              className={`px-3 py-1 text-sm rounded-md transition-colors ${
                viewMode === 'revenue'
                  ? 'bg-white text-blue-600 shadow-sm font-medium'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Revenue
            </button>
            <button
              onClick={() => setViewMode('units')}
              className={`px-3 py-1 text-sm rounded-md transition-colors ${
                viewMode === 'units'
                  ? 'bg-white text-blue-600 shadow-sm font-medium'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Units
            </button>
          </div>
          {/* Unit Period Selector */}
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
            {(['day', 'week', 'month'] as const).map((period) => (
              <button
                key={period}
                onClick={() => setUnitPeriod(period)}
                className={`px-3 py-1 text-sm rounded-md transition-colors capitalize ${
                  unitPeriod === period
                    ? 'bg-white text-blue-600 shadow-sm font-medium'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                {period}
              </button>
            ))}
          </div>
          {/* Time Range Selector */}
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
            {TIME_RANGES.map(({ label, days }) => (
              <button
                key={days}
                onClick={() => setSelectedTimeRange(days)}
                className={`px-3 py-1 text-sm rounded-md transition-colors ${
                  selectedTimeRange === days
                    ? 'bg-white text-blue-600 shadow-sm font-medium'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-green-100 rounded-lg">
                <PoundSterling className="h-6 w-6 text-green-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">£{totals.revenue.toLocaleString()}</p>
                <p className="text-sm text-gray-500">Total Revenue</p>
                <p className="text-xs text-gray-400">£{avgDailyRevenue.toFixed(0)}/day avg</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-blue-100 rounded-lg">
                <Package className="h-6 w-6 text-blue-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{totals.quantity.toLocaleString()}</p>
                <p className="text-sm text-gray-500">Units Sold</p>
                <p className="text-xs text-gray-400">{avgDailyUnits.toFixed(1)}/day avg</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-purple-100 rounded-lg">
                <ShoppingCart className="h-6 w-6 text-purple-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{totals.orders.toLocaleString()}</p>
                <p className="text-sm text-gray-500">Total Orders</p>
                <p className="text-xs text-gray-400">{avgDailyOrders.toFixed(1)}/day avg</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-amber-100 rounded-lg">
                <TrendingUp className="h-6 w-6 text-amber-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">
                  £{totals.orders > 0 ? (totals.revenue / totals.orders).toFixed(2) : '0'}
                </p>
                <p className="text-sm text-gray-500">Avg Order Value</p>
                <p className="text-xs text-gray-400">
                  {totals.quantity > 0 ? (totals.quantity / totals.orders).toFixed(1) : '0'} items/order
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Sales Chart */}
      <Card>
        <CardHeader>
          <CardTitle>
            {viewMode === 'revenue' ? 'Revenue' : 'Units Sold'} by Channel
          </CardTitle>
        </CardHeader>
        <CardContent>
          {aggregatedChartData.length === 0 ? (
            <div className="flex items-center justify-center h-64 text-gray-500">
              No sales data available for this period
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={400}>
              <ComposedChart data={aggregatedChartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11 }}
                  tickFormatter={(value) => {
                    const date = new Date(value);
                    if (unitPeriod === 'month') {
                      return date.toLocaleDateString('en-GB', { month: 'short' });
                    }
                    return `${date.getDate()}/${date.getMonth() + 1}`;
                  }}
                />
                <YAxis
                  tick={{ fontSize: 11 }}
                  tickFormatter={(value) =>
                    viewMode === 'revenue' ? `£${value.toLocaleString()}` : value.toString()
                  }
                />
                <Tooltip
                  labelFormatter={(label) => {
                    const date = new Date(label);
                    if (unitPeriod === 'week') {
                      const endOfWeek = new Date(date);
                      endOfWeek.setDate(endOfWeek.getDate() + 6);
                      return `Week of ${date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} - ${endOfWeek.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`;
                    }
                    if (unitPeriod === 'month') {
                      return date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
                    }
                    return date.toLocaleDateString('en-GB', {
                      weekday: 'short',
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    });
                  }}
                  formatter={(value: number, name: string) => {
                    const channelName = name.replace(/^(units_|revenue_)/, '');
                    if (name.startsWith('revenue_')) {
                      return [`£${value.toLocaleString()}`, channelName];
                    }
                    return [value, channelName];
                  }}
                />
                <Legend
                  onClick={(e: any) => toggleChannel(e.dataKey)}
                  formatter={(value: string) => {
                    const channel = value.replace(/^(units_|revenue_)/, '');
                    return (
                      <span style={{ color: hiddenChannels.has(value) ? '#ccc' : undefined }}>
                        {channel}
                      </span>
                    );
                  }}
                  wrapperStyle={{ cursor: 'pointer' }}
                />
                {/* Total line */}
                <Line
                  type="monotone"
                  dataKey={viewMode === 'revenue' ? 'totalRevenue' : 'totalUnits'}
                  stroke="#374151"
                  strokeWidth={2}
                  strokeDasharray="5 5"
                  dot={false}
                  name="Total"
                  hide={hiddenChannels.has(viewMode === 'revenue' ? 'totalRevenue' : 'totalUnits')}
                />
                {/* Channel bars */}
                {channels.map((channel, index) => {
                  const dataKey = viewMode === 'revenue' ? `revenue_${channel}` : `units_${channel}`;
                  return (
                    <Bar
                      key={channel}
                      dataKey={dataKey}
                      stackId="sales"
                      fill={getChannelColor(channel, index)}
                      name={dataKey}
                      hide={hiddenChannels.has(dataKey)}
                    />
                  );
                })}
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Channel Breakdown */}
      <Card>
        <CardHeader>
          <CardTitle>Channel Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-3 px-4 font-medium text-gray-500">Channel</th>
                  <th className="text-right py-3 px-4 font-medium text-gray-500">Revenue</th>
                  <th className="text-right py-3 px-4 font-medium text-gray-500">% of Total</th>
                  <th className="text-right py-3 px-4 font-medium text-gray-500">Units</th>
                  <th className="text-right py-3 px-4 font-medium text-gray-500">Orders</th>
                  <th className="text-right py-3 px-4 font-medium text-gray-500">Avg Order</th>
                </tr>
              </thead>
              <tbody>
                {channels
                  .sort((a, b) => (totalsByChannel[b]?.revenue || 0) - (totalsByChannel[a]?.revenue || 0))
                  .map((channel, index) => {
                    const channelData = totalsByChannel[channel] || { quantity: 0, revenue: 0, orders: 0 };
                    const percentOfTotal = totals.revenue > 0 ? (channelData.revenue / totals.revenue) * 100 : 0;
                    const avgOrderValue = channelData.orders > 0 ? channelData.revenue / channelData.orders : 0;

                    return (
                      <tr key={channel} className="border-b hover:bg-gray-50">
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2">
                            <div
                              className="w-3 h-3 rounded-full"
                              style={{ backgroundColor: getChannelColor(channel, index) }}
                            />
                            <span className="font-medium">{channel}</span>
                          </div>
                        </td>
                        <td className="text-right py-3 px-4 font-medium">
                          £{channelData.revenue.toLocaleString()}
                        </td>
                        <td className="text-right py-3 px-4 text-gray-500">
                          {percentOfTotal.toFixed(1)}%
                        </td>
                        <td className="text-right py-3 px-4">{channelData.quantity.toLocaleString()}</td>
                        <td className="text-right py-3 px-4">{channelData.orders.toLocaleString()}</td>
                        <td className="text-right py-3 px-4">£{avgOrderValue.toFixed(2)}</td>
                      </tr>
                    );
                  })}
                {/* Totals row */}
                <tr className="bg-gray-50 font-semibold">
                  <td className="py-3 px-4">Total</td>
                  <td className="text-right py-3 px-4">£{totals.revenue.toLocaleString()}</td>
                  <td className="text-right py-3 px-4">100%</td>
                  <td className="text-right py-3 px-4">{totals.quantity.toLocaleString()}</td>
                  <td className="text-right py-3 px-4">{totals.orders.toLocaleString()}</td>
                  <td className="text-right py-3 px-4">
                    £{totals.orders > 0 ? (totals.revenue / totals.orders).toFixed(2) : '0'}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
