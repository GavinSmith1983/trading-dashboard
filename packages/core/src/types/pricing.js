"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_PRICING_CONFIG = void 0;
exports.calculateCostBreakdown = calculateCostBreakdown;
/**
 * Default pricing configuration
 */
exports.DEFAULT_PRICING_CONFIG = {
    minimumMarginPercent: 15,
    maximumDiscountPercent: 50,
    defaultRoundingRule: 'nearest_99p',
    calculateWithVat: true,
    includeAdvertisingInMargin: true,
};
/**
 * Calculate costs and margin for a given price
 */
function calculateCostBreakdown(sellingPrice, costPrice, deliveryCost, commissionPercent, fixedFee, paymentProcessingPercent, advertisingPercent, vatPercent, pricesIncludeVat) {
    // Calculate VAT
    const vatMultiplier = 1 + vatPercent / 100;
    const priceExVat = pricesIncludeVat ? sellingPrice / vatMultiplier : sellingPrice;
    const vatAmount = pricesIncludeVat ? sellingPrice - priceExVat : 0;
    // Calculate fees (based on selling price inc VAT)
    const channelCommission = sellingPrice * (commissionPercent / 100);
    const paymentProcessing = sellingPrice * (paymentProcessingPercent / 100);
    const advertisingCost = sellingPrice * (advertisingPercent / 100);
    // Total costs
    const totalCosts = costPrice + deliveryCost + channelCommission + fixedFee + paymentProcessing + advertisingCost;
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
//# sourceMappingURL=pricing.js.map