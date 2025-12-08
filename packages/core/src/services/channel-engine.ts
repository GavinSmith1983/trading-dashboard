import { ChannelEngineProduct, ChannelEngineSalesData, ChannelEngineOrder, ChannelEngineOrderLine } from '../types';

/**
 * ChannelEngine API configuration
 */
interface ChannelEngineConfig {
  apiKey: string;
  tenantId: string;
  baseUrl?: string;
}

/**
 * ChannelEngine API response wrapper
 */
interface ChannelEngineResponse<T> {
  Content: T;
  StatusCode: number;
  Success: boolean;
  Message?: string;
  TotalCount?: number;
}

/**
 * ChannelEngine product from API
 */
interface CEProduct {
  MerchantProductNo: string;
  Name: string;
  Description?: string;
  Brand?: string;
  Stock: number;
  Price: number;
  CategoryTrail?: string;
  Ean?: string;
  ImageUrl?: string;
  ExtraImageUrls?: string[];
  // Physical dimensions
  Weight?: number;
  Height?: number;
  Width?: number;
  Length?: number;
  // Custom fields / Extra data
  ExtraData?: Array<{
    Key: string;
    Value: string;
    Type?: string;
  }>;
}

/**
 * ChannelEngine order line item
 */
interface CEOrderLine {
  MerchantProductNo: string;
  Quantity: number;
  UnitPriceInclVat: number;
  OrderDateUtc: string;
}

/**
 * ChannelEngine service for inventory and sales data
 */
export class ChannelEngineService {
  private apiKey: string;
  private tenantId: string;
  private baseUrl: string;

  constructor(config: ChannelEngineConfig) {
    this.apiKey = config.apiKey;
    this.tenantId = config.tenantId;
    this.baseUrl = config.baseUrl || 'https://api.channelengine.net/api/v2';
  }

  /**
   * Make authenticated request to ChannelEngine API
   * Authentication is via apikey query parameter (not header)
   */
  private async request<T>(
    endpoint: string,
    method: 'GET' | 'POST' | 'PUT' = 'GET',
    body?: unknown,
    queryParams: Record<string, string | number> = {}
  ): Promise<ChannelEngineResponse<T>> {
    // Add API key to query parameters (ChannelEngine's authentication method)
    const params = new URLSearchParams();
    params.set('apikey', this.apiKey);
    for (const [key, value] of Object.entries(queryParams)) {
      params.set(key, String(value));
    }

    const url = `${this.baseUrl}${endpoint}?${params.toString()}`;

    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`ChannelEngine API error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    return response.json() as Promise<ChannelEngineResponse<T>>;
  }

  /**
   * Fetch all products with full details (stock, price, name, brand, etc.)
   * Calls onBatch callback after each page to allow incremental processing/saving
   */
  async fetchProducts(onBatch?: (products: ChannelEngineProduct[], page: number, total: number) => Promise<void>): Promise<ChannelEngineProduct[]> {
    const allProducts: ChannelEngineProduct[] = [];
    let page = 1;
    const pageSize = 100;
    let hasMore = true;
    let totalCount = 0;

    console.log(`[CE] Starting product fetch from ${this.baseUrl}/products`);

    while (hasMore) {
      console.log(`[CE] Fetching page ${page}...`);

      try {
        const response = await this.request<CEProduct[]>(
          '/products',
          'GET',
          undefined,
          { page, pageSize }
        );

        totalCount = response.TotalCount || totalCount;

        if (response.Content && response.Content.length > 0) {
          const batchProducts: ChannelEngineProduct[] = [];

          for (const product of response.Content) {
            // Try to get weight from ExtraData if not in standard field
            let weight = product.Weight;
            if (!weight && product.ExtraData) {
              const weightField = product.ExtraData.find(
                (e) => e.Key.toLowerCase() === 'weight' || e.Key.toLowerCase() === 'weight_kg'
              );
              if (weightField && weightField.Value) {
                weight = parseFloat(weightField.Value);
              }
            }

            batchProducts.push({
              merchantProductNo: product.MerchantProductNo,
              name: product.Name,
              description: product.Description,
              brand: product.Brand,
              ean: product.Ean,
              stock: product.Stock,
              price: product.Price,
              categoryTrail: product.CategoryTrail,
              imageUrl: product.ImageUrl || (product.ExtraImageUrls && product.ExtraImageUrls[0]),
              weight: weight,
            });
          }

          allProducts.push(...batchProducts);
          console.log(`[CE] Page ${page}: Got ${batchProducts.length} products (${allProducts.length}/${totalCount})`);

          // Call batch callback to save immediately
          if (onBatch) {
            await onBatch(batchProducts, page, totalCount);
          }

          page++;
          hasMore = response.Content.length === pageSize;
        } else {
          console.log(`[CE] Page ${page}: No more products`);
          hasMore = false;
        }
      } catch (error) {
        console.error(`[CE] Error fetching page ${page}:`, error);
        throw error;
      }
    }

    console.log(`[CE] Completed: Fetched ${allProducts.length} total products`);
    return allProducts;
  }

  /**
   * Fetch sales data for products over a date range
   */
  async fetchSalesData(
    fromDate: Date,
    toDate: Date
  ): Promise<Map<string, { quantity: number; revenue: number }>> {
    const salesMap = new Map<string, { quantity: number; revenue: number }>();

    let page = 1;
    const pageSize = 100;
    let hasMore = true;

    const fromStr = fromDate.toISOString();
    const toStr = toDate.toISOString();

    while (hasMore) {
      const response = await this.request<{ Lines: CEOrderLine[] }[]>(
        '/orders',
        'GET',
        undefined,
        { fromDate: fromStr, toDate: toStr, page, pageSize }
      );

      if (response.Content && response.Content.length > 0) {
        for (const order of response.Content) {
          if (order.Lines) {
            for (const line of order.Lines) {
              const existing = salesMap.get(line.MerchantProductNo) || {
                quantity: 0,
                revenue: 0,
              };
              existing.quantity += line.Quantity;
              existing.revenue += line.UnitPriceInclVat * line.Quantity;
              salesMap.set(line.MerchantProductNo, existing);
            }
          }
        }
        page++;
        hasMore = response.Content.length === pageSize;
      } else {
        hasMore = false;
      }
    }

    return salesMap;
  }

  /**
   * Calculate sales metrics for last 7 and 30 days
   */
  async fetchSalesMetrics(): Promise<ChannelEngineSalesData[]> {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [sales7Days, sales30Days] = await Promise.all([
      this.fetchSalesData(sevenDaysAgo, now),
      this.fetchSalesData(thirtyDaysAgo, now),
    ]);

    // Combine all SKUs from both periods
    const allSkus = new Set([...sales7Days.keys(), ...sales30Days.keys()]);

    return Array.from(allSkus).map((sku) => ({
      merchantProductNo: sku,
      salesLast7Days: sales7Days.get(sku)?.quantity || 0,
      salesLast30Days: sales30Days.get(sku)?.quantity || 0,
    }));
  }

  /**
   * Fetch all orders from a given date with incremental batch processing
   * @param fromDate Start date to fetch orders from
   * @param onBatch Callback called after each page for incremental saving
   * @param toDate Optional end date to fetch orders until
   */
  async fetchOrders(
    fromDate: Date,
    onBatch?: (orders: ChannelEngineOrder[], page: number, total: number) => Promise<void>,
    toDate?: Date
  ): Promise<ChannelEngineOrder[]> {
    const allOrders: ChannelEngineOrder[] = [];
    let page = 1;
    const pageSize = 100;
    let hasMore = true;
    let totalCount = 0;

    const fromStr = fromDate.toISOString();
    const toStr = toDate?.toISOString();
    console.log(`[CE] Starting order fetch from ${fromStr}${toStr ? ` to ${toStr}` : ''}`);

    while (hasMore) {
      console.log(`[CE] Fetching orders page ${page}...`);

      try {
        const queryParams: Record<string, string | number> = { fromDate: fromStr, page, pageSize };
        if (toStr) {
          queryParams.toDate = toStr;
        }

        const response = await this.request<ChannelEngineOrder[]>(
          '/orders',
          'GET',
          undefined,
          queryParams
        );

        totalCount = response.TotalCount || totalCount;

        if (response.Content && response.Content.length > 0) {
          allOrders.push(...response.Content);
          console.log(`[CE] Page ${page}: Got ${response.Content.length} orders (${allOrders.length}/${totalCount})`);

          // Call batch callback to save immediately
          if (onBatch) {
            await onBatch(response.Content, page, totalCount);
          }

          page++;
          hasMore = response.Content.length === pageSize;
        } else {
          console.log(`[CE] Page ${page}: No more orders`);
          hasMore = false;
        }
      } catch (error) {
        console.error(`[CE] Error fetching orders page ${page}:`, error);
        throw error;
      }
    }

    console.log(`[CE] Completed: Fetched ${allOrders.length} total orders`);
    return allOrders;
  }

  /**
   * Update product prices in ChannelEngine
   */
  async updatePrices(
    updates: Array<{ merchantProductNo: string; price: number }>
  ): Promise<{ success: boolean; errors: string[] }> {
    const errors: string[] = [];

    // ChannelEngine API typically accepts batch updates
    // Update in chunks of 100
    const chunkSize = 100;

    for (let i = 0; i < updates.length; i += chunkSize) {
      const chunk = updates.slice(i, i + chunkSize);

      try {
        const payload = chunk.map((u) => ({
          MerchantProductNo: u.merchantProductNo,
          Price: u.price,
        }));

        const response = await this.request<unknown>(
          '/products/bulk',
          'PUT',
          payload
        );

        if (!response.Success) {
          errors.push(`Batch ${i / chunkSize + 1}: ${response.Message}`);
        }
      } catch (error) {
        errors.push(
          `Batch ${i / chunkSize + 1}: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    }

    return {
      success: errors.length === 0,
      errors,
    };
  }

  /**
   * Update stock levels in ChannelEngine
   */
  async updateStock(
    updates: Array<{ merchantProductNo: string; stock: number }>
  ): Promise<{ success: boolean; errors: string[] }> {
    const errors: string[] = [];
    const chunkSize = 100;

    for (let i = 0; i < updates.length; i += chunkSize) {
      const chunk = updates.slice(i, i + chunkSize);

      try {
        const payload = chunk.map((u) => ({
          MerchantProductNo: u.merchantProductNo,
          Stock: u.stock,
        }));

        const response = await this.request<unknown>(
          '/offer/stock',
          'PUT',
          payload
        );

        if (!response.Success) {
          errors.push(`Batch ${i / chunkSize + 1}: ${response.Message}`);
        }
      } catch (error) {
        errors.push(
          `Batch ${i / chunkSize + 1}: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    }

    return {
      success: errors.length === 0,
      errors,
    };
  }
}

/**
 * Factory function to create ChannelEngineService from AWS Secrets
 */
export async function createChannelEngineService(
  secretArn: string
): Promise<ChannelEngineService> {
  const { SecretsManagerClient, GetSecretValueCommand } = await import(
    '@aws-sdk/client-secrets-manager'
  );

  const client = new SecretsManagerClient({});
  const response = await client.send(
    new GetSecretValueCommand({ SecretId: secretArn })
  );

  if (!response.SecretString) {
    throw new Error('ChannelEngine secret not found');
  }

  const secret = JSON.parse(response.SecretString);

  return new ChannelEngineService({
    apiKey: secret.apiKey,
    tenantId: secret.tenantId,
    baseUrl: secret.baseUrl,
  });
}
