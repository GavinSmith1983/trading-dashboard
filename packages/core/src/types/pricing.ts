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

  // Sales velocity conditions (7-day total)
  salesVelocityBelow?: number; // Apply if 7-day sales below this
  salesVelocityAbove?: number; // Apply if 7-day sales above this

  // Daily sales velocity conditions (avg per day)
  dailySalesBelow?: number; // Apply if avg daily sales below this
  dailySalesAbove?: number; // Apply if avg daily sales above this

  // Days of stock conditions (stock / daily sales)
  daysOfStockBelow?: number; // Apply if days of stock below this (danger stock)
  daysOfStockAbove?: number; // Apply if days of stock above this (overstock)

  // Price conditions
  priceBelow?: number; // Apply if current price below this
  priceAbove?: number; // Apply if current price above this

  // Revenue conditions (daily)
  dailyRevenueBelow?: number; // Apply if avg daily revenue below this
  dailyRevenueAbove?: number; // Apply if avg daily revenue above this
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

  // Impact forecasting (based on recent sales velocity)
  estimatedDailyProfitChange: number; // Change in daily profit
  estimatedWeeklyRevenueImpact: number; // Estimated weekly revenue change
  estimatedWeeklyProfitImpact: number; // Estimated weekly profit change
  salesVelocity: number; // Units per day (from 7-day avg)

  // Cost breakdown
  costBreakdown: CostBreakdown;

  // Which rule triggered this change
  appliedRule?: string;
  appliedRuleId?: string;
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
 *
 * Simple formula:
 * 1. Price Ex-VAT = Selling Price / 1.2
 * 2. Clawback = Price Ex-VAT × 20% (covers commission, fees, ads)
 * 3. PPO = Price Ex-VAT - Clawback - Delivery - Cost
 * 4. Margin = PPO / Price Ex-VAT × 100
 */
export function calculateCostBreakdown(
  sellingPrice: number,
  costPrice: number,
  deliveryCost: number,
  _commissionPercent: number, // Unused - using flat 20% clawback
  _fixedFee: number,          // Unused - using flat 20% clawback
  _paymentProcessingPercent: number, // Unused - using flat 20% clawback
  _advertisingPercent: number, // Unused - using flat 20% clawback
  _vatPercent: number,        // Always 20%
  _pricesIncludeVat: boolean  // Always true
): CostBreakdown {
  // Helper to sanitize numeric values (prevent Infinity/NaN going to DynamoDB)
  const sanitize = (val: number): number => {
    if (!Number.isFinite(val)) return 0;
    return val;
  };

  // Step 1: Remove VAT (always 20%)
  const priceExVat = sellingPrice / 1.2;
  const vatAmount = sellingPrice - priceExVat;

  // Step 2: Calculate 20% clawback (covers all channel fees, commission, ads)
  const clawback = priceExVat * 0.20;

  // Step 3: Calculate PPO (Profit Per Order)
  const ppo = priceExVat - clawback - deliveryCost - costPrice;

  // Step 4: Calculate margin as percentage of Ex-VAT price
  const marginPercent = priceExVat > 0 ? (ppo / priceExVat) * 100 : 0;

  return {
    sellingPrice: sanitize(sellingPrice),
    vatAmount: sanitize(vatAmount),
    priceExVat: sanitize(priceExVat),
    costPrice: sanitize(costPrice),
    deliveryCost: sanitize(deliveryCost),
    channelCommission: sanitize(clawback), // Clawback shown as commission
    channelFixedFee: 0,
    paymentProcessing: 0,
    advertisingCost: 0,
    totalCosts: sanitize(costPrice + deliveryCost + clawback),
    netProfit: sanitize(ppo),
    marginPercent: sanitize(marginPercent),
  };
}
