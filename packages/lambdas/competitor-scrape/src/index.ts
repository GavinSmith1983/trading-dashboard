import { ScheduledEvent, Context } from 'aws-lambda';
import {
  createDynamoDBService,
  scrapeProductCompetitors,
  Product,
} from '@repricing/core';

const db = createDynamoDBService();

/**
 * Competitor Price Scraper Lambda
 * Runs weekly to scrape competitor prices and update products
 */
export async function handler(event: ScheduledEvent, context: Context): Promise<void> {
  console.log('Starting competitor price scrape', { event, requestId: context.awsRequestId });

  try {
    // Get all products with competitor URLs configured
    console.log('Loading products with competitor URLs...');
    const allProducts = await db.getAllProducts();
    const productsWithCompetitors = allProducts.filter(
      (p) => p.competitorUrls && p.competitorUrls.length > 0
    );

    console.log(`Found ${productsWithCompetitors.length} products with competitor URLs`);

    if (productsWithCompetitors.length === 0) {
      console.log('No products have competitor URLs configured. Exiting.');
      return;
    }

    let successCount = 0;
    let errorCount = 0;
    const errors: string[] = [];

    // Process products in batches to avoid overwhelming servers
    const batchSize = 5;
    for (let i = 0; i < productsWithCompetitors.length; i += batchSize) {
      const batch = productsWithCompetitors.slice(i, i + batchSize);

      // Process batch in parallel
      const results = await Promise.all(
        batch.map(async (product) => {
          try {
            console.log(`Scraping competitors for ${product.sku}...`);
            const result = await scrapeProductCompetitors(product);

            // Update product with new competitor data
            const updatedProduct: Product = {
              ...product,
              competitorUrls: result.updatedUrls,
              competitorFloorPrice: result.lowestPrice ?? undefined,
              competitorPricesLastUpdated: new Date().toISOString(),
            };

            await db.putProduct(updatedProduct);

            if (result.errors.length > 0) {
              errors.push(`${product.sku}: ${result.errors.join('; ')}`);
            }

            return {
              sku: product.sku,
              success: result.lowestPrice !== null,
              lowestPrice: result.lowestPrice,
              errors: result.errors,
            };
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            errors.push(`${product.sku}: ${message}`);
            return {
              sku: product.sku,
              success: false,
              lowestPrice: null,
              errors: [message],
            };
          }
        })
      );

      // Count successes/errors
      for (const result of results) {
        if (result.success) {
          successCount++;
        } else {
          errorCount++;
        }
      }

      // Small delay between batches to be respectful to competitor servers
      if (i + batchSize < productsWithCompetitors.length) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }

    console.log('Competitor scrape complete:', {
      totalProducts: productsWithCompetitors.length,
      successCount,
      errorCount,
      errors: errors.slice(0, 20), // Log first 20 errors
    });
  } catch (error) {
    console.error('Competitor scrape failed:', error);
    throw error;
  }
}
