import {
  Product,
  Channel,
  PricingRule,
  PricingConfig,
  PriceCalculationResult,
  CostBreakdown,
  calculateCostBreakdown,
  DEFAULT_PRICING_CONFIG,
  RoundingRule,
  PriceProposal,
} from '../types';
import { v4 as uuid } from 'uuid';

/**
 * Pricing engine - applies rules to calculate optimal prices
 */
export class PricingEngine {
  private config: PricingConfig;
  private rules: PricingRule[];
  private channels: Map<string, Channel>;

  constructor(
    config: PricingConfig = DEFAULT_PRICING_CONFIG,
    rules: PricingRule[] = [],
    channels: Channel[] = []
  ) {
    this.config = config;
    this.rules = rules.sort((a, b) => a.priority - b.priority);
    this.channels = new Map(channels.map((c) => [c.channelId, c]));
  }

  /**
   * Calculate proposed price for a product
   */
  calculatePrice(product: Product, channelId: string = 'amazon'): PriceCalculationResult {
    const channel = this.channels.get(channelId);
    if (!channel) {
      throw new Error(`Channel ${channelId} not configured`);
    }

    const warnings: string[] = [];

    // Check if product has required cost data
    if (!product.costPrice || product.costPrice <= 0) {
      warnings.push('Missing cost price - cannot calculate accurate margin');
    }

    // Calculate current margin
    const currentBreakdown = this.calculateCostBreakdown(product, product.currentPrice, channel);

    // Find applicable rule
    const applicableRule = this.findApplicableRule(product, currentBreakdown);

    // Calculate proposed price
    let proposedPrice = product.currentPrice;
    let reason = 'No rule applied - price unchanged';

    if (applicableRule) {
      const result = this.applyRule(applicableRule, product, channel);
      proposedPrice = result.price;
      reason = result.reason;
    }

    // Apply rounding
    proposedPrice = this.applyRounding(proposedPrice, this.config.defaultRoundingRule);

    // Enforce floor price (minimum margin)
    const floorPrice = this.calculateFloorPrice(product, channel);
    let atFloorPrice = false;
    if (proposedPrice < floorPrice) {
      proposedPrice = this.applyRounding(floorPrice, this.config.defaultRoundingRule);
      warnings.push(`Price raised to floor (${this.config.minimumMarginPercent}% minimum margin)`);
      atFloorPrice = true;
    }

    // Enforce ceiling price (MRP or max discount) - only if MRP is set
    const ceilingPrice = product.mrp;
    let atCeilingPrice = false;
    if (ceilingPrice > 0 && proposedPrice > ceilingPrice) {
      proposedPrice = ceilingPrice;
      warnings.push('Price capped at MRP');
      atCeilingPrice = true;
    }

    // Calculate final breakdown
    const proposedBreakdown = this.calculateCostBreakdown(product, proposedPrice, channel);

    // Check if below minimum margin
    const belowMinimumMargin = proposedBreakdown.marginPercent < this.config.minimumMarginPercent;
    if (belowMinimumMargin && !atFloorPrice) {
      warnings.push(
        `Margin (${proposedBreakdown.marginPercent.toFixed(1)}%) below minimum (${this.config.minimumMarginPercent}%)`
      );
    }

    // Calculate impact forecasting based on sales velocity
    const salesVelocity = (product.salesLast7Days || 0) / 7; // Average daily sales
    const profitPerUnitChange = proposedBreakdown.netProfit - currentBreakdown.netProfit;
    const revenuePerUnitChange = proposedPrice - product.currentPrice;

    // Estimated daily impact (assuming sales velocity remains constant)
    // Use 0 for products with no sales history
    const estimatedDailyProfitChange = Number.isFinite(profitPerUnitChange * salesVelocity)
      ? profitPerUnitChange * salesVelocity
      : 0;
    const estimatedWeeklyRevenueImpact = Number.isFinite(revenuePerUnitChange * salesVelocity * 7)
      ? revenuePerUnitChange * salesVelocity * 7
      : 0;
    const estimatedWeeklyProfitImpact = Number.isFinite(profitPerUnitChange * salesVelocity * 7)
      ? profitPerUnitChange * salesVelocity * 7
      : 0;

    // Helper to sanitize numeric values for DynamoDB
    const sanitize = (val: number): number => {
      if (!Number.isFinite(val)) return 0;
      return val;
    };

    return {
      sku: product.sku,
      currentPrice: sanitize(product.currentPrice),
      proposedPrice: sanitize(proposedPrice),
      priceChange: sanitize(proposedPrice - product.currentPrice),
      priceChangePercent: sanitize(
        product.currentPrice > 0
          ? ((proposedPrice - product.currentPrice) / product.currentPrice) * 100
          : 0
      ),
      currentMargin: sanitize(currentBreakdown.marginPercent),
      proposedMargin: sanitize(proposedBreakdown.marginPercent),
      marginChange: sanitize(proposedBreakdown.marginPercent - currentBreakdown.marginPercent),
      currentProfit: sanitize(currentBreakdown.netProfit),
      proposedProfit: sanitize(proposedBreakdown.netProfit),
      estimatedDailyProfitChange: sanitize(estimatedDailyProfitChange),
      estimatedWeeklyRevenueImpact: sanitize(estimatedWeeklyRevenueImpact),
      estimatedWeeklyProfitImpact: sanitize(estimatedWeeklyProfitImpact),
      salesVelocity: sanitize(salesVelocity),
      costBreakdown: proposedBreakdown,
      appliedRule: applicableRule?.name,
      appliedRuleId: applicableRule?.ruleId,
      reason,
      warnings,
      belowMinimumMargin,
      atFloorPrice,
      atCeilingPrice,
    };
  }

  /**
   * Calculate cost breakdown for a price
   */
  private calculateCostBreakdown(
    product: Product,
    price: number,
    channel: Channel
  ): CostBreakdown {
    const advertisingPercent = channel.includeAdvertisingInMargin
      ? channel.defaultAcosPercent || 0
      : 0;

    return calculateCostBreakdown(
      price,
      product.costPrice || 0,
      product.deliveryCost || 0,
      channel.commissionPercent,
      channel.fixedFee || 0,
      channel.paymentProcessingPercent || 0,
      advertisingPercent,
      channel.vatPercent,
      channel.pricesIncludeVat
    );
  }

  /**
   * Find the first rule that applies to this product
   */
  private findApplicableRule(
    product: Product,
    currentBreakdown: CostBreakdown
  ): PricingRule | undefined {
    for (const rule of this.rules) {
      if (!rule.isActive) continue;
      if (this.ruleMatches(rule, product, currentBreakdown)) {
        return rule;
      }
    }
    return undefined;
  }

  /**
   * Check if a rule's conditions match the product
   */
  private ruleMatches(
    rule: PricingRule,
    product: Product,
    breakdown: CostBreakdown
  ): boolean {
    const conditions = rule.conditions;

    // Brand filter
    if (conditions.brands && conditions.brands.length > 0) {
      if (!conditions.brands.includes(product.brand)) return false;
    }

    // Category filter
    if (conditions.categories && conditions.categories.length > 0) {
      if (!product.category || !conditions.categories.includes(product.category)) return false;
    }

    // SKU filter
    if (conditions.skus && conditions.skus.length > 0) {
      if (!conditions.skus.includes(product.sku)) return false;
    }

    // SKU pattern filter
    if (conditions.skuPatterns && conditions.skuPatterns.length > 0) {
      const matches = conditions.skuPatterns.some((pattern) =>
        new RegExp(pattern).test(product.sku)
      );
      if (!matches) return false;
    }

    // Margin conditions
    if (conditions.marginBelow !== undefined) {
      if (breakdown.marginPercent >= conditions.marginBelow) return false;
    }
    if (conditions.marginAbove !== undefined) {
      if (breakdown.marginPercent <= conditions.marginAbove) return false;
    }

    // Stock conditions
    if (conditions.stockBelow !== undefined) {
      if (product.stockLevel >= conditions.stockBelow) return false;
    }
    if (conditions.stockAbove !== undefined) {
      if (product.stockLevel <= conditions.stockAbove) return false;
    }

    // Sales velocity conditions (7-day totals)
    if (conditions.salesVelocityBelow !== undefined) {
      if (product.salesLast7Days >= conditions.salesVelocityBelow) return false;
    }
    if (conditions.salesVelocityAbove !== undefined) {
      if (product.salesLast7Days <= conditions.salesVelocityAbove) return false;
    }

    // Daily sales velocity conditions (avg per day)
    const dailySales = product.salesLast7Days / 7;
    if (conditions.dailySalesBelow !== undefined) {
      if (dailySales >= conditions.dailySalesBelow) return false;
    }
    if (conditions.dailySalesAbove !== undefined) {
      if (dailySales <= conditions.dailySalesAbove) return false;
    }

    // Days of stock conditions (stock / daily sales)
    const daysOfStock = dailySales > 0 ? product.stockLevel / dailySales : Infinity;
    if (conditions.daysOfStockBelow !== undefined) {
      if (daysOfStock >= conditions.daysOfStockBelow) return false;
    }
    if (conditions.daysOfStockAbove !== undefined) {
      if (daysOfStock <= conditions.daysOfStockAbove) return false;
    }

    // Price conditions
    if (conditions.priceBelow !== undefined) {
      if (product.currentPrice >= conditions.priceBelow) return false;
    }
    if (conditions.priceAbove !== undefined) {
      if (product.currentPrice <= conditions.priceAbove) return false;
    }

    // Daily revenue conditions
    const dailyRevenue = dailySales * product.currentPrice;
    if (conditions.dailyRevenueBelow !== undefined) {
      if (dailyRevenue >= conditions.dailyRevenueBelow) return false;
    }
    if (conditions.dailyRevenueAbove !== undefined) {
      if (dailyRevenue <= conditions.dailyRevenueAbove) return false;
    }

    return true;
  }

  /**
   * Apply a rule's action to calculate new price
   */
  private applyRule(
    rule: PricingRule,
    product: Product,
    channel: Channel
  ): { price: number; reason: string } {
    const action = rule.action;

    switch (action.type) {
      case 'set_margin': {
        // Calculate price to achieve target margin using simple formula:
        // Margin = PPO / PriceExVat
        // PPO = PriceExVat × 0.80 - Delivery - Cost  (20% clawback)
        // Solving: PriceExVat = (Delivery + Cost) / (0.80 - Margin)
        // SellingPrice = PriceExVat × 1.2

        // Require cost price for margin calculation
        if (!product.costPrice || product.costPrice <= 0) {
          return {
            price: product.currentPrice,
            reason: `Cannot calculate margin - missing cost price`,
          };
        }

        const targetMargin = action.value / 100;
        const fixedCosts = (product.costPrice || 0) + (product.deliveryCost || 0);

        // Divisor = 0.80 - targetMargin (where 0.80 = 1 - 20% clawback)
        const divisor = 0.80 - targetMargin;
        if (divisor <= 0) {
          return {
            price: product.currentPrice,
            reason: `Cannot achieve ${action.value}% margin - target too high`,
          };
        }

        const priceExVat = fixedCosts / divisor;
        const sellingPrice = priceExVat * 1.2; // Add VAT

        // Don't allow price to go below a minimum threshold or to 0
        if (sellingPrice <= 0 || !Number.isFinite(sellingPrice)) {
          return {
            price: product.currentPrice,
            reason: `Cannot calculate valid price - calculation error`,
          };
        }

        return {
          price: sellingPrice,
          reason: `Set to achieve ${action.value}% margin (rule: ${rule.name})`,
        };
      }

      case 'set_markup': {
        // Price = Cost × Markup multiplier
        const price = (product.costPrice || 0) * action.value;
        if (price <= 0 || !Number.isFinite(price)) {
          return {
            price: product.currentPrice,
            reason: `Cannot calculate markup - missing cost data`,
          };
        }
        return {
          price,
          reason: `Applied ${action.value}x markup on cost (rule: ${rule.name})`,
        };
      }

      case 'adjust_percent': {
        // Adjust by percentage
        const price = product.currentPrice * (1 + action.value / 100);
        const direction = action.value >= 0 ? 'increase' : 'decrease';
        return {
          price,
          reason: `${Math.abs(action.value)}% ${direction} (rule: ${rule.name})`,
        };
      }

      case 'adjust_fixed': {
        // Adjust by fixed amount
        const price = product.currentPrice + action.value;
        const direction = action.value >= 0 ? 'increase' : 'decrease';
        return {
          price,
          reason: `£${Math.abs(action.value).toFixed(2)} ${direction} (rule: ${rule.name})`,
        };
      }

      case 'set_price': {
        return {
          price: action.value,
          reason: `Set to fixed price £${action.value.toFixed(2)} (rule: ${rule.name})`,
        };
      }

      case 'match_mrp': {
        return {
          price: product.mrp,
          reason: `Set to MRP (rule: ${rule.name})`,
        };
      }

      case 'discount_from_mrp': {
        const price = product.mrp * (1 - action.value / 100);
        return {
          price,
          reason: `${action.value}% discount from MRP (rule: ${rule.name})`,
        };
      }

      default:
        return {
          price: product.currentPrice,
          reason: 'Unknown action type',
        };
    }
  }

  /**
   * Calculate floor price (minimum to achieve minimum margin)
   * Uses same formula: PriceExVat = (Cost + Delivery) / (0.80 - Margin)
   */
  private calculateFloorPrice(product: Product, _channel: Channel): number {
    const targetMargin = this.config.minimumMarginPercent / 100;
    const fixedCosts = (product.costPrice || 0) + (product.deliveryCost || 0);

    const divisor = 0.80 - targetMargin;
    if (divisor <= 0) return product.currentPrice;

    const priceExVat = fixedCosts / divisor;
    return priceExVat * 1.2; // Add VAT
  }

  /**
   * Apply rounding rule to price
   */
  private applyRounding(price: number, rule: RoundingRule): number {
    switch (rule) {
      case 'nearest_99p':
        return Math.floor(price) + 0.99;
      case 'nearest_95p':
        return Math.floor(price) + 0.95;
      case 'nearest_pound':
        return Math.round(price);
      case 'round_down':
        return Math.floor(price * 100) / 100;
      case 'round_up':
        return Math.ceil(price * 100) / 100;
      case 'none':
      default:
        return Math.round(price * 100) / 100;
    }
  }

  /**
   * Generate proposals for all products
   */
  generateProposals(products: Product[], batchId: string): PriceProposal[] {
    const proposals: PriceProposal[] = [];

    // Helper to sanitize numeric values for DynamoDB (prevent Infinity/NaN)
    const sanitize = (val: number | undefined): number => {
      if (val === undefined || val === null || !Number.isFinite(val)) return 0;
      return val;
    };

    for (const product of products) {
      const result = this.calculatePrice(product);

      // Only create proposal if price changed and proposed price is valid
      if (Math.abs(result.priceChange) < 0.01) continue;
      if (result.proposedPrice <= 0 || !Number.isFinite(result.proposedPrice)) continue;

      const proposal: PriceProposal = {
        proposalId: uuid(),
        sku: product.sku,
        productTitle: product.title,
        brand: product.brand,
        category: product.category,
        currentPrice: sanitize(result.currentPrice),
        proposedPrice: sanitize(result.proposedPrice),
        priceChange: sanitize(result.priceChange),
        priceChangePercent: sanitize(result.priceChangePercent),
        currentMargin: sanitize(result.currentMargin),
        proposedMargin: sanitize(result.proposedMargin),
        marginChange: sanitize(result.marginChange),
        costBreakdown: result.costBreakdown,
        stockLevel: sanitize(product.stockLevel),
        salesLast7Days: sanitize(product.salesLast7Days),
        salesLast30Days: sanitize(product.salesLast30Days),
        avgDailySales: sanitize(result.salesVelocity),
        estimatedDailyProfitChange: sanitize(result.estimatedDailyProfitChange),
        estimatedWeeklyRevenueImpact: sanitize(result.estimatedWeeklyRevenueImpact),
        estimatedWeeklyProfitImpact: sanitize(result.estimatedWeeklyProfitImpact),
        appliedRuleId: result.appliedRuleId,
        appliedRuleName: result.appliedRule,
        reason: result.reason,
        warnings: result.warnings,
        status: 'pending',
        createdAt: new Date().toISOString(),
        batchId,
        ttl: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60, // 30 days
      };

      proposals.push(proposal);
    }

    return proposals;
  }
}
