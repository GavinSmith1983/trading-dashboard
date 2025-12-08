# Repricing Dashboard

Automated repricing system for bathroom products sold across multiple sales channels (Amazon, eBay, B&Q, ManoMano, Shopify, OnBuy, Debenhams).

## Project Structure

```
Trading-Dashboard/
├── infrastructure/          # AWS CDK infrastructure (5 stacks)
├── packages/
│   ├── core/               # Shared types, services & business logic
│   ├── frontend/           # React dashboard UI
│   └── lambdas/            # Lambda functions
│       ├── api/            # REST API handler
│       ├── data-sync/      # ChannelEngine + Google Sheets sync
│       ├── order-sync/     # Order data synchronization
│       ├── price-calculator/ # Pricing proposal generation
│       └── competitor-scrape/ # Competitor price monitoring
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

```bash
# Deploy all AWS infrastructure
cd infrastructure && npx cdk deploy --all

# Deploy frontend to S3/CloudFront
cd packages/frontend && npm run build
aws s3 sync dist/ s3://repricing-frontend-<account-id> --delete
aws cloudfront create-invalidation --distribution-id <dist-id> --paths "/*"
```

## AWS Infrastructure

| Stack | Resources |
|-------|-----------|
| RepricingDatabaseStack | DynamoDB tables (products, orders, order-lines, proposals, rules, channels, sku-history) |
| RepricingLambdaStack | Lambda functions + EventBridge schedules |
| RepricingApiStack | API Gateway REST API |
| RepricingFrontendStack | S3 bucket + CloudFront distribution |
| RepricingAuthStack | Cognito User Pool + groups |

## Lambda Schedules

| Lambda | Schedule | Purpose |
|--------|----------|---------|
| data-sync | Daily 5am UTC | Sync products from ChannelEngine + Google Sheets |
| order-sync | Daily 6am UTC | Sync orders from ChannelEngine |
| price-calculator | Monday 7am UTC | Generate weekly price proposals |
| competitor-scraper | Daily 4am UTC | Scrape competitor prices |

## Environment Variables

Lambda functions require these secrets in AWS Secrets Manager:
- `repricing/channelengine` - ChannelEngine API credentials
- `repricing/google-sheets` - Google Sheets service account + spreadsheet ID

## Documentation

See [PROJECT_BRIEF.md](./PROJECT_BRIEF.md) for detailed business requirements, API documentation, and architecture overview.

See [CLAUDE.md](./CLAUDE.md) for AI assistant configuration and Google Sheets column mapping.
