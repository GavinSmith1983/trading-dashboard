import { Product, Channel, PricingRule, PricingConfig, PriceCalculationResult, PriceProposal } from '../types';
/**
 * Pricing engine - applies rules to calculate optimal prices
 */
export declare class PricingEngine {
    private config;
    private rules;
    private channels;
    constructor(config?: PricingConfig, rules?: PricingRule[], channels?: Channel[]);
    /**
     * Calculate proposed price for a product
     */
    calculatePrice(product: Product, channelId?: string): PriceCalculationResult;
    /**
     * Calculate cost breakdown for a price
     */
    private calculateCostBreakdown;
    /**
     * Find the first rule that applies to this product
     */
    private findApplicableRule;
    /**
     * Check if a rule's conditions match the product
     */
    private ruleMatches;
    /**
     * Apply a rule's action to calculate new price
     */
    private applyRule;
    /**
     * Calculate floor price (minimum to achieve minimum margin)
     */
    private calculateFloorPrice;
    /**
     * Apply rounding rule to price
     */
    private applyRounding;
    /**
     * Generate proposals for all products
     */
    generateProposals(products: Product[], batchId: string): PriceProposal[];
}
//# sourceMappingURL=pricing-engine.d.ts.map