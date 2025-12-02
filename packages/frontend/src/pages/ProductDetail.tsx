import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Package, Layers, PoundSterling, Truck, Calculator, Pencil, Save, X, ShoppingCart, Calendar } from 'lucide-react';
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
import { historyApi, analyticsApi, productsApi } from '../api';
import { Card, CardHeader, CardTitle, CardContent } from '../components/Card';
import Loading from '../components/Loading';
import ErrorMessage from '../components/ErrorMessage';
import Badge from '../components/Badge';
import Button from '../components/Button';

// Margin thresholds
const MARGIN_THRESHOLDS = {
  RED: 10,      // < 10% is red
  AMBER: 20,    // 10-20% is amber
  // > 20% is green
};

// Days of stock thresholds
const STOCK_DAYS_THRESHOLDS = {
  RED: 14,      // < 14 days is red (low stock warning)
  AMBER: 30,    // 14-30 days is amber
  GREEN: 90,    // 30-90 days is green
  // > 90 days is blue/grey (potential overstock)
};

// Helper to get margin color class
const getMarginColor = (margin: number): string => {
  if (margin < MARGIN_THRESHOLDS.RED) return 'text-red-600';
  if (margin < MARGIN_THRESHOLDS.AMBER) return 'text-amber-600';
  return 'text-green-600';
};

const getMarginBgColor = (margin: number): string => {
  if (margin < MARGIN_THRESHOLDS.RED) return 'bg-red-100';
  if (margin < MARGIN_THRESHOLDS.AMBER) return 'bg-amber-100';
  return 'bg-green-100';
};

// Helper to get days of stock color class
const getDaysOfStockColor = (days: number): string => {
  if (days < STOCK_DAYS_THRESHOLDS.RED) return 'text-red-600';
  if (days < STOCK_DAYS_THRESHOLDS.AMBER) return 'text-amber-600';
  if (days < STOCK_DAYS_THRESHOLDS.GREEN) return 'text-green-600';
  return 'text-blue-600'; // > 90 days potential overstock
};

export default function ProductDetail() {
  const { sku } = useParams<{ sku: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [isEditing, setIsEditing] = useState(false);
  const [editCost, setEditCost] = useState('');
  const [editDelivery, setEditDelivery] = useState('');

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['history', sku],
    queryFn: () => historyApi.get(sku!),
    enabled: !!sku,
  });

  // Fetch sales data for avg daily calculations (180 days like Products page)
  const { data: salesData } = useQuery({
    queryKey: ['sales', 180],
    queryFn: () => analyticsApi.sales(180),
  });

  const updateMutation = useMutation({
    mutationFn: (updates: { costPrice?: number; deliveryCost?: number }) =>
      productsApi.update(sku!, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['history', sku] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      setIsEditing(false);
    },
  });

  const handleEdit = () => {
    setEditCost(data?.product?.costPrice?.toString() || '');
    setEditDelivery(data?.product?.deliveryCost?.toString() || '');
    setIsEditing(true);
  };

  const handleSave = () => {
    updateMutation.mutate({
      costPrice: editCost ? parseFloat(editCost) : undefined,
      deliveryCost: editDelivery ? parseFloat(editDelivery) : undefined,
    });
  };

  const handleCancel = () => {
    setIsEditing(false);
    setEditCost('');
    setEditDelivery('');
  };

  if (isLoading) {
    return (
      <div className="p-8">
        <Loading message="Loading product history..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <ErrorMessage
          message={error instanceof Error ? error.message : 'Failed to load product history'}
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  const product = data?.product;
  const history = data?.history || [];

  // Prepare chart data - show all metrics on one chart
  const chartData = history.map((record) => ({
    date: record.date,
    price: record.price,
    stock: record.stockLevel,
    sales: record.dailySales,
    revenue: record.dailyRevenue,
    margin: record.margin,
  }));

  // Get sales data for this SKU from the 180-day sales query
  const salesDays = salesData?.days || 180;
  const skuSales = sku && salesData?.sales ? salesData.sales[sku] : null;
  const avgDailySales = skuSales ? skuSales.quantity / salesDays : 0;
  const avgDailyRevenue = skuSales ? skuSales.revenue / salesDays : 0;

  // Calculate product metrics (same as Products page)
  // When editing, use the edit values for live preview; otherwise use saved values
  const priceExVat = (product?.currentPrice || 0) / 1.2;
  const twentyPercent = priceExVat * 0.2;
  const costPrice = isEditing && editCost !== '' ? parseFloat(editCost) || 0 : (product?.costPrice || 0);
  const deliveryCost = isEditing && editDelivery !== '' ? parseFloat(editDelivery) || 0 : (product?.deliveryCost || 0);
  // PPO = Profit Per Order (Price ex VAT minus all costs)
  const ppo = priceExVat - twentyPercent - deliveryCost - costPrice;
  const margin = priceExVat > 0 ? (ppo / priceExVat) * 100 : 0;
  const stockLevel = product?.stockLevel || 0;
  const daysOfStock = avgDailySales > 0 ? Math.round(stockLevel / avgDailySales) : null;

  return (
    <div className="p-6">
      <div>
        {/* Header */}
        <div className="mb-4">
          <button
            onClick={() => navigate('/products')}
            className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Products
          </button>
          <div className="flex items-start gap-4">
            {product?.imageUrl ? (
              <img
                src={product.imageUrl}
                alt={product.title}
                className="w-16 h-16 object-cover rounded-lg border border-gray-200 shadow-sm"
              />
            ) : (
              <div className="w-16 h-16 bg-gray-100 rounded-lg border border-gray-200 flex items-center justify-center">
                <Package className="h-8 w-8 text-gray-400" />
              </div>
            )}
            <div className="flex-1">
              <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold text-gray-900">{sku}</h1>
                <Badge>{product?.brand || 'Unknown'}</Badge>
              </div>
              {product && (
                <p className="mt-1 text-sm text-gray-500">{product.title}</p>
              )}
            </div>
          </div>
        </div>

        {/* Three-Section Metrics Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4 items-stretch">
          {/* Section 1: Cost Inputs (Editable) */}
          <Card className="border-2 border-dashed border-gray-200 flex flex-col">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-gray-500 uppercase tracking-wide">Cost Inputs</CardTitle>
              {!isEditing ? (
                <Button variant="ghost" size="sm" onClick={handleEdit} className="text-blue-600 hover:text-blue-700">
                  <Pencil className="h-4 w-4 mr-1" />
                  Edit
                </Button>
              ) : (
                <div className="flex gap-2">
                  <Button variant="primary" size="sm" onClick={handleSave} disabled={updateMutation.isPending}>
                    <Save className="h-4 w-4 mr-1" />
                    Save
                  </Button>
                  <Button variant="ghost" size="sm" onClick={handleCancel}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </CardHeader>
            <CardContent className="pt-0 flex-1 flex flex-col justify-center">
              <div className="space-y-4">
                {/* Cost */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-orange-100 rounded-lg">
                      <Calculator className="h-5 w-5 text-orange-600" />
                    </div>
                    <span className="text-sm text-gray-600">Cost</span>
                  </div>
                  {isEditing ? (
                    <div className="flex items-center gap-1 bg-gray-50 border border-gray-300 rounded-lg px-3 py-2">
                      <span className="text-gray-500">£</span>
                      <input
                        type="number"
                        step="0.01"
                        value={editCost}
                        onChange={(e) => setEditCost(e.target.value)}
                        className="w-20 bg-transparent outline-none text-right font-semibold"
                        placeholder="0.00"
                      />
                      <Pencil className="h-3 w-3 text-gray-400 ml-1" />
                    </div>
                  ) : (
                    <p className={`text-xl font-semibold ${!costPrice ? 'text-red-500' : ''}`}>
                      {costPrice ? `£${costPrice.toFixed(2)}` : 'Not set'}
                    </p>
                  )}
                </div>
                {/* Delivery */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-cyan-100 rounded-lg">
                      <Truck className="h-5 w-5 text-cyan-600" />
                    </div>
                    <span className="text-sm text-gray-600">Delivery</span>
                  </div>
                  {isEditing ? (
                    <div className="flex items-center gap-1 bg-gray-50 border border-gray-300 rounded-lg px-3 py-2">
                      <span className="text-gray-500">£</span>
                      <input
                        type="number"
                        step="0.01"
                        value={editDelivery}
                        onChange={(e) => setEditDelivery(e.target.value)}
                        className="w-20 bg-transparent outline-none text-right font-semibold"
                        placeholder="0.00"
                      />
                      <Pencil className="h-3 w-3 text-gray-400 ml-1" />
                    </div>
                  ) : (
                    <p className="text-xl font-semibold">
                      {deliveryCost ? `£${deliveryCost.toFixed(2)}` : '-'}
                    </p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Section 2: Pricing & Margin (Calculated) */}
          <Card className="flex flex-col">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-gray-500 uppercase tracking-wide">Pricing & Margin</CardTitle>
            </CardHeader>
            <CardContent className="pt-0 flex-1">
              <div className="flex gap-6 h-full items-center">
                {/* Left: Pricing breakdown */}
                <div className="flex-1 space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-600">Price ex VAT</span>
                    <span className="font-semibold">£{priceExVat.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-600">20% Costs</span>
                    <span className="font-semibold text-gray-500">-£{twentyPercent.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-600">Cost + Delivery</span>
                    <span className={`font-semibold ${!costPrice && !deliveryCost ? 'text-gray-400' : 'text-gray-500'}`}>
                      {costPrice || deliveryCost ? `-£${(costPrice + deliveryCost).toFixed(2)}` : '-'}
                    </span>
                  </div>
                  <div className="border-t border-gray-200 pt-2 flex justify-between items-center">
                    <span className="text-sm text-gray-600 font-medium">PPO</span>
                    <span className="font-semibold">{costPrice ? `£${ppo.toFixed(2)}` : '-'}</span>
                  </div>
                </div>
                {/* Right: Hero Margin */}
                <div className={`flex flex-col items-center justify-center p-4 rounded-xl ${getMarginBgColor(margin)} min-w-[120px]`}>
                  <span className="text-xs text-gray-500 uppercase tracking-wide mb-1">Margin</span>
                  <span className={`text-3xl font-bold ${getMarginColor(margin)}`}>
                    {costPrice ? `${margin.toFixed(1)}%` : '-'}
                  </span>
                  {costPrice > 0 && (
                    <span className="text-xs text-gray-500 mt-1">
                      {margin < MARGIN_THRESHOLDS.RED ? 'Low' : margin < MARGIN_THRESHOLDS.AMBER ? 'Fair' : 'Good'}
                    </span>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Section 3: Sales Performance (Read-only) */}
        <Card className="mb-4">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500 uppercase tracking-wide">Sales Performance</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 py-1">
              {/* Avg Daily Sales */}
              <div className="flex items-center gap-3 p-2">
                <div className="p-2 bg-purple-100 rounded-lg flex-shrink-0">
                  <ShoppingCart className="h-5 w-5 text-purple-600" />
                </div>
                <div className="min-w-0">
                  <p className="text-xl font-semibold">{avgDailySales.toFixed(2)}</p>
                  <p className="text-xs text-gray-500">Daily Sales</p>
                </div>
              </div>

              {/* Avg Daily Revenue */}
              <div className="flex items-center gap-3 p-2">
                <div className="p-2 bg-yellow-100 rounded-lg flex-shrink-0">
                  <PoundSterling className="h-5 w-5 text-yellow-600" />
                </div>
                <div className="min-w-0">
                  <p className="text-xl font-semibold">£{avgDailyRevenue.toFixed(2)}</p>
                  <p className="text-xs text-gray-500">Daily Revenue</p>
                </div>
              </div>

              {/* Stock */}
              <div className="flex items-center gap-3 p-2">
                <div className="p-2 bg-green-100 rounded-lg flex-shrink-0">
                  <Layers className="h-5 w-5 text-green-600" />
                </div>
                <div className="min-w-0">
                  <p className={`text-xl font-semibold ${stockLevel === 0 ? 'text-red-600' : stockLevel < 10 ? 'text-yellow-600' : ''}`}>
                    {stockLevel}
                  </p>
                  <p className="text-xs text-gray-500">Stock</p>
                </div>
              </div>

              {/* Days of Stock */}
              <div className="flex items-center gap-3 p-2">
                <div className="p-2 bg-blue-100 rounded-lg flex-shrink-0">
                  <Calendar className="h-5 w-5 text-blue-600" />
                </div>
                <div className="min-w-0">
                  <p className={`text-xl font-semibold ${daysOfStock !== null ? getDaysOfStockColor(daysOfStock) : ''}`}>
                    {daysOfStock !== null ? `~${daysOfStock}` : '-'}
                  </p>
                  <p className="text-xs text-gray-500">Days of Stock</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Chart */}
      <div>
        <Card>
          <CardHeader>
            <CardTitle>Historical Data ({data?.fromDate} to {data?.toDate})</CardTitle>
          </CardHeader>
          <CardContent>
            {history.length === 0 ? (
              <div className="flex items-center justify-center h-64 text-gray-500">
                No history data available yet. Data will be recorded from the daily sync.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={400}>
                <LineChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 12 }}
                    tickFormatter={(value) => {
                      const date = new Date(value);
                      return `${date.getDate()}/${date.getMonth() + 1}`;
                    }}
                  />
                  <YAxis yAxisId="left" tick={{ fontSize: 12 }} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 12 }} />
                  <Tooltip
                    labelFormatter={(label) => {
                      const date = new Date(label);
                      return date.toLocaleDateString('en-GB', {
                        weekday: 'short',
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      });
                    }}
                    formatter={(value: number, name: string) => {
                      if (name === 'price' || name === 'revenue') {
                        return [`£${value.toFixed(2)}`, name.charAt(0).toUpperCase() + name.slice(1)];
                      }
                      if (name === 'margin') {
                        return [`${value.toFixed(1)}%`, 'Margin'];
                      }
                      return [value, name.charAt(0).toUpperCase() + name.slice(1)];
                    }}
                  />
                  <Legend />
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="price"
                    stroke="#3b82f6"
                    strokeWidth={2}
                    dot={false}
                    name="Price (£)"
                  />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="stock"
                    stroke="#10b981"
                    strokeWidth={2}
                    dot={false}
                    name="Stock"
                  />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="sales"
                    stroke="#8b5cf6"
                    strokeWidth={2}
                    dot={false}
                    name="Daily Sales"
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
