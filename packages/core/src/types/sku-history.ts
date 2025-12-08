/**
 * Competitor price snapshot for history
 */
export interface CompetitorPriceSnapshot {
  competitorName: string;
  price: number;
  url?: string;
}

/**
 * Daily snapshot of SKU metrics for historical tracking
 */
export interface SkuHistoryRecord {
  sku: string;
  date: string; // YYYY-MM-DD

  // Price data
  price: number;
  costPrice?: number;
  deliveryCost?: number;

  // Stock data
  stockLevel: number;

  // Sales data (daily)
  dailySales: number;
  dailyRevenue: number;

  // Calculated metrics
  margin?: number;

  // Competitor data
  lowestCompetitorPrice?: number;
  competitorPrices?: CompetitorPriceSnapshot[];

  // Metadata
  recordedAt: string; // ISO timestamp
}

/**
 * Aggregated history for charting
 */
export interface SkuHistorySummary {
  sku: string;
  records: SkuHistoryRecord[];
  summary: {
    avgDailySales: number;
    avgPrice: number;
    avgStock: number;
    totalRevenue: number;
    totalSales: number;
    daysWithData: number;
  };
}
