import { ScheduledEvent, Context } from 'aws-lambda';
import {
  createDynamoDBServiceV2,
  createGoogleSheetsService,
  createChannelEngineService,
  AkeneoService,
  AkeneoProductEnrichment,
  Product,
  Account,
  SkuHistoryRecord,
} from '@repricing/core';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';

const secretsClient = new SecretsManagerClient({});
const AKENEO_SECRET_ARN = process.env.AKENEO_SECRET_ARN;

/**
 * V2 Data Sync Lambda - Multi-tenant
 * Loops through all active accounts and syncs each from their own ChannelEngine + Google Sheets
 */
export async function handler(event: ScheduledEvent, context: Context): Promise<void> {
  console.log('V2 Data Sync starting', { requestId: context.awsRequestId });

  const db = createDynamoDBServiceV2();

  // Get all active accounts
  const accounts = await db.getActiveAccounts();
  console.log(`Found ${accounts.length} active accounts to sync`);

  const results: { accountId: string; status: string; products?: number; error?: string }[] = [];

  // Process each account
  for (const account of accounts) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Syncing account: ${account.name} (${account.accountId})`);
    console.log('='.repeat(60));

    try {
      const productCount = await syncAccount(db, account);
      results.push({ accountId: account.accountId, status: 'success', products: productCount });
      console.log(`✅ Account ${account.accountId} synced: ${productCount} products`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      results.push({ accountId: account.accountId, status: 'failed', error: errorMessage });
      console.error(`❌ Account ${account.accountId} failed:`, error);
      // Continue with other accounts
    }
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('SYNC SUMMARY');
  console.log('='.repeat(60));
  for (const result of results) {
    if (result.status === 'success') {
      console.log(`✅ ${result.accountId}: ${result.products} products`);
    } else {
      console.log(`❌ ${result.accountId}: ${result.error}`);
    }
  }

  const successCount = results.filter((r) => r.status === 'success').length;
  console.log(`\nCompleted: ${successCount}/${accounts.length} accounts synced successfully`);
}

/**
 * Sync a single account's data
 */
async function syncAccount(
  db: ReturnType<typeof createDynamoDBServiceV2>,
  account: Account
): Promise<number> {
  const accountId = account.accountId;

  // Validate account has required configuration
  if (!account.channelEngine?.apiKey || !account.channelEngine?.tenantId) {
    throw new Error('ChannelEngine not configured for this account');
  }

  // 1. Get existing products to preserve cost data
  console.log(`[${accountId}] Loading existing products...`);
  const existingProducts = await db.getAllProducts(accountId);
  const existingMap = new Map(existingProducts.map((p) => [p.sku, p]));
  console.log(`[${accountId}] Found ${existingProducts.length} existing products`);

  // 2. Fetch Google Sheets data if configured
  let sheetData = new Map<string, {
    amazonPricing?: number;
    ebayPricing?: number;
    bandqPricing?: number;
    manoManoPricing?: number;
    shopifyPricing?: number;
  }>();

  if (account.googleSheets?.spreadsheetId) {
    try {
      console.log(`[${accountId}] Fetching Google Sheets data...`);
      sheetData = await fetchGoogleSheetsData(account);
      console.log(`[${accountId}] Loaded ${sheetData.size} products from Google Sheets`);
    } catch (error) {
      console.warn(`[${accountId}] Failed to fetch Google Sheets, continuing without:`, error);
    }
  }

  // 3. Fetch Akeneo PIM data for product enrichment (Family)
  // Uses cached data from existing products, refreshes every 7 days
  let akeneoData = new Map<string, AkeneoProductEnrichment>();
  let shouldRefreshAkeneo = false;

  if (AKENEO_SECRET_ARN) {
    // Check if we need to refresh Akeneo data (every 7 days)
    const AKENEO_REFRESH_DAYS = 7;
    const oldestAllowedSync = new Date();
    oldestAllowedSync.setDate(oldestAllowedSync.getDate() - AKENEO_REFRESH_DAYS);

    // Check if any product has a recent Akeneo sync
    const recentAkeneoSync = existingProducts.find(p => {
      if (!p.lastSyncedFromAkeneo) return false;
      return new Date(p.lastSyncedFromAkeneo) > oldestAllowedSync;
    });

    if (recentAkeneoSync) {
      // Use cached Akeneo data from existing products
      console.log(`[${accountId}] Using cached Akeneo data (last sync: ${recentAkeneoSync.lastSyncedFromAkeneo})`);
      for (const product of existingProducts) {
        if (product.family) {
          akeneoData.set(product.sku, {
            sku: product.sku,
            family: product.family,
            categories: [],
            enabled: true,
            updated: product.lastSyncedFromAkeneo || '',
          });
        }
      }
      console.log(`[${accountId}] Loaded ${akeneoData.size} products from cache`);
    } else {
      // Need to refresh from Akeneo API
      shouldRefreshAkeneo = true;
      try {
        console.log(`[${accountId}] Refreshing Akeneo PIM data (cache expired or empty)...`);
        akeneoData = await fetchAkeneoData();
        console.log(`[${accountId}] Loaded ${akeneoData.size} products from Akeneo API`);
      } catch (error) {
        console.warn(`[${accountId}] Failed to fetch Akeneo data, using existing cache:`, error);
        // Fall back to cached data from existing products
        for (const product of existingProducts) {
          if (product.family) {
            akeneoData.set(product.sku, {
              sku: product.sku,
              family: product.family,
              categories: [],
              enabled: true,
              updated: product.lastSyncedFromAkeneo || '',
            });
          }
        }
      }
    }
  } else {
    console.log(`[${accountId}] Akeneo not configured (no AKENEO_SECRET_ARN)`);
  }

  // 4. Create ChannelEngine service for this account
  const ceService = createChannelEngineServiceFromAccount(account);

  // 5. Fetch products from ChannelEngine and save incrementally
  console.log(`[${accountId}] Starting incremental fetch and save from ChannelEngine...`);
  let totalSaved = 0;

  await ceService.fetchProducts(async (batchProducts, page, total) => {
    const timestamp = new Date().toISOString();

    // Note: ChannelEngine API returns PascalCase field names (MerchantProductNo, Name, Brand, etc.)
    const productsToSave: Product[] = batchProducts
      .filter((ceProduct) => ceProduct.MerchantProductNo) // Skip products without SKU
      .map((ceProduct) => {
      const sku = ceProduct.MerchantProductNo;
      const existing = existingMap.get(sku);
      const sheetProduct = sku
        ? (sheetData.get(sku) ||
           sheetData.get(sku.toUpperCase()) ||
           sheetData.get(sku.toLowerCase()))
        : undefined;

      // Get Akeneo enrichment data (try exact match, then uppercase, then lowercase)
      const akeneoProduct = sku
        ? (akeneoData.get(sku) ||
           akeneoData.get(sku.toUpperCase()) ||
           akeneoData.get(sku.toLowerCase()))
        : undefined;

      // Build channel prices from Google Sheets
      const channelPrices = sheetProduct
        ? {
            amazon: sheetProduct.amazonPricing || undefined,
            ebay: sheetProduct.ebayPricing || undefined,
            onbuy: sheetProduct.ebayPricing || undefined,
            debenhams: sheetProduct.ebayPricing || undefined,
            bandq: sheetProduct.bandqPricing || undefined,
            manomano: sheetProduct.manoManoPricing || undefined,
            shopify: sheetProduct.shopifyPricing || undefined,
          }
        : existing?.channelPrices;

      return {
        sku,
        title: ceProduct.Name || sku,
        brand: ceProduct.Brand || 'Unknown',
        // Family from Akeneo PIM (primary categorisation)
        family: akeneoProduct?.family || existing?.family,
        // Subcategory from ChannelEngine CategoryTrail (secondary categorisation)
        subcategory: ceProduct.CategoryTrail || existing?.subcategory || 'Uncategorized',
        imageUrl: ceProduct.ImageUrl || existing?.imageUrl,
        mrp: existing?.mrp || 0,
        currentPrice: ceProduct.Price,
        channelPrices,
        costPrice: existing?.costPrice || 0,
        deliveryCost: existing?.deliveryCost || 0,
        weight: ceProduct.Weight || existing?.weight,
        stockLevel: ceProduct.Stock,
        stockLastUpdated: timestamp,
        salesLast7Days: existing?.salesLast7Days || 0,
        salesLast30Days: existing?.salesLast30Days || 0,
        lastUpdated: timestamp,
        lastSyncedFromChannelEngine: timestamp,
        lastSyncedFromSheet: sheetProduct ? timestamp : existing?.lastSyncedFromSheet,
        // Only update Akeneo timestamp if we refreshed from API (not from cache)
        lastSyncedFromAkeneo: (shouldRefreshAkeneo && akeneoProduct) ? timestamp : existing?.lastSyncedFromAkeneo,
        competitorUrls: existing?.competitorUrls,
        competitorFloorPrice: existing?.competitorFloorPrice,
      };
    });

    // Save to DynamoDB with accountId
    await db.batchPutProducts(accountId, productsToSave);
    totalSaved += productsToSave.length;

    console.log(
      `[${accountId}] Saved batch ${page}: ${productsToSave.length} products (${totalSaved}/${total} total)`
    );
  });

  // 6. Calculate and update sales data from order lines
  console.log(`[${accountId}] Calculating sales data from order lines...`);
  await updateSalesData(db, accountId);

  // 7. Record daily history
  console.log(`[${accountId}] Recording daily history snapshots...`);
  await recordDailyHistory(db, accountId);

  return totalSaved;
}

/**
 * Fetch product data from Akeneo PIM
 * Returns a map of SKU -> enrichment data for easy lookup
 */
async function fetchAkeneoData(): Promise<Map<string, AkeneoProductEnrichment>> {
  if (!AKENEO_SECRET_ARN) {
    return new Map();
  }

  // Get credentials from Secrets Manager
  const secretResponse = await secretsClient.send(
    new GetSecretValueCommand({ SecretId: AKENEO_SECRET_ARN })
  );

  if (!secretResponse.SecretString) {
    throw new Error('Akeneo secret is empty');
  }

  const config = JSON.parse(secretResponse.SecretString);
  const akeneoService = new AkeneoService(config);

  // Fetch all products from Akeneo
  return akeneoService.fetchAllProducts();
}

/**
 * Convert column letter to index (A=0, B=1, etc.)
 */
function columnLetterToIndex(letter: string): number {
  let result = 0;
  for (let i = 0; i < letter.length; i++) {
    result = result * 26 + (letter.charCodeAt(i) - 'A'.charCodeAt(0) + 1);
  }
  return result - 1;
}

/**
 * Fetch Google Sheets data for an account using configurable column mapping
 */
async function fetchGoogleSheetsData(
  account: Account
): Promise<Map<string, {
  amazonPricing?: number;
  ebayPricing?: number;
  bandqPricing?: number;
  manoManoPricing?: number;
  shopifyPricing?: number;
  singlePrice?: number;
}>> {
  // Get credentials from Secrets Manager
  let credentials: string | undefined;

  if (account.googleSheets.credentialsSecretArn) {
    const secretResponse = await secretsClient.send(
      new GetSecretValueCommand({
        SecretId: account.googleSheets.credentialsSecretArn,
      })
    );
    credentials = secretResponse.SecretString;
  } else {
    // Fall back to default secret
    const defaultSecretArn = process.env.GOOGLE_SHEETS_SECRET_ARN;
    if (defaultSecretArn) {
      const secretResponse = await secretsClient.send(
        new GetSecretValueCommand({ SecretId: defaultSecretArn })
      );
      const secretData = JSON.parse(secretResponse.SecretString || '{}');
      credentials = secretData.credentials;
    }
  }

  if (!credentials) {
    throw new Error('Google Sheets credentials not found');
  }

  const sheetsService = createGoogleSheetsService(
    credentials,
    account.googleSheets.spreadsheetId
  );

  // Get column mapping from account config (with defaults for backwards compatibility)
  const columnMapping = account.googleSheets.columnMapping || {
    skuColumn: 'C',
    pricingMode: 'multi' as const,
    channelPriceColumns: {
      bnq: 'F',
      amazon: 'G',
      ebay: 'H',
      manomano: 'I',
      shopify: 'J',
    },
    startRow: 2,
  };

  // Fetch raw sheet data
  const sheetName = columnMapping.sheetName || '';
  const range = sheetName ? `'${sheetName}'!A:Z` : 'A:Z';
  const rawData = await sheetsService.fetchRawData(range);

  // Build lookup map
  const map = new Map<string, {
    amazonPricing?: number;
    ebayPricing?: number;
    bandqPricing?: number;
    manoManoPricing?: number;
    shopifyPricing?: number;
    singlePrice?: number;
  }>();

  const startRow = (columnMapping.startRow || 2) - 1; // Convert to 0-indexed
  const skuColIdx = columnLetterToIndex(columnMapping.skuColumn || 'A');

  for (let i = startRow; i < rawData.length; i++) {
    const row = rawData[i];
    const sku = row[skuColIdx]?.toString().trim();

    if (!sku) continue;

    if (columnMapping.pricingMode === 'single') {
      // Single price mode - one price for all channels
      const priceColIdx = columnLetterToIndex(columnMapping.priceColumn || 'B');
      const price = parseFloat(row[priceColIdx]) || undefined;

      map.set(sku.toUpperCase(), {
        singlePrice: price,
        // Apply single price to all channels
        amazonPricing: price,
        ebayPricing: price,
        bandqPricing: price,
        manoManoPricing: price,
        shopifyPricing: price,
      });
    } else {
      // Multi-channel mode - different prices per channel
      const channels = columnMapping.channelPriceColumns || {};

      map.set(sku.toUpperCase(), {
        bandqPricing: channels.bnq ? parseFloat(row[columnLetterToIndex(channels.bnq)]) || undefined : undefined,
        amazonPricing: channels.amazon ? parseFloat(row[columnLetterToIndex(channels.amazon)]) || undefined : undefined,
        ebayPricing: channels.ebay ? parseFloat(row[columnLetterToIndex(channels.ebay)]) || undefined : undefined,
        manoManoPricing: channels.manomano ? parseFloat(row[columnLetterToIndex(channels.manomano)]) || undefined : undefined,
        shopifyPricing: channels.shopify ? parseFloat(row[columnLetterToIndex(channels.shopify)]) || undefined : undefined,
      });
    }
  }

  console.log(`[${account.accountId}] Column mapping: SKU=${columnMapping.skuColumn}, mode=${columnMapping.pricingMode}`);

  return map;
}

/**
 * Create ChannelEngine service from account config
 */
function createChannelEngineServiceFromAccount(account: Account) {
  // Build base URL from tenant ID (e.g., ku-bathrooms -> https://ku-bathrooms.channelengine.net/api/v2)
  const tenantId = account.channelEngine.tenantId;
  const baseUrl = `https://${tenantId}.channelengine.net/api/v2`;

  return {
    async fetchProducts(
      callback?: (products: any[], page: number, total: number) => Promise<void>
    ): Promise<any[]> {
      const allProducts: any[] = [];
      let page = 1;
      const pageSize = 100;

      while (true) {
        const response = await fetch(
          `${baseUrl}/products?page=${page}&pageSize=${pageSize}`,
          {
            headers: {
              'X-CE-KEY': account.channelEngine.apiKey,
              'Content-Type': 'application/json',
            },
          }
        );

        if (!response.ok) {
          throw new Error(`ChannelEngine API error: ${response.status}`);
        }

        const data = (await response.json()) as { Content?: any[]; TotalCount?: number };
        const products = data.Content || [];
        const totalCount = data.TotalCount || 0;

        if (callback) {
          await callback(products, page, totalCount);
        }

        allProducts.push(...products);

        if (products.length < pageSize || allProducts.length >= totalCount) {
          break;
        }

        page++;
      }

      return allProducts;
    },
  };
}

/**
 * Calculate and update sales data from order lines
 */
async function updateSalesData(
  db: ReturnType<typeof createDynamoDBServiceV2>,
  accountId: string
): Promise<void> {
  // Get sales for last 7 and 30 days
  const [sales7Days, sales30Days] = await Promise.all([
    db.getSalesBySku(accountId, 7),
    db.getSalesBySku(accountId, 30),
  ]);

  console.log(`[${accountId}] Found sales data for ${sales7Days.size} SKUs (7d), ${sales30Days.size} SKUs (30d)`);

  if (sales7Days.size === 0 && sales30Days.size === 0) {
    console.log(`[${accountId}] No sales data to update`);
    return;
  }

  // Get all SKUs that have sales
  const skusWithSales = new Set([...sales7Days.keys(), ...sales30Days.keys()]);

  // Update products in batches
  let updated = 0;
  for (const sku of skusWithSales) {
    const sales7 = sales7Days.get(sku);
    const sales30 = sales30Days.get(sku);

    try {
      await db.updateProduct(accountId, sku, {
        salesLast7Days: sales7?.quantity || 0,
        salesLast30Days: sales30?.quantity || 0,
      });
      updated++;
    } catch (error) {
      // Product might not exist in products table
      console.warn(`[${accountId}] Could not update sales for SKU ${sku}:`, error);
    }
  }

  console.log(`[${accountId}] Updated sales data for ${updated} products`);
}

/**
 * Record daily history snapshot for all products in an account
 */
async function recordDailyHistory(
  db: ReturnType<typeof createDynamoDBServiceV2>,
  accountId: string
): Promise<void> {
  const today = new Date().toISOString().substring(0, 10);
  const products = await db.getAllProducts(accountId);

  const timestamp = new Date().toISOString();
  const historyRecords: SkuHistoryRecord[] = products.map((product) => ({
    sku: product.sku,
    date: today,
    price: product.currentPrice,
    costPrice: product.costPrice,
    stockLevel: product.stockLevel,
    dailySales: product.salesLast7Days ? Math.round(product.salesLast7Days / 7) : 0,
    dailyRevenue: 0, // Calculated separately from orders
    lowestCompetitorPrice: product.competitorFloorPrice,
    recordedAt: timestamp,
  }));

  // Batch write in chunks of 25
  const chunks: SkuHistoryRecord[][] = [];
  for (let i = 0; i < historyRecords.length; i += 25) {
    chunks.push(historyRecords.slice(i, i + 25));
  }

  for (const chunk of chunks) {
    for (const record of chunk) {
      await db.putSkuHistory(accountId, record);
    }
  }

  console.log(`[${accountId}] Recorded ${historyRecords.length} history snapshots`);
}
