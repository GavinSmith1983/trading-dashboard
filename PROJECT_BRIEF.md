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
| Product Costs (COGS) | Google Sheet | Google Sheets API |
| Delivery Costs | Manual | Fixed per SKU, configured in system |
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
│    • repricing-products (SKU, costs, prices, stock)            │
│    • repricing-rules (pricing rules configuration)              │
│    • repricing-proposals (pending price changes)                │
│    • repricing-channels (channel fee configuration)             │
│    • repricing-orders (order data with nested line items)       │
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

## Weekly Workflow

1. **Sunday 10pm:** Data sync Lambda pulls latest data from ChannelEngine and Google Sheets
2. **Monday 6am:** Price calculator Lambda applies rules, generates proposals
3. **Mon-Thu:** Human reviews proposals in approval UI
4. **Friday:** Approved prices pushed to ChannelEngine

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
│       └── frontend-stack.ts
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
- Data sync from ChannelEngine (6,200+ products with images)
- Data sync from Google Sheets (cost data)
- Order sync from ChannelEngine (orders with nested line items)
- 180-day sales analytics per SKU (optimized with parallel batch queries)
- Pricing rules engine with margin calculation
- React frontend with approval workflow
- Dashboard with stats and quick actions
- Proposals page with approve/reject/modify
- Products page with thumbnails, cost editing, sortable columns
- Product Detail page with redesigned 3-section layout
- Channels page for fee configuration
- Pricing Rules page for rule management
- Delivery Costs page for delivery cost management
- Import page for CSV cost uploads with enhanced diagnostics
- SKU History tracking with daily snapshots

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
- Backfill endpoint to populate from existing orders
- 180-day history retention

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
| GET | /analytics/summary | Dashboard summary stats |
| GET | /analytics/margins | Margin analysis |
| GET | /analytics/sales?days=N | N-day sales by SKU (default 180) |
| GET | /history/{sku} | Get SKU history (price, stock, sales) |
| POST | /history/backfill | Backfill history from orders |
| POST | /import/costs | Upload cost CSV |
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
| repricing-sku-history | sku | date | - |

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
| repricing-data-sync | Sunday 10pm | 15 min | 1024 MB |
| repricing-price-calculator | Monday 6am | 5 min | 512 MB |
| repricing-order-sync | Manual | 15 min | 1024 MB |
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

---

*Last updated: 2nd December 2024 - Product Detail page redesign with 3-section layout, live margin preview, Days of Stock metric, SKU history tracking, product images, 180-day sales analytics*
