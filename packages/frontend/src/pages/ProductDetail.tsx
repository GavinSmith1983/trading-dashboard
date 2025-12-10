import { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Package, Layers, PoundSterling, Truck, Calculator, Pencil, Save, X, ShoppingCart, Calendar, Globe, Plus, Trash2, RefreshCw, ExternalLink, AlertCircle, Tag, TrendingUp, TrendingDown, Minus, CheckCircle, XCircle, Clock, ArrowRight, History, ChevronDown, ChevronUp, User } from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ComposedChart,
  Bar,
  ReferenceLine,
} from 'recharts';
import { historyApi, productsApi, competitorsApi, proposalsApi, channelsApi, pricesApi, CompetitorUrl, ChannelSalesData, PriceChangeRecord } from '../api';
import { useAccountQuery } from '../hooks/useAccountQuery';
import { useAccount } from '../context/AccountContext';
import type { PriceProposal, Channel } from '../types';
import { Card, CardHeader, CardTitle, CardContent } from '../components/Card';
import Loading from '../components/Loading';
import ErrorMessage from '../components/ErrorMessage';
import Badge from '../components/Badge';
import Button from '../components/Button';

// Time range options for chart - 'days' can be a number or a special string for dynamic ranges
type TimeRangeOption = { label: string; days: number | 'thisMonth' | 'lastMonth' };

const TIME_RANGES: TimeRangeOption[] = [
  { label: '1W', days: 7 },
  { label: 'This Month', days: 'thisMonth' },
  { label: 'Last Month', days: 'lastMonth' },
  { label: '1M', days: 30 },
  { label: '3M', days: 90 },
  { label: '6M', days: 180 },
  { label: '12M', days: 365 },
  { label: '18M', days: 548 },
];

// Helper to calculate date range for API call
function getDateRangeForHistory(range: number | 'thisMonth' | 'lastMonth'): { from: string; to: string } {
  const now = new Date();
  const formatDate = (d: Date) => d.toISOString().substring(0, 10);

  if (typeof range === 'number') {
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - range);
    return { from: formatDate(fromDate), to: formatDate(now) };
  }

  if (range === 'thisMonth') {
    // First day of this month to today
    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from: formatDate(firstOfMonth), to: formatDate(now) };
  } else if (range === 'lastMonth') {
    // First day of last month to last day of last month
    const firstOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0); // Day 0 of this month = last day of previous
    return { from: formatDate(firstOfLastMonth), to: formatDate(lastOfLastMonth) };
  }

  // Default: last 30 days
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - 30);
  return { from: formatDate(fromDate), to: formatDate(now) };
}

// Price change annotation type for chart
interface PriceChangeAnnotation {
  date: string;
  channel: string;
  previousPrice: number;
  newPrice: number;
  changedBy: string;
  reason?: string;
}

// Custom label component for price change reference lines with tooltip
const PriceChangeLabel = ({
  viewBox,
  annotation,
  currencySymbol = '£'
}: {
  viewBox?: { x?: number; y?: number };
  annotation: PriceChangeAnnotation;
  currencySymbol?: string;
}) => {
  const [showTooltip, setShowTooltip] = useState(false);
  const x = viewBox?.x ?? 0;
  const priceChange = annotation.newPrice - annotation.previousPrice;
  const isIncrease = priceChange > 0;

  return (
    <g>
      {/* Clickable/hoverable area */}
      <circle
        cx={x}
        cy={15}
        r={8}
        fill="#f97316"
        stroke="#fff"
        strokeWidth={1.5}
        style={{ cursor: 'pointer' }}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
      />
      <text
        x={x}
        y={19}
        textAnchor="middle"
        fill="#fff"
        fontSize={10}
        fontWeight={700}
        style={{ pointerEvents: 'none' }}
      >
        {isIncrease ? '↑' : '↓'}
      </text>

      {/* Tooltip */}
      {showTooltip && (
        <foreignObject x={x - 100} y={28} width={200} height={120}>
          <div
            style={{
              background: 'white',
              border: '1px solid #e5e7eb',
              borderRadius: '6px',
              padding: '8px 10px',
              boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)',
              fontSize: '12px',
              lineHeight: '1.4',
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: '4px', color: '#f97316' }}>
              Price Change - {annotation.channel}
            </div>
            <div style={{ color: '#6b7280' }}>
              {currencySymbol}{annotation.previousPrice.toFixed(2)} → {currencySymbol}{annotation.newPrice.toFixed(2)}
              <span style={{
                marginLeft: '6px',
                color: isIncrease ? '#22c55e' : '#ef4444',
                fontWeight: 500
              }}>
                ({isIncrease ? '+' : ''}{currencySymbol}{priceChange.toFixed(2)})
              </span>
            </div>
            <div style={{ color: '#9ca3af', marginTop: '4px' }}>
              By: {annotation.changedBy}
            </div>
            {annotation.reason && (
              <div style={{ color: '#9ca3af', fontStyle: 'italic' }}>
                {annotation.reason}
              </div>
            )}
          </div>
        </foreignObject>
      )}
    </g>
  );
};

// Channel colors for stacked bar chart - includes variations of channel names
const CHANNEL_COLORS: Record<string, string> = {
  // Amazon variations
  'Amazon': '#FF9900',
  'amazon': '#FF9900',
  'AMAZON': '#FF9900',
  'Amazon UK': '#FF9900',
  'Amazon.co.uk': '#FF9900',
  // eBay variations
  'eBay': '#0064D2',
  'ebay': '#0064D2',
  'EBAY': '#0064D2',
  'eBay UK': '#0064D2',
  // B&Q variations
  'B&Q': '#F77F00',
  'b&q': '#F77F00',
  'B&Q Marketplace': '#F77F00',
  'BandQ': '#F77F00',
  // ManoMano variations
  'ManoMano': '#00A0DC',
  'manomano': '#00A0DC',
  'Mano Mano': '#00A0DC',
  'ManoMano UK': '#00A0DC',
  // Shopify variations
  'Shopify': '#96BF48',
  'shopify': '#96BF48',
  // Other common channels
  'OnBuy': '#E91E63',
  'Wayfair': '#7B1FA2',
  'Unknown': '#9CA3AF',
};

// Fallback colors for channels not in the list
const FALLBACK_COLORS = [
  '#8884d8', // Purple
  '#82ca9d', // Green
  '#ffc658', // Yellow
  '#ff7c43', // Orange
  '#a4de6c', // Light green
  '#d0ed57', // Lime
  '#83a6ed', // Light blue
  '#8dd1e1', // Cyan
];

// Get color for a channel, with fallback for unknown channels
const getChannelColor = (channel: string, index: number): string => {
  return CHANNEL_COLORS[channel] || FALLBACK_COLORS[index % FALLBACK_COLORS.length];
};

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
  const { accountId } = useAccountQuery();
  const { currentAccount, currencySymbol } = useAccount();

  // Check if this account uses single pricing mode
  const isSinglePriceMode = currentAccount?.settings?.pricingMode === 'single';

  const [isEditing, setIsEditing] = useState(false);
  const [editCost, setEditCost] = useState('');
  const [editDelivery, setEditDelivery] = useState('');
  const [isEditingPrice, setIsEditingPrice] = useState(false);
  const [editPrice, setEditPrice] = useState('');
  const [selectedChannel, setSelectedChannel] = useState<string | null>(null); // null = unified view
  const [newCompetitorUrl, setNewCompetitorUrl] = useState('');
  const [isAddingUrl, setIsAddingUrl] = useState(false);
  const [hiddenLines, setHiddenLines] = useState<Set<string>>(new Set());
  const [selectedTimeRange, setSelectedTimeRange] = useState<number | 'thisMonth' | 'lastMonth'>(180); // Default 6 months
  const [unitPeriod, setUnitPeriod] = useState<'day' | 'week' | 'month'>('day'); // Aggregation period
  const [isPriceHistoryExpanded, setIsPriceHistoryExpanded] = useState(false); // Price history visibility

  // Calculate date range based on selected time range
  const dateRange = useMemo(() => {
    return getDateRangeForHistory(selectedTimeRange);
  }, [selectedTimeRange]);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['history', accountId, sku, dateRange.from, dateRange.to],
    queryFn: () => historyApi.get(sku!, dateRange.from, dateRange.to, true), // Include channel sales
    enabled: !!sku,
  });

  // Calculate sales data from history (no need for separate API call)

  // Fetch proposals for this SKU
  const { data: proposalsData } = useQuery({
    queryKey: ['proposals', 'by-sku', accountId, sku],
    queryFn: () => proposalsApi.list({ search: sku, pageSize: 20 }),
    enabled: !!sku,
  });

  // Fetch price change history (always fetch for chart annotations)
  const { data: priceHistoryData, isLoading: isPriceHistoryLoading } = useQuery({
    queryKey: ['price-history', accountId, sku],
    queryFn: () => pricesApi.getHistory(sku!, 100),
    enabled: !!sku,
  });

  // Fetch channels for per-channel pricing calculations
  const { data: channelsData } = useQuery({
    queryKey: ['channels', accountId],
    queryFn: () => channelsApi.list(),
  });

  const updateMutation = useMutation({
    mutationFn: (updates: { costPrice?: number; deliveryCost?: number }) =>
      productsApi.update(sku!, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['history', accountId, sku] });
      queryClient.invalidateQueries({ queryKey: ['products', accountId] });
      setIsEditing(false);
    },
  });

  const addCompetitorMutation = useMutation({
    mutationFn: (url: string) => competitorsApi.addUrl(sku!, url),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['history', accountId, sku] });
      setNewCompetitorUrl('');
      setIsAddingUrl(false);
    },
  });

  const removeCompetitorMutation = useMutation({
    mutationFn: (urlId: string) => competitorsApi.removeUrl(sku!, urlId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['history', accountId, sku] });
    },
  });

  const scrapeCompetitorMutation = useMutation({
    mutationFn: () => competitorsApi.scrapeSingle(sku!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['history', accountId, sku] });
    },
  });

  const updatePriceMutation = useMutation({
    mutationFn: ({ channelId, price }: { channelId: string; price: number }) =>
      pricesApi.updateChannelPrice(sku!, channelId, price),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['history', accountId, sku] });
      queryClient.invalidateQueries({ queryKey: ['products', accountId] });
      queryClient.invalidateQueries({ queryKey: ['price-history', accountId, sku] });
      setIsEditingPrice(false);
      setEditPrice('');
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

  const handleAddCompetitorUrl = () => {
    if (newCompetitorUrl.trim()) {
      addCompetitorMutation.mutate(newCompetitorUrl.trim());
    }
  };

  const handleRemoveCompetitorUrl = (urlId: string) => {
    removeCompetitorMutation.mutate(urlId);
  };

  const handleScrapeCompetitors = () => {
    scrapeCompetitorMutation.mutate();
  };

  // Extract data - these must be before useMemo hooks
  const product = data?.product;
  const history = data?.history || [];
  const channelSales: ChannelSalesData = data?.channelSales || {};

  // Get all unique channels from the channel sales data
  // Must be called before early returns to maintain hook order
  const allChannels = useMemo(() => {
    const channels = new Set<string>();
    Object.values(channelSales).forEach(daySales => {
      Object.keys(daySales).forEach(channel => channels.add(channel));
    });
    return Array.from(channels).sort();
  }, [channelSales]);

  // Prepare chart data - fill in missing days with zeros
  // Must be called before early returns to maintain hook order
  const chartData = useMemo(() => {
    if (history.length === 0 && Object.keys(channelSales).length === 0) return [];

    // Use the selected date range
    const allDates: string[] = [];
    const [startYear, startMonth, startDay] = dateRange.from.split('-').map(Number);
    const [endYear, endMonth, endDay] = dateRange.to.split('-').map(Number);

    // Use UTC dates to avoid timezone shifts
    const current = new Date(Date.UTC(startYear, startMonth - 1, startDay));
    const end = new Date(Date.UTC(endYear, endMonth - 1, endDay));

    while (current <= end) {
      const year = current.getUTCFullYear();
      const month = String(current.getUTCMonth() + 1).padStart(2, '0');
      const day = String(current.getUTCDate()).padStart(2, '0');
      allDates.push(`${year}-${month}-${day}`);
      current.setUTCDate(current.getUTCDate() + 1);
    }

    // Create a map of existing records by date
    const recordMap = new Map(history.map((record) => [record.date, record]));

    // Build chart data - only use actual recorded data, don't fill gaps with assumed values
    return allDates.map((date) => {
      const record = recordMap.get(date);
      const daySales = channelSales[date] || {};

      // Build channel sales fields dynamically
      const channelFields: Record<string, number> = {};
      allChannels.forEach(channel => {
        channelFields[`sales_${channel}`] = daySales[channel]?.quantity || 0;
      });

      // Calculate totals from channel sales (order-lines) - this is the accurate source
      const totalSalesFromChannels = Object.values(daySales).reduce((sum, ch) => sum + (ch.quantity || 0), 0);
      const totalRevenueFromChannels = Object.values(daySales).reduce((sum, ch) => sum + (ch.revenue || 0), 0);
      // Calculate average price as revenue / quantity
      const avgPrice = totalSalesFromChannels > 0
        ? Math.round((totalRevenueFromChannels / totalSalesFromChannels) * 100) / 100
        : null;

      if (record) {
        const lowestCompetitor = record.lowestCompetitorPrice;
        // Stock of 0 from backfilled data means "unknown", not "zero stock"
        // Only show stock if it's > 0 (real data from daily sync)
        const stockValue = record.stockLevel > 0 ? record.stockLevel : null;
        // Use channel sales data for sales/revenue (accurate), fall back to history record
        const salesValue = totalSalesFromChannels > 0 ? totalSalesFromChannels : record.dailySales;
        const revenueValue = totalRevenueFromChannels > 0
          ? Math.round(totalRevenueFromChannels * 100) / 100
          : (record.dailyRevenue > 0 ? Math.round(record.dailyRevenue * 100) / 100 : null);
        // Use avg price from orders if available, otherwise use recorded price
        const priceValue = avgPrice !== null ? avgPrice : Math.round((record.price || 0) * 100) / 100;
        return {
          date: record.date,
          price: priceValue,
          stock: stockValue,
          sales: salesValue,
          revenue: revenueValue,
          margin: Math.round((record.margin || 0) * 100) / 100,
          lowestCompetitor: lowestCompetitor ? Math.round(lowestCompetitor * 100) / 100 : null,
          ...channelFields,
        };
      }
      // No history record for this day - use channel sales data if available
      return {
        date,
        price: avgPrice,
        stock: null,
        sales: totalSalesFromChannels > 0 ? totalSalesFromChannels : null,
        revenue: totalRevenueFromChannels > 0 ? Math.round(totalRevenueFromChannels * 100) / 100 : null,
        margin: null,
        lowestCompetitor: null,
        ...channelFields,
      };
    });
  }, [history, channelSales, allChannels, dateRange]);

  // Aggregate chart data by week or month if selected
  const aggregatedChartData = useMemo(() => {
    if (unitPeriod === 'day' || chartData.length === 0) return chartData;

    // Group data by period
    const groups = new Map<string, typeof chartData>();

    for (const point of chartData) {
      let periodKey: string;
      const date = new Date(point.date);

      if (unitPeriod === 'week') {
        // Get the Monday of the week
        const day = date.getUTCDay();
        const diff = date.getUTCDate() - day + (day === 0 ? -6 : 1);
        const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), diff));
        periodKey = monday.toISOString().substring(0, 10);
      } else {
        // Month - use first of month
        periodKey = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-01`;
      }

      if (!groups.has(periodKey)) {
        groups.set(periodKey, []);
      }
      groups.get(periodKey)!.push(point);
    }

    // Aggregate each group
    return Array.from(groups.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([periodKey, points]) => {
        // For price, margin, stock, lowestCompetitor - use average of non-null values
        // For sales, revenue - sum them up
        const validPrices = points.filter(p => p.price !== null).map(p => p.price as number);
        const validMargins = points.filter(p => p.margin !== null).map(p => p.margin as number);
        const validStocks = points.filter(p => p.stock !== null).map(p => p.stock as number);
        const validCompetitors = points.filter(p => p.lowestCompetitor !== null).map(p => p.lowestCompetitor as number);

        const totalSales = points.reduce((sum, p) => sum + (p.sales || 0), 0);
        const totalRevenue = points.reduce((sum, p) => sum + (p.revenue || 0), 0);

        // Aggregate channel sales
        const channelTotals: Record<string, number> = {};
        for (const channel of allChannels) {
          const key = `sales_${channel}`;
          channelTotals[key] = points.reduce((sum, p) => sum + ((p as any)[key] || 0), 0);
        }

        return {
          date: periodKey,
          price: validPrices.length > 0 ? Math.round((validPrices.reduce((a, b) => a + b, 0) / validPrices.length) * 100) / 100 : null,
          stock: validStocks.length > 0 ? Math.round(validStocks.reduce((a, b) => a + b, 0) / validStocks.length) : null,
          sales: totalSales,
          revenue: totalRevenue > 0 ? Math.round(totalRevenue * 100) / 100 : null,
          margin: validMargins.length > 0 ? Math.round((validMargins.reduce((a, b) => a + b, 0) / validMargins.length) * 100) / 100 : null,
          lowestCompetitor: validCompetitors.length > 0 ? Math.round((validCompetitors.reduce((a, b) => a + b, 0) / validCompetitors.length) * 100) / 100 : null,
          ...channelTotals,
        };
      });
  }, [chartData, unitPeriod, allChannels]);

  // Calculate sales data from channelSales (actual order data)
  const { avgDailySales, avgDailyRevenue } = useMemo(() => {
    // Sum up all sales and revenue from channelSales data
    let totalSales = 0;
    let totalRevenue = 0;

    // channelSales is: { date: { channel: { quantity, revenue } } }
    Object.values(channelSales).forEach(daySales => {
      Object.values(daySales).forEach(channelData => {
        totalSales += channelData.quantity || 0;
        totalRevenue += channelData.revenue || 0;
      });
    });

    // Calculate actual days from dateRange
    const fromDate = new Date(dateRange.from);
    const toDate = new Date(dateRange.to);
    const days = Math.max(1, Math.ceil((toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24)) + 1);
    return {
      avgDailySales: days > 0 ? totalSales / days : 0,
      avgDailyRevenue: days > 0 ? totalRevenue / days : 0,
    };
  }, [channelSales, dateRange]);

  // Filter price changes for chart annotations (within visible date range)
  // Must be called before early returns to maintain hook order
  const priceChangeAnnotations = useMemo(() => {
    if (!priceHistoryData?.items || priceHistoryData.items.length === 0) return [];

    // Get the date range from aggregatedChartData
    if (aggregatedChartData.length === 0) return [];

    const chartDates = aggregatedChartData.map(d => d.date);
    const minDate = chartDates[0];
    const maxDate = chartDates[chartDates.length - 1];

    // Channel display names for annotations
    const channelNames: Record<string, string> = {
      amazon: 'Amazon',
      ebay: 'eBay/OnBuy/Debs',
      bandq: 'B&Q',
      manomano: 'ManoMano',
      shopify: 'Shopify',
    };

    // Filter and map price changes within the chart date range
    return priceHistoryData.items
      .filter(change => {
        const changeDate = change.changedAt.substring(0, 10); // Extract YYYY-MM-DD
        return changeDate >= minDate && changeDate <= maxDate;
      })
      .map(change => {
        const changeDate = change.changedAt.substring(0, 10);
        // For weekly/monthly view, map to the period start date
        let mappedDate = changeDate;
        if (unitPeriod === 'week') {
          const date = new Date(changeDate);
          const day = date.getUTCDay();
          const diff = date.getUTCDate() - day + (day === 0 ? -6 : 1);
          const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), diff));
          mappedDate = monday.toISOString().substring(0, 10);
        } else if (unitPeriod === 'month') {
          const date = new Date(changeDate);
          mappedDate = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-01`;
        }

        // Get channel display name
        const channelDisplay = change.channelId === 'all'
          ? 'All'
          : channelNames[change.channelId] || change.channelId;

        return {
          date: mappedDate,
          channel: channelDisplay,
          previousPrice: change.previousPrice,
          newPrice: change.newPrice,
          changedBy: change.changedBy.split('@')[0],
          reason: change.reason,
        };
      })
      // Deduplicate by date (keep first change per date for cleaner annotations)
      .filter((change, index, self) =>
        self.findIndex(c => c.date === change.date) === index
      );
  }, [priceHistoryData, aggregatedChartData, unitPeriod]);

  // Early returns must come AFTER all hooks
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

  const competitorUrls: CompetitorUrl[] = (product as any)?.competitorUrls || [];
  const competitorFloorPrice = (product as any)?.competitorFloorPrice;
  const channels: Channel[] = channelsData?.items || [];

  // Get channel prices from product
  const channelPrices = (product as any)?.channelPrices || {};

  // Map channel IDs to display names (defined as constant outside useMemo to avoid re-renders)
  // eBay, OnBuy, and Debenhams all use the same price (eBay pricing) so we group them
  const channelDisplayNames: Record<string, string> = {
    amazon: 'Amazon',
    ebay: 'eBay/OnBuy/Debs', // Grouped - all use eBay pricing
    bandq: 'B&Q',
    manomano: 'ManoMano',
    shopify: 'Shopify',
  };

  // Define preferred channel order: Amazon, B&Q, Shopify, ManoMano, then everything else
  const channelOrder = ['amazon', 'bandq', 'shopify', 'manomano', 'ebay'];

  // Get unique channels that have prices set
  // Skip onbuy and debenhams since they use the same price as ebay
  const channelsWithPrices = Object.entries(channelPrices)
    .filter(([channelId, price]) => {
      // Skip onbuy and debenhams - they're covered by ebay
      if (channelId === 'onbuy' || channelId === 'debenhams') return false;
      return price && (price as number) > 0;
    })
    .map(([channelId, price]) => ({
      channelId,
      name: channelDisplayNames[channelId] || channelId,
      price: price as number,
      channel: channels.find(c => c.channelId === channelId),
    }))
    .sort((a, b) => {
      const aIndex = channelOrder.indexOf(a.channelId);
      const bIndex = channelOrder.indexOf(b.channelId);
      // If both are in the order list, sort by their position
      if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
      // If only one is in the list, it comes first
      if (aIndex !== -1) return -1;
      if (bIndex !== -1) return 1;
      // Otherwise sort alphabetically
      return a.name.localeCompare(b.name);
    });

  // Check if Shopify is missing from channelsWithPrices - always show Shopify tab
  const hasShopifyPrice = channelsWithPrices.some(c => c.channelId === 'shopify');
  // Show Shopify tab even if not listed
  const shopifyNotListed = !hasShopifyPrice;

  // Build the full tab list including Shopify placeholder in correct position
  const allChannelTabs = [...channelsWithPrices];
  if (shopifyNotListed) {
    // Add Shopify placeholder
    allChannelTabs.push({
      channelId: 'shopify',
      name: 'Shopify',
      price: 0,
      channel: undefined,
    });
    // Re-sort to put Shopify in correct position
    allChannelTabs.sort((a, b) => {
      const aIndex = channelOrder.indexOf(a.channelId);
      const bIndex = channelOrder.indexOf(b.channelId);
      if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
      if (aIndex !== -1) return -1;
      if (bIndex !== -1) return 1;
      return a.name.localeCompare(b.name);
    });
  }

  // Calculate average price across all channels (for "All" tab)
  const avgChannelPrice = channelsWithPrices.length > 0
    ? channelsWithPrices.reduce((sum, c) => sum + c.price, 0) / channelsWithPrices.length
    : product?.currentPrice || 0;

  // Get the price to use for calculations
  const savedSellingPrice = selectedChannel
    ? channelPrices[selectedChannel] || product?.currentPrice || 0
    : avgChannelPrice; // Use average price for "All" tab

  // Use edited price if editing, otherwise saved price
  const sellingPrice = isEditingPrice && editPrice !== '' ? parseFloat(editPrice) || 0 : savedSellingPrice;

  // Get the selected channel's config (if any)
  const selectedChannelConfig = selectedChannel
    ? channels.find(c => c.channelId === selectedChannel)
    : null;

  // Filter proposals to only show exact SKU matches
  const proposals: PriceProposal[] = (proposalsData?.items || []).filter(
    (p: PriceProposal) => p.sku.toUpperCase() === sku?.toUpperCase()
  );

  // Calculate product metrics with channel-specific costs
  const costPrice = isEditing && editCost !== '' ? parseFloat(editCost) || 0 : (product?.costPrice || 0);
  const deliveryCost = isEditing && editDelivery !== '' ? parseFloat(editDelivery) || 0 : (product?.deliveryCost || 0);

  // Channel-specific calculations
  const vatPercent = selectedChannelConfig?.vatPercent ?? 20;
  const priceExVat = sellingPrice / (1 + vatPercent / 100);

  // Channel fees - hardcoded for now (ignoring Marketplace tab settings)
  // Shopify 15%, all other marketplaces 20%
  const getDefaultCommission = (channelId: string | null) => {
    if (channelId === 'shopify') return 15;
    return 20;
  };
  const commissionPercent = getDefaultCommission(selectedChannel);
  const channelCommission = priceExVat * (commissionPercent / 100);
  const channelFixedFee = 0; // Ignoring Marketplace tab for now
  const paymentProcessing = 0; // Ignoring Marketplace tab for now

  // Total costs and margin
  const totalChannelFees = channelCommission + channelFixedFee + paymentProcessing;
  const ppo = priceExVat - totalChannelFees - deliveryCost - costPrice;
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
                      <span className="text-gray-500">{currencySymbol}</span>
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
                      {costPrice ? `${currencySymbol}${costPrice.toFixed(2)}` : 'Not set'}
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
                      <span className="text-gray-500">{currencySymbol}</span>
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
                      {deliveryCost ? `${currencySymbol}${deliveryCost.toFixed(2)}` : '-'}
                    </p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Section 2: Pricing & Margin (Calculated) */}
          <Card className="flex flex-col">
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-medium text-gray-500 uppercase tracking-wide">Pricing & Margin</CardTitle>
              {/* Channel selector - only show if multi-price mode and there are channels */}
              {!isSinglePriceMode && allChannelTabs.length > 0 && (
                <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
                  {channelsWithPrices.length > 0 && (
                    <button
                      onClick={() => {
                        setSelectedChannel(null);
                        setIsEditingPrice(false);
                      }}
                      className={`px-2 py-1 text-xs rounded-md transition-colors ${
                        selectedChannel === null
                          ? 'bg-white text-blue-600 shadow-sm font-medium'
                          : 'text-gray-600 hover:text-gray-900'
                      }`}
                    >
                      All
                    </button>
                  )}
                  {allChannelTabs.map(({ channelId, name }) => {
                    const isNotListed = channelId === 'shopify' && shopifyNotListed;
                    return (
                      <button
                        key={channelId}
                        onClick={() => {
                          setSelectedChannel(channelId);
                          setIsEditingPrice(false);
                        }}
                        className={`px-2 py-1 text-xs rounded-md transition-colors ${
                          selectedChannel === channelId
                            ? isNotListed
                              ? 'bg-white text-gray-500 shadow-sm font-medium'
                              : 'bg-white text-blue-600 shadow-sm font-medium'
                            : isNotListed
                              ? 'text-gray-400 hover:text-gray-600'
                              : 'text-gray-600 hover:text-gray-900'
                        }`}
                      >
                        {name}
                      </button>
                    );
                  })}
                </div>
              )}
            </CardHeader>
            <CardContent className="pt-0 flex-1">
              {/* Show "Not listed on Shopify" message when Shopify tab selected but no price */}
              {selectedChannel === 'shopify' && shopifyNotListed ? (
                <div className="flex flex-col items-center justify-center h-full py-8 text-gray-500">
                  <Package className="h-12 w-12 text-gray-300 mb-3" />
                  <p className="text-lg font-medium text-gray-600">Not listed on Shopify</p>
                  <p className="text-sm mt-1">This product doesn't have a Shopify price set</p>
                </div>
              ) : (
              /* Unified view - same layout for All tab and individual channels */
              <div className="flex gap-6 h-full items-center">
                {/* Left: Pricing breakdown */}
                <div className="flex-1 space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-600 font-medium">
                      {isSinglePriceMode
                        ? 'Selling Price'
                        : selectedChannel
                          ? `${channelDisplayNames[selectedChannel]} Price`
                          : channelsWithPrices.length > 1
                            ? 'Average Price (All Channels)'
                            : 'Selling Price'}
                    </span>
                    {isEditingPrice ? (
                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1 bg-blue-50 border border-blue-300 rounded-lg px-2 py-1">
                          <span className="text-blue-600">{currencySymbol}</span>
                          <input
                            type="number"
                            step="0.01"
                            value={editPrice}
                            onChange={(e) => setEditPrice(e.target.value)}
                            className="w-20 bg-transparent outline-none text-right font-bold text-blue-600"
                            autoFocus
                          />
                        </div>
                        {selectedChannel && sellingPrice !== savedSellingPrice && (
                          <button
                            onClick={() => {
                              const newPrice = parseFloat(editPrice);
                              if (!isNaN(newPrice) && newPrice > 0) {
                                updatePriceMutation.mutate({ channelId: selectedChannel, price: newPrice });
                              }
                            }}
                            disabled={updatePriceMutation.isPending}
                            className="p-1 text-green-600 hover:text-green-700 disabled:opacity-50"
                            title="Save price to Google Sheet"
                          >
                            <Save className="h-4 w-4" />
                          </button>
                        )}
                        <button
                          onClick={() => {
                            setIsEditingPrice(false);
                            setEditPrice('');
                          }}
                          className="p-1 text-gray-400 hover:text-gray-600"
                          title="Cancel"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => {
                          setEditPrice(savedSellingPrice.toFixed(2));
                          setIsEditingPrice(true);
                        }}
                        className="font-bold text-lg text-blue-600 hover:text-blue-700 hover:underline cursor-pointer flex items-center gap-1"
                        title={selectedChannel ? "Click to edit price" : "Select a channel to edit price"}
                      >
                        {currencySymbol}{sellingPrice.toFixed(2)}
                        <Pencil className="h-3 w-3 opacity-50" />
                      </button>
                    )}
                  </div>
                  {isEditingPrice && sellingPrice !== savedSellingPrice && (
                    <div className={`text-xs px-2 py-1 rounded ${selectedChannel ? 'text-green-600 bg-green-50' : 'text-amber-600 bg-amber-50'}`}>
                      {updatePriceMutation.isPending
                        ? 'Saving to Google Sheet...'
                        : selectedChannel
                          ? `Click save to update ${channelDisplayNames[selectedChannel] || selectedChannel} price in Google Sheet`
                          : 'Select a specific channel to save price changes'}
                    </div>
                  )}
                  {updatePriceMutation.isError && (
                    <div className="text-xs text-red-600 bg-red-50 px-2 py-1 rounded">
                      Failed to save: {(updatePriceMutation.error as Error)?.message || 'Unknown error'}
                    </div>
                  )}
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-600">Price ex VAT ({vatPercent}%)</span>
                    <span className="font-semibold">{currencySymbol}{priceExVat.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-600">
                      Channel Fees ({commissionPercent}%{channelFixedFee > 0 ? ` + ${currencySymbol}${channelFixedFee.toFixed(2)}` : ''})
                    </span>
                    <span className="font-semibold text-gray-500">-{currencySymbol}{totalChannelFees.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-600">Cost + Delivery</span>
                    <span className={`font-semibold ${!costPrice && !deliveryCost ? 'text-gray-400' : 'text-gray-500'}`}>
                      {costPrice || deliveryCost ? `-${currencySymbol}${(costPrice + deliveryCost).toFixed(2)}` : '-'}
                    </span>
                  </div>
                  <div className="border-t border-gray-200 pt-2 flex justify-between items-center">
                    <span className="text-sm text-gray-600 font-medium">PPO</span>
                    <span className={`font-semibold ${ppo < 0 ? 'text-red-600' : ''}`}>{costPrice ? `${currencySymbol}${ppo.toFixed(2)}` : '-'}</span>
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
              )}
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
                  <p className="text-xl font-semibold">{currencySymbol}{avgDailyRevenue.toFixed(2)}</p>
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

      {/* Chart Section */}
      <div>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Historical Data</CardTitle>
            <div className="flex gap-4">
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
          </CardHeader>
          <CardContent>
            {aggregatedChartData.length === 0 ? (
              <div className="flex items-center justify-center h-64 text-gray-500">
                No history data available yet. Data will be recorded from the daily sync.
              </div>
            ) : (
              <div className="space-y-6">
                {/* Price/Stock/Revenue Line Chart */}
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={aggregatedChartData} syncId="productHistory" margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 11 }}
                      tickFormatter={(value) => {
                        const date = new Date(value);
                        return `${date.getDate()}/${date.getMonth() + 1}`;
                      }}
                    />
                    <YAxis yAxisId="left" tick={{ fontSize: 11 }} width={50} />
                    <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} width={50} />
                    <Tooltip
                      wrapperStyle={{ zIndex: 1000 }}
                      contentStyle={{
                        backgroundColor: '#ffffff',
                        border: '1px solid #d1d5db',
                        borderRadius: '8px',
                        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
                        opacity: 1,
                      }}
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
                        if (value === null || value === undefined) return ['-', name];
                        const revenueLabel = unitPeriod === 'day' ? `Daily Revenue (${currencySymbol})` : unitPeriod === 'week' ? `Weekly Revenue (${currencySymbol})` : `Monthly Revenue (${currencySymbol})`;
                        if (name === `Price (${currencySymbol})` || name === revenueLabel || name === `Lowest Competitor (${currencySymbol})`) {
                          return [`${currencySymbol}${value.toFixed(2)}`, name];
                        }
                        if (name === 'Margin (%)') {
                          return [`${value.toFixed(1)}%`, name];
                        }
                        return [value, name];
                      }}
                    />
                    <Legend
                      onClick={(e: any) => {
                        const dataKey = e.dataKey;
                        setHiddenLines((prev) => {
                          const next = new Set(prev);
                          if (next.has(dataKey)) {
                            next.delete(dataKey);
                          } else {
                            next.add(dataKey);
                          }
                          return next;
                        });
                      }}
                      wrapperStyle={{ cursor: 'pointer' }}
                      formatter={(value: string, entry: any) => (
                        <span style={{ color: hiddenLines.has(entry.dataKey) ? '#ccc' : entry.color }}>
                          {value}
                        </span>
                      )}
                    />
                    <Line
                      yAxisId="left"
                      type="monotone"
                      dataKey="price"
                      stroke="#3b82f6"
                      strokeWidth={2}
                      dot={{ r: 2, fill: '#3b82f6' }}
                      activeDot={{ r: 4 }}
                      name={`Price (${currencySymbol})`}
                      hide={hiddenLines.has('price')}
                      connectNulls={false}
                    />
                    <Line
                      yAxisId="right"
                      type="monotone"
                      dataKey="stock"
                      stroke="#10b981"
                      strokeWidth={2}
                      dot={{ r: 2, fill: '#10b981' }}
                      activeDot={{ r: 4 }}
                      name="Stock"
                      hide={hiddenLines.has('stock')}
                      connectNulls={false}
                    />
                    <Line
                      yAxisId="left"
                      type="monotone"
                      dataKey="revenue"
                      stroke="#8b5cf6"
                      strokeWidth={2}
                      dot={{ r: 2, fill: '#8b5cf6' }}
                      activeDot={{ r: 4 }}
                      name={unitPeriod === 'day' ? `Daily Revenue (${currencySymbol})` : unitPeriod === 'week' ? `Weekly Revenue (${currencySymbol})` : `Monthly Revenue (${currencySymbol})`}
                      hide={hiddenLines.has('revenue')}
                      connectNulls={false}
                    />
                    <Line
                      yAxisId="left"
                      type="monotone"
                      dataKey="lowestCompetitor"
                      stroke="#ef4444"
                      strokeWidth={2}
                      strokeDasharray="5 5"
                      dot={{ r: 2, fill: '#ef4444' }}
                      activeDot={{ r: 4 }}
                      name={`Lowest Competitor (${currencySymbol})`}
                      hide={hiddenLines.has('lowestCompetitor')}
                      connectNulls={false}
                    />
                    {/* Price change annotations */}
                    {priceChangeAnnotations.map((annotation, index) => (
                      <ReferenceLine
                        key={`price-change-${index}`}
                        x={annotation.date}
                        stroke="#f97316"
                        strokeWidth={2}
                        strokeDasharray="4 2"
                        yAxisId="left"
                        label={<PriceChangeLabel annotation={annotation} currencySymbol={currencySymbol} />}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>

                {/* Sales by Channel Stacked Bar Chart */}
                {allChannels.length > 0 && (
                  <div>
                    <h4 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-3">Sales by Channel</h4>
                    <ResponsiveContainer width="100%" height={200}>
                      <ComposedChart data={aggregatedChartData} syncId="productHistory" margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
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
                        <YAxis yAxisId="left" tick={{ fontSize: 11 }} width={50} />
                        <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} width={50} tickFormatter={() => ''} />
                        <Tooltip
                          wrapperStyle={{ zIndex: 1000 }}
                          contentStyle={{
                            backgroundColor: '#ffffff',
                            border: '1px solid #d1d5db',
                            borderRadius: '8px',
                            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
                            opacity: 1,
                          }}
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
                            // Extract channel name from "sales_ChannelName"
                            const channelName = name.replace('sales_', '');
                            return [value, channelName];
                          }}
                        />
                        <Legend
                          formatter={(value: string) => value.replace('sales_', '')}
                        />
                        {allChannels.map((channel, index) => (
                          <Bar
                            key={channel}
                            yAxisId="left"
                            dataKey={`sales_${channel}`}
                            stackId="sales"
                            fill={getChannelColor(channel, index)}
                            name={`sales_${channel}`}
                          />
                        ))}
                        {/* Price change annotations */}
                        {priceChangeAnnotations.map((annotation, index) => (
                          <ReferenceLine
                            key={`price-change-sales-${index}`}
                            x={annotation.date}
                            stroke="#f97316"
                            strokeWidth={2}
                            strokeDasharray="4 2"
                            yAxisId="left"
                          />
                        ))}
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Competitor Monitoring Section */}
      <div className="mt-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-indigo-100 rounded-lg">
                <Globe className="h-5 w-5 text-indigo-600" />
              </div>
              <div>
                <CardTitle className="text-sm font-medium text-gray-500 uppercase tracking-wide">Competitor Monitoring</CardTitle>
                {competitorFloorPrice && (
                  <p className="text-lg font-semibold text-indigo-600">Floor: {currencySymbol}{competitorFloorPrice.toFixed(2)}</p>
                )}
              </div>
            </div>
            <div className="flex gap-2">
              {competitorUrls.length > 0 && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleScrapeCompetitors}
                  disabled={scrapeCompetitorMutation.isPending}
                >
                  <RefreshCw className={`h-4 w-4 mr-1 ${scrapeCompetitorMutation.isPending ? 'animate-spin' : ''}`} />
                  {scrapeCompetitorMutation.isPending ? 'Scraping...' : 'Scrape Now'}
                </Button>
              )}
              <Button
                variant="primary"
                size="sm"
                onClick={() => setIsAddingUrl(true)}
                disabled={isAddingUrl}
              >
                <Plus className="h-4 w-4 mr-1" />
                Add URL
              </Button>
            </div>
          </CardHeader>
          <CardContent className="pt-2">
            {/* Add URL Form */}
            {isAddingUrl && (
              <div className="flex gap-2 mb-4 p-3 bg-gray-50 rounded-lg">
                <input
                  type="url"
                  value={newCompetitorUrl}
                  onChange={(e) => setNewCompetitorUrl(e.target.value)}
                  placeholder="https://www.competitor.com/product-page"
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  autoFocus
                />
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleAddCompetitorUrl}
                  disabled={!newCompetitorUrl.trim() || addCompetitorMutation.isPending}
                >
                  {addCompetitorMutation.isPending ? 'Adding...' : 'Add'}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setIsAddingUrl(false);
                    setNewCompetitorUrl('');
                  }}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            )}

            {/* Competitor URLs List */}
            {competitorUrls.length === 0 ? (
              <div className="text-center py-6 text-gray-500">
                <Globe className="h-8 w-8 mx-auto mb-2 text-gray-300" />
                <p>No competitor URLs configured</p>
                <p className="text-sm mt-1">Add competitor product pages to monitor their prices</p>
              </div>
            ) : (
              <div className="space-y-2">
                {competitorUrls.map((comp) => (
                  <div
                    key={comp.id}
                    className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-900">{comp.competitorName}</span>
                        {comp.lastPrice && (
                          <Badge variant="success">{currencySymbol}{comp.lastPrice.toFixed(2)}</Badge>
                        )}
                        {comp.lastError && (
                          <span className="flex items-center gap-1 text-xs text-red-600">
                            <AlertCircle className="h-3 w-3" />
                            Error
                          </span>
                        )}
                      </div>
                      <a
                        href={comp.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-gray-500 hover:text-indigo-600 truncate block max-w-md"
                      >
                        {comp.url}
                        <ExternalLink className="h-3 w-3 inline ml-1" />
                      </a>
                      {comp.lastScrapedAt && (
                        <p className="text-xs text-gray-400 mt-1">
                          Last scraped: {new Date(comp.lastScrapedAt).toLocaleDateString('en-GB', {
                            day: 'numeric',
                            month: 'short',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </p>
                      )}
                      {comp.lastError && (
                        <p className="text-xs text-red-500 mt-1">{comp.lastError}</p>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRemoveCompetitorUrl(comp.id)}
                      disabled={removeCompetitorMutation.isPending}
                      className="text-red-500 hover:text-red-700 hover:bg-red-50"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Pricing Proposals Section */}
      <div className="mt-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-amber-100 rounded-lg">
                <Tag className="h-5 w-5 text-amber-600" />
              </div>
              <CardTitle className="text-sm font-medium text-gray-500 uppercase tracking-wide">
                Pricing Proposals
              </CardTitle>
            </div>
            {proposals.length > 0 && (
              <button
                onClick={() => navigate('/proposals')}
                className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1"
              >
                View All
                <ArrowRight className="h-4 w-4" />
              </button>
            )}
          </CardHeader>
          <CardContent className="pt-2">
            {proposals.length === 0 ? (
              <div className="text-center py-6 text-gray-500">
                <Tag className="h-8 w-8 mx-auto mb-2 text-gray-300" />
                <p>No pricing proposals for this product</p>
                <p className="text-sm mt-1">Proposals are generated weekly by pricing rules</p>
              </div>
            ) : (
              <div className="space-y-3">
                {proposals.map((proposal) => {
                  const statusConfig = {
                    pending: { icon: Clock, color: 'text-amber-600', bg: 'bg-amber-100', label: 'Pending' },
                    approved: { icon: CheckCircle, color: 'text-green-600', bg: 'bg-green-100', label: 'Approved' },
                    rejected: { icon: XCircle, color: 'text-red-600', bg: 'bg-red-100', label: 'Rejected' },
                    modified: { icon: Pencil, color: 'text-blue-600', bg: 'bg-blue-100', label: 'Modified' },
                    pushed: { icon: CheckCircle, color: 'text-purple-600', bg: 'bg-purple-100', label: 'Pushed' },
                  }[proposal.status] || { icon: Clock, color: 'text-gray-600', bg: 'bg-gray-100', label: proposal.status };

                  const StatusIcon = statusConfig.icon;
                  const priceChangePositive = proposal.priceChange > 0;
                  const PriceIcon = priceChangePositive ? TrendingUp : proposal.priceChange < 0 ? TrendingDown : Minus;

                  return (
                    <div
                      key={proposal.proposalId}
                      className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                    >
                      <div className="flex items-center gap-4">
                        {/* Status Badge */}
                        <div className={`p-2 rounded-lg ${statusConfig.bg}`}>
                          <StatusIcon className={`h-4 w-4 ${statusConfig.color}`} />
                        </div>

                        {/* Price Change Info */}
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-gray-700">{currencySymbol}{proposal.currentPrice.toFixed(2)}</span>
                            <ArrowRight className="h-4 w-4 text-gray-400" />
                            <span className="font-semibold text-gray-900">
                              {currencySymbol}{(proposal.approvedPrice ?? proposal.proposedPrice).toFixed(2)}
                            </span>
                            <span className={`flex items-center gap-1 text-sm ${priceChangePositive ? 'text-green-600' : proposal.priceChange < 0 ? 'text-red-600' : 'text-gray-500'}`}>
                              <PriceIcon className="h-3 w-3" />
                              {priceChangePositive ? '+' : ''}{proposal.priceChangePercent.toFixed(1)}%
                            </span>
                          </div>
                          <p className="text-xs text-gray-500 mt-1">
                            {proposal.appliedRuleName || proposal.reason}
                          </p>
                          <p className="text-xs text-gray-400">
                            {new Date(proposal.createdAt).toLocaleDateString('en-GB', {
                              day: 'numeric',
                              month: 'short',
                              year: 'numeric',
                            })}
                          </p>
                        </div>
                      </div>

                      {/* Margin Change */}
                      <div className="text-right">
                        <div className="text-sm text-gray-500">Margin</div>
                        <div className="flex items-center gap-1">
                          <span className="text-gray-600">{proposal.currentMargin.toFixed(1)}%</span>
                          <ArrowRight className="h-3 w-3 text-gray-400" />
                          <span className={proposal.proposedMargin > proposal.currentMargin ? 'text-green-600 font-semibold' : proposal.proposedMargin < proposal.currentMargin ? 'text-red-600 font-semibold' : 'text-gray-900 font-semibold'}>
                            {proposal.proposedMargin.toFixed(1)}%
                          </span>
                        </div>
                        <Badge variant={proposal.status === 'approved' || proposal.status === 'pushed' ? 'success' : proposal.status === 'rejected' ? 'danger' : 'warning'}>
                          {statusConfig.label}
                        </Badge>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Price Change History Section */}
      <div className="mt-4">
        <Card>
          <div
            className="cursor-pointer hover:bg-gray-50 transition-colors"
            onClick={() => setIsPriceHistoryExpanded(!isPriceHistoryExpanded)}
          >
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-100 rounded-lg">
                  <History className="h-5 w-5 text-blue-600" />
                </div>
                <div>
                  <CardTitle className="text-sm font-medium text-gray-500 uppercase tracking-wide">
                    Price Change History
                  </CardTitle>
                  {priceHistoryData && (
                    <span className="text-xs text-gray-400">
                      {priceHistoryData.count} changes recorded
                    </span>
                  )}
                </div>
              </div>
              <button className="p-1 text-gray-400 hover:text-gray-600">
                {isPriceHistoryExpanded ? (
                  <ChevronUp className="h-5 w-5" />
                ) : (
                  <ChevronDown className="h-5 w-5" />
                )}
              </button>
            </CardHeader>
          </div>
          {isPriceHistoryExpanded && (
            <CardContent className="pt-2">
              {isPriceHistoryLoading ? (
                <div className="flex items-center justify-center py-8 text-gray-500">
                  <RefreshCw className="h-5 w-5 animate-spin mr-2" />
                  Loading history...
                </div>
              ) : !priceHistoryData || priceHistoryData.items.length === 0 ? (
                <div className="text-center py-6 text-gray-500">
                  <History className="h-8 w-8 mx-auto mb-2 text-gray-300" />
                  <p>No price changes recorded yet</p>
                  <p className="text-sm mt-1">Changes will be tracked from now on</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200">
                        <th className="text-left py-2 px-3 font-medium text-gray-500">Date</th>
                        <th className="text-left py-2 px-3 font-medium text-gray-500">Channel</th>
                        <th className="text-right py-2 px-3 font-medium text-gray-500">Previous</th>
                        <th className="text-right py-2 px-3 font-medium text-gray-500">New</th>
                        <th className="text-left py-2 px-3 font-medium text-gray-500">Changed By</th>
                        <th className="text-left py-2 px-3 font-medium text-gray-500">Reason</th>
                        <th className="text-left py-2 px-3 font-medium text-gray-500">Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {priceHistoryData.items.map((change: PriceChangeRecord, index: number) => {
                        const changeDate = new Date(change.changedAt);
                        const priceChange = change.newPrice - change.previousPrice;
                        const priceChangePercent = change.previousPrice > 0
                          ? ((priceChange / change.previousPrice) * 100)
                          : 0;
                        const isPositive = priceChange > 0;

                        // Reason display mapping
                        const reasonDisplay: Record<string, { label: string; badge: string }> = {
                          manual: { label: 'Manual', badge: 'bg-blue-100 text-blue-700' },
                          proposal_approved: { label: 'Proposal', badge: 'bg-green-100 text-green-700' },
                          proposal_modified: { label: 'Modified', badge: 'bg-purple-100 text-purple-700' },
                          bulk_update: { label: 'Bulk', badge: 'bg-amber-100 text-amber-700' },
                        };
                        const reason = reasonDisplay[change.reason] || { label: change.reason, badge: 'bg-gray-100 text-gray-700' };

                        // Channel display
                        const channelDisplay = change.channelId === 'all' ? 'All Channels' :
                          channelDisplayNames[change.channelId] || change.channelId;

                        return (
                          <tr
                            key={`${change.changedAt}-${index}`}
                            className="border-b border-gray-100 hover:bg-gray-50"
                          >
                            <td className="py-2 px-3">
                              <div className="text-gray-900">
                                {changeDate.toLocaleDateString('en-GB', {
                                  day: 'numeric',
                                  month: 'short',
                                  year: 'numeric',
                                })}
                              </div>
                              <div className="text-xs text-gray-400">
                                {changeDate.toLocaleTimeString('en-GB', {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </div>
                            </td>
                            <td className="py-2 px-3 text-gray-700">{channelDisplay}</td>
                            <td className="py-2 px-3 text-right text-gray-500">
                              {currencySymbol}{change.previousPrice.toFixed(2)}
                            </td>
                            <td className="py-2 px-3 text-right">
                              <div className="flex items-center justify-end gap-2">
                                <span className="font-semibold text-gray-900">
                                  {currencySymbol}{change.newPrice.toFixed(2)}
                                </span>
                                <span className={`text-xs ${isPositive ? 'text-green-600' : priceChange < 0 ? 'text-red-600' : 'text-gray-500'}`}>
                                  {isPositive ? '+' : ''}{priceChangePercent.toFixed(1)}%
                                </span>
                              </div>
                            </td>
                            <td className="py-2 px-3">
                              <div className="flex items-center gap-1">
                                <User className="h-3 w-3 text-gray-400" />
                                <span className="text-gray-700 truncate max-w-[120px]" title={change.changedBy}>
                                  {change.changedBy.split('@')[0]}
                                </span>
                              </div>
                            </td>
                            <td className="py-2 px-3">
                              <span className={`px-2 py-1 rounded-full text-xs font-medium ${reason.badge}`}>
                                {reason.label}
                              </span>
                            </td>
                            <td className="py-2 px-3 text-gray-500 text-xs max-w-[150px] truncate" title={change.notes}>
                              {change.notes || '-'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          )}
        </Card>
      </div>
    </div>
  );
}
