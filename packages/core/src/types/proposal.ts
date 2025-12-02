import { CostBreakdown } from './pricing';

/**
 * Price change proposal - awaiting human approval
 */
export interface PriceProposal {
  proposalId: string;
  sku: string;

  // Product info (denormalized for UI)
  productTitle: string;
  brand: string;
  category?: string;

  // Price change
  currentPrice: number;
  proposedPrice: number;
  priceChange: number;
  priceChangePercent: number;

  // Margin analysis
  currentMargin: number;
  proposedMargin: number;
  marginChange: number;

  // Cost breakdown
  costBreakdown: CostBreakdown;

  // Context
  stockLevel: number;
  salesLast7Days: number;
  salesLast30Days: number;

  // Rule that triggered this
  appliedRuleId?: string;
  appliedRuleName?: string;
  reason: string;

  // Warnings
  warnings: string[];

  // Status
  status: ProposalStatus;

  // If modified, the final approved price
  approvedPrice?: number;
  approvedMargin?: number;

  // Audit trail
  createdAt: string;
  reviewedAt?: string;
  reviewedBy?: string;
  reviewNotes?: string;

  // For batch tracking
  batchId: string; // Groups proposals from same calculation run

  // TTL for auto-cleanup (epoch seconds)
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

  // Summary stats
  averagePriceChange: number;
  averageMarginChange: number;
  totalEstimatedImpact: number; // Estimated profit change based on recent sales
}

/**
 * Request to approve/reject a proposal
 */
export interface ProposalUpdateRequest {
  proposalId: string;
  action: 'approve' | 'reject' | 'modify';
  modifiedPrice?: number; // Required if action is 'modify'
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
  proposalIds?: string[]; // If not provided, push all approved
  dryRun?: boolean; // If true, validate but don't push
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
  searchTerm?: string; // Search SKU or title
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
