# Trading Dashboard - Architecture Documentation

> Save Point: December 8, 2025 - Complete system documentation

## Overview

The Trading Dashboard is a multi-channel pricing management system built on AWS serverless architecture. It integrates with ChannelEngine for product/order data and Google Sheets for channel pricing.

## AWS Infrastructure

### Stacks (CDK)

| Stack | Purpose | Key Resources |
|-------|---------|---------------|
| `RepricingAuthStack` | Authentication | Cognito User Pool, App Client |
| `RepricingDatabaseStack` | Data storage | DynamoDB tables |
| `RepricingLambdaStack` | Business logic | Lambda functions |
| `RepricingApiStack` | API layer | API Gateway REST API |
| `RepricingFrontendStack` | Web hosting | S3 bucket, CloudFront distribution |

### DynamoDB Tables

| Table | Primary Key | Sort Key | GSIs | Purpose |
|-------|-------------|----------|------|---------|
| `repricing-products` | `sku` | - | `by-brand` | Product catalog |
| `repricing-proposals` | `proposalId` | - | `by-status`, `by-sku` | Price change proposals |
| `repricing-rules` | `ruleId` | - | - | Pricing rules |
| `repricing-channels` | `channelId` | - | - | Channel configuration |
| `repricing-orders` | `orderId` | - | `by-date` | Order headers |
| `repricing-order-lines` | `sku` | `orderDate#orderId` | - | Denormalized order lines |
| `repricing-carrier-costs` | `carrier` | - | - | Delivery cost mappings |

### Lambda Functions

| Function | Trigger | Purpose |
|----------|---------|---------|
| `repricing-api` | API Gateway | REST API handler |
| `repricing-data-sync` | EventBridge (daily) | Sync products from ChannelEngine + Google Sheets |
| `repricing-order-sync` | EventBridge (daily) | Sync orders from ChannelEngine |
| `repricing-price-calculator` | EventBridge (daily) | Generate price proposals |
| `repricing-competitor-scrape` | EventBridge (daily 4am) | Scrape competitor prices |

### API Endpoints

Base URL: `https://2uf6pmvya1.execute-api.eu-west-2.amazonaws.com/prod/`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/products` | List products with filters |
| GET | `/products/{sku}` | Get single product |
| PUT | `/products/{sku}` | Update product |
| GET | `/proposals` | List proposals with filters |
| GET | `/proposals/{id}` | Get single proposal |
| PUT | `/proposals/{id}` | Approve/reject/modify proposal |
| POST | `/proposals/bulk-approve` | Bulk approve proposals |
| POST | `/proposals/bulk-reject` | Bulk reject proposals |
| POST | `/proposals/push` | Push approved prices to channels |
| GET | `/rules` | List pricing rules |
| POST | `/rules` | Create pricing rule |
| PUT | `/rules/{id}` | Update pricing rule |
| GET | `/channels` | List channel configs |
| GET | `/analytics/summary` | Dashboard summary stats |
| GET | `/analytics/sales` | Sales analytics |
| GET | `/analytics/insights` | AI-powered insights |
| GET | `/carriers` | List carrier costs |
| POST | `/carriers/recalculate` | Recalculate delivery costs |
| GET | `/history/{sku}` | SKU price history |
| POST | `/import/costs` | Import cost prices from CSV |
| POST | `/competitors/scrape` | Trigger competitor scrape |

## Frontend

### Tech Stack
- React 18 + TypeScript
- Vite build tool
- TailwindCSS styling
- React Query for data fetching
- React Router for navigation
- Recharts for charts
- Amazon Cognito for authentication

### Pages

| Route | Component | Purpose |
|-------|-----------|---------|
| `/` | Dashboard | Overview stats and charts |
| `/products` | Products | Product catalog with filters |
| `/products/:sku` | ProductDetail | Single product view with channel tabs |
| `/proposals` | Proposals | Price change proposals |
| `/sales` | Sales | Sales analytics |
| `/insights` | Insights | AI-powered insights |
| `/delivery-costs` | DeliveryCosts | Carrier cost management |
| `/login` | Login | Cognito authentication |

### Key Frontend Files

```
packages/frontend/
├── src/
│   ├── api/
│   │   ├── client.ts      # Base API client with Cognito auth
│   │   └── index.ts       # API endpoint functions
│   ├── components/
│   │   ├── Layout.tsx     # Main app layout with sidebar
│   │   ├── Card.tsx       # Reusable card components
│   │   └── ProtectedRoute.tsx  # Auth wrapper
│   ├── context/
│   │   └── AuthContext.tsx    # Cognito auth state
│   ├── pages/
│   │   ├── Dashboard.tsx
│   │   ├── Products.tsx
│   │   ├── ProductDetail.tsx
│   │   ├── Proposals.tsx
│   │   ├── Sales.tsx
│   │   ├── Insights.tsx
│   │   └── DeliveryCosts.tsx
│   └── types/
│       └── index.ts       # TypeScript interfaces
```

## Core Package

### Services

| Service | File | Purpose |
|---------|------|---------|
| DynamoDBService | `dynamodb.ts` | All database operations |
| ChannelEngineService | `channel-engine.ts` | ChannelEngine API integration |
| GoogleSheetsService | `google-sheets.ts` | Google Sheets integration |
| PricingEngine | `pricing-engine.ts` | Price calculation logic |
| CompetitorScraper | `competitor-scraper.ts` | Web scraping for competitor prices |

### Type Definitions

Key interfaces in `packages/core/src/types/`:

- `Product` - Product with all channel prices
- `PriceProposal` - Price change proposal
- `PricingRule` - Rule for automated pricing
- `Order` / `OrderLineRecord` - Order data
- `Channel` - Channel configuration
- `SkuHistoryRecord` - Price history tracking

## External Integrations

### ChannelEngine
- API Key stored in AWS Secrets Manager
- Endpoints: `/products`, `/orders`
- Provides: Product metadata, stock levels, orders

### Google Sheets
- Service account credentials in Secrets Manager
- Spreadsheet ID: `1aSLqRvCJLmHy5h4ELKrXaPU3GYq0YvqiGz3RlbVPWHg`
- Provides: Channel prices (columns F-J)
- Receives: Price updates when proposals are pushed

## Authentication

### Cognito Configuration
- User Pool ID: `eu-west-2_t4tJsxt3z`
- Client ID: `7c3s7gtdskn3nhpbivmsapgk74`
- Domain: `repricing-610274502245.auth.eu-west-2.amazoncognito.com`

### API Authorization
- All API endpoints require Cognito ID token
- Token passed in `Authorization` header
- 401 responses redirect to login page

## Deployment

### Commands
```bash
# Build all packages
npm run build

# Deploy to AWS
npm run deploy

# Sync frontend to S3
aws s3 sync packages/frontend/dist s3://repricing-frontend-610274502245 --delete

# Invalidate CloudFront cache
aws cloudfront create-invalidation --distribution-id E28VLOA0H027TB --paths "/*"
```

### URLs
- Frontend: https://dd0eswlutoz5b.cloudfront.net
- API: https://2uf6pmvya1.execute-api.eu-west-2.amazonaws.com/prod/

## Pricing Rules Engine

### Rule Types
1. **High Margin Low Sales** - Reduce price to boost volume
2. **Low Margin High Sales** - Increase price to improve margin
3. **Competitor Match** - Match or beat competitor prices
4. **Stock Clearance** - Aggressive pricing for old stock

### Rule Conditions
- `minMargin` / `maxMargin` - Margin percentage thresholds
- `minSales` / `maxSales` - Daily sales velocity thresholds
- `minStock` / `maxStock` - Stock level thresholds
- `brands` - Apply to specific brands
- `channels` - Apply to specific channels

### Proposal Flow
1. `price-calculator` Lambda runs daily
2. Evaluates each product against all active rules
3. Creates proposals with suggested prices
4. User reviews proposals (approve/reject/modify)
5. Approved proposals pushed to Google Sheets + ChannelEngine

## Data Flow

```
ChannelEngine ──┬──> data-sync Lambda ──> Products Table
                │
Google Sheets ──┘

ChannelEngine ──> order-sync Lambda ──> Order Lines Table

Products + Rules ──> price-calculator Lambda ──> Proposals Table

Approved Proposals ──> push Lambda ──> Google Sheets + ChannelEngine
```
