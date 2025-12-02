import { CostBreakdown } from './pricing';
/**
 * Price change proposal - awaiting human approval
 */
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
    appliedRuleId?: string;
    appliedRuleName?: string;
    reason: string;
    warnings: string[];
    status: ProposalStatus;
    approvedPrice?: number;
    approvedMargin?: number;
    createdAt: string;
    reviewedAt?: string;
    reviewedBy?: string;
    reviewNotes?: string;
    batchId: string;
    ttl?: number;
}
/**
 * Proposal status
 */
export type ProposalStatus = 'pending' | 'approved' | 'rejected' | 'modified' | 'pushed';
/**
 * Batch of proposals from a single calculation run
 */
export interface ProposalBatch {
    batchId: string;
    createdAt: string;
    totalProposals: number;
    pendingCount: number;
    approvedCount: number;
    rejectedCount: number;
    modifiedCount: number;
    pushedCount: number;
    averagePriceChange: number;
    averageMarginChange: number;
    totalEstimatedImpact: number;
}
/**
 * Request to approve/reject a proposal
 */
export interface ProposalUpdateRequest {
    proposalId: string;
    action: 'approve' | 'reject' | 'modify';
    modifiedPrice?: number;
    notes?: string;
    reviewedBy: string;
}
/**
 * Bulk approval request
 */
export interface BulkApprovalRequest {
    proposalIds: string[];
    action: 'approve' | 'reject';
    notes?: string;
    reviewedBy: string;
}
/**
 * Request to push approved prices to ChannelEngine
 */
export interface PushPricesRequest {
    proposalIds?: string[];
    dryRun?: boolean;
}
/**
 * Result of pushing prices
 */
export interface PushPricesResult {
    success: boolean;
    totalPushed: number;
    totalFailed: number;
    results: PushResult[];
    errors: string[];
}
export interface PushResult {
    proposalId: string;
    sku: string;
    success: boolean;
    error?: string;
    channelEngineResponse?: unknown;
}
/**
 * Filters for querying proposals
 */
export interface ProposalFilters {
    status?: ProposalStatus | ProposalStatus[];
    batchId?: string;
    brand?: string;
    category?: string;
    minPriceChange?: number;
    maxPriceChange?: number;
    minMarginChange?: number;
    maxMarginChange?: number;
    hasWarnings?: boolean;
    searchTerm?: string;
}
/**
 * Paginated response for proposals
 */
export interface PaginatedProposals {
    items: PriceProposal[];
    totalCount: number;
    page: number;
    pageSize: number;
    hasMore: boolean;
}
//# sourceMappingURL=proposal.d.ts.map