import { ScheduledEvent, Context } from 'aws-lambda';
import {
  createGoogleSheetsService,
  createChannelEngineService,
  createDynamoDBService,
  Product,
  ChannelEngineProduct,
  GoogleSheetProduct,
  SkuHistoryRecord,
} from '@repricing/core';

/**
 * Data Sync Lambda
 * Runs weekly to pull data from ChannelEngine (source of truth) and enrich from Google Sheets
 *
 * Data Flow:
 * 1. ChannelEngine → Primary source: active products, stock, current CE price
 * 2. Products are saved to DynamoDB incrementally as they are fetched (not at the end)
 * 3. Cost data is NOT synced here - it's matched at price calculation time from CSV uploads
 */
export async function handler(event: ScheduledEvent, context: Context): Promise<void> {
  console.log('Starting data sync', { event, requestId: context.awsRequestId });

  const db = createDynamoDBService();
  let totalSaved = 0;
  let totalProducts = 0;

  try {
    // 1. Get existing products from DB (to preserve cost data)
    console.log('[DB] Loading existing products to preserve cost data...');
    const existingProducts = await db.getAllProducts();
    const existingMap = new Map(existingProducts.map((p) => [p.sku, p]));
    console.log(`[DB] Found ${existingProducts.length} existing products`);

    // 2. Fetch products from ChannelEngine and SAVE EACH BATCH IMMEDIATELY
    console.log('[CE] Starting incremental fetch and save...');

    const secretArn = process.env.CHANNEL_ENGINE_SECRET_ARN;
    if (!secretArn) {
      throw new Error('CHANNEL_ENGINE_SECRET_ARN not configured');
    }

    const ceService = await createChannelEngineService(secretArn);

    await ceService.fetchProducts(async (batchProducts, page, total) => {
      // Transform and save this batch immediately
      const timestamp = new Date().toISOString();
      const productsToSave: Product[] = batchProducts.map((ceProduct) => {
        const sku = ceProduct.merchantProductNo;
        const existing = existingMap.get(sku);

        return {
          sku,
          title: ceProduct.name || sku,
          brand: ceProduct.brand || 'Unknown',
          category: ceProduct.categoryTrail || 'Uncategorized',
          imageUrl: ceProduct.imageUrl || existing?.imageUrl,
          mrp: existing?.mrp || 0,
          currentPrice: ceProduct.price,
          costPrice: existing?.costPrice || 0,
          deliveryCost: existing?.deliveryCost || 0,
          stockLevel: ceProduct.stock,
          stockLastUpdated: timestamp,
          salesLast7Days: existing?.salesLast7Days || 0,
          salesLast30Days: existing?.salesLast30Days || 0,
          lastUpdated: timestamp,
          lastSyncedFromChannelEngine: timestamp,
        };
      });

      // Save to DynamoDB
      await db.batchPutProducts(productsToSave);
      totalSaved += productsToSave.length;
      totalProducts = total;
      console.log(`[DB] Saved batch ${page}: ${productsToSave.length} products (${totalSaved}/${total} total saved)`);
    });

    console.log(`[DONE] Data sync complete: ${totalSaved} products saved to DynamoDB`);

    // 3. Record daily history snapshot for each SKU
    console.log('[HISTORY] Recording daily history snapshots...');
    await recordDailyHistory(db);
    console.log('[HISTORY] History snapshots recorded');

  } catch (error) {
    console.error(`[ERROR] Data sync failed after saving ${totalSaved} products:`, error);
    throw error;
  }
}

/**
 * Fetch products and sales data from ChannelEngine (PRIMARY SOURCE)
 */
async function fetchFromChannelEngine(): Promise<{
  products: ChannelEngineProduct[];
  salesMap: Map<string, { salesLast7Days: number; salesLast30Days: number }>;
}> {
  const secretArn = process.env.CHANNEL_ENGINE_SECRET_ARN;
  if (!secretArn) {
    throw new Error('CHANNEL_ENGINE_SECRET_ARN not configured - ChannelEngine is required as primary data source');
  }

  console.log('[CE] Initializing ChannelEngine service...');
  const ceService = await createChannelEngineService(secretArn);

  // Fetch all products with full details
  console.log('[CE] Fetching products...');
  const products = await ceService.fetchProducts();
  console.log(`[CE] Fetched ${products.length} products`);

  // Skip sales fetch for now - it takes too long and can be done separately
  // TODO: Make sales fetch optional or run in separate Lambda
  console.log('[CE] Skipping sales metrics fetch (performance optimization)');
  const salesMap = new Map<string, { salesLast7Days: number; salesLast30Days: number }>();

  return { products, salesMap };
}

/**
 * Fetch enrichment data from Google Sheets (MRP, channel pricing, discounts)
 * Returns a Map keyed by SKU for easy lookup
 */
async function fetchFromGoogleSheets(): Promise<Map<string, GoogleSheetProduct>> {
  const secretArn = process.env.GOOGLE_SHEETS_SECRET_ARN;
  if (!secretArn) {
    console.warn('GOOGLE_SHEETS_SECRET_ARN not configured - skipping Sheets enrichment');
    return new Map();
  }

  try {
    const sheetsService = await createGoogleSheetsService(secretArn);
    const sheetProducts = await sheetsService.fetchProducts();

    // Create lookup map by SKU
    const map = new Map<string, GoogleSheetProduct>();
    for (const product of sheetProducts) {
      if (product.productSku) {
        map.set(product.productSku, product);
      }
    }
    return map;
  } catch (error) {
    console.error('Google Sheets fetch failed:', error);
    return new Map();
  }
}

/**
 * Build Product records from ChannelEngine (base) + Google Sheets (enrichment) + existing DB (costs)
 */
function buildProducts(
  ceData: {
    products: ChannelEngineProduct[];
    salesMap: Map<string, { salesLast7Days: number; salesLast30Days: number }>;
  },
  sheetData: Map<string, GoogleSheetProduct>,
  existingProducts: Map<string, Product>
): Product[] {
  const timestamp = new Date().toISOString();
  const products: Product[] = [];

  // Iterate over ChannelEngine products (source of truth for active products)
  for (const ceProduct of ceData.products) {
    const sku = ceProduct.merchantProductNo;
    const existing = existingProducts.get(sku);
    const sheetProduct = sheetData.get(sku);
    const sales = ceData.salesMap.get(sku);

    // Determine current price: prefer sheet pricing, fallback to CE price
    const channelPrices = sheetProduct ? {
      amazon: sheetProduct.amazonPricing || undefined,
      ebay: sheetProduct.ebayPricing || undefined,
      bandq: sheetProduct.bandqPricing || undefined,
      manomano: sheetProduct.manoManoPricing || undefined,
      shopify: sheetProduct.shopifyPricing || undefined,
    } : undefined;

    // Use the first non-zero channel price or CE price as current price
    const sheetPrices = [
      sheetProduct?.amazonPricing,
      sheetProduct?.ebayPricing,
      sheetProduct?.bandqPricing,
      sheetProduct?.manoManoPricing,
      sheetProduct?.shopifyPricing,
    ].filter((p): p is number => p !== undefined && p > 0);

    const currentPrice = sheetPrices.length > 0 ? sheetPrices[0] : ceProduct.price;

    const product: Product = {
      // Core identifiers from ChannelEngine
      sku,
      title: ceProduct.name || sku,
      brand: sheetProduct?.brandName || ceProduct.brand || 'Unknown',
      category: ceProduct.categoryTrail || 'Uncategorized',
      imageUrl: ceProduct.imageUrl || existing?.imageUrl,

      // Enrichment from Google Sheets
      balterleySku: sheetProduct?.balterleySku || existing?.balterleySku,
      familyVariants: sheetProduct?.familyVariants || existing?.familyVariants,
      mrp: sheetProduct?.mrp || existing?.mrp || 0,
      currentPrice,
      channelPrices,

      // Discount info from Sheets
      discountPrice: sheetProduct?.discountPrice,
      discountStartDate: sheetProduct?.discountStartDate,
      discountEndDate: sheetProduct?.discountEndDate,

      // Cost data preserved from existing DB (updated via CSV import)
      costPrice: existing?.costPrice || 0,
      deliveryCost: existing?.deliveryCost || 0,

      // Stock from ChannelEngine
      stockLevel: ceProduct.stock,
      stockLastUpdated: timestamp,

      // Sales from ChannelEngine
      salesLast7Days: sales?.salesLast7Days || 0,
      salesLast30Days: sales?.salesLast30Days || 0,
      salesLastUpdated: sales ? timestamp : existing?.salesLastUpdated,

      // Timestamps
      lastUpdated: timestamp,
      lastSyncedFromSheet: sheetProduct ? timestamp : existing?.lastSyncedFromSheet,
      lastSyncedFromChannelEngine: timestamp,
    };

    products.push(product);
  }

  return products;
}

/**
 * Record daily history snapshot for all products
 * Captures price, stock, and daily sales for historical tracking
 */
async function recordDailyHistory(db: ReturnType<typeof createDynamoDBService>): Promise<void> {
  const today = new Date().toISOString().substring(0, 10); // YYYY-MM-DD
  const timestamp = new Date().toISOString();

  // Get all products
  const products = await db.getAllProducts();
  console.log(`[HISTORY] Processing ${products.length} products for date ${today}`);

  // Get today's sales from orders
  const orders = await db.getOrdersByDate(today);
  const dailySalesMap = new Map<string, { quantity: number; revenue: number }>();

  for (const order of orders) {
    if (order.lines) {
      for (const line of order.lines) {
        const existing = dailySalesMap.get(line.sku) || { quantity: 0, revenue: 0 };
        existing.quantity += line.quantity;
        existing.revenue += line.lineTotalInclVat;
        dailySalesMap.set(line.sku, existing);
      }
    }
  }

  // Build history records
  const historyRecords: SkuHistoryRecord[] = products.map((product) => {
    const dailySales = dailySalesMap.get(product.sku) || { quantity: 0, revenue: 0 };
    const priceExVat = (product.currentPrice || 0) / 1.2;
    const clawback = priceExVat * 0.2;
    const ppo = priceExVat - clawback - (product.deliveryCost || 0) - (product.costPrice || 0);
    const margin = priceExVat > 0 ? (ppo / priceExVat) * 100 : 0;

    return {
      sku: product.sku,
      date: today,
      price: product.currentPrice || 0,
      costPrice: product.costPrice || 0,
      stockLevel: product.stockLevel || 0,
      dailySales: dailySales.quantity,
      dailyRevenue: dailySales.revenue,
      margin: Math.round(margin * 100) / 100, // Round to 2 decimal places
      recordedAt: timestamp,
    };
  });

  // Save in batches
  await db.batchPutSkuHistory(historyRecords);
  console.log(`[HISTORY] Saved ${historyRecords.length} history records for ${today}`);
}
