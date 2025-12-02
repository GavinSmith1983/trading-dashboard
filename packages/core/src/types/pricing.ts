import { ChannelId } from './channel';

/**
 * Pricing rule - defines how prices should be calculated/adjusted
 */
export interface PricingRule {
  ruleId: string;
  name: string;
  description?: string;
  priority: number; // Lower number = higher priority (applied first)
  isActive: boolean;

  // Conditions - when should this rule apply?
  conditions: PricingRuleConditions;

  // Action - what should happen when conditions match?
  action: PricingRuleAction;

  // Metadata
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
}

/**
 * Conditions that determine when a pricing rule applies
 */
export interface PricingRuleConditions {
  // Product filters
  brands?: string[]; // Apply to specific brands
  categories?: string[]; // Apply to specific categories
  skus?: string[]; // Apply to specific SKUs
  skuPatterns?: string[]; // Regex patterns for SKUs

  // Margin conditions
  marginBelow?: number; // Apply if margin is below this %
  marginAbove?: number; // Apply if margin is above this %

  // Stock conditions
  stockBelow?: number; // Apply if stock is below this level
  stockAbove?: number; // Apply if stock is above this level

  // Sales velocity conditions
  salesVelocityBelow?: number; // Apply if 7-day sales below this
  salesVelocityAbove?: number; // Apply if 7-day sales above this

  // Price conditions
  priceBelow?: number; // Apply if current price below this
  priceAbove?: number; // Apply if current price above this
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
export type PricingRuleActionType =
  | 'set_margin' // Set price to achieve target margin %
  | 'set_markup' // Set price as cost × markup multiplier
  | 'adjust_percent' // Adjust current price by +/- %
  | 'adjust_fixed' // Adjust current price by +/- fixed amount
  | 'set_price' // Set to specific price
  | 'match_mrp' // Set to MRP
  | 'discount_from_mrp'; // Set to MRP minus % discount

/**
 * Rounding rules for final prices
 */
export type RoundingRule =
  | 'none' // No rounding
  | 'nearest_99p' // Round to £X.99
  | 'nearest_95p' // Round to £X.95
  | 'nearest_pound' // Round to nearest £
  | 'round_down' // Always round down
  | 'round_up'; // Always round up

/**
 * Global pricing configuration
 */
export interface PricingConfig {
  // Minimum margin threshold - never price below this
  minimumMarginPercent: number;

  // Maximum discount from MRP
  maximumDiscountPercent: number;

  // Default rounding rule
  defaultRoundingRule: RoundingRule;

  // Whether to include VAT in calculations
  calculateWithVat: boolean;

  // Whether to include advertising in margin calculations
  includeAdvertisingInMargin: boolean;
}

/**
 * Default pricing configuration
 */
export const DEFAULT_PRICING_CONFIG: PricingConfig = {
  minimumMarginPercent: 15,
  maximumDiscountPercent: 50,
  defaultRoundingRule: 'nearest_99p',
  calculateWithVat: true,
  includeAdvertisingInMargin: true,
};

/**
 * Result of price calculation for a single product
 */
export interface PriceCalculationResult {
  sku: string;
  currentPrice: number;
  proposedPrice: number;
  priceChange: number;
  priceChangePercent: number;

  // Margin analysis
  currentMargin: number;
  proposedMargin: number;
  marginChange: number;

  // Profit analysis (per unit)
  currentProfit: number;
  proposedProfit: number;

  // Cost breakdown
  costBreakdown: CostBreakdown;

  // Which rule triggered this change
  appliedRule?: string;
  reason: string;

  // Warnings/flags
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
export function calculateCostBreakdown(
  sellingPrice: number,
  costPrice: number,
  deliveryCost: number,
  commissionPercent: number,
  fixedFee: number,
  paymentProcessingPercent: number,
  advertisingPercent: number,
  vatPercent: number,
  pricesIncludeVat: boolean
): CostBreakdown {
  // Calculate VAT
  const vatMultiplier = 1 + vatPercent / 100;
  const priceExVat = pricesIncludeVat ? sellingPrice / vatMultiplier : sellingPrice;
  const vatAmount = pricesIncludeVat ? sellingPrice - priceExVat : 0;

  // Calculate fees (based on selling price inc VAT)
  const channelCommission = sellingPrice * (commissionPercent / 100);
  const paymentProcessing = sellingPrice * (paymentProcessingPercent / 100);
  const advertisingCost = sellingPrice * (advertisingPercent / 100);

  // Total costs
  const totalCosts =
    costPrice + deliveryCost + channelCommission + fixedFee + paymentProcessing + advertisingCost;

  // Net profit
  const netProfit = priceExVat - totalCosts + vatAmount; // VAT is pass-through

  // Actually, let's recalculate - profit is revenue minus all costs
  // Revenue = selling price (we receive this)
  // Costs = COGS + delivery + commission + fees + ads
  // VAT is collected and remitted, so neutral for profit calc
  const actualProfit = sellingPrice - totalCosts;

  // Margin as percentage of selling price
  const marginPercent = (actualProfit / sellingPrice) * 100;

  return {
    sellingPrice,
    vatAmount,
    priceExVat,
    costPrice,
    deliveryCost,
    channelCommission,
    channelFixedFee: fixedFee,
    paymentProcessing,
    advertisingCost,
    totalCosts,
    netProfit: actualProfit,
    marginPercent,
  };
}
