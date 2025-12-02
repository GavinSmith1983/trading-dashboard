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

export const analyticsApi = {
  summary: () => api.get<DashboardSummary>('/analytics/summary'),

  margins: () =>
    api.get<{ marginBands: Record<string, number>; total: number }>('/analytics/margins'),

  sales: (days: number = 7) => api.get<SalesData>(`/analytics/sales?days=${days}`),
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

export const carriersApi = {
  list: () => api.get<{ items: CarrierCost[]; count: number }>('/carriers'),

  get: (carrierId: string) => api.get<CarrierCost>(`/carriers/${encodeURIComponent(carrierId)}`),

  create: (data: Omit<CarrierCost, 'lastUpdated'>) =>
    api.post<CarrierCost>('/carriers', data),

  update: (carrierId: string, data: Partial<CarrierCost>) =>
    api.put<CarrierCost>(`/carriers/${encodeURIComponent(carrierId)}`, data),

  delete: (carrierId: string) => api.delete(`/carriers/${encodeURIComponent(carrierId)}`),
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
  recordedAt: string;
}

export interface SkuHistoryResponse {
  sku: string;
  product: Product | null;
  history: SkuHistoryRecord[];
  fromDate: string;
  toDate: string;
  recordCount: number;
}

export const historyApi = {
  get: (sku: string, fromDate?: string, toDate?: string) => {
    const params = new URLSearchParams();
    if (fromDate) params.set('fromDate', fromDate);
    if (toDate) params.set('toDate', toDate);
    const query = params.toString();
    return api.get<SkuHistoryResponse>(`/history/${encodeURIComponent(sku)}${query ? `?${query}` : ''}`);
  },
};

// Sync API
export const syncApi = {
  trigger: () => api.post('/sync'),
};
