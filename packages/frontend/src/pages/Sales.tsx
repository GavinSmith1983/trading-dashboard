import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ShoppingCart, PoundSterling, TrendingUp, TrendingDown, Package, Layers, ChevronDown, ChevronRight, Building2, Search, ChevronLeft } from 'lucide-react';
import { useAccountQuery } from '../hooks/useAccountQuery';
import { useAccount } from '../context/AccountContext';
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

// Revenue display component with hover tooltip showing precise value
function Revenue({ value, symbol, className = '' }: { value: number; symbol: string; className?: string }) {
  const roundedValue = Math.round(value);
  const preciseValue = value.toFixed(2);
  return (
    <span className={className} title={`${symbol}${preciseValue}`}>
      {symbol}{roundedValue.toLocaleString()}
    </span>
  );
}

// Time range options - 'days' can be a number or a special string for dynamic ranges
type TimeRangeOption = { label: string; days: number | 'thisMonth' | 'lastMonth' };

const TIME_RANGES: TimeRangeOption[] = [
  { label: 'This Month', days: 'thisMonth' },
  { label: 'Last Month', days: 'lastMonth' },
  { label: '1M', days: 30 },
  { label: '3M', days: 90 },
  { label: '6M', days: 180 },
  { label: '12M', days: 365 },
  { label: '18M', days: 548 },
];

// Helper to calculate date range for API call
function getDateRangeParams(range: number | 'thisMonth' | 'lastMonth'): { days?: number; fromDate?: string; toDate?: string } {
  if (typeof range === 'number') {
    return { days: range };
  }

  const now = new Date();
  const formatDate = (d: Date) => d.toISOString().substring(0, 10);

  if (range === 'thisMonth') {
    // First day of this month to today
    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    return {
      fromDate: formatDate(firstOfMonth),
      toDate: formatDate(now),
    };
  } else if (range === 'lastMonth') {
    // First day of last month to last day of last month
    const firstOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0); // Day 0 of this month = last day of previous
    return {
      fromDate: formatDate(firstOfLastMonth),
      toDate: formatDate(lastOfLastMonth),
    };
  }
  return { days: 30 };
}

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

// Custom tooltip component that sorts items by value (descending)
interface SortedTooltipProps {
  active?: boolean;
  payload?: Array<{
    name: string;
    value: number;
    color: string;
    dataKey: string;
  }>;
  label?: string;
  currencySymbol: string;
  viewMode: 'units' | 'revenue';
  unitPeriod: 'day' | 'week' | 'month';
}

function SortedTooltip({ active, payload, label, currencySymbol, viewMode, unitPeriod }: SortedTooltipProps) {
  if (!active || !payload || !label) return null;

  // Format the date label
  const date = new Date(label);
  let formattedLabel: string;
  if (unitPeriod === 'week') {
    const endOfWeek = new Date(date);
    endOfWeek.setDate(endOfWeek.getDate() + 6);
    formattedLabel = `Week of ${date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} - ${endOfWeek.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`;
  } else if (unitPeriod === 'month') {
    formattedLabel = date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  } else {
    formattedLabel = date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  }

  // Filter out null, undefined, and zero values (except for Total, Last Year, Last Month)
  const filteredPayload = payload.filter(entry => {
    if (entry.value === null || entry.value === undefined) return false;
    // Always show Total, Last Year, Last Month even if zero
    if (entry.name === 'Total' || entry.name === 'Last Year' || entry.name === 'Last Month') return true;
    // Filter out zero values for other items
    return entry.value !== 0;
  });

  // Sort payload by value (descending), keeping Total, Last Year, and Last Month at top
  const sortedPayload = [...filteredPayload].sort((a, b) => {
    // Total always first
    if (a.name === 'Total') return -1;
    if (b.name === 'Total') return 1;
    // Last Year second
    if (a.name === 'Last Year') return -1;
    if (b.name === 'Last Year') return 1;
    // Last Month third
    if (a.name === 'Last Month') return -1;
    if (b.name === 'Last Month') return 1;
    // Sort rest by value descending
    return (b.value || 0) - (a.value || 0);
  });

  // Determine if we should show currency based on viewMode
  const showCurrency = viewMode === 'revenue';

  return (
    <div className="bg-white border border-gray-300 rounded-lg shadow-lg p-3" style={{ opacity: 1 }}>
      <p className="font-medium text-gray-900 mb-2">{formattedLabel}</p>
      {sortedPayload.map((entry, index) => {
        const itemName = entry.name.replace(/^(units_|revenue_)/, '');
        // Format value based on whether it's revenue or units
        const isRevenueItem = entry.name === 'Last Year' || entry.name === 'Last Month' || entry.name.startsWith('revenue_') ||
                             (entry.name === 'Total' && showCurrency);
        const formattedValue = isRevenueItem
          ? `${currencySymbol}${entry.value.toLocaleString()}`
          : entry.value.toLocaleString();

        return (
          <div key={index} className="flex items-center justify-between gap-4 text-sm py-0.5">
            <span style={{ color: entry.color }}>{itemName}</span>
            <span className="font-medium">{formattedValue}</span>
          </div>
        );
      })}
    </div>
  );
}

export default function Sales() {
  const navigate = useNavigate();
  const { accountId } = useAccountQuery();
  const { currencySymbol } = useAccount();
  const [selectedTimeRange, setSelectedTimeRange] = useState<number | 'thisMonth' | 'lastMonth'>(30); // Default 1 month
  const [unitPeriod, setUnitPeriod] = useState<'day' | 'week' | 'month'>('day');
  const [hiddenChannels, setHiddenChannels] = useState<Set<string>>(new Set());
  const [hiddenFamilies, setHiddenFamilies] = useState<Set<string>>(new Set());
  const [hiddenBrands, setHiddenBrands] = useState<Set<string>>(new Set());
  const [expandedFamilies, setExpandedFamilies] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<'units' | 'revenue'>('revenue');
  const [showPreviousYear, setShowPreviousYear] = useState(false);
  const [showPreviousMonth, setShowPreviousMonth] = useState(false);

  // Drilldown state for Channel Breakdown table (4 levels: Channel -> Family -> Category -> SKU)
  const [expandedChannels, setExpandedChannels] = useState<Set<string>>(new Set());
  const [expandedChannelFamilies, setExpandedChannelFamilies] = useState<Set<string>>(new Set()); // "Channel:Family"
  const [expandedChannelCategories, setExpandedChannelCategories] = useState<Set<string>>(new Set()); // "Channel:Family:Category"

  // Drilldown state for Family Breakdown table (extend to SKU level)
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set()); // "Family:Category"

  // Stock Code view toggle (aggregate by parent model SKU instead of variant SKU)
  const [showStockCodes, setShowStockCodes] = useState(false);
  const [expandedStockCodes, setExpandedStockCodes] = useState<Set<string>>(new Set());

  // Company breakdown state (for Nuie Marketplace)
  const [companyPage, setCompanyPage] = useState(1);
  const [companySearch, setCompanySearch] = useState('');
  const [companySearchInput, setCompanySearchInput] = useState('');
  const isNuieMarketplace = accountId === 'nuie-marketplace';

  // Calculate date range params for API call
  const dateParams = getDateRangeParams(selectedTimeRange);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['sales', accountId, selectedTimeRange, showPreviousYear, showPreviousMonth, isNuieMarketplace, true, true, showStockCodes], // includeDaily=true, includeCategories=true, includeDrilldown=true, includeStockCodes
    queryFn: () => analyticsApi.sales(dateParams, true, showPreviousYear, true, showPreviousMonth, isNuieMarketplace, true, false, false, showStockCodes), // includeDaily=true, includeCategories=true, includeBrands for Nuie, includeDrilldown=true, includePreviousWeek=false, includeAvgSameWeekday=false, includeStockCodes
  });

  // Company breakdown query (only for Nuie Marketplace)
  const { data: companiesData, isLoading: companiesLoading } = useQuery({
    queryKey: ['companies', accountId, selectedTimeRange, companyPage, companySearch, showPreviousYear, showPreviousMonth],
    queryFn: () => analyticsApi.companies(dateParams, companyPage, 25, companySearch, showPreviousYear, showPreviousMonth),
    enabled: isNuieMarketplace,
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
    const previousYearDailySales = data.previousYear?.dailySales || {};
    const previousMonthDailySales = data.previousMonth?.dailySales || {};

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

      // Add previous year data if available (dates are already shifted to align)
      if (showPreviousYear && previousYearDailySales[date]) {
        const pyData = previousYearDailySales[date];
        entry.previousYearRevenue = Math.round(pyData.revenue * 100) / 100;
        entry.previousYearUnits = pyData.quantity;
      } else if (showPreviousYear) {
        entry.previousYearRevenue = null;
        entry.previousYearUnits = null;
      }

      // Add previous month data if available (dates are already shifted to align)
      if (showPreviousMonth && previousMonthDailySales[date]) {
        const pmData = previousMonthDailySales[date];
        entry.previousMonthRevenue = Math.round(pmData.revenue * 100) / 100;
        entry.previousMonthUnits = pmData.quantity;
      } else if (showPreviousMonth) {
        entry.previousMonthRevenue = null;
        entry.previousMonthUnits = null;
      }

      return entry;
    });
  }, [data, showPreviousYear, showPreviousMonth]);

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

        // Aggregate previous year data
        if (showPreviousYear) {
          const pyRevenueSum = points.reduce((sum, p) => sum + (p.previousYearRevenue || 0), 0);
          const pyUnitsSum = points.reduce((sum, p) => sum + (p.previousYearUnits || 0), 0);
          aggregated.previousYearRevenue = pyRevenueSum > 0 ? Math.round(pyRevenueSum * 100) / 100 : null;
          aggregated.previousYearUnits = pyUnitsSum > 0 ? pyUnitsSum : null;
        }

        // Aggregate previous month data
        if (showPreviousMonth) {
          const pmRevenueSum = points.reduce((sum, p) => sum + (p.previousMonthRevenue || 0), 0);
          const pmUnitsSum = points.reduce((sum, p) => sum + (p.previousMonthUnits || 0), 0);
          aggregated.previousMonthRevenue = pmRevenueSum > 0 ? Math.round(pmRevenueSum * 100) / 100 : null;
          aggregated.previousMonthUnits = pmUnitsSum > 0 ? pmUnitsSum : null;
        }

        return aggregated;
      });
  }, [chartData, unitPeriod, data?.channels, showPreviousYear, showPreviousMonth]);

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

  const toggleFamily = (family: string) => {
    setHiddenFamilies(prev => {
      const next = new Set(prev);
      if (next.has(family)) {
        next.delete(family);
      } else {
        next.add(family);
      }
      return next;
    });
  };

  const toggleBrand = (brand: string) => {
    setHiddenBrands(prev => {
      const next = new Set(prev);
      if (next.has(brand)) {
        next.delete(brand);
      } else {
        next.add(brand);
      }
      return next;
    });
  };

  // Family colors for the chart
  const FAMILY_COLORS = [
    '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6',
    '#EC4899', '#06B6D4', '#84CC16', '#F97316', '#6366F1',
    '#14B8A6', '#A855F7', '#22C55E', '#0EA5E9',
  ];

  const getFamilyColor = (_family: string, index: number): string => {
    return FAMILY_COLORS[index % FAMILY_COLORS.length];
  };

  // Toggle expanded family
  const toggleExpandedFamily = (family: string) => {
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

  // Toggle expanded category within family (for SKU drilldown in Family Breakdown table)
  const toggleExpandedCategory = (family: string, category: string) => {
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

  // Toggle functions for Channel Breakdown drilldown
  const toggleExpandedChannel = (channel: string) => {
    setExpandedChannels(prev => {
      const next = new Set(prev);
      if (next.has(channel)) {
        next.delete(channel);
      } else {
        next.add(channel);
      }
      return next;
    });
  };

  const toggleExpandedChannelFamily = (channel: string, family: string) => {
    const key = `${channel}:${family}`;
    setExpandedChannelFamilies(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const toggleExpandedChannelCategory = (channel: string, family: string, category: string) => {
    const key = `${channel}:${family}:${category}`;
    setExpandedChannelCategories(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  // Toggle expanded Stock Code to show child SKUs
  const toggleExpandedStockCode = (stockCode: string) => {
    setExpandedStockCodes(prev => {
      const next = new Set(prev);
      if (next.has(stockCode)) {
        next.delete(stockCode);
      } else {
        next.add(stockCode);
      }
      return next;
    });
  };

  // Get sorted list of families (by total revenue) - now using hierarchical totalsByFamily
  const families = useMemo(() => {
    if (!data?.totalsByFamily) return [];
    return Object.entries(data.totalsByFamily)
      .sort(([, a], [, b]) => b.revenue - a.revenue)
      .map(([family]) => family);
  }, [data?.totalsByFamily]);

  // Build family chart data from dailySalesByFamily (same structure as channel chart)
  // Uses the same date range as the channel chart (from dailySales)
  const familyChartData = useMemo(() => {
    if (!data?.dailySalesByFamily || !data?.dailySales) return [];

    const dailySalesByFamily = data.dailySalesByFamily as Record<string, Record<string, { quantity: number; revenue: number }>>;
    // Use dates from dailySales to ensure same date range as channel chart
    const allDates = Object.keys(data.dailySales).sort();

    return allDates.map(date => {
      const daySales = dailySalesByFamily[date] || {};
      const entry: Record<string, any> = { date };

      // Calculate total for the day
      let dayTotal = 0;
      let dayUnits = 0;

      families.forEach(family => {
        const familyData = daySales[family] || { quantity: 0, revenue: 0 };
        entry[`units_${family}`] = familyData.quantity;
        entry[`revenue_${family}`] = Math.round(familyData.revenue * 100) / 100;
        dayTotal += familyData.revenue;
        dayUnits += familyData.quantity;
      });

      entry.totalRevenue = Math.round(dayTotal * 100) / 100;
      entry.totalUnits = dayUnits;

      return entry;
    });
  }, [data?.dailySalesByFamily, data?.dailySales, families]);

  // Aggregate family data by week or month if selected
  const aggregatedFamilyChartData = useMemo(() => {
    if (unitPeriod === 'day' || familyChartData.length === 0) return familyChartData;

    const groups = new Map<string, typeof familyChartData>();

    for (const point of familyChartData) {
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

        let totalRevenue = 0;
        let totalUnits = 0;

        families.forEach(family => {
          const unitsSum = points.reduce((sum, p) => sum + (p[`units_${family}`] || 0), 0);
          const revenueSum = points.reduce((sum, p) => sum + (p[`revenue_${family}`] || 0), 0);
          aggregated[`units_${family}`] = unitsSum;
          aggregated[`revenue_${family}`] = Math.round(revenueSum * 100) / 100;
          totalRevenue += revenueSum;
          totalUnits += unitsSum;
        });

        aggregated.totalRevenue = Math.round(totalRevenue * 100) / 100;
        aggregated.totalUnits = totalUnits;

        return aggregated;
      });
  }, [familyChartData, unitPeriod, families]);

  // Brand colors for the chart (use similar palette as families)
  const BRAND_COLORS = [
    '#8B5CF6', '#EC4899', '#3B82F6', '#10B981', '#F59E0B',
    '#EF4444', '#06B6D4', '#84CC16', '#F97316', '#6366F1',
    '#14B8A6', '#A855F7', '#22C55E', '#0EA5E9',
  ];

  const getBrandColor = (_brand: string, index: number): string => {
    return BRAND_COLORS[index % BRAND_COLORS.length];
  };

  // Get sorted list of brands (by total revenue)
  const brands = useMemo(() => {
    if (!data?.totalsByBrand) return [];
    return Object.entries(data.totalsByBrand)
      .sort(([, a], [, b]) => b.revenue - a.revenue)
      .map(([brand]) => brand);
  }, [data?.totalsByBrand]);

  // Build brand chart data from dailySalesByBrand
  const brandChartData = useMemo(() => {
    if (!data?.dailySalesByBrand || !data?.fromDate || !data?.toDate || brands.length === 0) return [];

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

    const previousYearDailySales = data.previousYear?.dailySales || {};
    const previousMonthDailySales = data.previousMonth?.dailySales || {};

    return allDates.map(date => {
      const daySales = data.dailySalesByBrand![date] || {};
      const entry: Record<string, any> = { date };

      let dayTotal = 0;
      let dayUnits = 0;

      brands.forEach(brand => {
        const brandData = daySales[brand] || { quantity: 0, revenue: 0 };
        entry[`units_${brand}`] = brandData.quantity;
        entry[`revenue_${brand}`] = Math.round(brandData.revenue * 100) / 100;
        dayTotal += brandData.revenue;
        dayUnits += brandData.quantity;
      });

      entry.totalRevenue = Math.round(dayTotal * 100) / 100;
      entry.totalUnits = dayUnits;

      // Add previous year data if available (dates are already shifted to align)
      if (showPreviousYear && previousYearDailySales[date]) {
        const pyData = previousYearDailySales[date];
        entry.previousYearRevenue = Math.round(pyData.revenue * 100) / 100;
        entry.previousYearUnits = pyData.quantity;
      } else if (showPreviousYear) {
        entry.previousYearRevenue = null;
        entry.previousYearUnits = null;
      }

      // Add previous month data if available (dates are already shifted to align)
      if (showPreviousMonth && previousMonthDailySales[date]) {
        const pmData = previousMonthDailySales[date];
        entry.previousMonthRevenue = Math.round(pmData.revenue * 100) / 100;
        entry.previousMonthUnits = pmData.quantity;
      } else if (showPreviousMonth) {
        entry.previousMonthRevenue = null;
        entry.previousMonthUnits = null;
      }

      return entry;
    });
  }, [data?.dailySalesByBrand, data?.fromDate, data?.toDate, brands, data?.previousYear?.dailySales, data?.previousMonth?.dailySales, showPreviousYear, showPreviousMonth]);

  // Aggregate brand data by week or month if selected
  const aggregatedBrandChartData = useMemo(() => {
    if (unitPeriod === 'day' || brandChartData.length === 0) return brandChartData;

    const groups = new Map<string, typeof brandChartData>();

    for (const point of brandChartData) {
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

        let totalRevenue = 0;
        let totalUnits = 0;

        brands.forEach(brand => {
          const unitsSum = points.reduce((sum, p) => sum + (p[`units_${brand}`] || 0), 0);
          const revenueSum = points.reduce((sum, p) => sum + (p[`revenue_${brand}`] || 0), 0);
          aggregated[`units_${brand}`] = unitsSum;
          aggregated[`revenue_${brand}`] = Math.round(revenueSum * 100) / 100;
          totalRevenue += revenueSum;
          totalUnits += unitsSum;
        });

        aggregated.totalRevenue = Math.round(totalRevenue * 100) / 100;
        aggregated.totalUnits = totalUnits;

        // Aggregate previous year data
        if (showPreviousYear) {
          const pyRevenueSum = points.reduce((sum, p) => sum + (p.previousYearRevenue || 0), 0);
          const pyUnitsSum = points.reduce((sum, p) => sum + (p.previousYearUnits || 0), 0);
          aggregated.previousYearRevenue = pyRevenueSum > 0 ? Math.round(pyRevenueSum * 100) / 100 : null;
          aggregated.previousYearUnits = pyUnitsSum > 0 ? pyUnitsSum : null;
        }

        // Aggregate previous month data
        if (showPreviousMonth) {
          const pmRevenueSum = points.reduce((sum, p) => sum + (p.previousMonthRevenue || 0), 0);
          const pmUnitsSum = points.reduce((sum, p) => sum + (p.previousMonthUnits || 0), 0);
          aggregated.previousMonthRevenue = pmRevenueSum > 0 ? Math.round(pmRevenueSum * 100) / 100 : null;
          aggregated.previousMonthUnits = pmUnitsSum > 0 ? pmUnitsSum : null;
        }

        return aggregated;
      });
  }, [brandChartData, unitPeriod, brands, showPreviousYear, showPreviousMonth]);

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
  const daysInRange = data?.days || 30;
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
          {/* Comparison Toggles */}
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
            <button
              onClick={() => {
                setShowPreviousMonth(!showPreviousMonth);
                if (!showPreviousMonth) setShowPreviousYear(false);
              }}
              className={`px-3 py-1 text-sm rounded-md transition-colors ${
                showPreviousMonth
                  ? 'bg-white text-blue-600 shadow-sm font-medium'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              vs Last Month
            </button>
            <button
              onClick={() => {
                setShowPreviousYear(!showPreviousYear);
                if (!showPreviousYear) setShowPreviousMonth(false);
              }}
              className={`px-3 py-1 text-sm rounded-md transition-colors ${
                showPreviousYear
                  ? 'bg-white text-purple-600 shadow-sm font-medium'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              vs Last Year
            </button>
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      {(() => {
        const comparisonTotals = showPreviousYear ? data?.previousYear?.totals : showPreviousMonth ? data?.previousMonth?.totals : null;
        const comparisonLabel = showPreviousYear ? 'LY' : showPreviousMonth ? 'LM' : '';

        const revenueChange = comparisonTotals && comparisonTotals.revenue > 0
          ? ((totals.revenue - comparisonTotals.revenue) / comparisonTotals.revenue) * 100 : null;
        const unitsChange = comparisonTotals && comparisonTotals.quantity > 0
          ? ((totals.quantity - comparisonTotals.quantity) / comparisonTotals.quantity) * 100 : null;
        const ordersChange = comparisonTotals && comparisonTotals.orders > 0
          ? ((totals.orders - comparisonTotals.orders) / comparisonTotals.orders) * 100 : null;

        const comparisonAov = comparisonTotals && comparisonTotals.orders > 0
          ? comparisonTotals.revenue / comparisonTotals.orders : 0;
        const currentAov = totals.orders > 0 ? totals.revenue / totals.orders : 0;
        const aovChange = comparisonAov > 0 ? ((currentAov - comparisonAov) / comparisonAov) * 100 : null;

        // Company count (for Nuie Marketplace)
        const currentCompanyCount = companiesData?.pagination?.totalCount || 0;
        const comparisonCompanyCount = showPreviousYear
          ? companiesData?.previousYear?.totals?.companyCount
          : showPreviousMonth
            ? companiesData?.previousMonth?.totals?.companyCount
            : null;
        const companyCountChange = comparisonCompanyCount && comparisonCompanyCount > 0
          ? ((currentCompanyCount - comparisonCompanyCount) / comparisonCompanyCount) * 100 : null;

        return (
          <div className={`grid grid-cols-1 gap-4 ${isNuieMarketplace ? 'md:grid-cols-5' : 'md:grid-cols-4'}`}>
            <Card>
              <CardContent className="py-4">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-green-100 rounded-lg">
                    <PoundSterling className="h-6 w-6 text-green-600" />
                  </div>
                  <div className="flex-1">
                    <p className="text-2xl font-bold"><Revenue value={totals.revenue} symbol={currencySymbol} /></p>
                    <p className="text-sm text-gray-500">Total Revenue</p>
                    {comparisonTotals ? (
                      <div className="flex items-center gap-2 text-xs">
                        <span className="text-gray-400">{comparisonLabel}: <Revenue value={comparisonTotals.revenue} symbol={currencySymbol} /></span>
                        {revenueChange !== null && (
                          <span className={revenueChange >= 0 ? 'text-green-600 font-medium' : 'text-red-600 font-medium'}>
                            {revenueChange >= 0 ? '+' : ''}{revenueChange.toFixed(1)}%
                          </span>
                        )}
                      </div>
                    ) : (
                      <p className="text-xs text-gray-400"><Revenue value={avgDailyRevenue} symbol={currencySymbol} />/day avg</p>
                    )}
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
                  <div className="flex-1">
                    <p className="text-2xl font-bold">{totals.quantity.toLocaleString()}</p>
                    <p className="text-sm text-gray-500">Units Sold</p>
                    {comparisonTotals ? (
                      <div className="flex items-center gap-2 text-xs">
                        <span className="text-gray-400">{comparisonLabel}: {comparisonTotals.quantity.toLocaleString()}</span>
                        {unitsChange !== null && (
                          <span className={unitsChange >= 0 ? 'text-green-600 font-medium' : 'text-red-600 font-medium'}>
                            {unitsChange >= 0 ? '+' : ''}{unitsChange.toFixed(1)}%
                          </span>
                        )}
                      </div>
                    ) : (
                      <p className="text-xs text-gray-400">{avgDailyUnits.toFixed(1)}/day avg</p>
                    )}
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
                  <div className="flex-1">
                    <p className="text-2xl font-bold">{totals.orders.toLocaleString()}</p>
                    <p className="text-sm text-gray-500">Total Orders</p>
                    {comparisonTotals ? (
                      <div className="flex items-center gap-2 text-xs">
                        <span className="text-gray-400">{comparisonLabel}: {comparisonTotals.orders.toLocaleString()}</span>
                        {ordersChange !== null && (
                          <span className={ordersChange >= 0 ? 'text-green-600 font-medium' : 'text-red-600 font-medium'}>
                            {ordersChange >= 0 ? '+' : ''}{ordersChange.toFixed(1)}%
                          </span>
                        )}
                      </div>
                    ) : (
                      <p className="text-xs text-gray-400">{avgDailyOrders.toFixed(1)}/day avg</p>
                    )}
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
                  <div className="flex-1">
                    <p className="text-2xl font-bold">
                      {currencySymbol}{currentAov.toFixed(2)}
                    </p>
                    <p className="text-sm text-gray-500">Avg Order Value</p>
                    {comparisonTotals ? (
                      <div className="flex items-center gap-2 text-xs">
                        <span className="text-gray-400">{comparisonLabel}: {currencySymbol}{comparisonAov.toFixed(2)}</span>
                        {aovChange !== null && (
                          <span className={aovChange >= 0 ? 'text-green-600 font-medium' : 'text-red-600 font-medium'}>
                            {aovChange >= 0 ? '+' : ''}{aovChange.toFixed(1)}%
                          </span>
                        )}
                      </div>
                    ) : (
                      <p className="text-xs text-gray-400">
                        {totals.quantity > 0 ? (totals.quantity / totals.orders).toFixed(1) : '0'} items/order
                      </p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Active Companies - only for Nuie Marketplace */}
            {isNuieMarketplace && (
              <Card>
                <CardContent className="py-4">
                  <div className="flex items-center gap-3">
                    <div className="p-3 bg-cyan-100 rounded-lg">
                      <Building2 className="h-6 w-6 text-cyan-600" />
                    </div>
                    <div className="flex-1">
                      <p className="text-2xl font-bold">{currentCompanyCount.toLocaleString()}</p>
                      <p className="text-sm text-gray-500">Active Companies</p>
                      {comparisonCompanyCount ? (
                        <div className="flex items-center gap-2 text-xs">
                          <span className="text-gray-400">{comparisonLabel}: {comparisonCompanyCount.toLocaleString()}</span>
                          {companyCountChange !== null && (
                            <span className={companyCountChange >= 0 ? 'text-green-600 font-medium' : 'text-red-600 font-medium'}>
                              {companyCountChange >= 0 ? '+' : ''}{companyCountChange.toFixed(1)}%
                            </span>
                          )}
                        </div>
                      ) : (
                        <p className="text-xs text-gray-400">
                          {totals.orders > 0 && currentCompanyCount > 0 ? (totals.orders / currentCompanyCount).toFixed(1) : '0'} orders/company
                        </p>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        );
      })()}

      {/* Sales Chart - Shows Brand breakdown for Nuie, Channel breakdown for others */}
      <Card>
        <CardHeader>
          <CardTitle>
            {viewMode === 'revenue' ? 'Revenue' : 'Units Sold'} by {isNuieMarketplace && brands.length > 0 ? 'Brand' : 'Channel'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {/* Brand chart for Nuie Marketplace */}
          {isNuieMarketplace && aggregatedBrandChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={400}>
              <ComposedChart data={aggregatedBrandChartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
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
                    viewMode === 'revenue' ? `${currencySymbol}${value.toLocaleString()}` : value.toString()
                  }
                />
                <Tooltip
                  wrapperStyle={{ zIndex: 1000 }}
                  content={<SortedTooltip currencySymbol={currencySymbol} viewMode={viewMode} unitPeriod={unitPeriod} />}
                />
                <Legend
                  onClick={(e: any) => toggleBrand(e.dataKey)}
                  formatter={(value: string) => {
                    const brand = value.replace(/^(units_|revenue_)/, '');
                    return (
                      <span style={{ color: hiddenBrands.has(value) ? '#ccc' : undefined }}>
                        {brand}
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
                  hide={hiddenBrands.has(viewMode === 'revenue' ? 'totalRevenue' : 'totalUnits')}
                />
                {/* Previous year line */}
                {showPreviousYear && (
                  <Line
                    type="monotone"
                    dataKey={viewMode === 'revenue' ? 'previousYearRevenue' : 'previousYearUnits'}
                    stroke="#9333ea"
                    strokeWidth={2}
                    strokeDasharray="3 3"
                    dot={false}
                    name="Last Year"
                    connectNulls={false}
                  />
                )}
                {/* Previous month line */}
                {showPreviousMonth && (
                  <Line
                    type="monotone"
                    dataKey={viewMode === 'revenue' ? 'previousMonthRevenue' : 'previousMonthUnits'}
                    stroke="#0891b2"
                    strokeWidth={2}
                    strokeDasharray="3 3"
                    dot={false}
                    name="Last Month"
                    connectNulls={false}
                  />
                )}
                {/* Brand bars */}
                {brands.map((brand, index) => {
                  const dataKey = viewMode === 'revenue' ? `revenue_${brand}` : `units_${brand}`;
                  return (
                    <Bar
                      key={brand}
                      dataKey={dataKey}
                      stackId="sales"
                      fill={getBrandColor(brand, index)}
                      name={dataKey}
                      hide={hiddenBrands.has(dataKey)}
                    />
                  );
                })}
              </ComposedChart>
            </ResponsiveContainer>
          ) : aggregatedChartData.length === 0 ? (
            <div className="flex items-center justify-center h-64 text-gray-500">
              No sales data available for this period
            </div>
          ) : (
            /* Channel chart for other accounts */
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
                    viewMode === 'revenue' ? `${currencySymbol}${value.toLocaleString()}` : value.toString()
                  }
                />
                <Tooltip
                  wrapperStyle={{ zIndex: 1000 }}
                  content={<SortedTooltip currencySymbol={currencySymbol} viewMode={viewMode} unitPeriod={unitPeriod} />}
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
                {/* Previous year line */}
                {showPreviousYear && (
                  <Line
                    type="monotone"
                    dataKey={viewMode === 'revenue' ? 'previousYearRevenue' : 'previousYearUnits'}
                    stroke="#9333ea"
                    strokeWidth={2}
                    strokeDasharray="3 3"
                    dot={false}
                    name="Last Year"
                    connectNulls={false}
                  />
                )}
                {/* Previous month line */}
                {showPreviousMonth && (
                  <Line
                    type="monotone"
                    dataKey={viewMode === 'revenue' ? 'previousMonthRevenue' : 'previousMonthUnits'}
                    stroke="#0891b2"
                    strokeWidth={2}
                    strokeDasharray="3 3"
                    dot={false}
                    name="Last Month"
                    connectNulls={false}
                  />
                )}
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

      {/* Company Breakdown (for Nuie Marketplace) or Channel Breakdown (for others) */}
      {isNuieMarketplace ? (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Building2 className="h-5 w-5 text-gray-500" />
                <CardTitle>Company Breakdown</CardTitle>
                {companiesData?.pagination && (
                  <span className="text-sm text-gray-500">
                    ({companiesData.pagination.totalCount} companies)
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search companies..."
                    value={companySearchInput}
                    onChange={(e) => setCompanySearchInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        setCompanySearch(companySearchInput);
                        setCompanyPage(1);
                      }
                    }}
                    className="pl-9 pr-3 py-1.5 text-sm border rounded-lg w-48 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <button
                  onClick={() => {
                    setCompanySearch(companySearchInput);
                    setCompanyPage(1);
                  }}
                  className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  Search
                </button>
                {companySearch && (
                  <button
                    onClick={() => {
                      setCompanySearch('');
                      setCompanySearchInput('');
                      setCompanyPage(1);
                    }}
                    className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {companiesLoading ? (
              <div className="flex items-center justify-center h-32">
                <Loading message="Loading company data..." />
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-3 px-4 font-medium text-gray-500">#</th>
                        <th className="text-left py-3 px-4 font-medium text-gray-500">Company</th>
                        <th className="text-right py-3 px-4 font-medium text-gray-500">Revenue</th>
                        {(showPreviousYear || showPreviousMonth) && (
                          <>
                            <th className="text-right py-3 px-4 font-medium text-gray-500">{showPreviousYear ? 'LY' : 'LM'} Revenue</th>
                            <th className="text-right py-3 px-4 font-medium text-gray-500">{showPreviousYear ? 'YoY' : 'MoM'} %</th>
                          </>
                        )}
                        <th className="text-right py-3 px-4 font-medium text-gray-500">Discount</th>
                        <th className="text-right py-3 px-4 font-medium text-gray-500">% of Total</th>
                        <th className="text-right py-3 px-4 font-medium text-gray-500">Units</th>
                        {(showPreviousYear || showPreviousMonth) && (
                          <th className="text-right py-3 px-4 font-medium text-gray-500">{showPreviousYear ? 'LY' : 'LM'} Units</th>
                        )}
                        <th className="text-right py-3 px-4 font-medium text-gray-500">Orders</th>
                        <th className="text-right py-3 px-4 font-medium text-gray-500">Avg Order</th>
                      </tr>
                    </thead>
                    <tbody>
                      {companiesData?.companies.map((company, index) => {
                        const rank = ((companiesData.pagination.page - 1) * companiesData.pagination.pageSize) + index + 1;
                        const percentOfTotal = companiesData.totals.revenue > 0
                          ? (company.revenue / companiesData.totals.revenue) * 100
                          : 0;
                        const comparisonData = showPreviousYear ? company.previousYear : company.previousMonth;
                        const revenueChange = comparisonData && comparisonData.revenue > 0
                          ? ((company.revenue - comparisonData.revenue) / comparisonData.revenue) * 100
                          : null;

                        return (
                          <tr key={company.company} className="border-b hover:bg-gray-50">
                            <td className="py-3 px-4 text-gray-400">{rank}</td>
                            <td className="py-3 px-4">
                              <button
                                onClick={() => navigate(`/companies/${encodeURIComponent(company.company)}`)}
                                className="font-medium text-blue-600 hover:text-blue-800 hover:underline text-left"
                              >
                                {company.company}
                              </button>
                            </td>
                            <td className="text-right py-3 px-4 font-medium">
                              <Revenue value={company.revenue} symbol={currencySymbol} />
                            </td>
                            {(showPreviousYear || showPreviousMonth) && (
                              <>
                                <td className="text-right py-3 px-4 text-gray-500">
                                  {comparisonData ? <Revenue value={comparisonData.revenue} symbol={currencySymbol} /> : '-'}
                                </td>
                                <td className="text-right py-3 px-4">
                                  {revenueChange !== null ? (
                                    <span className={revenueChange >= 0 ? 'text-green-600' : 'text-red-600'}>
                                      {revenueChange >= 0 ? '+' : ''}{revenueChange.toFixed(1)}%
                                    </span>
                                  ) : '-'}
                                </td>
                              </>
                            )}
                            <td className="text-right py-3 px-4 text-gray-500">
                              {company.discount > 0 ? `${currencySymbol}${company.discount.toFixed(2)}` : '-'}
                            </td>
                            <td className="text-right py-3 px-4 text-gray-500">
                              {percentOfTotal.toFixed(1)}%
                            </td>
                            <td className="text-right py-3 px-4">{company.quantity.toLocaleString()}</td>
                            {(showPreviousYear || showPreviousMonth) && (
                              <td className="text-right py-3 px-4 text-gray-500">
                                {comparisonData ? comparisonData.quantity.toLocaleString() : '-'}
                              </td>
                            )}
                            <td className="text-right py-3 px-4">{company.orders.toLocaleString()}</td>
                            <td className="text-right py-3 px-4">{currencySymbol}{company.avgOrderValue.toFixed(2)}</td>
                          </tr>
                        );
                      })}
                      {/* Totals row */}
                      {companiesData && (() => {
                        const comparisonTotals = showPreviousYear ? companiesData.previousYear?.totals : companiesData.previousMonth?.totals;
                        const totalRevenueChange = comparisonTotals && comparisonTotals.revenue > 0
                          ? ((companiesData.totals.revenue - comparisonTotals.revenue) / comparisonTotals.revenue) * 100
                          : null;
                        return (
                          <tr className="bg-gray-50 font-semibold">
                            <td className="py-3 px-4"></td>
                            <td className="py-3 px-4">Total</td>
                            <td className="text-right py-3 px-4">
                              <Revenue value={companiesData.totals.revenue} symbol={currencySymbol} />
                            </td>
                            {(showPreviousYear || showPreviousMonth) && (
                              <>
                                <td className="text-right py-3 px-4 text-gray-600">
                                  {comparisonTotals ? <Revenue value={comparisonTotals.revenue} symbol={currencySymbol} /> : '-'}
                                </td>
                                <td className="text-right py-3 px-4">
                                  {totalRevenueChange !== null ? (
                                    <span className={totalRevenueChange >= 0 ? 'text-green-600' : 'text-red-600'}>
                                      {totalRevenueChange >= 0 ? '+' : ''}{totalRevenueChange.toFixed(1)}%
                                    </span>
                                  ) : '-'}
                                </td>
                              </>
                            )}
                            <td className="text-right py-3 px-4 text-gray-600">
                              {companiesData.totals.discount > 0 ? `${currencySymbol}${companiesData.totals.discount.toFixed(2)}` : '-'}
                            </td>
                            <td className="text-right py-3 px-4">100%</td>
                            <td className="text-right py-3 px-4">{companiesData.totals.quantity.toLocaleString()}</td>
                            {(showPreviousYear || showPreviousMonth) && (
                              <td className="text-right py-3 px-4 text-gray-600">
                                {comparisonTotals ? comparisonTotals.quantity.toLocaleString() : '-'}
                              </td>
                            )}
                            <td className="text-right py-3 px-4">{companiesData.totals.orders.toLocaleString()}</td>
                            <td className="text-right py-3 px-4">
                              {currencySymbol}
                              {companiesData.totals.orders > 0
                                ? (companiesData.totals.revenue / companiesData.totals.orders).toFixed(2)
                                : '0'}
                            </td>
                          </tr>
                        );
                      })()}
                    </tbody>
                  </table>
                </div>

                {/* Pagination */}
                {companiesData?.pagination && companiesData.pagination.totalPages > 1 && (
                  <div className="flex items-center justify-between mt-4 pt-4 border-t">
                    <div className="text-sm text-gray-500">
                      Showing {((companiesData.pagination.page - 1) * companiesData.pagination.pageSize) + 1} to{' '}
                      {Math.min(
                        companiesData.pagination.page * companiesData.pagination.pageSize,
                        companiesData.pagination.totalCount
                      )}{' '}
                      of {companiesData.pagination.totalCount} companies
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setCompanyPage(p => Math.max(1, p - 1))}
                        disabled={companyPage === 1}
                        className="p-2 rounded-lg hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </button>
                      <span className="text-sm">
                        Page {companiesData.pagination.page} of {companiesData.pagination.totalPages}
                      </span>
                      <button
                        onClick={() => setCompanyPage(p => Math.min(companiesData.pagination.totalPages, p + 1))}
                        disabled={companyPage >= companiesData.pagination.totalPages}
                        className="p-2 rounded-lg hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      ) : data?.totalsByChannelDrilldown ? (
        <Card>
          <CardHeader>
            <CardTitle>
              <div className="flex items-center gap-2">
                Channel Breakdown
                <span className="text-xs text-gray-400 font-normal">(click to expand)</span>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-3 px-4 font-medium text-gray-500">Channel / Family / Category / SKU</th>
                    <th className="text-right py-3 px-4 font-medium text-gray-500">Revenue</th>
                    {(showPreviousYear || showPreviousMonth) && (
                      <>
                        <th className="text-right py-3 px-4 font-medium text-gray-500">{showPreviousYear ? 'LY' : 'LM'} Revenue</th>
                        <th className="text-right py-3 px-4 font-medium text-gray-500">{showPreviousYear ? 'YoY' : 'MoM'} %</th>
                      </>
                    )}
                    <th className="text-right py-3 px-4 font-medium text-gray-500">% of Total</th>
                    <th className="text-right py-3 px-4 font-medium text-gray-500">Units</th>
                    {(showPreviousYear || showPreviousMonth) && (
                      <th className="text-right py-3 px-4 font-medium text-gray-500">{showPreviousYear ? 'LY' : 'LM'} Units</th>
                    )}
                    <th className="text-right py-3 px-4 font-medium text-gray-500">Orders</th>
                    <th className="text-right py-3 px-4 font-medium text-gray-500">Avg Order</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(data.totalsByChannelDrilldown)
                    .sort(([, a], [, b]) => b.revenue - a.revenue)
                    .flatMap(([channel, channelData], index) => {
                      const comparisonChannelData = showPreviousYear
                        ? (data?.previousYear?.totalsByChannel?.[channel] || { quantity: 0, revenue: 0, orders: 0 })
                        : (data?.previousMonth?.totalsByChannel?.[channel] || { quantity: 0, revenue: 0, orders: 0 });
                      const percentOfTotal = totals.revenue > 0 ? (channelData.revenue / totals.revenue) * 100 : 0;
                      const avgOrderValue = channelData.orders > 0 ? channelData.revenue / channelData.orders : 0;
                      const revenueChange = comparisonChannelData.revenue > 0 ? ((channelData.revenue - comparisonChannelData.revenue) / comparisonChannelData.revenue) * 100 : null;
                      const isChannelExpanded = expandedChannels.has(channel);
                      const hasFamilies = channelData.families && Object.keys(channelData.families).length > 0;

                      const rows = [
                        // Level 1: Channel row
                        <tr
                          key={channel}
                          className={`border-b hover:bg-gray-50 ${hasFamilies ? 'cursor-pointer' : ''}`}
                          onClick={() => hasFamilies && toggleExpandedChannel(channel)}
                        >
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-2">
                              {hasFamilies && (
                                isChannelExpanded
                                  ? <ChevronDown className="h-4 w-4 text-gray-400" />
                                  : <ChevronRight className="h-4 w-4 text-gray-400" />
                              )}
                              {!hasFamilies && <span className="w-4" />}
                              <div
                                className="w-3 h-3 rounded-full"
                                style={{ backgroundColor: getChannelColor(channel, index) }}
                              />
                              <span className="font-medium">{channel}</span>
                              {hasFamilies && (
                                <span className="text-xs text-gray-400">
                                  ({Object.keys(channelData.families).length} families)
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="text-right py-3 px-4 font-medium">
                            <Revenue value={channelData.revenue} symbol={currencySymbol} />
                          </td>
                          {(showPreviousYear || showPreviousMonth) && (
                            <>
                              <td className="text-right py-3 px-4 text-gray-500">
                                {comparisonChannelData.revenue > 0 ? <Revenue value={comparisonChannelData.revenue} symbol={currencySymbol} /> : '-'}
                              </td>
                              <td className={`text-right py-3 px-4 font-medium ${
                                revenueChange === null ? 'text-gray-400' :
                                revenueChange >= 0 ? 'text-green-600' : 'text-red-600'
                              }`}>
                                {revenueChange !== null ? (
                                  <span className="flex items-center justify-end gap-1">
                                    {revenueChange >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                                    {revenueChange >= 0 ? '+' : ''}{revenueChange.toFixed(1)}%
                                  </span>
                                ) : '-'}
                              </td>
                            </>
                          )}
                          <td className="text-right py-3 px-4 text-gray-500">
                            {percentOfTotal.toFixed(1)}%
                          </td>
                          <td className="text-right py-3 px-4">{channelData.quantity.toLocaleString()}</td>
                          {(showPreviousYear || showPreviousMonth) && (
                            <td className="text-right py-3 px-4 text-gray-500">
                              {comparisonChannelData.quantity > 0 ? comparisonChannelData.quantity.toLocaleString() : '-'}
                            </td>
                          )}
                          <td className="text-right py-3 px-4">{channelData.orders.toLocaleString()}</td>
                          <td className="text-right py-3 px-4">{currencySymbol}{avgOrderValue.toFixed(2)}</td>
                        </tr>
                      ];

                      // Level 2: Family rows (only if channel expanded)
                      if (isChannelExpanded && hasFamilies) {
                        const familyRows = Object.entries(channelData.families)
                          .sort(([, a], [, b]) => b.revenue - a.revenue)
                          .flatMap(([family, familyData]) => {
                            const familyPercentOfChannel = channelData.revenue > 0 ? (familyData.revenue / channelData.revenue) * 100 : 0;
                            const familyAvgOrderValue = familyData.orders > 0 ? familyData.revenue / familyData.orders : 0;
                            const familyKey = `${channel}:${family}`;
                            const isFamilyExpanded = expandedChannelFamilies.has(familyKey);
                            const hasCategories = familyData.categories && Object.keys(familyData.categories).length > 0;

                            const familyRowItems = [
                              // Level 2: Family row
                              <tr
                                key={familyKey}
                                className={`border-b bg-gray-50/50 hover:bg-gray-100 ${hasCategories ? 'cursor-pointer' : ''}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  hasCategories && toggleExpandedChannelFamily(channel, family);
                                }}
                              >
                                <td className="py-2 px-4 pl-10">
                                  <div className="flex items-center gap-2">
                                    {hasCategories && (
                                      isFamilyExpanded
                                        ? <ChevronDown className="h-3 w-3 text-gray-400" />
                                        : <ChevronRight className="h-3 w-3 text-gray-400" />
                                    )}
                                    {!hasCategories && <span className="w-3" />}
                                    <span className="text-sm text-gray-600">{family}</span>
                                    {hasCategories && (
                                      <span className="text-xs text-gray-400">
                                        ({Object.keys(familyData.categories).length} categories)
                                      </span>
                                    )}
                                  </div>
                                </td>
                                <td className="text-right py-2 px-4 text-sm">
                                  <Revenue value={familyData.revenue} symbol={currencySymbol} />
                                </td>
                                {(showPreviousYear || showPreviousMonth) && (
                                  <>
                                    <td className="text-right py-2 px-4 text-sm text-gray-500">-</td>
                                    <td className="text-right py-2 px-4 text-sm text-gray-400">-</td>
                                  </>
                                )}
                                <td className="text-right py-2 px-4 text-sm text-gray-500">
                                  {familyPercentOfChannel.toFixed(1)}%
                                </td>
                                <td className="text-right py-2 px-4 text-sm">{familyData.quantity.toLocaleString()}</td>
                                {(showPreviousYear || showPreviousMonth) && (
                                  <td className="text-right py-2 px-4 text-sm text-gray-500">-</td>
                                )}
                                <td className="text-right py-2 px-4 text-sm">{familyData.orders.toLocaleString()}</td>
                                <td className="text-right py-2 px-4 text-sm">{currencySymbol}{familyAvgOrderValue.toFixed(2)}</td>
                              </tr>
                            ];

                            // Level 3: Category rows (only if family expanded)
                            if (isFamilyExpanded && hasCategories) {
                              const categoryRows = Object.entries(familyData.categories)
                                .sort(([, a], [, b]) => b.revenue - a.revenue)
                                .flatMap(([category, categoryData]) => {
                                  const categoryPercentOfFamily = familyData.revenue > 0 ? (categoryData.revenue / familyData.revenue) * 100 : 0;
                                  const categoryAvgOrderValue = categoryData.orders > 0 ? categoryData.revenue / categoryData.orders : 0;
                                  const categoryKey = `${channel}:${family}:${category}`;
                                  const isCategoryExpanded = expandedChannelCategories.has(categoryKey);
                                  const hasSkus = categoryData.skus && categoryData.skus.length > 0;

                                  const categoryRowItems = [
                                    // Level 3: Category row
                                    <tr
                                      key={categoryKey}
                                      className={`border-b bg-gray-100/50 hover:bg-gray-100 ${hasSkus ? 'cursor-pointer' : ''}`}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        hasSkus && toggleExpandedChannelCategory(channel, family, category);
                                      }}
                                    >
                                      <td className="py-2 px-4 pl-16">
                                        <div className="flex items-center gap-2">
                                          {hasSkus && (
                                            isCategoryExpanded
                                              ? <ChevronDown className="h-3 w-3 text-gray-400" />
                                              : <ChevronRight className="h-3 w-3 text-gray-400" />
                                          )}
                                          {!hasSkus && <span className="w-3" />}
                                          <span className="text-xs text-gray-600">{category}</span>
                                          {hasSkus && categoryData.skus && (
                                            <span className="text-xs text-gray-400">
                                              ({categoryData.totalSkuCount || categoryData.skus.length} SKUs)
                                            </span>
                                          )}
                                        </div>
                                      </td>
                                      <td className="text-right py-2 px-4 text-xs">
                                        <Revenue value={categoryData.revenue} symbol={currencySymbol} />
                                      </td>
                                      {(showPreviousYear || showPreviousMonth) && (
                                        <>
                                          <td className="text-right py-2 px-4 text-xs text-gray-500">-</td>
                                          <td className="text-right py-2 px-4 text-xs text-gray-400">-</td>
                                        </>
                                      )}
                                      <td className="text-right py-2 px-4 text-xs text-gray-500">
                                        {categoryPercentOfFamily.toFixed(1)}%
                                      </td>
                                      <td className="text-right py-2 px-4 text-xs">{categoryData.quantity.toLocaleString()}</td>
                                      {(showPreviousYear || showPreviousMonth) && (
                                        <td className="text-right py-2 px-4 text-xs text-gray-500">-</td>
                                      )}
                                      <td className="text-right py-2 px-4 text-xs">{categoryData.orders.toLocaleString()}</td>
                                      <td className="text-right py-2 px-4 text-xs">{currencySymbol}{categoryAvgOrderValue.toFixed(2)}</td>
                                    </tr>
                                  ];

                                  // Level 4: SKU rows (only if category expanded)
                                  if (isCategoryExpanded && hasSkus && categoryData.skus) {
                                    const skuRows = categoryData.skus
                                      .sort((a, b) => b.revenue - a.revenue)
                                      .map((skuData) => {
                                        const skuPercentOfCategory = categoryData.revenue > 0 ? (skuData.revenue / categoryData.revenue) * 100 : 0;
                                        const skuAvgOrderValue = skuData.orders > 0 ? skuData.revenue / skuData.orders : 0;

                                        return (
                                          <tr
                                            key={`${categoryKey}:${skuData.sku}`}
                                            className="border-b bg-gray-100 hover:bg-gray-200 cursor-pointer"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              navigate(`/products/${encodeURIComponent(skuData.sku)}`);
                                            }}
                                          >
                                            <td className="py-2 px-4 pl-24">
                                              <div className="flex flex-col gap-0.5">
                                                <span className="text-xs font-mono text-blue-600">{skuData.sku}</span>
                                                <span className="text-xs text-gray-500">{skuData.title}</span>
                                              </div>
                                            </td>
                                            <td className="text-right py-2 px-4 text-xs">
                                              <Revenue value={skuData.revenue} symbol={currencySymbol} />
                                            </td>
                                            {(showPreviousYear || showPreviousMonth) && (
                                              <>
                                                <td className="text-right py-2 px-4 text-xs text-gray-500">-</td>
                                                <td className="text-right py-2 px-4 text-xs text-gray-400">-</td>
                                              </>
                                            )}
                                            <td className="text-right py-2 px-4 text-xs text-gray-500">
                                              {skuPercentOfCategory.toFixed(1)}%
                                            </td>
                                            <td className="text-right py-2 px-4 text-xs">{skuData.quantity.toLocaleString()}</td>
                                            {(showPreviousYear || showPreviousMonth) && (
                                              <td className="text-right py-2 px-4 text-xs text-gray-500">-</td>
                                            )}
                                            <td className="text-right py-2 px-4 text-xs">{skuData.orders.toLocaleString()}</td>
                                            <td className="text-right py-2 px-4 text-xs">{currencySymbol}{skuAvgOrderValue.toFixed(2)}</td>
                                          </tr>
                                        );
                                      });
                                    categoryRowItems.push(...skuRows);

                                    // Show "Showing X of Y" message if there are more SKUs
                                    const totalSkuCount = categoryData.totalSkuCount || categoryData.skus.length;
                                    if (totalSkuCount > categoryData.skus.length) {
                                      categoryRowItems.push(
                                        <tr key={`${categoryKey}:more`} className="border-b bg-gray-50">
                                          <td colSpan={showPreviousYear || showPreviousMonth ? 9 : 6} className="py-2 px-4 pl-24">
                                            <span className="text-xs text-gray-400 italic">
                                              Showing top {categoryData.skus.length} of {totalSkuCount} SKUs by revenue
                                            </span>
                                          </td>
                                        </tr>
                                      );
                                    }
                                  }

                                  return categoryRowItems;
                                });
                              familyRowItems.push(...categoryRows);
                            }

                            return familyRowItems;
                          });
                        rows.push(...familyRows);
                      }

                      return rows;
                    })}
                  {/* Totals row */}
                  {(() => {
                    const comparisonTotals = showPreviousYear ? data?.previousYear?.totals : data?.previousMonth?.totals;
                    return (
                      <tr className="bg-gray-50 font-semibold">
                        <td className="py-3 px-4">Total</td>
                        <td className="text-right py-3 px-4"><Revenue value={totals.revenue} symbol={currencySymbol} /></td>
                        {(showPreviousYear || showPreviousMonth) && (
                          <>
                            <td className="text-right py-3 px-4 text-gray-600">
                              {comparisonTotals?.revenue ? <Revenue value={comparisonTotals.revenue} symbol={currencySymbol} /> : '-'}
                            </td>
                            <td className={`text-right py-3 px-4 ${
                              !comparisonTotals?.revenue ? 'text-gray-400' :
                              totals.revenue >= comparisonTotals.revenue ? 'text-green-600' : 'text-red-600'
                            }`}>
                              {comparisonTotals?.revenue ? (
                                <span className="flex items-center justify-end gap-1">
                                  {totals.revenue >= comparisonTotals.revenue ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                                  {((totals.revenue - comparisonTotals.revenue) / comparisonTotals.revenue * 100).toFixed(1)}%
                                </span>
                              ) : '-'}
                            </td>
                          </>
                        )}
                        <td className="text-right py-3 px-4">100%</td>
                        <td className="text-right py-3 px-4">{totals.quantity.toLocaleString()}</td>
                        {(showPreviousYear || showPreviousMonth) && (
                          <td className="text-right py-3 px-4 text-gray-600">
                            {comparisonTotals?.quantity ? comparisonTotals.quantity.toLocaleString() : '-'}
                          </td>
                        )}
                        <td className="text-right py-3 px-4">{totals.orders.toLocaleString()}</td>
                        <td className="text-right py-3 px-4">
                          {currencySymbol}{totals.orders > 0 ? (totals.revenue / totals.orders).toFixed(2) : '0'}
                        </td>
                      </tr>
                    );
                  })()}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ) : (
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
                    {(showPreviousYear || showPreviousMonth) && (
                      <>
                        <th className="text-right py-3 px-4 font-medium text-gray-500">{showPreviousYear ? 'LY' : 'LM'} Revenue</th>
                        <th className="text-right py-3 px-4 font-medium text-gray-500">{showPreviousYear ? 'YoY' : 'MoM'} %</th>
                      </>
                    )}
                    <th className="text-right py-3 px-4 font-medium text-gray-500">% of Total</th>
                    <th className="text-right py-3 px-4 font-medium text-gray-500">Units</th>
                    {(showPreviousYear || showPreviousMonth) && (
                      <th className="text-right py-3 px-4 font-medium text-gray-500">{showPreviousYear ? 'LY' : 'LM'} Units</th>
                    )}
                    <th className="text-right py-3 px-4 font-medium text-gray-500">Orders</th>
                    <th className="text-right py-3 px-4 font-medium text-gray-500">Avg Order</th>
                  </tr>
                </thead>
                <tbody>
                  {channels
                    .sort((a, b) => (totalsByChannel[b]?.revenue || 0) - (totalsByChannel[a]?.revenue || 0))
                    .map((channel, index) => {
                      const channelData = totalsByChannel[channel] || { quantity: 0, revenue: 0, orders: 0 };
                      const comparisonChannelData = showPreviousYear
                        ? (data?.previousYear?.totalsByChannel?.[channel] || { quantity: 0, revenue: 0, orders: 0 })
                        : (data?.previousMonth?.totalsByChannel?.[channel] || { quantity: 0, revenue: 0, orders: 0 });
                      const percentOfTotal = totals.revenue > 0 ? (channelData.revenue / totals.revenue) * 100 : 0;
                      const avgOrderValue = channelData.orders > 0 ? channelData.revenue / channelData.orders : 0;
                      const revenueChange = comparisonChannelData.revenue > 0 ? ((channelData.revenue - comparisonChannelData.revenue) / comparisonChannelData.revenue) * 100 : null;

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
                            <Revenue value={channelData.revenue} symbol={currencySymbol} />
                          </td>
                          {(showPreviousYear || showPreviousMonth) && (
                            <>
                              <td className="text-right py-3 px-4 text-gray-500">
                                {comparisonChannelData.revenue > 0 ? <Revenue value={comparisonChannelData.revenue} symbol={currencySymbol} /> : '-'}
                              </td>
                              <td className={`text-right py-3 px-4 font-medium ${
                                revenueChange === null ? 'text-gray-400' :
                                revenueChange >= 0 ? 'text-green-600' : 'text-red-600'
                              }`}>
                                {revenueChange !== null ? (
                                  <span className="flex items-center justify-end gap-1">
                                    {revenueChange >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                                    {revenueChange >= 0 ? '+' : ''}{revenueChange.toFixed(1)}%
                                  </span>
                                ) : '-'}
                              </td>
                            </>
                          )}
                          <td className="text-right py-3 px-4 text-gray-500">
                            {percentOfTotal.toFixed(1)}%
                          </td>
                          <td className="text-right py-3 px-4">{channelData.quantity.toLocaleString()}</td>
                          {(showPreviousYear || showPreviousMonth) && (
                            <td className="text-right py-3 px-4 text-gray-500">
                              {comparisonChannelData.quantity > 0 ? comparisonChannelData.quantity.toLocaleString() : '-'}
                            </td>
                          )}
                          <td className="text-right py-3 px-4">{channelData.orders.toLocaleString()}</td>
                          <td className="text-right py-3 px-4">{currencySymbol}{avgOrderValue.toFixed(2)}</td>
                        </tr>
                      );
                    })}
                  {/* Totals row */}
                  {(() => {
                    const comparisonTotals = showPreviousYear ? data?.previousYear?.totals : data?.previousMonth?.totals;
                    return (
                      <tr className="bg-gray-50 font-semibold">
                        <td className="py-3 px-4">Total</td>
                        <td className="text-right py-3 px-4"><Revenue value={totals.revenue} symbol={currencySymbol} /></td>
                        {(showPreviousYear || showPreviousMonth) && (
                          <>
                            <td className="text-right py-3 px-4 text-gray-600">
                              {comparisonTotals?.revenue ? <Revenue value={comparisonTotals.revenue} symbol={currencySymbol} /> : '-'}
                            </td>
                            <td className={`text-right py-3 px-4 ${
                              !comparisonTotals?.revenue ? 'text-gray-400' :
                              totals.revenue >= comparisonTotals.revenue ? 'text-green-600' : 'text-red-600'
                            }`}>
                              {comparisonTotals?.revenue ? (
                                <span className="flex items-center justify-end gap-1">
                                  {totals.revenue >= comparisonTotals.revenue ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                                  {((totals.revenue - comparisonTotals.revenue) / comparisonTotals.revenue * 100).toFixed(1)}%
                                </span>
                              ) : '-'}
                            </td>
                          </>
                        )}
                        <td className="text-right py-3 px-4">100%</td>
                        <td className="text-right py-3 px-4">{totals.quantity.toLocaleString()}</td>
                        {(showPreviousYear || showPreviousMonth) && (
                          <td className="text-right py-3 px-4 text-gray-600">
                            {comparisonTotals?.quantity ? comparisonTotals.quantity.toLocaleString() : '-'}
                          </td>
                        )}
                        <td className="text-right py-3 px-4">{totals.orders.toLocaleString()}</td>
                        <td className="text-right py-3 px-4">
                          {currencySymbol}{totals.orders > 0 ? (totals.revenue / totals.orders).toFixed(2) : '0'}
                        </td>
                      </tr>
                    );
                  })()}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Family Breakdown Chart (from Akeneo PIM) - Same layout as Channel chart */}
      {aggregatedFamilyChartData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>
              {viewMode === 'revenue' ? 'Revenue' : 'Units Sold'} by Family
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={400}>
              <ComposedChart data={aggregatedFamilyChartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
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
                    viewMode === 'revenue' ? `${currencySymbol}${value.toLocaleString()}` : value.toString()
                  }
                />
                <Tooltip
                  wrapperStyle={{ zIndex: 1000 }}
                  content={<SortedTooltip currencySymbol={currencySymbol} viewMode={viewMode} unitPeriod={unitPeriod} />}
                />
                <Legend
                  onClick={(e: any) => toggleFamily(e.dataKey)}
                  formatter={(value: string) => {
                    const family = value.replace(/^(units_|revenue_)/, '');
                    return (
                      <span style={{ color: hiddenFamilies.has(value) ? '#ccc' : undefined }}>
                        {family}
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
                  hide={hiddenFamilies.has(viewMode === 'revenue' ? 'totalRevenue' : 'totalUnits')}
                />
                {/* Family bars */}
                {families.map((family, index) => {
                  const dataKey = viewMode === 'revenue' ? `revenue_${family}` : `units_${family}`;
                  return (
                    <Bar
                      key={family}
                      dataKey={dataKey}
                      stackId="familySales"
                      fill={getFamilyColor(family, index)}
                      name={dataKey}
                      hide={hiddenFamilies.has(dataKey)}
                    />
                  );
                })}
              </ComposedChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Family / Stock Code Breakdown Table - Expandable with Categories and SKUs */}
      {data?.totalsByFamily && Object.keys(data.totalsByFamily).length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Layers className="h-5 w-5 text-gray-500" />
                <CardTitle>{showStockCodes ? 'Stock Code Breakdown' : 'Family Breakdown'}</CardTitle>
                <span className="text-sm text-gray-500">(click to expand)</span>
              </div>
              <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
                <button
                  onClick={() => setShowStockCodes(false)}
                  className={`px-3 py-1 text-sm rounded-md transition-colors ${
                    !showStockCodes
                      ? 'bg-white text-blue-600 shadow-sm font-medium'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  Family
                </button>
                <button
                  onClick={() => setShowStockCodes(true)}
                  className={`px-3 py-1 text-sm rounded-md transition-colors ${
                    showStockCodes
                      ? 'bg-white text-blue-600 shadow-sm font-medium'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  Stock Code
                </button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {/* Stock Code Breakdown Table */}
            {showStockCodes && data?.totalsByStockCode && (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-3 px-4 font-medium text-gray-500">Stock Code / Sales Code (SKU)</th>
                      <th className="text-right py-3 px-4 font-medium text-gray-500">Revenue</th>
                      <th className="text-right py-3 px-4 font-medium text-gray-500">% of Total</th>
                      <th className="text-right py-3 px-4 font-medium text-gray-500">Units</th>
                      <th className="text-right py-3 px-4 font-medium text-gray-500">Orders</th>
                      <th className="text-right py-3 px-4 font-medium text-gray-500">Avg Order</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(data.totalsByStockCode)
                      .sort(([, a], [, b]) => b.revenue - a.revenue)
                      .flatMap(([stockCode, stockCodeData]) => {
                        const percentOfTotal = totals.revenue > 0 ? (stockCodeData.revenue / totals.revenue) * 100 : 0;
                        const avgOrderValue = stockCodeData.orders > 0 ? stockCodeData.revenue / stockCodeData.orders : 0;
                        const isExpanded = expandedStockCodes.has(stockCode);
                        const hasSkus = stockCodeData.skus && stockCodeData.skus.length > 1; // Only expandable if more than 1 SKU

                        const rows = [
                          // Stock Code row
                          <tr
                            key={stockCode}
                            className={`border-b hover:bg-gray-50 ${hasSkus ? 'cursor-pointer' : ''}`}
                            onClick={() => hasSkus && toggleExpandedStockCode(stockCode)}
                          >
                            <td className="py-3 px-4">
                              <div className="flex items-center gap-2">
                                {hasSkus && (
                                  isExpanded
                                    ? <ChevronDown className="h-4 w-4 text-gray-400" />
                                    : <ChevronRight className="h-4 w-4 text-gray-400" />
                                )}
                                {!hasSkus && <span className="w-4" />}
                                <span className="font-medium font-mono">{stockCode}</span>
                                {hasSkus && (
                                  <span className="text-xs text-gray-400">
                                    ({stockCodeData.skus.length} variants)
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="text-right py-3 px-4 font-medium">
                              <Revenue value={stockCodeData.revenue} symbol={currencySymbol} />
                            </td>
                            <td className="text-right py-3 px-4 text-gray-500">
                              {percentOfTotal.toFixed(1)}%
                            </td>
                            <td className="text-right py-3 px-4">{stockCodeData.quantity.toLocaleString()}</td>
                            <td className="text-right py-3 px-4">{stockCodeData.orders.toLocaleString()}</td>
                            <td className="text-right py-3 px-4">{currencySymbol}{avgOrderValue.toFixed(2)}</td>
                          </tr>
                        ];

                        // Sales Code (SKU) rows - only if expanded
                        if (isExpanded && hasSkus) {
                          stockCodeData.skus.forEach((sku) => {
                            rows.push(
                              <tr
                                key={`${stockCode}-${sku}`}
                                className="border-b bg-gray-50/50 hover:bg-gray-100 cursor-pointer"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  navigate(`/products/${encodeURIComponent(sku)}`);
                                }}
                              >
                                <td className="py-2 px-4 pl-10">
                                  <span className="text-sm font-mono text-blue-600 hover:underline">{sku}</span>
                                </td>
                                <td className="text-right py-2 px-4 text-sm text-gray-400">-</td>
                                <td className="text-right py-2 px-4 text-sm text-gray-400">-</td>
                                <td className="text-right py-2 px-4 text-sm text-gray-400">-</td>
                                <td className="text-right py-2 px-4 text-sm text-gray-400">-</td>
                                <td className="text-right py-2 px-4 text-sm text-gray-400">-</td>
                              </tr>
                            );
                          });
                        }

                        return rows;
                      })}
                    {/* Totals row */}
                    <tr className="bg-gray-100 font-semibold">
                      <td className="py-3 px-4">Total ({data.stockCodes?.length || 0} Stock Codes)</td>
                      <td className="text-right py-3 px-4"><Revenue value={totals.revenue} symbol={currencySymbol} /></td>
                      <td className="text-right py-3 px-4">100%</td>
                      <td className="text-right py-3 px-4">{totals.quantity.toLocaleString()}</td>
                      <td className="text-right py-3 px-4">{totals.orders.toLocaleString()}</td>
                      <td className="text-right py-3 px-4">
                        {currencySymbol}{totals.orders > 0 ? (totals.revenue / totals.orders).toFixed(2) : '0'}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}

            {/* Family Breakdown Table */}
            {!showStockCodes && (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-3 px-4 font-medium text-gray-500">Family / Category / SKU</th>
                    <th className="text-right py-3 px-4 font-medium text-gray-500">Revenue</th>
                    {(showPreviousYear || showPreviousMonth) && (
                      <>
                        <th className="text-right py-3 px-4 font-medium text-gray-500">{showPreviousYear ? 'LY' : 'LM'} Revenue</th>
                        <th className="text-right py-3 px-4 font-medium text-gray-500">{showPreviousYear ? 'YoY' : 'MoM'} %</th>
                      </>
                    )}
                    <th className="text-right py-3 px-4 font-medium text-gray-500">% of Total</th>
                    <th className="text-right py-3 px-4 font-medium text-gray-500">Units</th>
                    {(showPreviousYear || showPreviousMonth) && (
                      <th className="text-right py-3 px-4 font-medium text-gray-500">{showPreviousYear ? 'LY' : 'LM'} Units</th>
                    )}
                    <th className="text-right py-3 px-4 font-medium text-gray-500">Orders</th>
                    <th className="text-right py-3 px-4 font-medium text-gray-500">Avg Order</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(data.totalsByFamily)
                    .sort(([, a], [, b]) => b.revenue - a.revenue)
                    .flatMap(([family, familyData]) => {
                      const comparisonFamilyData = showPreviousYear
                        ? (data?.previousYearTotalsByFamily?.[family] || { quantity: 0, revenue: 0, orders: 0, categories: {} })
                        : (data?.previousMonthTotalsByFamily?.[family] || { quantity: 0, revenue: 0, orders: 0, categories: {} });
                      const percentOfTotal = totals.revenue > 0 ? (familyData.revenue / totals.revenue) * 100 : 0;
                      const avgOrderValue = familyData.orders > 0 ? familyData.revenue / familyData.orders : 0;
                      const revenueChange = comparisonFamilyData.revenue > 0 ? ((familyData.revenue - comparisonFamilyData.revenue) / comparisonFamilyData.revenue) * 100 : null;
                      const isExpanded = expandedFamilies.has(family);
                      const hasCategories = familyData.categories && Object.keys(familyData.categories).length > 0;

                      const rows = [
                        // Family row
                        <tr
                          key={family}
                          className={`border-b hover:bg-gray-50 ${hasCategories ? 'cursor-pointer' : ''}`}
                          onClick={() => hasCategories && toggleExpandedFamily(family)}
                        >
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-2">
                              {hasCategories && (
                                isExpanded
                                  ? <ChevronDown className="h-4 w-4 text-gray-400" />
                                  : <ChevronRight className="h-4 w-4 text-gray-400" />
                              )}
                              {!hasCategories && <span className="w-4" />}
                              <span className="font-medium">{family}</span>
                              {hasCategories && (
                                <span className="text-xs text-gray-400">
                                  ({Object.keys(familyData.categories).length} categories)
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="text-right py-3 px-4 font-medium">
                            <Revenue value={familyData.revenue} symbol={currencySymbol} />
                          </td>
                          {(showPreviousYear || showPreviousMonth) && (
                            <>
                              <td className="text-right py-3 px-4 text-gray-500">
                                {comparisonFamilyData.revenue > 0 ? <Revenue value={comparisonFamilyData.revenue} symbol={currencySymbol} /> : '-'}
                              </td>
                              <td className={`text-right py-3 px-4 font-medium ${
                                revenueChange === null ? 'text-gray-400' :
                                revenueChange >= 0 ? 'text-green-600' : 'text-red-600'
                              }`}>
                                {revenueChange !== null ? (
                                  <span className="flex items-center justify-end gap-1">
                                    {revenueChange >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                                    {revenueChange >= 0 ? '+' : ''}{revenueChange.toFixed(1)}%
                                  </span>
                                ) : '-'}
                              </td>
                            </>
                          )}
                          <td className="text-right py-3 px-4 text-gray-500">
                            {percentOfTotal.toFixed(1)}%
                          </td>
                          <td className="text-right py-3 px-4">{familyData.quantity.toLocaleString()}</td>
                          {(showPreviousYear || showPreviousMonth) && (
                            <td className="text-right py-3 px-4 text-gray-500">
                              {comparisonFamilyData.quantity > 0 ? comparisonFamilyData.quantity.toLocaleString() : '-'}
                            </td>
                          )}
                          <td className="text-right py-3 px-4">{familyData.orders.toLocaleString()}</td>
                          <td className="text-right py-3 px-4">{currencySymbol}{avgOrderValue.toFixed(2)}</td>
                        </tr>
                      ];

                      // Category rows (only if expanded) - now also expandable to SKUs
                      if (isExpanded && hasCategories) {
                        const categoryRows = Object.entries(familyData.categories)
                          .sort(([, a], [, b]) => b.revenue - a.revenue)
                          .flatMap(([category, catData]) => {
                            const comparisonCatData = (comparisonFamilyData as any)?.categories?.[category] || { quantity: 0, revenue: 0, orders: 0 };
                            const catPercentOfFamily = familyData.revenue > 0 ? (catData.revenue / familyData.revenue) * 100 : 0;
                            const catAvgOrderValue = catData.orders > 0 ? catData.revenue / catData.orders : 0;
                            const catRevenueChange = comparisonCatData.revenue > 0 ? ((catData.revenue - comparisonCatData.revenue) / comparisonCatData.revenue) * 100 : null;
                            const categoryKey = `${family}:${category}`;
                            const isCategoryExpanded = expandedCategories.has(categoryKey);
                            const hasSkus = catData.skus && catData.skus.length > 0;

                            const catRows: JSX.Element[] = [
                              <tr
                                key={`${family}-${category}`}
                                className={`border-b bg-gray-50/50 hover:bg-gray-100 ${hasSkus ? 'cursor-pointer' : ''}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (hasSkus) toggleExpandedCategory(family, category);
                                }}
                              >
                                <td className="py-2 px-4 pl-10">
                                  <div className="flex items-center gap-2">
                                    {hasSkus && (
                                      isCategoryExpanded
                                        ? <ChevronDown className="h-3 w-3 text-gray-400" />
                                        : <ChevronRight className="h-3 w-3 text-gray-400" />
                                    )}
                                    {!hasSkus && <span className="w-3" />}
                                    <span className="text-sm text-gray-600">{category}</span>
                                    {hasSkus && (
                                      <span className="text-xs text-gray-400">({catData.totalSkuCount || catData.skus!.length} SKUs)</span>
                                    )}
                                  </div>
                                </td>
                                <td className="text-right py-2 px-4 text-sm">
                                  <Revenue value={catData.revenue} symbol={currencySymbol} />
                                </td>
                                {(showPreviousYear || showPreviousMonth) && (
                                  <>
                                    <td className="text-right py-2 px-4 text-sm text-gray-500">
                                      {comparisonCatData.revenue > 0 ? <Revenue value={comparisonCatData.revenue} symbol={currencySymbol} /> : '-'}
                                    </td>
                                    <td className={`text-right py-2 px-4 text-sm ${
                                      catRevenueChange === null ? 'text-gray-400' :
                                      catRevenueChange >= 0 ? 'text-green-600' : 'text-red-600'
                                    }`}>
                                      {catRevenueChange !== null ? (
                                        <span className="flex items-center justify-end gap-1">
                                          {catRevenueChange >= 0 ? '+' : ''}{catRevenueChange.toFixed(1)}%
                                        </span>
                                      ) : '-'}
                                    </td>
                                  </>
                                )}
                                <td className="text-right py-2 px-4 text-sm text-gray-500">
                                  {catPercentOfFamily.toFixed(1)}%
                                </td>
                                <td className="text-right py-2 px-4 text-sm">{catData.quantity.toLocaleString()}</td>
                                {(showPreviousYear || showPreviousMonth) && (
                                  <td className="text-right py-2 px-4 text-sm text-gray-500">
                                    {comparisonCatData.quantity > 0 ? comparisonCatData.quantity.toLocaleString() : '-'}
                                  </td>
                                )}
                                <td className="text-right py-2 px-4 text-sm">{catData.orders.toLocaleString()}</td>
                                <td className="text-right py-2 px-4 text-sm">{currencySymbol}{catAvgOrderValue.toFixed(2)}</td>
                              </tr>
                            ];

                            // SKU rows (only if category is expanded)
                            if (isCategoryExpanded && hasSkus) {
                              catData.skus!
                                .sort((a, b) => b.revenue - a.revenue)
                                .forEach((skuData) => {
                                  const skuPercentOfCategory = catData.revenue > 0 ? (skuData.revenue / catData.revenue) * 100 : 0;
                                  const skuAvgOrderValue = skuData.orders > 0 ? skuData.revenue / skuData.orders : 0;
                                  catRows.push(
                                    <tr
                                      key={`${family}-${category}-${skuData.sku}`}
                                      className="border-b bg-gray-100 hover:bg-gray-200 cursor-pointer"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        navigate(`/products/${encodeURIComponent(skuData.sku)}`);
                                      }}
                                    >
                                      <td className="py-2 px-4 pl-16">
                                        <div>
                                          <span className="font-mono text-xs text-blue-600 hover:underline">{skuData.sku}</span>
                                          <p className="text-xs text-gray-500 truncate max-w-xs" title={skuData.title}>{skuData.title}</p>
                                        </div>
                                      </td>
                                      <td className="text-right py-2 px-4 text-xs">
                                        <Revenue value={skuData.revenue} symbol={currencySymbol} />
                                      </td>
                                      {(showPreviousYear || showPreviousMonth) && (
                                        <>
                                          <td className="text-right py-2 px-4 text-xs text-gray-400">-</td>
                                          <td className="text-right py-2 px-4 text-xs text-gray-400">-</td>
                                        </>
                                      )}
                                      <td className="text-right py-2 px-4 text-xs text-gray-500">
                                        {skuPercentOfCategory.toFixed(1)}%
                                      </td>
                                      <td className="text-right py-2 px-4 text-xs">{skuData.quantity.toLocaleString()}</td>
                                      {(showPreviousYear || showPreviousMonth) && (
                                        <td className="text-right py-2 px-4 text-xs text-gray-400">-</td>
                                      )}
                                      <td className="text-right py-2 px-4 text-xs">{skuData.orders.toLocaleString()}</td>
                                      <td className="text-right py-2 px-4 text-xs">{currencySymbol}{skuAvgOrderValue.toFixed(2)}</td>
                                    </tr>
                                  );
                                });

                              // Show "Showing X of Y" message if there are more SKUs
                              const totalSkuCount = catData.totalSkuCount || catData.skus!.length;
                              if (totalSkuCount > catData.skus!.length) {
                                catRows.push(
                                  <tr key={`${family}-${category}:more`} className="border-b bg-gray-50">
                                    <td colSpan={showPreviousYear || showPreviousMonth ? 9 : 6} className="py-2 px-4 pl-16">
                                      <span className="text-xs text-gray-400 italic">
                                        Showing top {catData.skus!.length} of {totalSkuCount} SKUs by revenue
                                      </span>
                                    </td>
                                  </tr>
                                );
                              }
                            }

                            return catRows;
                          });
                        rows.push(...categoryRows);
                      }

                      return rows;
                    })}
                  {/* Totals row */}
                  {(() => {
                    const comparisonTotals = showPreviousYear ? data?.previousYear?.totals : data?.previousMonth?.totals;
                    return (
                      <tr className="bg-gray-100 font-semibold">
                        <td className="py-3 px-4">Total</td>
                        <td className="text-right py-3 px-4"><Revenue value={totals.revenue} symbol={currencySymbol} /></td>
                        {(showPreviousYear || showPreviousMonth) && (
                          <>
                            <td className="text-right py-3 px-4 text-gray-600">
                              {comparisonTotals?.revenue ? <Revenue value={comparisonTotals.revenue} symbol={currencySymbol} /> : '-'}
                            </td>
                            <td className={`text-right py-3 px-4 ${
                              !comparisonTotals?.revenue ? 'text-gray-400' :
                              totals.revenue >= comparisonTotals.revenue ? 'text-green-600' : 'text-red-600'
                            }`}>
                              {comparisonTotals?.revenue ? (
                                <span className="flex items-center justify-end gap-1">
                                  {totals.revenue >= comparisonTotals.revenue ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                                  {((totals.revenue - comparisonTotals.revenue) / comparisonTotals.revenue * 100).toFixed(1)}%
                                </span>
                              ) : '-'}
                            </td>
                          </>
                        )}
                        <td className="text-right py-3 px-4">100%</td>
                        <td className="text-right py-3 px-4">{totals.quantity.toLocaleString()}</td>
                        {(showPreviousYear || showPreviousMonth) && (
                          <td className="text-right py-3 px-4 text-gray-600">
                            {comparisonTotals?.quantity ? comparisonTotals.quantity.toLocaleString() : '-'}
                          </td>
                        )}
                        <td className="text-right py-3 px-4">{totals.orders.toLocaleString()}</td>
                        <td className="text-right py-3 px-4">
                          {currencySymbol}{totals.orders > 0 ? (totals.revenue / totals.orders).toFixed(2) : '0'}
                        </td>
                      </tr>
                    );
                  })()}
                </tbody>
              </table>
            </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
