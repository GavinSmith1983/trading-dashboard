/**
 * Pricing rule - defines how prices should be calculated/adjusted
 */
export interface PricingRule {
    ruleId: string;
    name: string;
    description?: string;
    priority: number;
    isActive: boolean;
    conditions: PricingRuleConditions;
    action: PricingRuleAction;
    createdAt: string;
    updatedAt: string;
    createdBy?: string;
}
/**
 * Conditions that determine when a pricing rule applies
 */
export interface PricingRuleConditions {
    brands?: string[];
    categories?: string[];
    skus?: string[];
    skuPatterns?: string[];
    marginBelow?: number;
    marginAbove?: number;
    stockBelow?: number;
    stockAbove?: number;
    salesVelocityBelow?: number;
    salesVelocityAbove?: number;
    priceBelow?: number;
    priceAbove?: number;
}
/**
 * Action to take when rule conditions match
 */
export interface PricingRuleAction {
    type: PricingRuleActionType;
    value: number;
    roundingRule?: RoundingRule;
}
/**
 * Types of pricing actions
 */
export type PricingRuleActionType = 'set_margin' | 'set_markup' | 'adjust_percent' | 'adjust_fixed' | 'set_price' | 'match_mrp' | 'discount_from_mrp';
/**
 * Rounding rules for final prices
 */
export type RoundingRule = 'none' | 'nearest_99p' | 'nearest_95p' | 'nearest_pound' | 'round_down' | 'round_up';
/**
 * Global pricing configuration
 */
export interface PricingConfig {
    minimumMarginPercent: number;
    maximumDiscountPercent: number;
    defaultRoundingRule: RoundingRule;
    calculateWithVat: boolean;
    includeAdvertisingInMargin: boolean;
}
/**
 * Default pricing configuration
 */
export declare const DEFAULT_PRICING_CONFIG: PricingConfig;
/**
 * Result of price calculation for a single product
 */
export interface PriceCalculationResult {
    sku: string;
    currentPrice: number;
    proposedPrice: number;
    priceChange: number;
    priceChangePercent: number;
    currentMargin: number;
    proposedMargin: number;
    marginChange: number;
    currentProfit: number;
    proposedProfit: number;
    costBreakdown: CostBreakdown;
    appliedRule?: string;
    reason: string;
    warnings: string[];
    belowMinimumMargin: boolean;
    atFloorPrice: boolean;
    atCeilingPrice: boolean;
}
/**
 * Detailed cost breakdown for a product
 */
export interface CostBreakdown {
    sellingPrice: number;
    vatAmount: number;
    priceExVat: number;
    costPrice: number;
    deliveryCost: number;
    channelCommission: number;
    channelFixedFee: number;
    paymentProcessing: number;
    advertisingCost: number;
    totalCosts: number;
    netProfit: number;
    marginPercent: number;
}
/**
 * Calculate costs and margin for a given price
 */
export declare function calculateCostBreakdown(sellingPrice: number, costPrice: number, deliveryCost: number, commissionPercent: number, fixedFee: number, paymentProcessingPercent: number, advertisingPercent: number, vatPercent: number, pricesIncludeVat: boolean): CostBreakdown;
//# sourceMappingURL=pricing.d.ts.map