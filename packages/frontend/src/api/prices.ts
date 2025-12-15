import { api } from './client';

export interface PriceUpdateResult {
  success: boolean;
  message: string;
  sku: string;
  channelId: string;
  price: number;
}

export type PriceChangeReason =
  | 'manual'
  | 'proposal_approved'
  | 'proposal_modified'
  | 'bulk_update';

export interface PriceChangeRecord {
  accountId: string;
  sku: string;
  channelId: string;
  previousPrice: number;
  newPrice: number;
  changedBy: string;
  changedAt: string;
  reason: PriceChangeReason;
  source: string;
  notes?: string;
  proposalId?: string;
}

export interface PriceChangeHistoryResponse {
  items: PriceChangeRecord[];
  count: number;
  sku?: string;
}

export const pricesApi = {
  updateChannelPrice: (sku: string, channelId: string, price: number) =>
    api.put<PriceUpdateResult>(`/prices/${encodeURIComponent(sku)}`, { channelId, price }),

  getRecentChanges: (limit: number = 100) =>
    api.get<PriceChangeHistoryResponse>(`/prices/recent?limit=${limit}`),

  getHistory: (sku: string, limit: number = 50) =>
    api.get<PriceChangeHistoryResponse>(`/prices/${encodeURIComponent(sku)}/history?limit=${limit}`),
};
