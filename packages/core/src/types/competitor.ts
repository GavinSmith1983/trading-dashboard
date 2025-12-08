/**
 * Competitor price monitoring types
 */

/**
 * Configuration for monitoring a competitor's product page
 */
export interface CompetitorMonitor {
  sku: string; // Our product SKU
  competitorId: string; // Unique ID for this monitor entry
  competitorName: string; // e.g., "Victorian Plumbing", "Heat and Plumb"
  productUrl: string; // URL to scrape
  priceSelector?: string; // CSS selector for price element (optional, uses auto-detection if not set)
  isActive: boolean;

  // Scraping status
  lastScrapedAt?: string; // ISO timestamp
  lastScrapedPrice?: number;
  lastError?: string;
  consecutiveErrors?: number;

  // Metadata
  createdAt: string;
  updatedAt: string;
}

/**
 * Historical record of a scraped competitor price
 */
export interface CompetitorPriceRecord {
  sku: string; // Partition key
  scrapedDate: string; // Sort key (YYYY-MM-DD)
  competitorName: string;
  price: number;
  productUrl: string;

  // Change tracking
  previousPrice?: number;
  priceChangePercent?: number;

  recordedAt: string; // Full ISO timestamp
}

/**
 * Aggregated competitor price data for a SKU
 */
export interface CompetitorPriceSummary {
  sku: string;
  lowestPrice: number;
  lowestPriceCompetitor: string;
  highestPrice: number;
  highestPriceCompetitor: string;
  averagePrice: number;
  competitorCount: number;
  lastUpdated: string;
  prices: Array<{
    competitorName: string;
    price: number;
    productUrl: string;
    scrapedAt: string;
  }>;
}
