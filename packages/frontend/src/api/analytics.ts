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
  totalsByCategory?: Record<string, { quantity: number; revenue: number; orders: number }>;
  categories?: string[];
  dailySalesByFamily?: Record<string, Record<string, { quantity: number; revenue: number }>>;
  previousYearTotalsByCategory?: Record<string, { quantity: number; revenue: number; orders: number }>;
  previousMonthTotalsByCategory?: Record<string, { quantity: number; revenue: number; orders: number }>;
  totalsByFamily?: Record<string, {
    quantity: number;
    revenue: number;
    orders: number;
    categories: Record<string, { quantity: number; revenue: number; orders: number }>;
  }>;
  previousYearTotalsByFamily?: Record<string, {
    quantity: number;
    revenue: number;
    orders: number;
    categories: Record<string, { quantity: number; revenue: number; orders: number }>;
  }>;
  previousMonthTotalsByFamily?: Record<string, {
    quantity: number;
    revenue: number;
    orders: number;
    categories: Record<string, { quantity: number; revenue: number; orders: number }>;
  }>;
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
    includePreviousMonth: boolean = false
  ) => {
    const queryParts: string[] = [];
    if (params.fromDate) queryParts.push(`fromDate=${params.fromDate}`);
    if (params.toDate) queryParts.push(`toDate=${params.toDate}`);
    if (params.days && !params.fromDate) queryParts.push(`days=${params.days}`);
    if (includeDaily) queryParts.push('includeDaily=true');
    if (includePreviousYear) queryParts.push('includePreviousYear=true');
    if (includeCategories) queryParts.push('includeCategories=true');
    if (includePreviousMonth) queryParts.push('includePreviousMonth=true');
    return api.get<SalesResponse>(`/analytics/sales?${queryParts.join('&')}`);
  },

  insights: () => api.get<InsightsResponse>('/analytics/insights'),
};
