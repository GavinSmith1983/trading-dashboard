# Repricing Model Project Brief

> **Use this document at the start of each Claude session to provide context.**

## Project Overview

An automated repricing system for bathroom products sold across multiple sales channels (Amazon, B&Q, eBay, ManoMano, Shopify). The system calculates optimal prices based on costs, margins, sales velocity, and inventory levels, then presents price changes for human approval before pushing to ChannelEngine.

## Business Context

- **Company:** Bathroom products retailer (brands include Nuie, Balterley)
- **Product Catalog:** 6,200+ SKUs
- **Sales Channels:** Amazon, B&Q, eBay, ManoMano, Shopify (all managed via ChannelEngine)
- **Repricing Frequency:** Weekly cycle
- **Pricing Strategy:** Start with unified pricing across channels, evolve to channel-specific optimization later

## Live URLs

- **Frontend:** https://dd0eswlutoz5b.cloudfront.net
- **API:** https://2uf6pmvya1.execute-api.eu-west-2.amazonaws.com/prod/

## Goals

1. **Primary:** Balance profit margins with competitive positioning
2. **Automation:** Calculate prices automatically, but require human approval before changes
3. **Visibility:** Dashboard showing proposed changes, margin impact, and reasoning
4. **Scalability:** Handle 6,000+ SKUs efficiently with minimal AWS costs

## Data Sources

| Data | Source | Access Method |
|------|--------|---------------|
| Current Prices | ChannelEngine | ChannelEngine API |
| Sales & Stock | ChannelEngine | ChannelEngine API |
| Orders & Revenue | ChannelEngine | ChannelEngine Orders API |
| Product Weight | ChannelEngine | ChannelEngine API (standard or ExtraData field) |
| Product Costs (COGS) | Google Sheet | Google Sheets API |
| Delivery Costs | Calculated | From order data (Vector Summary) + category averages |
| Channel Fees | Configuration | Set in system (Amazon 15%, eBay 12.8%, etc.) |
| Advertising Costs | Configuration | ACOS % or fixed per channel |

### Google Sheet Structure
- **Sheet ID:** `1scr_yS-9U6x4zTN9HG3emptsqt8phQgDjYeNygB8Cs8`
- **Columns:** Brand Name, Product SKU, Balterley SKU, Family Variants, MRP, B&Q Pricing, Amazon Pricing, eBay Pricing, ManoMano Pricing, Shopify Pricing, discount-start-date, discount-end-date, discount-price

## Technical Stack

- **Language:** TypeScript/Node.js
- **Infrastructure:** AWS CDK
- **Cloud Provider:** AWS (Account: 610274502245)
- **Region:** eu-west-2 (London)
- **Budget:** Cost-optimized (~$5-10/month target)

## AWS Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    AWS REPRICING SYSTEM                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  EventBridge (Weekly)                                           │
│       │                                                         │
│       ├──▶ data-sync Lambda ──▶ Pulls from CE + Google Sheets  │
│       │                                                         │
│       ├──▶ price-calculator Lambda ──▶ Generates proposals     │
│       │                                                         │
│       └──▶ order-sync Lambda ──▶ Pulls orders from CE          │
│                                                                 │
│  DynamoDB Tables:                                               │
│    • repricing-products (SKU, costs, prices, stock, weight)    │
│    • repricing-rules (pricing rules configuration)              │
│    • repricing-proposals (pending price changes)                │
│    • repricing-channels (channel fee configuration)             │
│    • repricing-orders (order data with nested line items)       │
│    • repricing-carriers (carrier costs for delivery calc)       │
│                                                                 │
│  API Gateway ──▶ api Lambda ──▶ REST API for frontend          │
│                                                                 │
│  S3 + CloudFront ──▶ React approval UI                         │
│                                                                 │
│  Secrets Manager:                                               │
│    • repricing/channel-engine (API credentials)                 │
│    • repricing/google-sheets (service account)                  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Daily/Weekly Workflow

1. **Daily 4am UTC:** Competitor scrape Lambda scrapes competitor prices for products with URLs configured
2. **Daily 5am UTC:** Data sync Lambda pulls latest data from ChannelEngine and Google Sheets, records daily history
3. **Daily 6am UTC:** Order sync Lambda pulls new orders from ChannelEngine
4. **Monday 7am UTC:** Price calculator Lambda applies rules, generates proposals
5. **Mon-Thu:** Human reviews proposals in approval UI
6. **Friday:** Approved prices pushed to ChannelEngine

## Profit Calculation Formula

```
Net Profit = Selling Price - COGS - Delivery Cost - Channel Fee - Advertising Cost

Where:
  - Channel Fee = Selling Price × Channel Fee %
  - Advertising Cost = Selling Price × ACOS % (or fixed amount)

Margin % = (Net Profit / Selling Price) × 100
```

## Project Structure

```
channel-engine-repricing/
├── PROJECT_BRIEF.md          # This file
├── infrastructure/           # AWS CDK
│   ├── bin/app.ts
│   └── lib/
│       ├── database-stack.ts
│       ├── lambda-stack.ts
│       ├── api-stack.ts
│       ├── frontend-stack.ts
│       └── auth-stack.ts
├── packages/
│   ├── core/                 # Shared types & services
│   │   ├── src/types/
│   │   │   ├── product.ts
│   │   │   ├── channel.ts
│   │   │   ├── pricing.ts
│   │   │   ├── proposal.ts
│   │   │   └── order.ts      # Order types with nested lines
│   │   └── src/services/
│   │       ├── google-sheets.ts
│   │       ├── channel-engine.ts
│   │       ├── pricing-engine.ts
│   │       └── dynamodb.ts
│   ├── lambdas/
│   │   ├── data-sync/        # ChannelEngine + Sheets sync
│   │   ├── price-calculator/ # Pricing rules engine
│   │   ├── order-sync/       # Order data sync
│   │   └── api/              # REST API handlers
│   └── frontend/             # React approval UI
├── package.json              # Monorepo root
└── tsconfig.json
```

## Implementation Status

### Completed
- AWS CDK infrastructure (all stacks deployed)
- Data sync from ChannelEngine (6,200+ products with images, weight)
- Data sync from Google Sheets (cost data)
- Order sync from ChannelEngine (orders with nested line items)
- 180-day sales analytics per SKU (optimized with parallel batch queries)
- Pricing rules engine with margin calculation
- React frontend with approval workflow
- Dashboard with stats and quick actions
- **Insights page** with product health cards (replaced Proposals)
- Products page with thumbnails, cost editing, sortable columns
- Product Detail page with redesigned 3-section layout
- Channels page for fee configuration
- Pricing Rules page for rule management
- Delivery Costs page with carrier management and recalculation
- Import page for CSV cost uploads with enhanced diagnostics
- SKU History tracking with daily snapshots
- **Delivery cost calculation from order data (Vector Summary imports)**

### Insights Page Features
Seven insight cards to identify product health issues:

| Card | Criteria | Severity |
|------|----------|----------|
| Low Sales & High Margin | Sales < 0.25/day, margin > 40%, in stock | Info |
| Danger Stock | Sales > 0.5/day, stock < 14 days | Critical |
| Out of Stock (High Demand) | Sales > 0.5/day, stock = 0 | Critical |
| Low Margin | Margin 0-25% | Warning |
| Negative Margin | Margin < 0% | Critical |
| Missing Price | No price set | Critical |
| Missing Title | No title | Warning |

- Expandable cards showing product tables
- Sorted by severity (critical first)
- Links to product detail page
- Summary counts for critical/warning issues

### Delivery Cost Calculation
Delivery costs are calculated from real order data:

1. **Vector Summary Import:** Upload warehouse delivery data (carrier, parcels per order)
2. **Carrier Cost Configuration:** Set cost per parcel for each carrier
3. **Recalculate:** Processes all orders to calculate delivery cost per SKU
   - Proportionally splits order delivery cost by line item value
   - Calculates average delivery cost per unit sold

**Automatic Fill Rules:**
- Products without order data get category average (from products with order data)
- Products with "Suite" in title → £45 delivery cost
- Products with weight > 30kg → £45 delivery cost

### Import Features
- Case-insensitive SKU matching
- Fallback matching via Balterley SKU field
- Batch writes for fast processing (6,000+ products in seconds)
- Detailed import results showing:
  - Products updated
  - File SKUs not found in database
  - Database SKUs missing from cost file (with samples)

### Products Page Features
- Sortable columns (click headers to sort)
- Product thumbnails (40x40px)
- Sorted by avg daily sales (highest first) by default
- Stock levels with color coding
- Inline navigation to product detail page
- 180-day avg daily sales and revenue per SKU
- **Filters:** Stock (All/In Stock/Out of Stock), Missing Cost toggle, Margin filter (All/Negative/Low/Good)
- **Pagination:** Page size selector (25/50/100/200), First/Prev/Next/Last navigation
- **Listing count:** Shows filtered count vs total products

### Product Detail Page Features (Redesigned)
Three-section layout following merchandiser workflow:

**Section 1: Cost Inputs (Editable)**
- Cost and Delivery fields with inline editing
- Dashed border styling to indicate editability
- Live preview of margin changes while editing

**Section 2: Pricing & Margin (Calculated)**
- Price ex VAT breakdown
- 20% Costs deduction
- Cost + Delivery deduction (updates live when editing)
- PPO (Profit Per Order) calculation
- Hero Margin display with color-coded thresholds:
  - Red: < 10% (Low)
  - Amber: 10-20% (Fair)
  - Green: > 20% (Good)

**Section 3: Sales Performance (Read-only)**
- Average Daily Sales (units/day)
- Average Daily Revenue (£/day)
- Current Stock with color coding
- Days of Stock (calculated: Stock ÷ Avg Daily Sales)
  - Red: < 14 days (low stock warning)
  - Amber: 14-30 days
  - Green: 30-90 days
  - Blue: > 90 days (potential overstock)

**Section 4: Historical Data**
- Line chart showing price, stock, and sales trends
- Date range display

### SKU History Features
- Daily snapshots recorded during data sync
- Historical price, stock, and sales tracking
- Competitor price tracking (lowest competitor, all competitor prices with URLs)
- Backfill endpoint to populate from existing orders
- 180-day history retention

### Competitor Price Tracking
- Add competitor URLs per product via Product Detail page
- Daily scraping at 4am UTC extracts prices from competitor sites
- Supports various price formats (JSON-LD, meta tags, element extraction)
- Handles VAT correctly (ex-VAT sites automatically have VAT added)
- Competitor prices shown on Product Detail chart as red dashed line
- Historical competitor prices stored in SKU history

### Data Currently Synced
- **Products:** 6,200+ SKUs with prices, stock levels, costs, images
- **Orders:** 20,700+ orders (from June 2024 onwards)
- **Sales Data:** 180-day sales by SKU (quantity + revenue)
- **SKU History:** 15,900+ daily history records
- **Cost Data:** ~5,500 products with costs imported

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | /products | List all products |
| GET | /products/{sku} | Get single product |
| PUT | /products/{sku} | Update product costs |
| GET | /proposals | List price proposals |
| PUT | /proposals/{id} | Approve/reject proposal |
| POST | /proposals/bulk-approve | Bulk approve |
| POST | /proposals/bulk-reject | Bulk reject |
| POST | /proposals/push | Push to ChannelEngine |
| GET/POST | /rules | Manage pricing rules |
| GET/PUT | /channels/{id} | Channel configuration |
| GET | /carriers | List all carriers |
| POST | /carriers | Create/update carrier |
| POST | /carriers/recalculate | Recalculate all delivery costs |
| GET | /analytics/summary | Dashboard summary stats |
| GET | /analytics/margins | Margin analysis |
| GET | /analytics/sales?days=N | N-day sales by SKU (default 180) |
| GET | /analytics/insights | Product health insights |
| GET | /history/{sku} | Get SKU history (price, stock, sales) |
| POST | /history/backfill | Backfill history from orders |
| POST | /import/costs | Upload cost CSV |
| POST | /import/delivery | Import Vector Summary delivery data |
| POST | /sync | Trigger manual data sync |

## Credentials (AWS Secrets Manager)

1. **repricing/channel-engine:** API key and tenant ID (configured)
2. **repricing/google-sheets:** Service account JSON (configured)

## DynamoDB Tables

| Table | Partition Key | Sort Key | GSIs |
|-------|---------------|----------|------|
| repricing-products | sku | - | by-brand, by-category |
| repricing-rules | ruleId | - | - |
| repricing-proposals | proposalId | - | by-status, by-sku |
| repricing-channels | channelId | - | - |
| repricing-orders | orderId | - | by-channel, by-date |
| repricing-order-lines | orderLineId | - | by-sku-date |
| repricing-sku-history | sku | date | - |
| repricing-carriers | carrierId | - | - |

### Order Data Structure
Orders are stored with nested line items (single table design):
```typescript
interface Order {
  orderId: string;
  channelName: string;
  orderDate: string;
  orderDateDay: string;  // YYYY-MM-DD for GSI
  shippingMethod?: string;
  shippingServiceLevel?: string;
  lines: OrderLine[];    // Nested array
  // ... totals, fees, etc.
}
```

## Lambda Functions

| Function | Schedule | Timeout | Memory |
|----------|----------|---------|--------|
| repricing-competitor-scrape | Daily 4am UTC | 15 min | 512 MB |
| repricing-data-sync | Daily 5am UTC | 15 min | 1024 MB |
| repricing-order-sync | Daily 6am UTC | 15 min | 1024 MB |
| repricing-price-calculator | Monday 7am UTC | 5 min | 512 MB |
| repricing-api | On-demand | 5 min | 1024 MB |

## Running Locally

```bash
# Install dependencies
npm install

# Build all packages
npm run build

# Run frontend development server
cd packages/frontend
npm run dev
```

## Deploying to AWS

```bash
cd infrastructure

# Deploy all stacks
npx cdk deploy --all

# Deploy specific stack
npx cdk deploy RepricingLambdaStack --exclusively

# Sync frontend to S3
aws s3 sync ../packages/frontend/dist s3://repricing-frontend-610274502245 --delete

# Invalidate CloudFront cache
aws cloudfront create-invalidation --distribution-id E28VLOA0H027TB --paths "/*"
```

## Manual Operations

```bash
# Trigger data sync
aws lambda invoke --function-name repricing-data-sync --payload '{}' response.json

# Trigger order sync (backfill from specific date)
aws lambda invoke --function-name repricing-order-sync \
  --payload '{"fromDate":"2024-11-01"}' response.json

# Check order count
aws dynamodb scan --table-name repricing-orders --select COUNT
```

### Product Detail Chart Features
- Interactive line chart showing historical data
- Toggle lines on/off by clicking legend items
- Shows: Price, Stock, Revenue, Margin %, Lowest Competitor
- Values limited to 2 decimal places
- Fills missing days but shows gaps for missing data (doesn't assume values)
- Uses UTC dates to avoid timezone issues

### Authentication
- AWS Cognito user pool (RepricingAuthStack)
- Login page with email/password
- User groups: admin, editor, viewer
- Admin user: gavin.smith@roxorgroup.com

### Channel Pricing (Google Sheet Integration)
- **Column C (Balterley SKU):** Primary key for matching ChannelEngine products
- **Columns F-J:** Channel-specific prices (B&Q, Amazon, eBay, ManoMano, Shopify)
- **eBay pricing** also applies to OnBuy and Debenhams channels
- Price updates via Product Detail page write back to Google Sheet
- Data sync pulls channel prices during daily sync

---

*Last updated: 3rd December 2025*

**Recent Changes:**
- Products page: Added filters (stock, missing cost, margin) and pagination
- Google Sheet integration simplified: Only Column C (SKU) and F-J (prices) are read
- Brand data now sourced from ChannelEngine only (not Google Sheet)
- Order-lines table added for faster sales analytics queries
- Daily competitor price scraping (was weekly)
- Early morning sync schedules (4am-7am UTC, was evening)
- Competitor prices tracked in daily history and shown on charts
- Data sync preserves user-entered competitor URLs
