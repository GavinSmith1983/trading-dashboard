import { api } from './client';

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

  listForAccount: (accountId: string) =>
    api.getWithAccount<{ items: CarrierCost[]; count: number }>('/carriers', accountId),

  get: (carrierId: string) => api.get<CarrierCost>(`/carriers/${encodeURIComponent(carrierId)}`),

  create: (data: Omit<CarrierCost, 'lastUpdated'>) =>
    api.post<CarrierCost>('/carriers', data),

  createForAccount: (data: Omit<CarrierCost, 'lastUpdated'>, accountId: string) =>
    api.postWithAccount<CarrierCost>('/carriers', data, accountId),

  update: (carrierId: string, data: Partial<CarrierCost>) =>
    api.put<CarrierCost>(`/carriers/${encodeURIComponent(carrierId)}`, data),

  updateForAccount: (carrierId: string, data: Partial<CarrierCost>, accountId: string) =>
    api.putWithAccount<CarrierCost>(`/carriers/${encodeURIComponent(carrierId)}`, data, accountId),

  delete: (carrierId: string) => api.delete(`/carriers/${encodeURIComponent(carrierId)}`),

  deleteForAccount: (carrierId: string, accountId: string) =>
    api.deleteWithAccount(`/carriers/${encodeURIComponent(carrierId)}`, accountId),

  recalculate: () => api.post<RecalculateResult>('/carriers/recalculate', {}),

  recalculateForAccount: (accountId: string) =>
    api.postWithAccount<RecalculateResult>('/carriers/recalculate', {}, accountId),
};
