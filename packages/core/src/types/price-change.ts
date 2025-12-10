/**
 * Price Change Audit Record
 * Tracks all price changes with user attribution
 */
export type PriceChangeReason =
  | 'manual'           // User manually edited price
  | 'proposal_approved' // Price approved from proposal
  | 'proposal_modified' // Price modified during approval
  | 'bulk_update';      // Bulk approval operation

export interface PriceChangeRecord {
  accountId: string;
  sku: string;
  channelId: string;           // Channel affected (or "all" for average price)
  previousPrice: number;
  newPrice: number;
  changedBy: string;           // User email
  changedAt: string;           // ISO timestamp
  reason: PriceChangeReason;
  source: string;              // "ProductDetail", "Proposals", "API"
  notes?: string;              // Optional user notes
  proposalId?: string;         // Reference to proposal if applicable
}

/**
 * API response for price change history
 */
export interface PriceChangeHistoryResponse {
  items: PriceChangeRecord[];
  count: number;
  sku: string;
}
