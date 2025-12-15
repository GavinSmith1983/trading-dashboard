# Trading Dashboard

> Multi-tenant automated repricing system for retail businesses selling across multiple marketplaces.

**Live URL:** https://d1stq5bxiu9ds3.cloudfront.net
**API:** https://lvsj0zgfz2.execute-api.eu-west-2.amazonaws.com/prod/

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Tech Stack](#tech-stack)
4. [Data Sources](#data-sources)
5. [AWS Infrastructure](#aws-infrastructure)
6. [Frontend Structure](#frontend-structure)
7. [API Reference](#api-reference)
8. [Security](#security)
9. [Getting Started](#getting-started)
10. [Deployment](#deployment)
11. [Common Operations](#common-operations)

---

## Overview

### What It Does

The Trading Dashboard is an automated repricing system that:

1. **Aggregates data** from multiple sources (ChannelEngine, Google Sheets, Akeneo PIM)
2. **Calculates optimal prices** based on costs, margins, sales velocity, and competitor prices
3. **Presents proposals** for human review before pushing changes
4. **Tracks performance** with sales analytics, margin analysis, and inventory insights

### Business Context

- **Product Catalog:** 6,200+ SKUs per account
- **Sales Channels:** Amazon, B&Q, eBay, ManoMano, Shopify, OnBuy, Debenhams (via ChannelEngine)
- **Pricing Cycle:** Weekly proposals with human approval
- **Multi-Tenant:** Supports multiple accounts with full data isolation

### Current Accounts

| Account ID | Name | Currency | Status |
|------------|------|----------|--------|
| `ku-bathrooms` | KU Bathrooms | GBP | Active |
| `valquest-usa` | Valquest USA | USD | Active |
| `ultra-clearance` | Ultra Clearance | GBP | Active |

---

## Architecture

### High-Level Data Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         TRADING DASHBOARD SYSTEM                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  External Sources                    AWS Infrastructure                      │
│  ────────────────                    ─────────────────                       │
│                                                                              │
│  ┌─────────────┐     ┌──────────────────────────────────────────────────┐   │
│  │ChannelEngine│────▶│  EventBridge Schedules                           │   │
│  │  - Products │     │    │                                             │   │
│  │  - Orders   │     │    ├─▶ data-sync (Daily 5am)                     │   │
│  │  - Stock    │     │    ├─▶ order-sync (Hourly)                       │   │
│  └─────────────┘     │    ├─▶ akeneo-sync (Every 15 mins)               │   │
│                      │    ├─▶ competitor-scrape (Daily 4am)             │   │
│  ┌─────────────┐     │    └─▶ price-calculator (Monday 7am)             │   │
│  │Google Sheets│────▶│                    │                             │   │
│  │  - Prices   │     │                    ▼                             │   │
│  └─────────────┘     │  ┌────────────────────────────────────────────┐  │   │
│                      │  │           DynamoDB Tables                   │  │   │
│  ┌─────────────┐     │  │  - repricing-v2-accounts                   │  │   │
│  │ Akeneo PIM  │────▶│  │  - repricing-v2-products                   │  │   │
│  │  - Family   │     │  │  - repricing-v2-orders                     │  │   │
│  └─────────────┘     │  │  - repricing-v2-order-lines                │  │   │
│                      │  │  - repricing-v2-proposals                  │  │   │
│                      │  │  - repricing-v2-carriers                   │  │   │
│                      │  └────────────────────────────────────────────┘  │   │
│                      │                    │                             │   │
│                      │                    ▼                             │   │
│                      │  ┌────────────────────────────────────────────┐  │   │
│                      │  │         API Gateway + Lambda               │  │   │
│                      │  │         (Cognito Authorizer)               │  │   │
│                      │  └────────────────────────────────────────────┘  │   │
│                      │                    │                             │   │
│                      └────────────────────│─────────────────────────────┘   │
│                                           ▼                                  │
│                      ┌────────────────────────────────────────────────┐     │
│                      │     S3 + CloudFront (React Frontend)           │     │
│                      │     https://d1stq5bxiu9ds3.cloudfront.net      │     │
│                      └────────────────────────────────────────────────┘     │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Multi-Tenant Design

All DynamoDB tables use `accountId` as the partition key, ensuring complete data isolation between tenants. The account context is extracted from the JWT token and validated on every API request.

---

## Tech Stack

### Backend
- **Runtime:** Node.js 20.x (TypeScript)
- **Infrastructure:** AWS CDK (TypeScript)
- **Database:** DynamoDB (multi-tenant with accountId partition key)
- **API:** API Gateway REST + Lambda
- **Auth:** Cognito User Pool with JWT tokens
- **Scheduling:** EventBridge

### Frontend
- **Framework:** React 18 + TypeScript
- **Build:** Vite
- **Styling:** TailwindCSS
- **Data Fetching:** TanStack React Query
- **Routing:** React Router v6
- **Charts:** Recharts
- **Hosting:** S3 + CloudFront

### External Integrations
- **ChannelEngine:** Product catalog, orders, stock levels
- **Google Sheets:** Channel-specific pricing (Columns F-J)
- **Akeneo PIM:** Product family categorisation

---

## Data Sources

### Primary Data Sources

| Data | Source | Update Frequency |
|------|--------|------------------|
| Product metadata (title, brand, image) | ChannelEngine | Daily (5am UTC) |
| Stock levels | ChannelEngine | Daily |
| Family (primary categorisation) | Akeneo PIM | Every 15 mins |
| Subcategory | ChannelEngine CategoryTrail | Daily |
| Channel prices | Google Sheet (Columns F-J) | Daily |
| Cost price | CSV import / manual entry | On demand |
| Delivery cost | Calculated from orders | On demand |
| Competitor prices | Web scraper | Daily (4am UTC) |
| Orders & sales | ChannelEngine | Hourly |

### Google Sheets Integration

**Only Column C and Columns F-J are used:**

| Column | Field | Channel |
|--------|-------|---------|
| C | Balterley SKU | Primary key for matching |
| F | B&Q Pricing | B&Q |
| G | Amazon Pricing | Amazon |
| H | eBay Pricing | eBay, OnBuy, Debenhams |
| I | ManoMano Pricing | ManoMano |
| J | Shopify Pricing | Shopify |

### Akeneo PIM Integration

- **Tenant:** `roxor-test.cloud.akeneo.com`
- **Sync Frequency:** Every 15 minutes
- **Smart Sync:** Only syncs products with no `family` or data older than 7 days
- **Rate Limiting:** 50 requests/second with exponential backoff

---

## AWS Infrastructure

### Account Details
- **AWS Account:** 610274502245
- **Region:** eu-west-2 (London)

### CloudFormation Stacks

| Stack | Purpose |
|-------|---------|
| RepricingV2DatabaseStack | DynamoDB tables |
| RepricingV2LambdaStack | Lambda functions + EventBridge schedules |
| RepricingV2ApiStack | API Gateway REST API |
| RepricingV2AuthStack | Cognito User Pool |
| RepricingV2FrontendStack | S3 bucket + CloudFront |

### DynamoDB Tables

| Table | Partition Key | Sort Key | Purpose |
|-------|---------------|----------|---------|
| repricing-v2-accounts | accountId | - | Account configuration |
| repricing-v2-products | accountId | sku | Product catalog |
| repricing-v2-orders | accountId | orderId | Order headers |
| repricing-v2-order-lines | accountId | sku#orderDate | Denormalized for sales queries |
| repricing-v2-proposals | accountId | proposalId | Price change proposals |
| repricing-v2-carriers | accountId | carrierId | Delivery cost config |
| repricing-v2-sku-history | accountId | sku#date | Historical tracking |

### Lambda Functions

| Function | Schedule | Timeout | Memory | Purpose |
|----------|----------|---------|--------|---------|
| repricing-v2-api | On demand | 5 min | 1024 MB | REST API handler |
| repricing-v2-data-sync | Daily 5am UTC | 15 min | 1024 MB | Product sync |
| repricing-v2-order-sync | Hourly | 15 min | 1024 MB | Order sync (last 24h) |
| repricing-v2-akeneo-sync | Every 15 mins | 5 min | 512 MB | Family sync |
| repricing-v2-competitor-scrape | Daily 4am UTC | 15 min | 512 MB | Price scraping |
| repricing-v2-price-calculator | Monday 7am | 5 min | 512 MB | Generate proposals |

### Other AWS Resources

| Service | Resource | Details |
|---------|----------|---------|
| API Gateway | lvsj0zgfz2 | REST API with Cognito authorizer |
| Cognito | eu-west-2_XPGjaZEIp | User Pool (repricing-v2-users) |
| S3 | repricing-v2-frontend-610274502245 | Frontend hosting |
| CloudFront | EO4ZPYXTKH81H | CDN (d1stq5bxiu9ds3.cloudfront.net) |
| Secrets Manager | repricing/akeneo-* | Akeneo credentials |
| Secrets Manager | repricing/google-sheets | Google service account |

---

## Frontend Structure

```
packages/frontend/src/
├── api/                    # API client modules (split by domain)
│   ├── index.ts           # Barrel export + shared config
│   ├── products.ts        # Products API
│   ├── proposals.ts       # Proposals API
│   ├── analytics.ts       # Analytics/Sales API
│   ├── admin.ts           # Accounts/Users API
│   ├── carriers.ts        # Carriers/Delivery API
│   ├── prices.ts          # Prices API
│   └── misc.ts            # Import/Sync endpoints
├── components/            # Reusable UI components
│   ├── index.ts          # Barrel export
│   ├── Badge.tsx, Button.tsx, Card.tsx, Modal.tsx, etc.
│   └── charts/           # Chart components
├── context/              # React context providers
│   ├── AuthContext.tsx   # Authentication state
│   └── AccountContext.tsx # Multi-tenant account selection
├── hooks/                # Custom React hooks
│   ├── index.ts         # Barrel export
│   ├── useAccountQuery.ts
│   ├── useDateRange.ts  # Date range selection with presets
│   └── usePagination.ts # Client-side pagination
├── pages/               # Page components
│   ├── Dashboard.tsx, Products.tsx, ProductDetail.tsx
│   ├── Sales.tsx, Insights.tsx, Proposals.tsx
│   └── admin/           # Admin pages (Accounts, Users, DeliveryCosts)
├── types/               # TypeScript type definitions
└── utils/               # Pure utility functions
    ├── format.ts       # formatCurrency, formatPrice, formatPercent
    ├── dates.ts        # getDateRange, formatDate
    ├── calculations.ts # calculateMargin, getMarginColor
    └── channels.ts     # CHANNEL_COLORS, getChannelDisplayName
```

### Key Pages

| Route | Page | Description |
|-------|------|-------------|
| `/` | Dashboard | Overview stats, quick actions |
| `/products` | Products | Product catalog with filters, pagination |
| `/products/:sku` | ProductDetail | Single product with channel tabs, history chart |
| `/sales` | Sales | Revenue/units by channel and family |
| `/insights` | Insights | Product health cards (low margin, danger stock, etc.) |
| `/proposals` | Proposals | Price change approval workflow |
| `/admin/accounts` | Accounts | Tenant management (super-admin) |
| `/admin/users` | Users | User management (super-admin) |
| `/admin/delivery-costs` | DeliveryCosts | Carrier cost configuration |

---

## API Reference

Base URL: `https://lvsj0zgfz2.execute-api.eu-west-2.amazonaws.com/prod`

All endpoints require Cognito JWT in `Authorization` header.

### Products

| Method | Path | Description |
|--------|------|-------------|
| GET | `/products` | List products with pagination |
| GET | `/products?includeSales=true&salesDays=90` | Products with embedded sales data |
| GET | `/products/{sku}` | Get single product |
| PUT | `/products/{sku}` | Update product (cost, delivery, etc.) |

### Proposals

| Method | Path | Description |
|--------|------|-------------|
| GET | `/proposals` | List proposals with filters |
| GET | `/proposals/status-counts` | Get counts by status |
| PUT | `/proposals/{id}` | Approve/reject/modify proposal |
| POST | `/proposals/bulk-approve` | Bulk approve |
| POST | `/proposals/bulk-reject` | Bulk reject |
| POST | `/proposals/push` | Push approved to ChannelEngine |

### Analytics

| Method | Path | Description |
|--------|------|-------------|
| GET | `/analytics/summary` | Dashboard metrics |
| GET | `/analytics/sales` | Sales data with date range, groupBy |
| GET | `/analytics/insights` | Product health insights |

### Prices

| Method | Path | Description |
|--------|------|-------------|
| GET | `/prices/recent?limit=N` | Recent price changes |
| GET | `/prices/history/{sku}?limit=N` | Price history for SKU |
| PUT | `/prices/{sku}` | Update channel price |

### Carriers

| Method | Path | Description |
|--------|------|-------------|
| GET | `/carriers` | List carriers for account |
| POST | `/carriers` | Create carrier |
| PUT | `/carriers/{id}` | Update carrier |
| DELETE | `/carriers/{id}` | Delete carrier |
| POST | `/carriers/recalculate` | Recalculate delivery costs |

### Import

| Method | Path | Description |
|--------|------|-------------|
| POST | `/import/costs` | Import cost prices from CSV |
| POST | `/import/delivery` | Import delivery costs from CSV |

### Competitors

| Method | Path | Description |
|--------|------|-------------|
| POST | `/competitors/add-url` | Add competitor URL to product |
| DELETE | `/competitors/remove-url` | Remove competitor URL |
| POST | `/competitors/scrape/{sku}` | Scrape prices for SKU |

### Admin (Super-Admin Only)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/accounts` | List all accounts |
| POST | `/accounts` | Create account |
| PUT | `/accounts/{id}` | Update account |
| GET | `/users` | List all users |
| POST | `/users` | Create user (sends welcome email) |
| DELETE | `/users/{email}` | Disable user |
| POST | `/users/{email}/resend-invitation` | Resend welcome email |

---

## Security

### Authentication
- **Provider:** AWS Cognito
- **User Pool:** eu-west-2_XPGjaZEIp
- **Token Type:** JWT (ID token in Authorization header)

### User Roles

| Role | Permissions |
|------|-------------|
| super-admin | Full access, cross-account management |
| admin | Account management, user settings |
| editor | Modify data within allowed accounts |
| viewer | Read-only access |

### CORS Configuration
Restricted to specific origins:
- `https://d1stq5bxiu9ds3.cloudfront.net` (production)
- `http://localhost:5173` (development)
- `http://localhost:3000` (development)

### Rate Limiting
- **Rate:** 10 requests/second
- **Burst:** 20 requests

### API Gateway Compression
- Enabled for responses > 1KB
- Reduces 5MB responses to ~500KB (10:1 compression)

---

## Getting Started

### Prerequisites
- Node.js 20.x
- AWS CLI configured with credentials
- AWS CDK CLI (`npm install -g aws-cdk`)

### Installation

```bash
# Clone repository
git clone <repo-url>
cd Trading-Dashboard

# Install dependencies (monorepo workspaces)
npm install

# Build core package (required before lambdas)
cd packages/core && npm run build && cd ../..
```

### Local Development

```bash
# Create frontend environment file
cat > packages/frontend/.env << EOF
VITE_API_URL=https://lvsj0zgfz2.execute-api.eu-west-2.amazonaws.com/prod
VITE_COGNITO_USER_POOL_ID=eu-west-2_XPGjaZEIp
VITE_COGNITO_CLIENT_ID=<your-client-id>
EOF

# Start frontend dev server
cd packages/frontend && npm run dev
```

---

## Deployment

### Deploy Infrastructure

```bash
# Deploy all V2 stacks
cd infrastructure
npx cdk deploy --app "npx ts-node bin/app-v2.ts" RepricingV2* --require-approval never

# Or deploy specific stack
npx cdk deploy --app "npx ts-node bin/app-v2.ts" RepricingV2LambdaStack --require-approval never
```

### Deploy Frontend

```bash
# Build frontend
cd packages/frontend && npm run build

# Sync to S3
aws s3 sync dist s3://repricing-v2-frontend-610274502245 --delete --region eu-west-2

# Invalidate CloudFront cache
aws cloudfront create-invalidation --distribution-id EO4ZPYXTKH81H --paths "/*"
```

### TypeScript Check

```bash
npx tsc --noEmit -p packages/lambdas/tsconfig.json
```

---

## Common Operations

### Trigger Data Sync (Single Account)

```bash
aws lambda invoke --function-name repricing-v2-data-sync \
  --region eu-west-2 --invocation-type Event \
  --cli-binary-format raw-in-base64-out \
  --payload '{"accountId":"ku-bathrooms"}' output.json
```

### Trigger Akeneo Sync (Single Account)

```bash
aws lambda invoke --function-name repricing-v2-akeneo-sync \
  --region eu-west-2 --invocation-type Event \
  --cli-binary-format raw-in-base64-out \
  --payload '{"accountId":"ku-bathrooms"}' output.json
```

### Test API Endpoint

```bash
aws lambda invoke --function-name repricing-v2-api \
  --region eu-west-2 --cli-binary-format raw-in-base64-out \
  --payload '{"httpMethod":"GET","path":"/accounts","queryStringParameters":{},"headers":{},"requestContext":{"authorizer":{"claims":{"sub":"test","email":"test@test.com","cognito:groups":"super-admin"}}}}' \
  response.json && cat response.json
```

### Re-enable API Compression (if disabled)

```bash
# Git Bash on Windows
MSYS_NO_PATHCONV=1 aws apigateway update-rest-api \
  --rest-api-id lvsj0zgfz2 --region eu-west-2 \
  --patch-operations "op=replace,path=/minimumCompressionSize,value=1000"

MSYS_NO_PATHCONV=1 aws apigateway create-deployment \
  --rest-api-id lvsj0zgfz2 --stage-name prod --region eu-west-2
```

---

## Rollback Points

| Commit | Date | Description |
|--------|------|-------------|
| `aaf1245` | 2025-12-15 | Documentation consolidation |
| `ba896d5` | 2025-12-15 | Frontend refactor Stage 3 |
| `0da1373` | 2025-12-15 | Security and efficiency improvements |
| `0c50daf` | 2025-12-15 | Performance: 55s to 5s load time |
| `d3ebe25` | 2025-12-10 | Remove V1 infrastructure |

### Git Tags

| Tag | Description |
|-----|-------------|
| `backup-pre-refactor-2025-12-15` | Before frontend restructuring |
| `savepoint-2025-12-08` | Initial stable V2 deployment |

### How to Rollback

```bash
# Rollback code only (keeps working directory changes)
git reset --soft <commit>

# Full rollback (discards all changes)
git reset --hard <commit>

# Redeploy after rollback
cd packages/frontend && npm run build
aws s3 sync dist s3://repricing-v2-frontend-610274502245 --delete --region eu-west-2
aws cloudfront create-invalidation --distribution-id EO4ZPYXTKH81H --paths "/*"
```

---

## Important Notes

### Order Sync Lambda
**DO NOT MODIFY** `repricing-v2-order-sync` - it ignores all event parameters and always syncs the last 24 hours. For historical backfill, create a temporary Lambda script.

### Channel Pricing Rules
- eBay pricing (Column H) applies to OnBuy and Debenhams channels
- Channel fees: Shopify = 15%, all other marketplaces = 20%

### Profit Calculation

```
Net Profit = Selling Price - COGS - Delivery Cost - Channel Fee - Advertising Cost

Where:
  Channel Fee = Selling Price × Channel Fee %
  Advertising Cost = Selling Price × ACOS % (or fixed amount)

Margin % = (Net Profit / Selling Price) × 100
```

---

*Last updated: 15th December 2025*
