/**
 * API module barrel export
 *
 * All API modules are re-exported here for backward compatibility.
 * New code should import directly from the specific module.
 */

// Re-export the HTTP client
export { api, getIdToken } from './client';

// Products
export { productsApi, type ProductWithSales } from './products';

// Proposals
export { proposalsApi, type ProposalFilters } from './proposals';

// Analytics
export {
  analyticsApi,
  type SalesData,
  type InsightProduct,
  type InsightCategory,
  type InsightsResponse,
  type SalesResponse,
} from './analytics';

// Admin (accounts, users)
export {
  accountsApi,
  usersApi,
  type Account,
  type GoogleSheetsColumnMapping,
  type User,
  type CreateUserRequest,
  type UpdateUserRequest,
} from './admin';

// Carriers
export {
  carriersApi,
  type CarrierCost,
  type RecalculateResult,
} from './carriers';

// Prices
export {
  pricesApi,
  type PriceUpdateResult,
  type PriceChangeReason,
  type PriceChangeRecord,
  type PriceChangeHistoryResponse,
} from './prices';

// Misc (rules, channels, import, history, sync, competitors)
export {
  rulesApi,
  channelsApi,
  importApi,
  historyApi,
  syncApi,
  competitorsApi,
  type ImportResult,
  type DeliveryImportResult,
  type SkuHistoryRecord,
  type ChannelSalesData,
  type SkuHistoryResponse,
  type CompetitorUrl,
  type ScrapeResult,
} from './misc';
