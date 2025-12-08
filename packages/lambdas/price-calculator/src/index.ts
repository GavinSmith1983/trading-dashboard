import { ScheduledEvent, Context } from 'aws-lambda';
import { v4 as uuid } from 'uuid';
import {
  createDynamoDBService,
  PricingEngine,
  DEFAULT_PRICING_CONFIG,
  DEFAULT_CHANNEL_CONFIGS,
  Channel,
} from '@repricing/core';

/**
 * Price Calculator Lambda
 * Runs weekly after data sync to generate price proposals
 */
export async function handler(event: ScheduledEvent, context: Context): Promise<void> {
  console.log('Starting price calculation', { event, requestId: context.awsRequestId });

  const db = createDynamoDBService();
  const batchId = uuid();

  try {
    // 1. Load all products and sales data in parallel
    console.log('Loading products and sales data...');
    const [products, salesMap] = await Promise.all([
      db.getAllProducts(),
      db.getSalesBySku(7), // Get 7-day sales data
    ]);
    console.log(`Loaded ${products.length} products and sales data for ${salesMap.size} SKUs`);

    // Merge sales data into products
    for (const product of products) {
      const sales = salesMap.get(product.sku);
      if (sales) {
        product.salesLast7Days = sales.quantity;
      }
    }

    // Filter to products with cost data (required for any pricing calculation)
    // Products without cost price cannot be repriced - we need costs to calculate margin
    const productsWithCosts = products.filter((p) => p.costPrice > 0);
    const withoutRetail = productsWithCosts.filter((p) => p.currentPrice < 1).length;
    console.log(`${productsWithCosts.length} products have cost data (${withoutRetail} need retail price set)`);

    if (productsWithCosts.length === 0) {
      console.warn('No products with cost data - skipping price calculation');
      return;
    }

    // 2. Load pricing rules
    console.log('Loading pricing rules...');
    const rules = await db.getAllRules();
    console.log(`Loaded ${rules.length} pricing rules`);

    // 3. Load channel configuration
    console.log('Loading channel configuration...');
    let channels = await db.getAllChannels();

    // If no channels configured, initialize with defaults
    if (channels.length === 0) {
      console.log('No channels configured - initializing defaults');
      const defaultChannels = Object.values(DEFAULT_CHANNEL_CONFIGS).map((c) => ({
        ...c,
        lastUpdated: new Date().toISOString(),
      })) as Channel[];

      for (const channel of defaultChannels) {
        await db.putChannel(channel);
      }
      channels = defaultChannels;
    }

    // 4. Initialize pricing engine
    const pricingEngine = new PricingEngine(DEFAULT_PRICING_CONFIG, rules, channels);

    // 5. Generate proposals
    console.log('Generating price proposals...');
    const proposals = pricingEngine.generateProposals(productsWithCosts, batchId);
    console.log(`Generated ${proposals.length} proposals`);

    if (proposals.length === 0) {
      console.log('No price changes proposed');
      return;
    }

    // 6. Save proposals to database
    console.log('Saving proposals...');
    await db.batchPutProposals(proposals);
    console.log('Proposals saved');

    // 7. Log summary
    const summary = {
      batchId,
      totalProducts: products.length,
      productsWithCosts: productsWithCosts.length,
      proposalsGenerated: proposals.length,
      priceIncreases: proposals.filter((p) => p.priceChange > 0).length,
      priceDecreases: proposals.filter((p) => p.priceChange < 0).length,
      avgPriceChange:
        proposals.length > 0
          ? proposals.reduce((sum, p) => sum + p.priceChangePercent, 0) / proposals.length
          : 0,
      avgMarginChange:
        proposals.length > 0
          ? proposals.reduce((sum, p) => sum + p.marginChange, 0) / proposals.length
          : 0,
      proposalsWithWarnings: proposals.filter((p) => p.warnings.length > 0).length,
    };

    console.log('Calculation summary:', summary);

    // 8. Could send notification here (SNS, email, etc.)
    // For now, just log that proposals are ready for review
    console.log(`Price proposals ready for review. Batch ID: ${batchId}`);
  } catch (error) {
    console.error('Price calculation failed:', error);
    throw error;
  }
}
