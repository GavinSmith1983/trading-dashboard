import { api } from './client';
import type { DashboardSummary } from '../types';

export interface SalesData {
  days: number;
  skuCount: number;
  sales: Record<string, { quantity: number; revenue: number }>;
}

export interface InsightProduct {
  sku: string;
  title: string;
  brand: string;
  imageUrl?: string;
  currentPrice: number;
  costPrice: number;
  deliveryCost: number;
  stockLevel: number;
  margin: number;
  avgDailySales: number;
  avgDailyRevenue: number;
  daysOfStock: number | null;
}

export interface InsightCategory {
  id: string;
  title: string;
  description: string;
  count: number;
  severity: 'critical' | 'warning' | 'info';
  products: InsightProduct[];
  dailyRevenueImpact?: number;
}

export interface InsightsResponse {
  insights: InsightCategory[];
}

export interface CompanyComparisonData {
  quantity: number;
  revenue: number;
  discount: number;
  orders: number;
  companyCount?: number;
}

export interface CompanyData {
  company: string;
  quantity: number;
  revenue: number;
  discount: number;
  orders: number;
  avgOrderValue: number;
  previousYear?: CompanyComparisonData;
  previousMonth?: CompanyComparisonData;
}

export interface CompaniesResponse {
  days: number;
  fromDate: string;
  toDate: string;
  companies: CompanyData[];
  totals: { quantity: number; revenue: number; discount: number; orders: number };
  pagination: {
    page: number;
    pageSize: number;
    totalCount: number;
    totalPages: number;
  };
  previousYear?: { totals: CompanyComparisonData };
  previousMonth?: { totals: CompanyComparisonData };
}

export interface CompanyDetailProduct {
  sku: string;
  title: string;
  brand: string;
  family?: string;
  quantity: number;
  revenue: number;
  orders: number;
}

export interface CompanyDetailResponse {
  company: string;
  dateRange: { fromDate: string; toDate: string; days: number };
  totals: {
    revenue: number;
    discount: number;
    discountPercent: number;
    orders: number;
    quantity: number;
    avgOrderValue: number;
  };
  dailySales: Record<string, { revenue: number; discount: number; orders: number; quantity: number }>;
  familyBreakdown: Record<string, {
    revenue: number;
    quantity: number;
    orders: number;
    categories: Record<string, {
      revenue: number;
      quantity: number;
      orders: number;
      products: Array<{ sku: string; title: string; quantity: number; revenue: number; orders: number }>;
    }>;
  }>;
  topProducts: CompanyDetailProduct[];
}

// Drilldown types for hierarchical sales data
export interface SkuSalesSummary {
  sku: string;
  title: string;
  quantity: number;
  revenue: number;
  orders: number;
}

export interface CategoryWithSkus {
  quantity: number;
  revenue: number;
  orders: number;
  skus?: SkuSalesSummary[];
  totalSkuCount?: number;
}

export interface FamilyWithCategories {
  quantity: number;
  revenue: number;
  orders: number;
  categories: Record<string, CategoryWithSkus>;
}

export interface ChannelWithFamilies {
  quantity: number;
  revenue: number;
  orders: number;
  families: Record<string, FamilyWithCategories>;
}

// Stock Code aggregation (parent model SKU from Akeneo)
export interface StockCodeSummary {
  stockCode: string;
  quantity: number;
  revenue: number;
  orders: number;
  skus: string[]; // Child Sales Codes (variant SKUs)
}

export interface SalesResponse {
  days: number;
  fromDate: string;
  toDate: string;
  skuCount: number;
  sales: Record<string, { quantity: number; revenue: number }>;
  totalsByChannel: Record<string, { quantity: number; revenue: number; orders: number }>;
  totals: { quantity: number; revenue: number; orders: number };
  channels: string[];
  dailySales?: Record<string, Record<string, { quantity: number; revenue: number; orders: number }>>;
  previousYear?: {
    fromDate: string;
    toDate: string;
    dailySales: Record<string, { quantity: number; revenue: number; orders: number }>;
    totals: { quantity: number; revenue: number; orders: number };
    totalsByChannel: Record<string, { quantity: number; revenue: number; orders: number }>;
  };
  previousMonth?: {
    fromDate: string;
    toDate: string;
    dailySales: Record<string, { quantity: number; revenue: number; orders: number }>;
    totals: { quantity: number; revenue: number; orders: number };
    totalsByChannel: Record<string, { quantity: number; revenue: number; orders: number }>;
  };
  previousWeek?: {
    fromDate: string;
    toDate: string;
    totals: { quantity: number; revenue: number; orders: number };
  };
  avgSameWeekday?: {
    dates: string[];
    totals: { quantity: number; revenue: number; orders: number };
  };
  totalsByCategory?: Record<string, { quantity: number; revenue: number; orders: number }>;
  categories?: string[];
  dailySalesByFamily?: Record<string, Record<string, { quantity: number; revenue: number }>>;
  previousYearTotalsByCategory?: Record<string, { quantity: number; revenue: number; orders: number }>;
  previousMonthTotalsByCategory?: Record<string, { quantity: number; revenue: number; orders: number }>;
  totalsByBrand?: Record<string, { quantity: number; revenue: number; orders: number }>;
  brands?: string[];
  dailySalesByBrand?: Record<string, Record<string, { quantity: number; revenue: number; orders: number }>>;
  // Family breakdown with optional SKU drilldown
  totalsByFamily?: Record<string, FamilyWithCategories>;
  previousYearTotalsByFamily?: Record<string, FamilyWithCategories>;
  previousMonthTotalsByFamily?: Record<string, FamilyWithCategories>;
  families?: string[];
  // Channel drilldown (Channel -> Family -> Category -> SKU)
  totalsByChannelDrilldown?: Record<string, ChannelWithFamilies>;
  // Stock Code aggregation (parent model SKU)
  totalsByStockCode?: Record<string, StockCodeSummary>;
  stockCodes?: string[];
}

export const analyticsApi = {
  summary: () => api.get<DashboardSummary>('/analytics/summary'),

  margins: () =>
    api.get<{ marginBands: Record<string, number>; total: number }>('/analytics/margins'),

  sales: (
    params: { days?: number; fromDate?: string; toDate?: string },
    includeDaily: boolean = false,
    includePreviousYear: boolean = false,
    includeCategories: boolean = false,
    includePreviousMonth: boolean = false,
    includeBrands: boolean = false,
    includeDrilldown: boolean = false,
    includePreviousWeek: boolean = false,
    includeAvgSameWeekday: boolean = false,
    includeStockCodes: boolean = false
  ) => {
    const queryParts: string[] = [];
    if (params.fromDate) queryParts.push(`fromDate=${params.fromDate}`);
    if (params.toDate) queryParts.push(`toDate=${params.toDate}`);
    if (params.days && !params.fromDate) queryParts.push(`days=${params.days}`);
    if (includeDaily) queryParts.push('includeDaily=true');
    if (includePreviousYear) queryParts.push('includePreviousYear=true');
    if (includeCategories) queryParts.push('includeCategories=true');
    if (includePreviousMonth) queryParts.push('includePreviousMonth=true');
    if (includeBrands) queryParts.push('includeBrands=true');
    if (includeDrilldown) queryParts.push('includeDrilldown=true');
    if (includePreviousWeek) queryParts.push('includePreviousWeek=true');
    if (includeAvgSameWeekday) queryParts.push('includeAvgSameWeekday=true');
    if (includeStockCodes) queryParts.push('includeStockCodes=true');
    return api.get<SalesResponse>(`/analytics/sales?${queryParts.join('&')}`);
  },

  insights: () => api.get<InsightsResponse>('/analytics/insights'),

  companies: (
    params: { days?: number; fromDate?: string; toDate?: string },
    page: number = 1,
    pageSize: number = 25,
    search?: string,
    includePreviousYear: boolean = false,
    includePreviousMonth: boolean = false
  ) => {
    const queryParts: string[] = [];
    if (params.fromDate) queryParts.push(`fromDate=${params.fromDate}`);
    if (params.toDate) queryParts.push(`toDate=${params.toDate}`);
    if (params.days && !params.fromDate) queryParts.push(`days=${params.days}`);
    queryParts.push(`page=${page}`);
    queryParts.push(`pageSize=${pageSize}`);
    if (search) queryParts.push(`search=${encodeURIComponent(search)}`);
    if (includePreviousYear) queryParts.push('includePreviousYear=true');
    if (includePreviousMonth) queryParts.push('includePreviousMonth=true');
    return api.get<CompaniesResponse>(`/analytics/companies?${queryParts.join('&')}`);
  },

  companyDetail: (
    companyName: string,
    params: { days?: number; fromDate?: string; toDate?: string }
  ) => {
    const queryParts: string[] = [];
    if (params.fromDate) queryParts.push(`fromDate=${params.fromDate}`);
    if (params.toDate) queryParts.push(`toDate=${params.toDate}`);
    if (params.days && !params.fromDate) queryParts.push(`days=${params.days}`);
    const encodedName = encodeURIComponent(companyName);
    return api.get<CompanyDetailResponse>(`/analytics/company/${encodedName}?${queryParts.join('&')}`);
  },
};
