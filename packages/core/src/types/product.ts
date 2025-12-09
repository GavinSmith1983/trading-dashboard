/**
 * Core product data structure
 * Combines data from Google Sheets, ChannelEngine, Akeneo PIM, and manual configuration
 */
export interface Product {
  // Identifiers
  sku: string;
  balterleySku?: string;
  title: string;
  brand: string;
  family?: string; // Primary categorisation from Akeneo PIM
  subcategory?: string; // Secondary categorisation from ChannelEngine
  category?: string; // Alias for subcategory (V1 compatibility)
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

  // Physical dimensions (from ChannelEngine)
  weight?: number; // Weight in kg

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

  // Competitor monitoring
  competitorUrls?: CompetitorUrl[];
  competitorFloorPrice?: number; // Lowest competitor price from last scrape
  competitorPricesLastUpdated?: string;

  // Metadata
  lastUpdated: string;
  lastSyncedFromSheet?: string;
  lastSyncedFromChannelEngine?: string;
  lastSyncedFromAkeneo?: string;
}

/**
 * Competitor URL for price monitoring
 */
export interface CompetitorUrl {
  id: string; // Unique ID for this entry
  competitorName: string; // e.g., "Victorian Plumbing"
  url: string; // URL to scrape
  lastPrice?: number; // Last scraped price
  lastScrapedAt?: string; // ISO timestamp
  lastError?: string; // Last error message if scraping failed
}

/**
 * Per-channel pricing
 * Note: eBay pricing is also used for OnBuy and Debenhams
 */
export interface ChannelPrices {
  amazon?: number;
  ebay?: number;
  onbuy?: number; // Uses same price as eBay
  debenhams?: number; // Uses same price as eBay
  bandq?: number;
  manomano?: number;
  shopify?: number;
}

/**
 * Product data as it comes from the Google Sheet
 * Only Column C (Balterley SKU) and Columns F-J (channel pricing) are used
 */
export interface GoogleSheetProduct {
  balterleySku: string;        // Column C - used for matching
  bandqPricing: number;        // Column F
  amazonPricing: number;       // Column G
  ebayPricing: number;         // Column H (also used for OnBuy and Debenhams)
  manoManoPricing: number;     // Column I
  shopifyPricing: number;      // Column J
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
  weight?: number; // Weight in kg
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
