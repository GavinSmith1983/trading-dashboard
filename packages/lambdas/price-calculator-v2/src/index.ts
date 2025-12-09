import { ScheduledEvent, Context } from 'aws-lambda';
import {
  createDynamoDBServiceV2,
  Account,
  Product,
  PricingRule,
  PriceProposal,
  RoundingRule,
  calculateCostBreakdown,
} from '@repricing/core';
import { v4 as uuid } from 'uuid';

/**
 * V2 Price Calculator Lambda - Multi-tenant
 * Loops through all active accounts and calculates pricing proposals for each
 */
export async function handler(event: ScheduledEvent, context: Context): Promise<void> {
  console.log('V2 Price Calculator starting', { requestId: context.awsRequestId });

  const db = createDynamoDBServiceV2();

  // Get all active accounts
  const accounts = await db.getActiveAccounts();
  console.log(`Found ${accounts.length} active accounts to process`);

  const results: { accountId: string; status: string; proposals?: number; error?: string }[] = [];

  // Process each account
  for (const account of accounts) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Calculating prices for: ${account.name} (${account.accountId})`);
    console.log('='.repeat(60));

    try {
      const proposalCount = await calculatePricesForAccount(db, account);
      results.push({ accountId: account.accountId, status: 'success', proposals: proposalCount });
      console.log(`✅ Account ${account.accountId}: ${proposalCount} proposals generated`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      results.push({ accountId: account.accountId, status: 'failed', error: errorMessage });
      console.error(`❌ Account ${account.accountId} price calculation failed:`, error);
    }
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('PRICE CALCULATION SUMMARY');
  console.log('='.repeat(60));
  for (const result of results) {
    if (result.status === 'success') {
      console.log(`✅ ${result.accountId}: ${result.proposals} proposals`);
    } else {
      console.log(`❌ ${result.accountId}: ${result.error}`);
    }
  }
}

/**
 * Calculate prices for a single account
 */
async function calculatePricesForAccount(
  db: ReturnType<typeof createDynamoDBServiceV2>,
  account: Account
): Promise<number> {
  const accountId = account.accountId;

  // Load products, rules, and sales data
  console.log(`[${accountId}] Loading data...`);
  const [products, rules] = await Promise.all([
    db.getAllProducts(accountId),
    db.getAllRules(accountId),
  ]);

  console.log(`[${accountId}] Found ${products.length} products, ${rules.length} rules`);

  if (products.length === 0) {
    console.log(`[${accountId}] No products to process`);
    return 0;
  }

  // Get sales data for last 7 days
  const salesMap = await db.getSalesBySku(accountId, 7);

  // Create batch ID for this run
  const batchId = `calc-${new Date().toISOString().substring(0, 10)}-${uuid().substring(0, 8)}`;

  // Generate proposals
  const proposals: PriceProposal[] = [];

  for (const product of products) {
    // Skip products without cost price
    if (!product.costPrice || product.costPrice <= 0) {
      continue;
    }

    // Find matching rule
    const matchingRule = findMatchingRule(product, rules);

    // Calculate proposed price
    const result = calculatePrice(product, matchingRule, account, salesMap);

    if (result.shouldCreateProposal) {
      const priceChange = result.proposedPrice - product.currentPrice;
      const priceChangePercent = product.currentPrice > 0
        ? ((result.proposedPrice - product.currentPrice) / product.currentPrice) * 100
        : 0;

      // Calculate cost breakdown for proposed price
      const costBreakdown = calculateCostBreakdown(
        result.proposedPrice,
        product.costPrice,
        product.deliveryCost || 0,
        0.20, // Commission percent (unused - using flat 20% clawback)
        0,    // Fixed fee
        0,    // Payment processing
        0,    // Advertising
        20,   // VAT percent
        true  // Prices include VAT
      );

      // Calculate current cost breakdown for margin comparison
      const currentCostBreakdown = calculateCostBreakdown(
        product.currentPrice,
        product.costPrice,
        product.deliveryCost || 0,
        0.20, 0, 0, 0, 20, true
      );

      const avgDailySales = salesMap.get(product.sku)?.quantity
        ? salesMap.get(product.sku)!.quantity / 7
        : 0;

      proposals.push({
        proposalId: uuid(),
        sku: product.sku,
        productTitle: product.title,
        brand: product.brand,
        category: product.category,
        currentPrice: product.currentPrice,
        proposedPrice: result.proposedPrice,
        priceChange,
        priceChangePercent,
        currentMargin: currentCostBreakdown.marginPercent,
        proposedMargin: costBreakdown.marginPercent,
        marginChange: costBreakdown.marginPercent - currentCostBreakdown.marginPercent,
        costBreakdown,
        status: 'pending',
        appliedRuleId: matchingRule?.ruleId,
        appliedRuleName: matchingRule?.name,
        reason: matchingRule ? `Applied rule: ${matchingRule.name}` : 'Default margin target',
        warnings: result.warnings,
        batchId,
        stockLevel: product.stockLevel,
        salesLast7Days: product.salesLast7Days || 0,
        salesLast30Days: product.salesLast30Days || 0,
        avgDailySales,
        estimatedDailyProfitChange: (costBreakdown.netProfit - currentCostBreakdown.netProfit) * avgDailySales,
        estimatedWeeklyRevenueImpact: priceChange * avgDailySales * 7,
        estimatedWeeklyProfitImpact: result.weeklyProfitImpact,
        createdAt: new Date().toISOString(),
        ttl: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60, // 30 days
      });
    }
  }

  // Save proposals in batches
  if (proposals.length > 0) {
    console.log(`[${accountId}] Saving ${proposals.length} proposals...`);
    await db.batchPutProposals(accountId, proposals);
  }

  return proposals.length;
}

/**
 * Find the first matching rule for a product
 */
function findMatchingRule(
  product: Product,
  rules: PricingRule[]
): PricingRule | undefined {
  // Rules are sorted by priority
  for (const rule of rules) {
    if (!rule.isActive) continue;

    // Check if product matches rule conditions
    if (rule.conditions) {
      // Brand filter
      if (rule.conditions.brands && rule.conditions.brands.length > 0) {
        if (!rule.conditions.brands.includes(product.brand)) continue;
      }

      // Category filter
      if (rule.conditions.categories && rule.conditions.categories.length > 0) {
        const productCategory = product.category?.toLowerCase() || '';
        const matches = rule.conditions.categories.some((cat: string) =>
          productCategory.includes(cat.toLowerCase())
        );
        if (!matches) continue;
      }

      // Price range filter
      if (rule.conditions.priceBelow !== undefined && product.currentPrice >= rule.conditions.priceBelow)
        continue;
      if (rule.conditions.priceAbove !== undefined && product.currentPrice <= rule.conditions.priceAbove)
        continue;
    }

    return rule;
  }

  return undefined;
}

/**
 * Calculate the proposed price for a product
 */
function calculatePrice(
  product: Product,
  rule: PricingRule | undefined,
  account: Account,
  salesMap: Map<string, { quantity: number; revenue: number }>
): {
  proposedPrice: number;
  margin: number;
  marginPercent: number;
  shouldCreateProposal: boolean;
  warnings: string[];
  weeklyProfitImpact: number;
} {
  const warnings: string[] = [];

  // Get target margin from rule action or account default
  // Rule action type 'set_margin' uses action.value as the target margin percentage
  const targetMarginPercent = rule?.action?.type === 'set_margin'
    ? rule.action.value
    : (account.settings.defaultMargin * 100);
  const targetMargin = targetMarginPercent / 100;

  // Calculate total cost
  const totalCost = product.costPrice + (product.deliveryCost || 0);

  // Calculate proposed price based on target margin
  // margin = (price - cost) / price
  // price = cost / (1 - margin)
  let proposedPrice = totalCost / (1 - targetMargin);

  // Apply rounding strategy from rule action
  const roundingRule = rule?.action?.roundingRule;
  proposedPrice = applyRounding(proposedPrice, roundingRule);

  // Check against competitor floor price
  if (product.competitorFloorPrice && proposedPrice < product.competitorFloorPrice) {
    warnings.push(
      `Price ${proposedPrice.toFixed(2)} is below competitor floor ${product.competitorFloorPrice.toFixed(2)}`
    );
  }

  // Calculate actual margin at proposed price
  const margin = proposedPrice - totalCost;
  const marginPercent = proposedPrice > 0 ? (margin / proposedPrice) * 100 : 0;

  // Calculate weekly profit impact
  const sales = salesMap.get(product.sku);
  const avgDailySales = sales ? sales.quantity / 7 : 0;
  const currentProfit = (product.currentPrice - totalCost) * avgDailySales * 7;
  const proposedProfit = margin * avgDailySales * 7;
  const weeklyProfitImpact = proposedProfit - currentProfit;

  // Determine if we should create a proposal
  const priceChange = Math.abs(proposedPrice - product.currentPrice);
  const priceChangePercent =
    product.currentPrice > 0 ? (priceChange / product.currentPrice) * 100 : 100;

  // Only create proposal if price change is significant (>1%)
  const shouldCreateProposal = priceChangePercent >= 1;

  return {
    proposedPrice,
    margin,
    marginPercent,
    shouldCreateProposal,
    warnings,
    weeklyProfitImpact,
  };
}

/**
 * Apply rounding strategy to price
 */
function applyRounding(
  price: number,
  strategy?: RoundingRule
): number {
  switch (strategy) {
    case 'nearest_pound':
      return Math.round(price);
    case 'nearest_99p':
      return Math.floor(price) + 0.99;
    case 'nearest_95p':
      return Math.floor(price) + 0.95;
    case 'round_down':
      return Math.floor(price * 100) / 100;
    case 'round_up':
      return Math.ceil(price * 100) / 100;
    case 'none':
    default:
      return Math.round(price * 100) / 100; // Round to 2 decimal places
  }
}
