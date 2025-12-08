// Product types
export interface Product {
  sku: string;
  balterleySku?: string;
  title: string;
  brand: string;
  category?: string;
  familyVariants?: string;
  imageUrl?: string;
  mrp: number;
  currentPrice: number;
  channelPrices?: {
    amazon?: number;
    ebay?: number;
    onbuy?: number;
    debenhams?: number;
    bandq?: number;
    manomano?: number;
    shopify?: number;
  };
  discountPrice?: number;
  discountStartDate?: string;
  discountEndDate?: string;
  costPrice: number;
  deliveryCost: number;
  stockLevel: number;
  salesLast7Days: number;
  salesLast30Days: number;
  calculatedMargin?: number;
  lastUpdated: string;
}

// Channel types
export type ChannelId = 'amazon' | 'ebay' | 'bandq' | 'manomano' | 'shopify';

export interface Channel {
  channelId: ChannelId;
  name: string;
  isActive: boolean;
  commissionPercent: number;
  fixedFee?: number;
  paymentProcessingPercent?: number;
  defaultAcosPercent?: number;
  includeAdvertisingInMargin: boolean;
  vatPercent: number;
  pricesIncludeVat: boolean;
  lastUpdated: string;
}

// Pricing rule types
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
}

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
  dailySalesBelow?: number;
  dailySalesAbove?: number;
  daysOfStockBelow?: number;
  daysOfStockAbove?: number;
  priceBelow?: number;
  priceAbove?: number;
  dailyRevenueBelow?: number;
  dailyRevenueAbove?: number;
}

export interface PricingRuleAction {
  type: 'set_margin' | 'set_markup' | 'adjust_percent' | 'adjust_fixed' | 'set_price' | 'match_mrp' | 'discount_from_mrp';
  value: number;
}

// Proposal types
export type ProposalStatus = 'pending' | 'approved' | 'rejected' | 'modified' | 'pushed';

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

export interface PriceProposal {
  proposalId: string;
  sku: string;
  productTitle: string;
  brand: string;
  category?: string;
  currentPrice: number;
  proposedPrice: number;
  priceChange: number;
  priceChangePercent: number;
  currentMargin: number;
  proposedMargin: number;
  marginChange: number;
  costBreakdown: CostBreakdown;
  stockLevel: number;
  salesLast7Days: number;
  salesLast30Days: number;
  // Impact forecasting
  avgDailySales: number;
  estimatedDailyProfitChange: number;
  estimatedWeeklyRevenueImpact: number;
  estimatedWeeklyProfitImpact: number;
  // Rule info
  appliedRuleId?: string;
  appliedRuleName?: string;
  reason: string;
  warnings: string[];
  status: ProposalStatus;
  approvedPrice?: number;
  createdAt: string;
  reviewedAt?: string;
  reviewedBy?: string;
  reviewNotes?: string;
  batchId: string;
}

// API response types
export interface PaginatedResponse<T> {
  items: T[];
  totalCount: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface DashboardSummary {
  totalProducts: number;
  productsWithCosts: number;
  productsWithoutCosts: number;
  outOfStock: number;
  lowStock: number;
  pendingProposals: number;
  avgMargin: number;
}
