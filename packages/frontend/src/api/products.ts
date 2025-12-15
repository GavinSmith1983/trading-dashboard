import { api } from './client';
import type { Product } from '../types';

// Extended Product type with sales data
export interface ProductWithSales extends Product {
  salesQuantity?: number;
  salesRevenue?: number;
}

export const productsApi = {
  list: () => api.get<{ items: Product[]; count: number }>('/products'),

  listWithSales: (salesDays: number = 90) =>
    api.get<{ items: ProductWithSales[]; count: number; salesDays: number }>(
      `/products?includeSales=true&salesDays=${salesDays}`
    ),

  get: (sku: string) => api.get<Product>(`/products/${encodeURIComponent(sku)}`),

  update: (sku: string, data: Partial<Product>) =>
    api.put<Product>(`/products/${encodeURIComponent(sku)}`, data),
};
