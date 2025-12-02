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

    // Enforce ceiling price (MRP or max discount)
    const ceilingPrice = product.mrp;
    let atCeilingPrice = false;
    if (proposedPrice > ceilingPrice) {
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

    return {
      sku: product.sku,
      currentPrice: product.currentPrice,
      proposedPrice,
      priceChange: proposedPrice - product.currentPrice,
      priceChangePercent:
        product.currentPrice > 0
          ? ((proposedPrice - product.currentPrice) / product.currentPrice) * 100
          : 0,
      currentMargin: currentBreakdown.marginPercent,
      proposedMargin: proposedBreakdown.marginPercent,
      marginChange: proposedBreakdown.marginPercent - currentBreakdown.marginPercent,
      currentProfit: currentBreakdown.netProfit,
      proposedProfit: proposedBreakdown.netProfit,
      costBreakdown: proposedBreakdown,
      appliedRule: applicableRule?.name,
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

    // Sales velocity conditions
    if (conditions.salesVelocityBelow !== undefined) {
      if (product.salesLast7Days >= conditions.salesVelocityBelow) return false;
    }
    if (conditions.salesVelocityAbove !== undefined) {
      if (product.salesLast7Days <= conditions.salesVelocityAbove) return false;
    }

    // Price conditions
    if (conditions.priceBelow !== undefined) {
      if (product.currentPrice >= conditions.priceBelow) return false;
    }
    if (conditions.priceAbove !== undefined) {
      if (product.currentPrice <= conditions.priceAbove) return false;
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
        // Calculate price to achieve target margin
        const targetMargin = action.value / 100;
        const totalCostRate =
          (channel.commissionPercent +
            (channel.paymentProcessingPercent || 0) +
            (channel.defaultAcosPercent || 0)) /
          100;
        const fixedCosts = (product.costPrice || 0) + (product.deliveryCost || 0) + (channel.fixedFee || 0);

        // Price = FixedCosts / (1 - totalCostRate - targetMargin)
        const divisor = 1 - totalCostRate - targetMargin;
        if (divisor <= 0) {
          return {
            price: product.currentPrice,
            reason: `Cannot achieve ${action.value}% margin - costs too high`,
          };
        }
        const price = fixedCosts / divisor;
        return {
          price,
          reason: `Set to achieve ${action.value}% margin (rule: ${rule.name})`,
        };
      }

      case 'set_markup': {
        // Price = Cost × Markup multiplier
        const price = (product.costPrice || 0) * action.value;
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
   */
  private calculateFloorPrice(product: Product, channel: Channel): number {
    const targetMargin = this.config.minimumMarginPercent / 100;
    const totalCostRate =
      (channel.commissionPercent +
        (channel.paymentProcessingPercent || 0) +
        (channel.defaultAcosPercent || 0)) /
      100;
    const fixedCosts = (product.costPrice || 0) + (product.deliveryCost || 0) + (channel.fixedFee || 0);

    const divisor = 1 - totalCostRate - targetMargin;
    if (divisor <= 0) return product.currentPrice;

    return fixedCosts / divisor;
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

    for (const product of products) {
      const result = this.calculatePrice(product);

      // Only create proposal if price changed
      if (Math.abs(result.priceChange) < 0.01) continue;

      const proposal: PriceProposal = {
        proposalId: uuid(),
        sku: product.sku,
        productTitle: product.title,
        brand: product.brand,
        category: product.category,
        currentPrice: result.currentPrice,
        proposedPrice: result.proposedPrice,
        priceChange: result.priceChange,
        priceChangePercent: result.priceChangePercent,
        currentMargin: result.currentMargin,
        proposedMargin: result.proposedMargin,
        marginChange: result.marginChange,
        costBreakdown: result.costBreakdown,
        stockLevel: product.stockLevel,
        salesLast7Days: product.salesLast7Days,
        salesLast30Days: product.salesLast30Days,
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
