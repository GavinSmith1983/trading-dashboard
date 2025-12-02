/**
 * Daily snapshot of SKU metrics for historical tracking
 */
export interface SkuHistoryRecord {
  sku: string;
  date: string; // YYYY-MM-DD

  // Price data
  price: number;
  costPrice?: number;

  // Stock data
  stockLevel: number;

  // Sales data (daily)
  dailySales: number;
  dailyRevenue: number;

  // Calculated metrics
  margin?: number;

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
