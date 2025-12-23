import { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  Building2,
  TrendingUp,
  Percent,
  ShoppingCart,
  Package,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { useAccountQuery } from '../hooks/useAccountQuery';
import { useAccount } from '../context/AccountContext';
import { analyticsApi } from '../api';
import { Card, CardHeader, CardTitle, CardContent } from '../components/Card';
import Loading from '../components/Loading';
import ErrorMessage from '../components/ErrorMessage';

// Time range options
type TimeRangeOption = { label: string; days: number | 'thisMonth' | 'lastMonth' };

const TIME_RANGES: TimeRangeOption[] = [
  { label: 'This Month', days: 'thisMonth' },
  { label: 'Last Month', days: 'lastMonth' },
  { label: '1M', days: 30 },
  { label: '3M', days: 90 },
  { label: '6M', days: 180 },
  { label: '12M', days: 365 },
];

// Helper to calculate date range for API call
function getDateRangeParams(range: number | 'thisMonth' | 'lastMonth'): { days?: number; fromDate?: string; toDate?: string } {
  if (typeof range === 'number') {
    return { days: range };
  }

  const now = new Date();
  const formatDate = (d: Date) => d.toISOString().substring(0, 10);

  if (range === 'thisMonth') {
    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    return {
      fromDate: formatDate(firstOfMonth),
      toDate: formatDate(now),
    };
  } else if (range === 'lastMonth') {
    const firstOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);
    return {
      fromDate: formatDate(firstOfLastMonth),
      toDate: formatDate(lastOfLastMonth),
    };
  }
  return { days: 30 };
}

// Revenue display component
function Revenue({ value, symbol, className = '' }: { value: number; symbol: string; className?: string }) {
  const roundedValue = Math.round(value);
  const preciseValue = value.toFixed(2);
  return (
    <span className={className} title={`${symbol}${preciseValue}`}>
      {symbol}{roundedValue.toLocaleString()}
    </span>
  );
}

// Chart colors
const CHART_COLORS = {
  revenue: '#3B82F6',
  discount: '#F59E0B',
  orders: '#10B981',
  quantity: '#8B5CF6',
};

// Family colors
const FAMILY_COLORS = [
  '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6',
  '#EC4899', '#06B6D4', '#84CC16', '#F97316', '#6366F1',
];

export default function CompanyDetail() {
  const { companyName } = useParams<{ companyName: string }>();
  const decodedCompanyName = decodeURIComponent(companyName || '');
  const navigate = useNavigate();
  const { accountId } = useAccountQuery();
  const { currencySymbol } = useAccount();
  const hasAccount = accountId !== 'no-account';

  const [selectedTimeRange, setSelectedTimeRange] = useState<number | 'thisMonth' | 'lastMonth'>(90);
  const [viewMode, setViewMode] = useState<'revenue' | 'units'>('revenue');
  const [unitPeriod, setUnitPeriod] = useState<'day' | 'week' | 'month'>('day');
  const [expandedFamilies, setExpandedFamilies] = useState<Set<string>>(new Set());
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

  // Date range params
  const dateParams = getDateRangeParams(selectedTimeRange);

  // Fetch company detail data
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['company-detail', accountId, decodedCompanyName, selectedTimeRange],
    queryFn: () => analyticsApi.companyDetail(decodedCompanyName, dateParams),
    enabled: hasAccount && !!decodedCompanyName,
  });

  // Transform daily sales data for charts - fill in all dates in range
  const chartData = useMemo(() => {
    if (!data?.dateRange) return [];

    const { fromDate, toDate } = data.dateRange;
    const dailySales = data.dailySales || {};
    const result: Array<{
      date: string;
      revenue: number;
      discount: number;
      discountPercent: number;
      orders: number;
      quantity: number;
    }> = [];

    // Generate all dates in the range
    const start = new Date(fromDate);
    const end = new Date(toDate);
    const current = new Date(start);

    while (current <= end) {
      const dateStr = current.toISOString().substring(0, 10);
      const sales = dailySales[dateStr];

      if (sales) {
        const discountPercent = sales.revenue > 0
          ? Math.round((sales.discount / sales.revenue) * 10000) / 100
          : 0;
        result.push({
          date: dateStr,
          revenue: Math.round(sales.revenue * 100) / 100,
          discount: Math.round(sales.discount * 100) / 100,
          discountPercent,
          orders: sales.orders,
          quantity: sales.quantity,
        });
      } else {
        // No orders on this date - fill with zeros
        result.push({
          date: dateStr,
          revenue: 0,
          discount: 0,
          discountPercent: 0,
          orders: 0,
          quantity: 0,
        });
      }

      current.setDate(current.getDate() + 1);
    }

    return result;
  }, [data]);

  // Aggregate chart data by week or month if selected
  const aggregatedChartData = useMemo(() => {
    if (unitPeriod === 'day' || chartData.length === 0) return chartData;

    // Group daily data by period
    const groups = new Map<string, typeof chartData>();

    for (const point of chartData) {
      let periodKey: string;
      const date = new Date(point.date);

      if (unitPeriod === 'week') {
        // Get Monday of the week (ISO week starts on Monday)
        const day = date.getUTCDay();
        const diff = date.getUTCDate() - day + (day === 0 ? -6 : 1);
        const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), diff));
        periodKey = monday.toISOString().substring(0, 10);
      } else {
        // month - first day of month
        periodKey = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-01`;
      }

      if (!groups.has(periodKey)) {
        groups.set(periodKey, []);
      }
      groups.get(periodKey)!.push(point);
    }

    // Convert to array and compute aggregates
    return Array.from(groups.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([periodKey, points]) => {
        const totalRevenue = points.reduce((sum, p) => sum + p.revenue, 0);
        const totalDiscount = points.reduce((sum, p) => sum + p.discount, 0);
        const totalQuantity = points.reduce((sum, p) => sum + p.quantity, 0);
        const totalOrders = points.reduce((sum, p) => sum + p.orders, 0);
        const discountPercent = totalRevenue > 0
          ? Math.round((totalDiscount / totalRevenue) * 10000) / 100
          : 0;

        return {
          date: periodKey,
          revenue: Math.round(totalRevenue * 100) / 100,
          discount: Math.round(totalDiscount * 100) / 100,
          discountPercent,
          quantity: totalQuantity,
          orders: totalOrders,
        };
      });
  }, [chartData, unitPeriod]);

  // Sort families by revenue
  const sortedFamilies = useMemo(() => {
    if (!data?.familyBreakdown) return [];
    return Object.entries(data.familyBreakdown)
      .map(([family, stats]) => ({ family, ...stats }))
      .sort((a, b) => b.revenue - a.revenue);
  }, [data]);

  // Toggle family expansion
  const toggleFamily = (family: string) => {
    setExpandedFamilies(prev => {
      const next = new Set(prev);
      if (next.has(family)) {
        next.delete(family);
      } else {
        next.add(family);
      }
      return next;
    });
  };

  // Toggle category expansion (uses family:category as key)
  const toggleCategory = (family: string, category: string) => {
    const key = `${family}:${category}`;
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  // Navigate to product detail
  const handleProductClick = (sku: string) => {
    navigate(`/products/${encodeURIComponent(sku)}`);
  };

  if (!hasAccount) {
    return (
      <div className="p-6">
        <div className="text-center py-12">
          <Building2 className="h-12 w-12 mx-auto text-gray-400 mb-4" />
          <h2 className="text-xl font-semibold text-gray-700 mb-2">No Account Selected</h2>
          <p className="text-gray-500">Please select an account to view company data.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/companies')}
            className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-3">
            <Building2 className="h-8 w-8 text-blue-600" />
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{decodedCompanyName}</h1>
              <p className="text-sm text-gray-500">Company Analytics</p>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3">
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
          {/* Period Selector */}
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
            {TIME_RANGES.map((range) => (
              <button
                key={range.label}
                onClick={() => setSelectedTimeRange(range.days)}
                className={`px-3 py-1 text-sm rounded-md transition-colors ${
                  selectedTimeRange === range.days
                    ? 'bg-white text-blue-600 shadow-sm font-medium'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                {range.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && (
        <ErrorMessage
          message="Failed to load company data"
          onRetry={refetch}
        />
      )}

      {isLoading ? (
        <Loading message="Loading company data..." />
      ) : data ? (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-green-100 rounded-lg">
                    <TrendingUp className="h-5 w-5 text-green-600" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Total Revenue</p>
                    <p className="text-xl font-bold">
                      <Revenue value={data.totals.revenue} symbol={currencySymbol} />
                    </p>
                    <p className="text-xs text-gray-400">
                      {currencySymbol}{(data.totals.revenue / (data.dateRange.days || 1)).toFixed(0)}/day avg
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-orange-100 rounded-lg">
                    <Percent className="h-5 w-5 text-orange-600" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Discount Rate</p>
                    <p className="text-xl font-bold">{data.totals.discountPercent.toFixed(1)}%</p>
                    <p className="text-xs text-gray-400">
                      {currencySymbol}{data.totals.discount.toFixed(2)} total
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-100 rounded-lg">
                    <ShoppingCart className="h-5 w-5 text-blue-600" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Total Orders</p>
                    <p className="text-xl font-bold">{data.totals.orders.toLocaleString()}</p>
                    <p className="text-xs text-gray-400">
                      {currencySymbol}{data.totals.avgOrderValue.toFixed(2)} avg value
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-purple-100 rounded-lg">
                    <Package className="h-5 w-5 text-purple-600" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Units Sold</p>
                    <p className="text-xl font-bold">{data.totals.quantity.toLocaleString()}</p>
                    <p className="text-xs text-gray-400">
                      {(data.totals.quantity / (data.totals.orders || 1)).toFixed(1)} per order
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Sales Over Time Chart */}
          {aggregatedChartData.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>
                  {viewMode === 'revenue' ? 'Revenue' : 'Units'} & Discount Over Time
                  {unitPeriod !== 'day' && ` (by ${unitPeriod})`}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={350}>
                  <LineChart data={aggregatedChartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 12 }}
                      tickFormatter={(value) => {
                        const date = new Date(value);
                        if (unitPeriod === 'month') {
                          return date.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
                        } else if (unitPeriod === 'week') {
                          return `W${date.getDate()}/${date.getMonth() + 1}`;
                        }
                        return `${date.getDate()}/${date.getMonth() + 1}`;
                      }}
                    />
                    <YAxis
                      yAxisId="primary"
                      tick={{ fontSize: 12 }}
                      tickFormatter={(value) =>
                        viewMode === 'revenue' ? `${currencySymbol}${value}` : String(value)
                      }
                    />
                    <YAxis
                      yAxisId="percent"
                      orientation="right"
                      tick={{ fontSize: 12 }}
                      tickFormatter={(value) => `${value}%`}
                      domain={[0, 'auto']}
                    />
                    <Tooltip
                      content={({ active, payload, label }) => {
                        if (!active || !payload || !payload.length || !label) return null;
                        const dataPoint = payload[0]?.payload;
                        const date = new Date(String(label));
                        let dateLabel: string;
                        if (unitPeriod === 'week') {
                          const endOfWeek = new Date(date);
                          endOfWeek.setDate(endOfWeek.getDate() + 6);
                          dateLabel = `Week of ${date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} - ${endOfWeek.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`;
                        } else if (unitPeriod === 'month') {
                          dateLabel = date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
                        } else {
                          dateLabel = date.toLocaleDateString();
                        }
                        return (
                          <div className="bg-white border rounded-lg shadow-lg p-3">
                            <p className="font-medium mb-2">{dateLabel}</p>
                            <div className="space-y-1 text-sm">
                              <p className="flex justify-between gap-4">
                                <span style={{ color: CHART_COLORS.revenue }}>Revenue:</span>
                                <span className="font-medium">{currencySymbol}{dataPoint?.revenue?.toFixed(2)}</span>
                              </p>
                              <p className="flex justify-between gap-4">
                                <span style={{ color: CHART_COLORS.discount }}>Discount:</span>
                                <span className="font-medium">
                                  {currencySymbol}{dataPoint?.discount?.toFixed(2)} ({dataPoint?.discountPercent?.toFixed(1)}%)
                                </span>
                              </p>
                              <p className="flex justify-between gap-4">
                                <span style={{ color: CHART_COLORS.quantity }}>Units:</span>
                                <span className="font-medium">{dataPoint?.quantity?.toLocaleString()}</span>
                              </p>
                              <p className="flex justify-between gap-4">
                                <span style={{ color: CHART_COLORS.orders }}>Orders:</span>
                                <span className="font-medium">{dataPoint?.orders?.toLocaleString()}</span>
                              </p>
                            </div>
                          </div>
                        );
                      }}
                    />
                    <Legend />
                    <Line
                      yAxisId="primary"
                      type="monotone"
                      dataKey={viewMode === 'revenue' ? 'revenue' : 'quantity'}
                      stroke={viewMode === 'revenue' ? CHART_COLORS.revenue : CHART_COLORS.quantity}
                      name={viewMode === 'revenue' ? 'Revenue' : 'Units'}
                      strokeWidth={2}
                      dot={false}
                    />
                    <Line
                      yAxisId="percent"
                      type="monotone"
                      dataKey="discountPercent"
                      stroke={CHART_COLORS.discount}
                      name="Discount %"
                      strokeWidth={2}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* Family/Category Breakdown */}
          {sortedFamilies.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Product Family Breakdown</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-3 px-4 font-medium text-gray-500 w-8"></th>
                        <th className="text-left py-3 px-4 font-medium text-gray-500">Family / Category</th>
                        <th className="text-right py-3 px-4 font-medium text-gray-500">Revenue</th>
                        <th className="text-right py-3 px-4 font-medium text-gray-500">% of Total</th>
                        <th className="text-right py-3 px-4 font-medium text-gray-500">Units</th>
                        <th className="text-right py-3 px-4 font-medium text-gray-500">Orders</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedFamilies.map((familyData, index) => {
                        const isExpanded = expandedFamilies.has(familyData.family);
                        const hasCategories = Object.keys(familyData.categories).length > 0;
                        const percentOfTotal = data.totals.revenue > 0
                          ? (familyData.revenue / data.totals.revenue) * 100
                          : 0;
                        const color = FAMILY_COLORS[index % FAMILY_COLORS.length];

                        return (
                          <>
                            <tr
                              key={familyData.family}
                              className={`border-b hover:bg-gray-50 ${hasCategories ? 'cursor-pointer' : ''}`}
                              onClick={() => hasCategories && toggleFamily(familyData.family)}
                            >
                              <td className="py-3 px-4">
                                {hasCategories && (
                                  isExpanded ? (
                                    <ChevronDown className="h-4 w-4 text-gray-400" />
                                  ) : (
                                    <ChevronRight className="h-4 w-4 text-gray-400" />
                                  )
                                )}
                              </td>
                              <td className="py-3 px-4">
                                <div className="flex items-center gap-2">
                                  <div
                                    className="w-3 h-3 rounded-full"
                                    style={{ backgroundColor: color }}
                                  />
                                  <span className="font-medium">{familyData.family}</span>
                                </div>
                              </td>
                              <td className="text-right py-3 px-4 font-medium">
                                <Revenue value={familyData.revenue} symbol={currencySymbol} />
                              </td>
                              <td className="text-right py-3 px-4 text-gray-500">
                                {percentOfTotal.toFixed(1)}%
                              </td>
                              <td className="text-right py-3 px-4">{familyData.quantity.toLocaleString()}</td>
                              <td className="text-right py-3 px-4">{familyData.orders.toLocaleString()}</td>
                            </tr>
                            {/* Category rows */}
                            {isExpanded && Object.entries(familyData.categories)
                              .sort(([, a], [, b]) => b.revenue - a.revenue)
                              .map(([category, catData]) => {
                                const catPercent = data.totals.revenue > 0
                                  ? (catData.revenue / data.totals.revenue) * 100
                                  : 0;
                                const categoryKey = `${familyData.family}:${category}`;
                                const isCategoryExpanded = expandedCategories.has(categoryKey);
                                const hasProducts = catData.products && catData.products.length > 0;

                                return (
                                  <>
                                    <tr
                                      key={categoryKey}
                                      className={`border-b bg-gray-50 ${hasProducts ? 'cursor-pointer hover:bg-gray-100' : ''}`}
                                      onClick={() => hasProducts && toggleCategory(familyData.family, category)}
                                    >
                                      <td className="py-2 px-4">
                                        {hasProducts && (
                                          isCategoryExpanded ? (
                                            <ChevronDown className="h-4 w-4 text-gray-400 ml-4" />
                                          ) : (
                                            <ChevronRight className="h-4 w-4 text-gray-400 ml-4" />
                                          )
                                        )}
                                      </td>
                                      <td className="py-2 px-4 pl-12 text-gray-600">{category}</td>
                                      <td className="text-right py-2 px-4 text-gray-600">
                                        <Revenue value={catData.revenue} symbol={currencySymbol} />
                                      </td>
                                      <td className="text-right py-2 px-4 text-gray-500">
                                        {catPercent.toFixed(1)}%
                                      </td>
                                      <td className="text-right py-2 px-4 text-gray-600">{catData.quantity.toLocaleString()}</td>
                                      <td className="text-right py-2 px-4 text-gray-600">{catData.orders.toLocaleString()}</td>
                                    </tr>
                                    {/* Product rows within category */}
                                    {isCategoryExpanded && catData.products.map((product) => {
                                      const productPercent = data.totals.revenue > 0
                                        ? (product.revenue / data.totals.revenue) * 100
                                        : 0;
                                      return (
                                        <tr
                                          key={`${categoryKey}-${product.sku}`}
                                          className="border-b bg-gray-100 hover:bg-gray-200 cursor-pointer"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handleProductClick(product.sku);
                                          }}
                                        >
                                          <td className="py-2 px-4"></td>
                                          <td className="py-2 px-4 pl-20">
                                            <div>
                                              <span className="font-mono text-xs text-blue-600 hover:underline">{product.sku}</span>
                                              <p className="text-xs text-gray-500 truncate max-w-xs" title={product.title}>{product.title}</p>
                                            </div>
                                          </td>
                                          <td className="text-right py-2 px-4 text-gray-600">
                                            <Revenue value={product.revenue} symbol={currencySymbol} />
                                          </td>
                                          <td className="text-right py-2 px-4 text-gray-500">
                                            {productPercent.toFixed(1)}%
                                          </td>
                                          <td className="text-right py-2 px-4 text-gray-600">{product.quantity.toLocaleString()}</td>
                                          <td className="text-right py-2 px-4 text-gray-600">{product.orders.toLocaleString()}</td>
                                        </tr>
                                      );
                                    })}
                                  </>
                                );
                              })}
                          </>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Top Products */}
          {data.topProducts.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Top Products Purchased</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-3 px-4 font-medium text-gray-500">#</th>
                        <th className="text-left py-3 px-4 font-medium text-gray-500">SKU</th>
                        <th className="text-left py-3 px-4 font-medium text-gray-500">Title</th>
                        <th className="text-left py-3 px-4 font-medium text-gray-500">Brand</th>
                        <th className="text-left py-3 px-4 font-medium text-gray-500">Family</th>
                        <th className="text-right py-3 px-4 font-medium text-gray-500">Revenue</th>
                        <th className="text-right py-3 px-4 font-medium text-gray-500">Units</th>
                        <th className="text-right py-3 px-4 font-medium text-gray-500">Orders</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.topProducts.slice(0, 25).map((product, index) => (
                        <tr
                          key={product.sku}
                          className="border-b hover:bg-gray-50 cursor-pointer"
                          onClick={() => handleProductClick(product.sku)}
                        >
                          <td className="py-3 px-4 text-gray-400">{index + 1}</td>
                          <td className="py-3 px-4">
                            <span className="font-mono text-sm text-blue-600 hover:text-blue-800 hover:underline">
                              {product.sku}
                            </span>
                          </td>
                          <td className="py-3 px-4 max-w-xs truncate" title={product.title}>
                            {product.title}
                          </td>
                          <td className="py-3 px-4 text-gray-500">{product.brand}</td>
                          <td className="py-3 px-4 text-gray-500">{product.family || '-'}</td>
                          <td className="text-right py-3 px-4 font-medium">
                            <Revenue value={product.revenue} symbol={currencySymbol} />
                          </td>
                          <td className="text-right py-3 px-4">{product.quantity.toLocaleString()}</td>
                          <td className="text-right py-3 px-4">{product.orders.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      ) : null}
    </div>
  );
}
