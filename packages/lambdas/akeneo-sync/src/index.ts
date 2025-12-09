/**
 * Akeneo Sync Lambda
 *
 * Runs every 15 minutes to sync product Family data from Akeneo PIM.
 * Only syncs products that:
 * - Have no family assigned, OR
 * - Have family data older than 7 days
 *
 * Rate limiting:
 * - Conservative 10 requests/second (Akeneo allows 100/s)
 * - Exponential backoff on 429 responses
 * - Batch size limited to avoid Lambda timeout
 */

import { ScheduledEvent, Context } from 'aws-lambda';
import {
  createDynamoDBServiceV2,
  createAkeneoServiceFromSecret,
  Product,
  AkeneoProductEnrichment,
} from '@repricing/core';

// Environment variables
const AKENEO_SECRET_ARN = process.env.AKENEO_SECRET_ARN;
const AKENEO_REFRESH_DAYS = parseInt(process.env.AKENEO_REFRESH_DAYS || '7', 10);
const MAX_PRODUCTS_PER_RUN = parseInt(process.env.MAX_PRODUCTS_PER_RUN || '500', 10);
const REQUESTS_PER_SECOND = parseInt(process.env.REQUESTS_PER_SECOND || '10', 10);

interface SyncResult {
  accountId: string;
  totalProducts: number;
  productsNeedingSync: number;
  productsSynced: number;
  productsFailed: number;
  durationMs: number;
}

export async function handler(
  event: ScheduledEvent,
  context: Context
): Promise<{ statusCode: number; body: string }> {
  const startTime = Date.now();
  console.log('[AkeneoSync] Starting scheduled sync...');
  console.log(`[AkeneoSync] Config: refreshDays=${AKENEO_REFRESH_DAYS}, maxPerRun=${MAX_PRODUCTS_PER_RUN}, rps=${REQUESTS_PER_SECOND}`);

  if (!AKENEO_SECRET_ARN) {
    console.log('[AkeneoSync] AKENEO_SECRET_ARN not configured, skipping sync');
    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Akeneo not configured', skipped: true }),
    };
  }

  const db = createDynamoDBServiceV2();
  const results: SyncResult[] = [];

  try {
    // Get all active accounts
    const accounts = await db.getActiveAccounts();
    console.log(`[AkeneoSync] Found ${accounts.length} active accounts`);

    // Create Akeneo service with conservative rate limiting
    const akeneo = await createAkeneoServiceFromSecret(AKENEO_SECRET_ARN, {
      requestsPerSecond: REQUESTS_PER_SECOND,
      retryAfterMs: 2000,
      maxRetries: 3,
    });

    // Process each account
    for (const account of accounts) {
      const accountStart = Date.now();
      console.log(`[AkeneoSync] Processing account: ${account.accountId}`);

      try {
        const accountResult = await syncAccountProducts(
          db,
          akeneo,
          account.accountId,
          context
        );
        results.push(accountResult);
      } catch (error) {
        console.error(`[AkeneoSync] Error syncing account ${account.accountId}:`, error);
        results.push({
          accountId: account.accountId,
          totalProducts: 0,
          productsNeedingSync: 0,
          productsSynced: 0,
          productsFailed: 0,
          durationMs: Date.now() - accountStart,
        });
      }

      // Check remaining time - leave 30s buffer for cleanup
      const remainingMs = context.getRemainingTimeInMillis();
      if (remainingMs < 30000) {
        console.log(`[AkeneoSync] Low on time (${remainingMs}ms remaining), stopping early`);
        break;
      }
    }

    const totalDuration = Date.now() - startTime;
    const summary = {
      totalAccounts: accounts.length,
      processedAccounts: results.length,
      totalSynced: results.reduce((sum, r) => sum + r.productsSynced, 0),
      totalFailed: results.reduce((sum, r) => sum + r.productsFailed, 0),
      durationMs: totalDuration,
      results,
    };

    console.log(`[AkeneoSync] Completed in ${totalDuration}ms:`, JSON.stringify(summary, null, 2));

    return {
      statusCode: 200,
      body: JSON.stringify(summary),
    };
  } catch (error) {
    console.error('[AkeneoSync] Fatal error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error',
        results,
      }),
    };
  }
}

async function syncAccountProducts(
  db: ReturnType<typeof createDynamoDBServiceV2>,
  akeneo: Awaited<ReturnType<typeof createAkeneoServiceFromSecret>>,
  accountId: string,
  context: Context
): Promise<SyncResult> {
  const startTime = Date.now();

  // Get all products for this account
  const products = await db.getAllProducts(accountId);
  console.log(`[AkeneoSync] Account ${accountId}: ${products.length} total products`);

  // Find products needing sync
  const needsSync = findProductsNeedingSync(products, AKENEO_REFRESH_DAYS);
  console.log(`[AkeneoSync] Account ${accountId}: ${needsSync.length} products need sync`);

  if (needsSync.length === 0) {
    return {
      accountId,
      totalProducts: products.length,
      productsNeedingSync: 0,
      productsSynced: 0,
      productsFailed: 0,
      durationMs: Date.now() - startTime,
    };
  }

  // Limit batch size to avoid timeout
  const productsToSync = needsSync.slice(0, MAX_PRODUCTS_PER_RUN);
  console.log(`[AkeneoSync] Account ${accountId}: Syncing ${productsToSync.length} products (limited from ${needsSync.length})`);

  // Fetch from Akeneo with progress tracking
  const skus = productsToSync.map(p => p.sku);
  let synced = 0;
  let failed = 0;
  const timestamp = new Date().toISOString();

  // Fetch and update products one by one (respects rate limits)
  const akeneoData = await akeneo.fetchProductsBySKUs(skus, async (completed, total, product) => {
    // Log progress every 50 products
    if (completed % 50 === 0 || completed === total) {
      console.log(`[AkeneoSync] Account ${accountId}: Progress ${completed}/${total}`);
    }
  });

  // Update products in DynamoDB
  for (const sku of skus) {
    const akeneoProduct = akeneoData.get(sku);

    try {
      if (akeneoProduct) {
        await db.updateProduct(accountId, sku, {
          family: akeneoProduct.family || undefined,
          lastSyncedFromAkeneo: timestamp,
        });
        synced++;
      } else {
        // Product not found in Akeneo, still update timestamp to avoid repeated lookups
        await db.updateProduct(accountId, sku, {
          lastSyncedFromAkeneo: timestamp,
        });
        synced++;
      }
    } catch (error) {
      console.error(`[AkeneoSync] Failed to update product ${sku}:`, error);
      failed++;
    }

    // Check remaining time
    const remainingMs = context.getRemainingTimeInMillis();
    if (remainingMs < 10000) {
      console.log(`[AkeneoSync] Low on time during updates, stopping early`);
      break;
    }
  }

  return {
    accountId,
    totalProducts: products.length,
    productsNeedingSync: needsSync.length,
    productsSynced: synced,
    productsFailed: failed,
    durationMs: Date.now() - startTime,
  };
}

/**
 * Find products that need Akeneo sync:
 * 1. Products with no family assigned
 * 2. Products with family data older than refreshDays
 */
function findProductsNeedingSync(products: Product[], refreshDays: number): Product[] {
  const oldestAllowedSync = new Date();
  oldestAllowedSync.setDate(oldestAllowedSync.getDate() - refreshDays);
  const oldestAllowedStr = oldestAllowedSync.toISOString();

  return products.filter(p => {
    // No family assigned - needs sync
    if (!p.family) {
      return true;
    }

    // Never synced from Akeneo - needs sync
    if (!p.lastSyncedFromAkeneo) {
      return true;
    }

    // Sync data is older than threshold
    if (p.lastSyncedFromAkeneo < oldestAllowedStr) {
      return true;
    }

    return false;
  });
}
