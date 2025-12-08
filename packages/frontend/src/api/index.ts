import { api } from './client';
import type {
  Product,
  Channel,
  PricingRule,
  PriceProposal,
  PaginatedResponse,
  DashboardSummary,
  ProposalStatus,
} from '../types';

// Products API
export const productsApi = {
  list: () => api.get<{ items: Product[]; count: number }>('/products'),

  get: (sku: string) => api.get<Product>(`/products/${encodeURIComponent(sku)}`),

  update: (sku: string, data: Partial<Product>) =>
    api.put<Product>(`/products/${encodeURIComponent(sku)}`, data),
};

// Proposals API
export interface ProposalFilters {
  status?: ProposalStatus;
  batchId?: string;
  brand?: string;
  search?: string;
  hasWarnings?: boolean;
  appliedRuleName?: string;
  page?: number;
  pageSize?: number;
}

export const proposalsApi = {
  list: (filters: ProposalFilters = {}) => {
    const params = new URLSearchParams();
    if (filters.status) params.set('status', filters.status);
    if (filters.batchId) params.set('batchId', filters.batchId);
    if (filters.brand) params.set('brand', filters.brand);
    if (filters.search) params.set('search', filters.search);
    if (filters.hasWarnings) params.set('hasWarnings', 'true');
    if (filters.appliedRuleName) params.set('appliedRuleName', filters.appliedRuleName);
    if (filters.page) params.set('page', String(filters.page));
    if (filters.pageSize) params.set('pageSize', String(filters.pageSize));

    const query = params.toString();
    return api.get<PaginatedResponse<PriceProposal>>(`/proposals${query ? `?${query}` : ''}`);
  },

  get: (proposalId: string) => api.get<PriceProposal>(`/proposals/${proposalId}`),

  approve: (proposalId: string, reviewedBy: string, notes?: string) =>
    api.put<PriceProposal>(`/proposals/${proposalId}`, {
      action: 'approve',
      reviewedBy,
      notes,
    }),

  reject: (proposalId: string, reviewedBy: string, notes?: string) =>
    api.put<PriceProposal>(`/proposals/${proposalId}`, {
      action: 'reject',
      reviewedBy,
      notes,
    }),

  modify: (proposalId: string, modifiedPrice: number, reviewedBy: string, notes?: string) =>
    api.put<PriceProposal>(`/proposals/${proposalId}`, {
      action: 'modify',
      modifiedPrice,
      reviewedBy,
      notes,
    }),

  bulkApprove: (proposalIds: string[], reviewedBy: string, notes?: string) =>
    api.post('/proposals/bulk-approve', { proposalIds, reviewedBy, notes }),

  bulkReject: (proposalIds: string[], reviewedBy: string, notes?: string) =>
    api.post('/proposals/bulk-reject', { proposalIds, reviewedBy, notes }),

  push: (dryRun = false) =>
    api.post<{ success: boolean; pushed: number; errors: string[] }>('/proposals/push', { dryRun }),
};

// Pricing Rules API
export const rulesApi = {
  list: () => api.get<{ items: PricingRule[]; count: number }>('/rules'),

  get: (ruleId: string) => api.get<PricingRule>(`/rules/${ruleId}`),

  create: (rule: Omit<PricingRule, 'ruleId' | 'createdAt' | 'updatedAt'>) =>
    api.post<PricingRule>('/rules', rule),

  update: (ruleId: string, rule: Partial<PricingRule>) =>
    api.put<PricingRule>(`/rules/${ruleId}`, rule),

  delete: (ruleId: string) => api.delete(`/rules/${ruleId}`),
};

// Channels API
export const channelsApi = {
  list: () => api.get<{ items: Channel[]; count: number }>('/channels'),

  get: (channelId: string) => api.get<Channel>(`/channels/${channelId}`),

  update: (channelId: string, data: Partial<Channel>) =>
    api.put<Channel>(`/channels/${channelId}`, data),
};

// Analytics API
export interface SalesData {
  days: number;
  skuCount: number;
  sales: Record<string, { quantity: number; revenue: number }>;
}

// Insights types
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
}

export interface InsightsResponse {
  insights: InsightCategory[];
}

// Enhanced sales response with channel and daily breakdown
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
}

export const analyticsApi = {
  summary: () => api.get<DashboardSummary>('/analytics/summary'),

  margins: () =>
    api.get<{ marginBands: Record<string, number>; total: number }>('/analytics/margins'),

  sales: (days: number = 30, includeDaily: boolean = false) =>
    api.get<SalesResponse>(`/analytics/sales?days=${days}${includeDaily ? '&includeDaily=true' : ''}`),

  insights: () => api.get<InsightsResponse>('/analytics/insights'),
};

// Import API
export interface ImportResult {
  updated: number;
  notFoundInDb: number;
  matchedByBalterleySku?: number;
  total: number;
  sampleNotFoundInDb?: string[];
  dbProductsMissingFromFile: number;
  sampleDbSkusMissingFromFile?: string[];
}

export interface DeliveryImportResult {
  ordersProcessed: number;
  ordersMatched: number;
  ordersNotFound: number;
  ordersSkipped: number;
  excludedCarriers: string[];
  carriersFound: string[];
  newCarriersCreated: string[];
  note: string;
}

export const importApi = {
  costs: (data: Array<{ sku: string; costPrice: number; deliveryCost?: number }>) =>
    api.post<ImportResult>('/import/costs', { data }),

  delivery: (data: Array<{ orderNumber: string; parcels: number; carrier: string }>) =>
    api.post<DeliveryImportResult>('/import/delivery', { data }),
};

// Carriers API
export interface CarrierCost {
  carrierId: string;
  carrierName: string;
  costPerParcel: number;
  isActive: boolean;
  lastUpdated: string;
}

export interface RecalculateResult {
  ordersWithDeliveryData: number;
  ordersProcessed: number;
  ordersSkipped: number;
  skusAnalyzed: number;
  productsUpdated: number;
  productsUnchanged: number;
  updatedSkus: Array<{ sku: string; oldCost: number; newCost: number; carrier: string }>;
}

export const carriersApi = {
  list: () => api.get<{ items: CarrierCost[]; count: number }>('/carriers'),

  get: (carrierId: string) => api.get<CarrierCost>(`/carriers/${encodeURIComponent(carrierId)}`),

  create: (data: Omit<CarrierCost, 'lastUpdated'>) =>
    api.post<CarrierCost>('/carriers', data),

  update: (carrierId: string, data: Partial<CarrierCost>) =>
    api.put<CarrierCost>(`/carriers/${encodeURIComponent(carrierId)}`, data),

  delete: (carrierId: string) => api.delete(`/carriers/${encodeURIComponent(carrierId)}`),

  recalculate: () => api.post<RecalculateResult>('/carriers/recalculate', {}),
};

// SKU History API
export interface SkuHistoryRecord {
  sku: string;
  date: string;
  price: number;
  costPrice?: number;
  stockLevel: number;
  dailySales: number;
  dailyRevenue: number;
  margin?: number;
  lowestCompetitorPrice?: number;
  recordedAt: string;
}

export interface ChannelSalesData {
  [date: string]: {
    [channel: string]: { quantity: number; revenue: number };
  };
}

export interface SkuHistoryResponse {
  sku: string;
  product: Product | null;
  history: SkuHistoryRecord[];
  channelSales?: ChannelSalesData;
  fromDate: string;
  toDate: string;
  recordCount: number;
}

export const historyApi = {
  get: (sku: string, fromDate?: string, toDate?: string, includeChannelSales?: boolean) => {
    const params = new URLSearchParams();
    if (fromDate) params.set('fromDate', fromDate);
    if (toDate) params.set('toDate', toDate);
    if (includeChannelSales) params.set('includeChannelSales', 'true');
    const query = params.toString();
    return api.get<SkuHistoryResponse>(`/history/${encodeURIComponent(sku)}${query ? `?${query}` : ''}`);
  },
};

// Sync API
export const syncApi = {
  trigger: () => api.post('/sync'),
};

// Competitors API
export interface CompetitorUrl {
  id: string;
  competitorName: string;
  url: string;
  lastPrice?: number;
  lastScrapedAt?: string;
  lastError?: string;
}

export interface ScrapeResult {
  sku: string;
  lowestPrice: number | null;
  competitorUrls: CompetitorUrl[];
  errors: string[];
}

export const competitorsApi = {
  addUrl: (sku: string, url: string) =>
    api.post<{ message: string; sku: string; competitorUrls: CompetitorUrl[] }>('/competitors/add-url', { sku, url }),

  removeUrl: (sku: string, urlId: string) =>
    api.delete<{ message: string; sku: string; competitorUrls: CompetitorUrl[] }>(
      '/competitors/remove-url',
      { sku, urlId }
    ),

  scrapeSingle: (sku: string) =>
    api.post<ScrapeResult>(`/competitors/scrape/${encodeURIComponent(sku)}`),

  scrapeAll: () =>
    api.post<{ message: string; totalProducts: number; successCount: number; errorCount: number }>('/competitors/scrape'),
};

// Prices API
export interface PriceUpdateResult {
  success: boolean;
  message: string;
  sku: string;
  channelId: string;
  price: number;
}

export const pricesApi = {
  updateChannelPrice: (sku: string, channelId: string, price: number) =>
    api.put<PriceUpdateResult>(`/prices/${encodeURIComponent(sku)}`, { channelId, price }),
};
