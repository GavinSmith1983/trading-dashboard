import { ChannelEngineProduct, ChannelEngineOrder, ChannelEngineOrderLine } from '../types';

/**
 * CS-Cart API configuration
 */
export interface CSCartConfig {
  baseUrl: string;      // Base URL (e.g., https://nuie.com)
  email: string;        // API user email for Basic Auth
  apiKey: string;       // API key for Basic Auth
  companyId?: number;   // Multi-vendor filter (e.g., 2 for Roxor)
}

/**
 * CS-Cart API response wrapper for lists
 */
interface CSCartListResponse<T> {
  products?: T[];
  orders?: T[];
  params?: {
    total_items: string;
    items_per_page: string;
    page: string;
  };
}

/**
 * CS-Cart product feature
 */
interface CSCartProductFeature {
  feature_id: string;
  internal_name: string;      // e.g., "Brand", "Range", "Style"
  description: string;
  variant?: string;           // The feature value (e.g., "Bayswater" for Brand)
  value?: string;
}

/**
 * CS-Cart category from API
 */
interface CSCartCategory {
  category_id: string;
  category: string;           // Category name
  parent_id: string;          // Parent category ID
  id_path: string;            // Path like "1/2/3" for hierarchy
  status: string;
}

/**
 * CS-Cart product from API
 */
interface CSCartProduct {
  product_id: string;
  product_code: string;       // SKU
  product: string;            // Title/name
  price: string;              // Current price (string format)
  list_price: string;         // MRP/RRP
  amount: string;             // Stock level
  company_id: string;         // Vendor ID for filtering
  status: string;             // A=Active, D=Disabled, H=Hidden
  timestamp: string;          // Unix timestamp (seconds)
  updated_timestamp?: string; // Unix timestamp of last update
  weight?: string;            // Weight
  category_ids?: number[];    // Category IDs
  main_category?: number;     // Primary category ID
  seo_name?: string;          // SEO-friendly URL slug
  main_pair?: {               // Main product image
    detailed?: {
      image_path?: string;
    };
  };
  product_features?: Record<string, CSCartProductFeature>; // Product features including Brand
}

/**
 * CS-Cart order from API
 */
interface CSCartOrder {
  order_id: string;
  timestamp: string;          // Unix timestamp
  status: string;             // O=Open, P=Processed, C=Complete, etc.
  total: string;
  subtotal: string;
  discount: string;
  subtotal_discount: string;
  shipping_cost: string;
  company_id: string;
  firstname: string;
  lastname: string;
  email: string;
  phone?: string;
  company?: string;           // Buyer's company name (e.g., "House Lydia")
  user_id?: string;           // Buyer's user ID in CS-Cart
  products: CSCartOrderProduct[];
}

/**
 * CS-Cart order product/line item
 */
interface CSCartOrderProduct {
  item_id: string;
  product_id: string;
  product_code: string;       // SKU
  price: string;
  amount: string;             // Quantity (string)
  product?: string;           // Product name/description
}

/**
 * CS-Cart service for fetching products and orders
 * Outputs data in ChannelEngine format for compatibility with existing system
 */
export class CSCartService {
  private baseUrl: string;
  private email: string;
  private apiKey: string;
  private companyId?: number;
  private categoryMap: Map<string, string> = new Map(); // category_id -> category name

  constructor(config: CSCartConfig) {
    // Ensure baseUrl ends with /api
    this.baseUrl = config.baseUrl.endsWith('/api')
      ? config.baseUrl
      : `${config.baseUrl}/api`;
    this.email = config.email;
    this.apiKey = config.apiKey;
    this.companyId = config.companyId;
  }

  /**
   * Make authenticated request to CS-Cart API
   * Uses Basic Auth with email:apiKey
   */
  private async request<T>(
    endpoint: string,
    queryParams: Record<string, string | number> = {}
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${endpoint}`);

    // Add company filter if configured
    if (this.companyId) {
      queryParams.company_id = this.companyId;
    }

    for (const [key, value] of Object.entries(queryParams)) {
      url.searchParams.set(key, String(value));
    }

    // Basic Auth: base64(email:apiKey)
    const auth = Buffer.from(`${this.email}:${this.apiKey}`).toString('base64');

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('CS-Cart authentication failed: Invalid credentials');
      }
      if (response.status === 403) {
        throw new Error('CS-Cart access denied: Check API permissions');
      }
      if (response.status === 429) {
        throw new Error('CS-Cart rate limited: Too many requests');
      }
      const errorText = await response.text();
      throw new Error(`CS-Cart API error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    return response.json() as Promise<T>;
  }

  /**
   * Extract brand from product features
   * Brand is typically feature ID "1" or has internal_name "Brand"
   */
  private extractBrand(csProduct: CSCartProduct): string | undefined {
    if (!csProduct.product_features) {
      return undefined;
    }

    // Try feature ID "1" first (common for Brand)
    const brandFeature = csProduct.product_features['1'];
    if (brandFeature && brandFeature.variant) {
      return brandFeature.variant;
    }

    // Fallback: search by internal_name
    for (const feature of Object.values(csProduct.product_features)) {
      if (feature.internal_name?.toLowerCase() === 'brand' && feature.variant) {
        return feature.variant;
      }
    }

    return undefined;
  }

  /**
   * Fetch all categories from CS-Cart and build a lookup map
   */
  async fetchCategories(): Promise<Map<string, string>> {
    if (this.categoryMap.size > 0) {
      return this.categoryMap;
    }

    console.log('[CSCart] Fetching categories...');
    let page = 1;
    const pageSize = 250;
    let hasMore = true;

    while (hasMore) {
      try {
        const response = await this.request<CSCartListResponse<CSCartCategory>>(
          '/categories/',
          {
            items_per_page: pageSize,
            page,
          }
        );

        const categories = (response as any).categories || Object.values(response).filter((v: any) => v?.category_id) || [];

        if (categories.length > 0) {
          for (const cat of categories) {
            this.categoryMap.set(String(cat.category_id), cat.category);
          }
          console.log(`[CSCart] Categories page ${page}: Got ${categories.length} categories`);
          page++;
          hasMore = categories.length === pageSize;
        } else {
          hasMore = false;
        }
      } catch (error) {
        console.error('[CSCart] Error fetching categories:', error);
        hasMore = false;
      }
    }

    console.log(`[CSCart] Total categories loaded: ${this.categoryMap.size}`);
    return this.categoryMap;
  }

  /**
   * Get category name by ID
   */
  private getCategoryName(categoryId: number | undefined): string | undefined {
    if (!categoryId) return undefined;
    return this.categoryMap.get(String(categoryId));
  }

  /**
   * Transform CS-Cart product to ChannelEngine format
   */
  private transformProduct(csProduct: CSCartProduct): ChannelEngineProduct {
    // Get actual category name from the category map
    const categoryName = this.getCategoryName(csProduct.main_category);

    return {
      merchantProductNo: csProduct.product_code,
      name: csProduct.product,
      brand: this.extractBrand(csProduct),
      stock: parseInt(csProduct.amount, 10) || 0,
      price: parseFloat(csProduct.price) || 0,
      categoryTrail: categoryName || undefined,
      imageUrl: csProduct.main_pair?.detailed?.image_path,
      weight: csProduct.weight ? parseFloat(csProduct.weight) : undefined,
    };
  }

  /**
   * Transform CS-Cart order to ChannelEngine format
   */
  private transformOrder(csOrder: CSCartOrder): ChannelEngineOrder {
    const total = parseFloat(csOrder.total) || 0;
    const subtotal = parseFloat(csOrder.subtotal) || 0;
    const shipping = parseFloat(csOrder.shipping_cost) || 0;
    const discount = (parseFloat(csOrder.discount) || 0) + (parseFloat(csOrder.subtotal_discount) || 0);
    // Assume 20% VAT for UK
    const vatRate = 0.2;
    const totalExclVat = total / (1 + vatRate);
    const totalVat = total - totalExclVat;
    const subtotalExclVat = subtotal / (1 + vatRate);
    const subtotalVat = subtotal - subtotalExclVat;

    // Convert Unix timestamp to ISO string
    const orderDate = new Date(parseInt(csOrder.timestamp, 10) * 1000).toISOString();

    // CS-Cart API returns products as an object when fetching single orders, or as an array when listing
    // Normalize to array
    let productsArray: CSCartOrderProduct[];
    if (Array.isArray(csOrder.products)) {
      productsArray = csOrder.products;
    } else if (csOrder.products && typeof csOrder.products === 'object') {
      // Convert object to array (products keyed by item_id)
      productsArray = Object.values(csOrder.products);
    } else {
      productsArray = [];
    }

    const lines: ChannelEngineOrderLine[] = productsArray.map((line) => {
      const linePrice = parseFloat(line.price) || 0;
      const lineQty = parseInt(line.amount, 10) || 1;
      const lineTotal = linePrice * lineQty;
      const linePriceExclVat = linePrice / (1 + vatRate);
      const lineTotalExclVat = lineTotal / (1 + vatRate);
      const lineVat = lineTotal - lineTotalExclVat;

      return {
        Id: parseInt(line.item_id, 10) || 0,
        ChannelOrderLineNo: line.item_id,
        MerchantProductNo: line.product_code,
        Description: line.product || line.product_code,
        Quantity: lineQty,
        UnitPriceInclVat: linePrice,
        UnitPriceExclVat: linePriceExclVat,
        LineTotalInclVat: lineTotal,
        LineTotalExclVat: lineTotalExclVat,
        LineVat: lineVat,
        FeeFixed: 0,
        FeeRate: 0,
        VatRate: vatRate * 100, // 20
        Status: this.mapOrderStatus(csOrder.status),
      };
    });

    // Build buyer name from firstname + lastname
    const buyerName = [csOrder.firstname, csOrder.lastname]
      .filter(Boolean)
      .join(' ')
      .trim() || undefined;

    return {
      Id: parseInt(csOrder.order_id, 10) || 0,
      ChannelOrderNo: csOrder.order_id,
      ChannelName: 'Nuie',
      ChannelId: 0,
      OrderDate: orderDate,
      Status: this.mapOrderStatus(csOrder.status),
      SubTotalInclVat: subtotal,
      SubTotalVat: subtotalVat,
      ShippingCostsInclVat: shipping,
      ShippingCostsVat: shipping - (shipping / (1 + vatRate)),
      TotalInclVat: total,
      TotalVat: totalVat,
      TotalFee: 0,
      CurrencyCode: 'GBP',
      Lines: lines,
      // Buyer info for sales breakdown
      BuyerName: buyerName,
      BuyerEmail: csOrder.email || undefined,
      BuyerCompany: csOrder.company || undefined,
      BuyerUserId: csOrder.user_id || undefined,
      // Discount
      Discount: discount > 0 ? discount : undefined,
    };
  }

  /**
   * Map CS-Cart order status to standard status
   */
  private mapOrderStatus(status: string): string {
    const statusMap: Record<string, string> = {
      'O': 'NEW',           // Open
      'P': 'IN_PROGRESS',   // Processed
      'C': 'SHIPPED',       // Complete
      'F': 'FAILED',        // Failed
      'D': 'CANCELLED',     // Declined
      'I': 'ON_HOLD',       // Incomplete
      'B': 'BACKORDER',     // Backordered
    };
    return statusMap[status] || 'NEW';
  }

  /**
   * Fetch all products with pagination
   * Outputs ChannelEngine format for compatibility
   * @param onBatch Callback called after each page for incremental saving
   */
  async fetchProducts(
    onBatch?: (products: ChannelEngineProduct[], page: number, total: number) => Promise<void>
  ): Promise<ChannelEngineProduct[]> {
    const allProducts: ChannelEngineProduct[] = [];
    let page = 1;
    const pageSize = 100;
    let hasMore = true;
    let totalCount = 0;

    console.log(`[CSCart] Starting product fetch from ${this.baseUrl}/products/`);
    if (this.companyId) {
      console.log(`[CSCart] Filtering by company_id=${this.companyId}`);
    }

    // Fetch categories first so we can map category IDs to names
    await this.fetchCategories();

    while (hasMore) {
      console.log(`[CSCart] Fetching page ${page}...`);

      try {
        const response = await this.request<CSCartListResponse<CSCartProduct>>(
          '/products/',
          {
            items_per_page: pageSize,
            page,
            status: 'A', // Only active products
          }
        );

        const products = response.products || [];
        totalCount = parseInt(response.params?.total_items || '0', 10) || totalCount;

        if (products.length > 0) {
          // Filter by company_id if needed (in case API doesn't support it)
          const filteredProducts = this.companyId
            ? products.filter((p) => p.company_id === String(this.companyId))
            : products;

          const batchProducts = filteredProducts.map((p) => this.transformProduct(p));

          allProducts.push(...batchProducts);
          console.log(`[CSCart] Page ${page}: Got ${batchProducts.length} products (${allProducts.length} total)`);

          // Call batch callback to save immediately
          if (onBatch && batchProducts.length > 0) {
            await onBatch(batchProducts, page, totalCount);
          }

          page++;
          hasMore = products.length === pageSize;
        } else {
          console.log(`[CSCart] Page ${page}: No more products`);
          hasMore = false;
        }
      } catch (error) {
        console.error(`[CSCart] Error fetching page ${page}:`, error);
        throw error;
      }
    }

    console.log(`[CSCart] Completed: Fetched ${allProducts.length} total products`);
    return allProducts;
  }

  /**
   * Fetch orders with date range filtering
   * Outputs ChannelEngine format for compatibility
   * @param fromDate Start date to fetch orders from
   * @param onBatch Callback called after each page for incremental saving
   * @param toDate Optional end date
   * @param fetchFullDetails If true, fetches full order details (including line items) for each order
   */
  async fetchOrders(
    fromDate: Date,
    onBatch?: (orders: ChannelEngineOrder[], page: number, total: number) => Promise<void>,
    toDate?: Date,
    fetchFullDetails: boolean = false
  ): Promise<ChannelEngineOrder[]> {
    const allOrders: ChannelEngineOrder[] = [];
    let page = 1;
    const pageSize = 100;
    let hasMore = true;
    let totalCount = 0;

    // Convert dates to Unix timestamps
    const fromTimestamp = Math.floor(fromDate.getTime() / 1000);
    const toTimestamp = toDate ? Math.floor(toDate.getTime() / 1000) : undefined;

    console.log(`[CSCart] Starting order fetch from ${new Date(fromTimestamp * 1000).toISOString()}`);
    if (toTimestamp) {
      console.log(`[CSCart] To: ${new Date(toTimestamp * 1000).toISOString()}`);
    }
    if (fetchFullDetails) {
      console.log(`[CSCart] Fetching full order details (including line items)`);
    }

    while (hasMore) {
      console.log(`[CSCart] Fetching orders page ${page}...`);

      try {
        const queryParams: Record<string, string | number> = {
          items_per_page: pageSize,
          page,
          // CS-Cart uses timestamp range for filtering
          // period: 'C' for custom, with time_from and time_to
          period: 'C',
          time_from: fromTimestamp,
        };

        if (toTimestamp) {
          queryParams.time_to = toTimestamp;
        }

        const response = await this.request<CSCartListResponse<CSCartOrder>>(
          '/orders/',
          queryParams
        );

        const orders = response.orders || [];
        totalCount = parseInt(response.params?.total_items || '0', 10) || totalCount;

        if (orders.length > 0) {
          // Filter by company_id if needed
          const filteredOrders = this.companyId
            ? orders.filter((o) => o.company_id === String(this.companyId))
            : orders;

          // If fetchFullDetails is true, fetch each order individually to get line items
          let batchOrders: ChannelEngineOrder[];
          if (fetchFullDetails) {
            console.log(`[CSCart] Fetching full details for ${filteredOrders.length} orders...`);
            batchOrders = [];
            for (const order of filteredOrders) {
              const fullOrder = await this.fetchOrder(order.order_id);
              if (fullOrder) {
                batchOrders.push(fullOrder);
              }
              // Small delay to avoid rate limiting
              await new Promise(resolve => setTimeout(resolve, 50));
            }
          } else {
            batchOrders = filteredOrders.map((o) => this.transformOrder(o));
          }

          allOrders.push(...batchOrders);
          console.log(`[CSCart] Page ${page}: Got ${batchOrders.length} orders (${allOrders.length} total)`);

          // Call batch callback to save immediately
          if (onBatch && batchOrders.length > 0) {
            await onBatch(batchOrders, page, totalCount);
          }

          page++;
          hasMore = orders.length === pageSize;
        } else {
          console.log(`[CSCart] Page ${page}: No more orders`);
          hasMore = false;
        }
      } catch (error) {
        console.error(`[CSCart] Error fetching orders page ${page}:`, error);
        throw error;
      }
    }

    console.log(`[CSCart] Completed: Fetched ${allOrders.length} total orders`);
    return allOrders;
  }

  /**
   * Fetch a single order with full details (including line items)
   */
  async fetchOrder(orderId: string): Promise<ChannelEngineOrder | null> {
    try {
      const csOrder = await this.request<CSCartOrder>(`/orders/${orderId}`);
      return this.transformOrder(csOrder);
    } catch (error) {
      console.error(`[CSCart] Error fetching order ${orderId}:`, error);
      return null;
    }
  }
}

/**
 * Factory function to create CSCartService from AWS Secrets
 */
export async function createCSCartService(
  secretArn: string
): Promise<CSCartService> {
  const { SecretsManagerClient, GetSecretValueCommand } = await import(
    '@aws-sdk/client-secrets-manager'
  );

  const client = new SecretsManagerClient({});
  const response = await client.send(
    new GetSecretValueCommand({ SecretId: secretArn })
  );

  if (!response.SecretString) {
    throw new Error('CS-Cart secret not found');
  }

  const secret = JSON.parse(response.SecretString);

  return new CSCartService({
    baseUrl: secret.baseUrl,
    email: secret.email,
    apiKey: secret.apiKey,
    companyId: secret.companyId,
  });
}
