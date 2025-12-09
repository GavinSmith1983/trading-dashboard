# Trading Dashboard - Claude Instructions

> Project-specific instructions for Claude AI sessions.

## Architecture Overview

The Trading Dashboard is a **multi-tenant V2 architecture** supporting multiple accounts (KU Bathrooms, Valquest USA, etc.). All DynamoDB tables use `accountId` as the partition key.

### V2 Infrastructure
- **CDK Entry Point**: `infrastructure/bin/app-v2.ts`
- **Deploy Command**: `npx cdk deploy --app "npx ts-node bin/app-v2.ts" RepricingV2*`
- **Tables**: All prefixed with `repricing-v2-` (e.g., `repricing-v2-products`, `repricing-v2-accounts`)

## Data Sources

### Primary Data Sources
| Data | Source | Update Frequency |
|------|--------|------------------|
| Product metadata (title, brand, image) | ChannelEngine | Daily (5am UTC) |
| Stock levels | ChannelEngine | Daily |
| **Family (primary categorisation)** | **Akeneo PIM** | **Every 15 mins (background sync)** |
| Subcategory (secondary categorisation) | ChannelEngine CategoryTrail | Daily |
| Channel prices | Google Sheet (Columns F-J) | Daily |
| Cost price | CSV import / manual entry | On demand |
| Delivery cost | Calculated from orders | On demand |
| Competitor prices | Scraper | Daily (4am UTC) |
| Orders & sales | ChannelEngine | Hourly |

### Categorisation Hierarchy
1. **Family** (from Akeneo PIM) - Primary categorisation used for analytics
2. **Subcategory** (from ChannelEngine) - Fallback if Family not available
3. `category` field is kept for V1 compatibility (alias for subcategory)

## Akeneo PIM Integration

### Configuration
- **Tenant**: `roxor-test.cloud.akeneo.com`
- **Secret ARN**: `arn:aws:secretsmanager:eu-west-2:610274502245:secret:repricing/akeneo-*`
- **Service**: `packages/core/src/services/akeneo.ts`

### Background Sync (`repricing-v2-akeneo-sync`)
- **Schedule**: Every 15 minutes via EventBridge
- **Behaviour**: Only syncs products with:
  - No `family` field, OR
  - `lastSyncedFromAkeneo` older than 7 days
- **Rate Limiting**: 10 requests/second (Akeneo allows 100/s)
- **Batch Size**: Max 500 products per run to avoid Lambda timeout
- **Retry Logic**: Exponential backoff on 429 responses

### Product Fields from Akeneo
| Field | Description |
|-------|-------------|
| `family` | Product family code (primary categorisation) |
| `lastSyncedFromAkeneo` | ISO timestamp of last sync |

## Google Sheets Integration

### Data We Use from Google Sheets
**IMPORTANT: Only Column C and Columns F-J are used. All other columns are ignored.**

| Column | Field | Used For |
|--------|-------|----------|
| C | Balterley SKU | **Primary key** for matching to ChannelEngine products |
| F | B&Q Pricing | Channel price |
| G | Amazon Pricing | Channel price |
| H | eBay Pricing | Channel price (also applies to OnBuy and Debenhams) |
| I | ManoMano Pricing | Channel price |
| J | Shopify Pricing | Channel price |

### What We Do NOT Read from Google Sheets
- Brand (comes from ChannelEngine)
- MRP (not used)
- Discount dates/prices (not currently implemented)
- Family variants (not used)

### SKU Matching Logic
- ChannelEngine SKUs are matched to **Column C (Balterley SKU)** case-insensitively
- Matching occurs in data-sync Lambda when enriching products with channel pricing

## Channel Pricing Rules
- eBay pricing (Column H) is also applied to OnBuy and Debenhams channels
- Channel fees: Shopify = 15%, all other marketplaces = 20%

## Sales Analytics

### Sales Page Features
- **Time Ranges**: 1M, 3M, 6M, This Month, Last Month
- **Period Grouping**: Day, Week, Month
- **Comparison Modes**: vs Last Year (YoY), vs Last Month (MoM)
- **Revenue Display**: Rounded to 0 decimals, hover for 2 decimal precision

### Charts
1. **Revenue/Units by Channel** - Stacked bar chart by day/week/month with clickable legend
2. **Revenue/Units by Family** - Same layout as channel chart, uses Akeneo Family data

### Channel Tabs UI
- Channels displayed in order: Amazon, B&Q, Shopify, ManoMano, eBay/OnBuy/Debs
- eBay, OnBuy, and Debenhams are collapsed into a single tab (shared pricing)
- The "All" tab shows average price across all channels

## Key Technical Notes

### V2 Tables (Multi-tenant)
- `repricing-v2-accounts` - Account configuration
- `repricing-v2-products` - PK: accountId, SK: sku
- `repricing-v2-rules` - Pricing rules
- `repricing-v2-proposals` - Price proposals
- `repricing-v2-orders` - Orders
- `repricing-v2-order-lines` - Denormalized order lines for fast sales queries

### Lambda Functions
| Function | Schedule | Purpose |
|----------|----------|---------|
| `repricing-v2-data-sync` | Daily 5am UTC | Sync products from ChannelEngine + Google Sheets |
| `repricing-v2-order-sync` | Hourly | Sync orders from ChannelEngine |
| `repricing-v2-akeneo-sync` | Every 15 mins | Sync Family data from Akeneo PIM |
| `repricing-v2-competitor-scrape` | Daily 4am UTC | Scrape competitor prices |
| `repricing-v2-price-calculator` | Weekly Monday 7am | Calculate price proposals |
| `repricing-v2-api` | On demand | REST API handler |

### Environment Variables (Lambdas)
- `AKENEO_SECRET_ARN` - Akeneo credentials secret
- `GOOGLE_SHEETS_SECRET_ARN` - Google Sheets credentials
- `MULTI_TENANT=true` - Enable multi-tenant mode
- `ACCOUNTS_TABLE`, `PRODUCTS_TABLE`, etc. - DynamoDB table names
