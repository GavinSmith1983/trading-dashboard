import { api } from './client';
import type { PricingRule, Channel, Product } from '../types';

// Rules API
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

// History API
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
