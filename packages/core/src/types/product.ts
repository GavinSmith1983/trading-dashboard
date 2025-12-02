/**
 * Core product data structure
 * Combines data from Google Sheets, ChannelEngine, and manual configuration
 */
export interface Product {
  // Identifiers
  sku: string;
  balterleySku?: string;
  title: string;
  brand: string;
  category?: string;
  familyVariants?: string;
  imageUrl?: string;

  // Pricing (from Google Sheet)
  mrp: number; // Manufacturer Recommended Price
  currentPrice: number; // Current selling price (unified)
  channelPrices?: ChannelPrices; // Per-channel prices (for future use)

  // Discount pricing (from Google Sheet)
  discountPrice?: number;
  discountStartDate?: string;
  discountEndDate?: string;

  // Costs (from monthly CSV upload)
  costPrice: number; // COGS
  deliveryCost: number; // Fixed per product

  // Inventory (from ChannelEngine)
  stockLevel: number;
  stockLastUpdated?: string;

  // Sales metrics (from ChannelEngine)
  salesLast7Days: number;
  salesLast30Days: number;
  salesLastUpdated?: string;

  // Calculated fields
  calculatedMargin?: number;
  calculatedProfit?: number;

  // Metadata
  lastUpdated: string;
  lastSyncedFromSheet?: string;
  lastSyncedFromChannelEngine?: string;
}

/**
 * Per-channel pricing (for future multi-channel pricing)
 */
export interface ChannelPrices {
  amazon?: number;
  ebay?: number;
  bandq?: number;
  manomano?: number;
  shopify?: number;
}

/**
 * Product data as it comes from the Google Sheet
 */
export interface GoogleSheetProduct {
  brandName: string;
  productSku: string;
  balterleySku: string;
  familyVariants: string;
  mrp: number;
  bandqPricing: number;
  amazonPricing: number;
  ebayPricing: number;
  manoManoPricing: number;
  shopifyPricing: number;
  discountStartDate?: string;
  discountEndDate?: string;
  discountPrice?: number;
}

/**
 * Product cost data from CSV upload
 */
export interface ProductCostData {
  sku: string;
  costPrice: number;
  deliveryCost: number;
}

/**
 * Product data from ChannelEngine (full product details)
 */
export interface ChannelEngineProduct {
  merchantProductNo: string; // Maps to SKU
  name: string;
  description?: string;
  brand?: string;
  ean?: string;
  stock: number;
  price: number; // Current price in ChannelEngine
  categoryTrail?: string;
  imageUrl?: string; // Main product image URL
}

/**
 * Sales data from ChannelEngine
 */
export interface ChannelEngineSalesData {
  merchantProductNo: string;
  salesLast7Days: number;
  salesLast30Days: number;
}

/**
 * Summary stats for dashboard
 */
export interface ProductSummary {
  totalProducts: number;
  productsWithCosts: number;
  productsWithoutCosts: number;
  averageMargin: number;
  lowMarginCount: number; // Products below minimum margin threshold
  outOfStockCount: number;
  lowStockCount: number;
}
