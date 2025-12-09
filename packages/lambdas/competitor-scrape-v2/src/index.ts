import { ScheduledEvent, Context } from 'aws-lambda';
import { createDynamoDBServiceV2, Account, Product } from '@repricing/core';

/**
 * V2 Competitor Scrape Lambda - Multi-tenant
 * Loops through all active accounts and scrapes competitor prices for their products
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

  // Process each product
  for (const product of productsWithUrls) {
    try {
      const floorPrice = await scrapeProductCompetitors(product);

      if (floorPrice !== null && floorPrice !== product.competitorFloorPrice) {
        // Update product with new floor price
        await db.putProduct(accountId, {
          ...product,
          competitorFloorPrice: floorPrice,
          competitorPricesLastUpdated: new Date().toISOString(),
        });
        scrapedCount++;

        console.log(
          `[${accountId}] ${product.sku}: floor price updated to ${floorPrice.toFixed(2)}`
        );
      }
    } catch (error) {
      console.warn(`[${accountId}] Failed to scrape ${product.sku}:`, error);
    }
  }

  return scrapedCount;
}

/**
 * Scrape competitor prices for a single product
 * Returns the lowest (floor) price found
 */
async function scrapeProductCompetitors(product: Product): Promise<number | null> {
  if (!product.competitorUrls || product.competitorUrls.length === 0) {
    return null;
  }

  const prices: number[] = [];

  for (const urlEntry of product.competitorUrls) {
    const url = typeof urlEntry === 'string' ? urlEntry : urlEntry.url;

    try {
      const price = await scrapePrice(url);
      if (price !== null && price > 0) {
        prices.push(price);
      }
    } catch (error) {
      console.warn(`Failed to scrape URL ${url}:`, error);
    }
  }

  if (prices.length === 0) {
    return null;
  }

  // Return the minimum price (floor)
  return Math.min(...prices);
}

/**
 * Scrape price from a URL
 * This is a placeholder - in production, you'd use puppeteer or similar
 */
async function scrapePrice(url: string): Promise<number | null> {
  try {
    // Use a simple fetch with timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      },
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return null;
    }

    const html = await response.text();

    // Try to extract price using common patterns
    const pricePatterns = [
      /£(\d+(?:\.\d{2})?)/g,
      /GBP\s*(\d+(?:\.\d{2})?)/gi,
      /"price":\s*"?(\d+(?:\.\d{2})?)"/gi,
      /data-price="(\d+(?:\.\d{2})?)"/gi,
    ];

    const foundPrices: number[] = [];

    for (const pattern of pricePatterns) {
      let match;
      while ((match = pattern.exec(html)) !== null) {
        const price = parseFloat(match[1]);
        if (price > 0 && price < 10000) {
          // Sanity check
          foundPrices.push(price);
        }
      }
    }

    if (foundPrices.length === 0) {
      return null;
    }

    // Return the most common price (mode) or median
    return foundPrices.sort((a, b) => a - b)[Math.floor(foundPrices.length / 2)];
  } catch (error) {
    return null;
  }
}
