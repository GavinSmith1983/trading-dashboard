import { ScheduledEvent, Context } from 'aws-lambda';
import {
  createDynamoDBServiceV2,
  scrapeProductCompetitors,
  Account,
  Product,
} from '@repricing/core';

/**
 * V2 Competitor Scrape Lambda - Multi-tenant
 * Loops through all active accounts and scrapes competitor prices for their products
 * Uses the same scraping logic as V1 with site-specific patterns
 */
export async function handler(event: ScheduledEvent, context: Context): Promise<void> {
  console.log('V2 Competitor Scrape starting', { requestId: context.awsRequestId });

  const db = createDynamoDBServiceV2();

  // Get all active accounts
  const accounts = await db.getActiveAccounts();
  console.log(`Found ${accounts.length} active accounts to process`);

  const results: { accountId: string; status: string; scraped?: number; error?: string }[] = [];

  // Process each account
  for (const account of accounts) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Scraping competitors for: ${account.name} (${account.accountId})`);
    console.log('='.repeat(60));

    try {
      const scrapedCount = await scrapeCompetitorsForAccount(db, account);
      results.push({ accountId: account.accountId, status: 'success', scraped: scrapedCount });
      console.log(`✅ Account ${account.accountId}: ${scrapedCount} products scraped`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      results.push({ accountId: account.accountId, status: 'failed', error: errorMessage });
      console.error(`❌ Account ${account.accountId} scrape failed:`, error);
    }
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('COMPETITOR SCRAPE SUMMARY');
  console.log('='.repeat(60));
  for (const result of results) {
    if (result.status === 'success') {
      console.log(`✅ ${result.accountId}: ${result.scraped} products`);
    } else {
      console.log(`❌ ${result.accountId}: ${result.error}`);
    }
  }
}

/**
 * Scrape competitor prices for a single account
 */
async function scrapeCompetitorsForAccount(
  db: ReturnType<typeof createDynamoDBServiceV2>,
  account: Account
): Promise<number> {
  const accountId = account.accountId;

  // Get all products that have competitor URLs
  console.log(`[${accountId}] Loading products with competitor URLs...`);
  const products = await db.getAllProducts(accountId);

  const productsWithUrls = products.filter(
    (p) => p.competitorUrls && p.competitorUrls.length > 0
  );

  console.log(`[${accountId}] Found ${productsWithUrls.length} products with competitor URLs`);

  if (productsWithUrls.length === 0) {
    return 0;
  }

  let scrapedCount = 0;
  const errors: string[] = [];

  // Process products in batches to avoid overwhelming servers
  const batchSize = 5;
  for (let i = 0; i < productsWithUrls.length; i += batchSize) {
    const batch = productsWithUrls.slice(i, i + batchSize);

    // Process batch in parallel
    const results = await Promise.all(
      batch.map(async (product) => {
        try {
          console.log(`[${accountId}] Scraping competitors for ${product.sku}...`);
          const result = await scrapeProductCompetitors(product);

          // Update product with new competitor data
          const updatedProduct: Product = {
            ...product,
            competitorUrls: result.updatedUrls,
            competitorFloorPrice: result.lowestPrice ?? undefined,
            competitorPricesLastUpdated: new Date().toISOString(),
          };

          await db.putProduct(accountId, updatedProduct);

          if (result.errors.length > 0) {
            errors.push(`${product.sku}: ${result.errors.join('; ')}`);
          }

          const urlsWithPrices = result.updatedUrls.filter(u => u.lastPrice !== undefined).length;
          console.log(
            `[${accountId}] ${product.sku}: ${urlsWithPrices}/${result.updatedUrls.length} URLs scraped, ` +
            `floor price: ${result.lowestPrice !== null ? `£${result.lowestPrice.toFixed(2)}` : 'N/A'}`
          );

          return {
            sku: product.sku,
            success: result.lowestPrice !== null,
            lowestPrice: result.lowestPrice,
            errors: result.errors,
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          errors.push(`${product.sku}: ${message}`);
          console.error(`[${accountId}] Failed to scrape ${product.sku}:`, error);
          return {
            sku: product.sku,
            success: false,
            lowestPrice: null,
            errors: [message],
          };
        }
      })
    );

    // Count successes
    for (const result of results) {
      if (result.success) {
        scrapedCount++;
      }
    }

    // Small delay between batches to be respectful to competitor servers
    if (i + batchSize < productsWithUrls.length) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  if (errors.length > 0) {
    console.log(`[${accountId}] Scrape errors (first 10):`, errors.slice(0, 10));
  }

  return scrapedCount;
}
