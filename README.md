# Repricing Dashboard

Automated repricing system for bathroom products sold across multiple sales channels (Amazon, eBay, B&Q, ManoMano, Shopify, OnBuy, Debenhams).

## V2 Multi-Tenant System (Current)

The V2 system supports multiple accounts (KU Bathrooms, Valquest, Clearance) with full data isolation.

### V2 URLs
- **Frontend:** https://d1stq5bxiu9ds3.cloudfront.net
- **API:** https://lvsj0zgfz2.execute-api.eu-west-2.amazonaws.com/prod/

### V2 Features
- Multi-account support with account switcher
- Super-admin role for managing accounts and users
- Per-account data isolation (products, orders, proposals)
- Daily revenue impact on stock insights

## V1 Legacy System

The original single-tenant system is still operational for reference.

### V1 URLs
- **Frontend:** https://dd0eswlutoz5b.cloudfront.net
- **API:** https://2uf6pmvya1.execute-api.eu-west-2.amazonaws.com/prod/

### V2 Integrations
- **ChannelEngine:** Product catalog, stock levels, orders, and pricing
- **Google Sheets:** Channel-specific pricing (Columns F-J mapped to channels)
- **Akeneo PIM:** Product family/categorisation (with 7-day caching)

## Project Structure

```
Trading-Dashboard/
├── infrastructure/           # AWS CDK infrastructure
│   ├── bin/
│   │   ├── app.ts           # V1 entry point
│   │   └── app-v2.ts        # V2 entry point
│   └── lib/
│       ├── *.ts             # V1 stacks
│       └── v2/              # V2 stacks
├── packages/
│   ├── core/                # Shared types, services & business logic
│   │   └── src/services/
│   │       ├── dynamodb.ts      # V1 DynamoDB service
│   │       ├── dynamodb-v2.ts   # V2 multi-tenant service
│   │       └── akeneo.ts        # Akeneo PIM integration
│   ├── frontend/            # React dashboard UI
│   │   └── src/
│   │       ├── context/
│   │       │   └── AccountContext.tsx  # Multi-account state
│   │       └── components/
│   │           └── AccountSwitcher.tsx # Account dropdown
│   └── lambdas/
│       ├── api/             # V1 API handler
│       ├── api-v2/          # V2 API handler (multi-tenant)
│       ├── data-sync/       # V1 ChannelEngine sync
│       ├── data-sync-v2/    # V2 sync (per-account)
│       ├── order-sync/      # V1 order sync
│       ├── order-sync-v2/   # V2 order sync (per-account)
│       ├── akeneo-sync/     # Akeneo PIM background sync
│       ├── price-calculator/  # Pricing proposal generation
│       └── competitor-scrape/ # Competitor price monitoring
└── scripts/
    └── backfill-orders-v2.ts  # Order backfill utility
```

## Prerequisites

- Node.js 18+
- AWS CLI configured with appropriate credentials
- AWS CDK CLI (`npm install -g aws-cdk`)

## Quick Start

```bash
# Install all dependencies (monorepo workspaces)
npm install

# Build core package (required before lambdas)
cd packages/core && npm run build && cd ../..

# Start frontend development server
cd packages/frontend && npm run dev
```

## Deployment

### V2 Deployment (Recommended)

```bash
# Deploy all V2 AWS infrastructure
cd infrastructure
npx cdk deploy RepricingV2* --app "npx ts-node bin/app-v2.ts" --require-approval never

# Build and deploy frontend
cd packages/frontend && npm run build
aws s3 sync dist/ s3://repricing-v2-frontend-610274502245 --delete
aws cloudfront create-invalidation --distribution-id EO4ZPYXTKH81H --paths "/*"
```

### V1 Deployment (Legacy)

```bash
# Deploy V1 infrastructure
cd infrastructure && npx cdk deploy --all

# Deploy V1 frontend
cd packages/frontend && npm run build
aws s3 sync dist/ s3://repricing-frontend-610274502245 --delete
aws cloudfront create-invalidation --distribution-id E28VLOA0H027TB --paths "/*"
```

## AWS Infrastructure

### V2 Stacks
| Stack | Resources |
|-------|-----------|
| RepricingV2DatabaseStack | DynamoDB tables with accountId partition keys |
| RepricingV2LambdaStack | Lambda functions (per-account processing) |
| RepricingV2ApiStack | API Gateway REST API |
| RepricingV2FrontendStack | S3 bucket + CloudFront distribution |
| RepricingV2AuthStack | Cognito User Pool with super-admin group |

### V1 Stacks (Legacy)
| Stack | Resources |
|-------|-----------|
| RepricingDatabaseStack | DynamoDB tables (single-tenant) |
| RepricingLambdaStack | Lambda functions + EventBridge schedules |
| RepricingApiStack | API Gateway REST API |
| RepricingFrontendStack | S3 bucket + CloudFront distribution |
| RepricingAuthStack | Cognito User Pool + groups |

## Lambda Schedules

### V2 Lambdas
| Lambda | Schedule | Purpose |
|--------|----------|---------|
| data-sync-v2 | Daily 5am UTC | Sync products from ChannelEngine + Google Sheets |
| order-sync-v2 | Daily 6am UTC | Sync orders from ChannelEngine |
| akeneo-sync | Every 15 mins | Sync product families from Akeneo PIM |
| price-calculator | Monday 7am UTC | Generate weekly price proposals |
| competitor-scraper | Daily 4am UTC | Scrape competitor prices |

### V1 Lambdas (Legacy)
| Lambda | Schedule | Purpose |
|--------|----------|---------|
| data-sync | Daily 5am UTC | Sync products from ChannelEngine + Google Sheets |
| order-sync | Daily 6am UTC | Sync orders from ChannelEngine |
| price-calculator | Monday 7am UTC | Generate weekly price proposals |
| competitor-scraper | Daily 4am UTC | Scrape competitor prices |

## V2 Accounts

| Account | Status | Description |
|---------|--------|-------------|
| ku-bathrooms | Active | Primary account (~6,200 SKUs) |
| valquest | Active | Secondary account |
| clearance | Pending | Awaiting ChannelEngine credentials |

## Environment Variables

Lambda functions require these secrets in AWS Secrets Manager:
- `repricing/channelengine` - ChannelEngine API credentials
- `repricing/google-sheets` - Google Sheets service account + spreadsheet ID
- `repricing/akeneo` - Akeneo PIM credentials (clientId, clientSecret, username, password, baseUrl per account)

V2 accounts store credentials in the accounts DynamoDB table.

## Akeneo PIM Integration

The system integrates with Akeneo PIM to fetch product family/categorisation data:

- **Background Sync:** Runs every 15 minutes via EventBridge
- **Smart Sync:** Only syncs products with no family OR data older than 7 days
- **Rate Limiting:** 10 requests/second with exponential backoff on 429 responses
- **Token Caching:** OAuth2 tokens cached for 1 hour to minimize auth requests
- **Batch Processing:** Max 500 products per run, respects Lambda timeout

## Documentation

- [PROJECT_BRIEF.md](./PROJECT_BRIEF.md) - Business requirements, API docs, architecture
- [PLAN-V2-MULTITENANCY.md](./PLAN-V2-MULTITENANCY.md) - V2 implementation plan and status
- [CLAUDE.md](./CLAUDE.md) - AI assistant configuration and Google Sheets mapping

---

*Last updated: 9th December 2025*
