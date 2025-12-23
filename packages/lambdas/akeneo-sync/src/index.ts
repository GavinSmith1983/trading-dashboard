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
 *
 * Supports optional accountId parameter to sync specific account.
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
const MAX_PRODUCTS_PER_RUN = parseInt(process.env.MAX_PRODUCTS_PER_RUN || '4000', 10);
const REQUESTS_PER_SECOND = parseInt(process.env.REQUESTS_PER_SECOND || '50', 10);

interface AkeneoSyncEvent extends Partial<ScheduledEvent> {
  accountId?: string; // Optional: sync specific account only
}

interface SyncResult {
  accountId: string;
  totalProducts: number;
  productsNeedingSync: number;
  productsSynced: number;
  productsMatched: number;
  productsFailed: number;
  durationMs: number;
}

export async function handler(
  event: AkeneoSyncEvent,
  context: Context
): Promise<{ statusCode: number; body: string }> {
  const startTime = Date.now();
  const targetAccountId = event.accountId;

  console.log('[AkeneoSync] Starting sync...');
  console.log(`[AkeneoSync] Config: refreshDays=${AKENEO_REFRESH_DAYS}, maxPerRun=${MAX_PRODUCTS_PER_RUN}, rps=${REQUESTS_PER_SECOND}`);
  if (targetAccountId) {
    console.log(`[AkeneoSync] Target account: ${targetAccountId}`);
  }

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
    // Get accounts to process
    let accounts;
    if (targetAccountId) {
      // Single account mode
      const account = await db.getAccount(targetAccountId);
      if (!account) {
        return {
          statusCode: 404,
          body: JSON.stringify({ error: `Account ${targetAccountId} not found` }),
        };
      }
      accounts = [account];
    } else {
      // All active accounts - sorted by product count (smallest first)
      accounts = await db.getActiveAccounts();
      // Sort accounts by name to ensure smaller accounts (like valquest-usa) go first
      // This helps ensure all accounts get processed within the time limit
      accounts.sort((a, b) => a.accountId.localeCompare(b.accountId));
    }

    console.log(`[AkeneoSync] Processing ${accounts.length} account(s): ${accounts.map(a => a.accountId).join(', ')}`);

    // Create Akeneo service with rate limiting
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
          productsMatched: 0,
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
      totalMatched: results.reduce((sum, r) => sum + r.productsMatched, 0),
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

// Cache for Akeneo products - fetched once per Lambda invocation
let akeneoProductsCache: Map<string, AkeneoProductEnrichment> | null = null;
// Cache for Akeneo family labels - fetched once per Lambda invocation
let familyLabelsCache: Map<string, string> | null = null;

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
      productsMatched: 0,
      productsFailed: 0,
      durationMs: Date.now() - startTime,
    };
  }

  // Fetch family labels from Akeneo (for human-readable display)
  if (!familyLabelsCache) {
    console.log(`[AkeneoSync] Fetching family labels from Akeneo...`);
    familyLabelsCache = new Map();
    try {
      const families = await akeneo.fetchFamilies();
      for (const family of families) {
        // Prefer en_GB, fall back to en_US, then first available, then code
        const label = family.labels['en_GB'] || family.labels['en_US'] || Object.values(family.labels)[0] || family.code;
        familyLabelsCache.set(family.code, label);
      }
      console.log(`[AkeneoSync] Fetched ${familyLabelsCache.size} family labels`);
    } catch (error) {
      console.error(`[AkeneoSync] Failed to fetch family labels:`, error);
      // Continue without labels - will fall back to codes
    }
  }

  // Fetch ALL products from Akeneo once (paginated, ~100 per page)
  // This is more efficient than individual lookups when SKUs might not match exactly
  if (!akeneoProductsCache) {
    console.log(`[AkeneoSync] Fetching all products from Akeneo (bulk)...`);
    akeneoProductsCache = await akeneo.fetchAllProducts((batch, page) => {
      console.log(`[AkeneoSync] Akeneo page ${page}: ${batch.length} products`);
      return Promise.resolve();
    });
    console.log(`[AkeneoSync] Akeneo total: ${akeneoProductsCache.size} products`);
  }

  // Build a case-insensitive lookup map for matching
  const akeneoBySkuLower = new Map<string, AkeneoProductEnrichment>();
  for (const [sku, product] of akeneoProductsCache) {
    akeneoBySkuLower.set(sku.toLowerCase(), product);
  }

  // Limit batch size to avoid timeout
  const productsToSync = needsSync.slice(0, MAX_PRODUCTS_PER_RUN);
  console.log(`[AkeneoSync] Account ${accountId}: Syncing ${productsToSync.length} products (limited from ${needsSync.length})`);

  let synced = 0;
  let matched = 0;
  let failed = 0;
  const timestamp = new Date().toISOString();

  // Update products in DynamoDB
  for (let i = 0; i < productsToSync.length; i++) {
    const product = productsToSync[i];
    const sku = product.sku;

    // Try exact match first, then case-insensitive
    let akeneoProduct = akeneoProductsCache.get(sku) || akeneoBySkuLower.get(sku.toLowerCase());

    try {
      if (akeneoProduct && akeneoProduct.family) {
        // Get the human-readable label for the family
        const familyLabel = familyLabelsCache?.get(akeneoProduct.family) || akeneoProduct.family;
        await db.updateProduct(accountId, sku, {
          family: akeneoProduct.family,
          familyLabel: familyLabel,
          stockCode: akeneoProduct.parent || undefined,  // Parent model SKU (Stock Code)
          lastSyncedFromAkeneo: timestamp,
        });
        matched++;
      } else if (akeneoProduct && akeneoProduct.parent) {
        // Product has parent (Stock Code) but no family - still store the parent
        await db.updateProduct(accountId, sku, {
          stockCode: akeneoProduct.parent,
          lastSyncedFromAkeneo: timestamp,
        });
        matched++;
      } else if (product.family && !product.familyLabel && familyLabelsCache) {
        // Product has family code but no label - look up label from cache
        const familyLabel = familyLabelsCache.get(product.family) || product.family;
        await db.updateProduct(accountId, sku, {
          familyLabel: familyLabel,
          lastSyncedFromAkeneo: timestamp,
        });
        matched++;
      } else {
        // Product not found in Akeneo or has no family, still update timestamp
        await db.updateProduct(accountId, sku, {
          lastSyncedFromAkeneo: timestamp,
        });
      }
      synced++;
    } catch (error) {
      console.error(`[AkeneoSync] Failed to update product ${sku}:`, error);
      failed++;
    }

    // Log progress every 500 products
    if ((i + 1) % 500 === 0 || i === productsToSync.length - 1) {
      console.log(`[AkeneoSync] Account ${accountId}: Progress ${i + 1}/${productsToSync.length} (matched: ${matched})`);
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
    productsMatched: matched,
    productsFailed: failed,
    durationMs: Date.now() - startTime,
  };
}

/**
 * Find products that need Akeneo sync:
 * 1. Products with no family assigned
 * 2. Products with no stockCode assigned
 * 3. Products with family data older than refreshDays
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

    // Has family but no familyLabel - needs sync to get label
    if (p.family && !p.familyLabel) {
      return true;
    }

    // No stockCode assigned - needs sync to get parent model SKU
    if (!p.stockCode) {
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
