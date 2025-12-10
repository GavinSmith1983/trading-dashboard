# Trading Dashboard - Claude Instructions

> Project-specific instructions for Claude AI sessions.
> **Last Updated**: 2025-12-10

## Architecture Overview

The Trading Dashboard is a **multi-tenant V2 architecture** supporting multiple accounts. All DynamoDB tables use `accountId` as the partition key.

### Current Accounts
| Account ID | Name | Currency | Pricing Mode |
|------------|------|----------|--------------|
| `ku-bathrooms` | KU Bathrooms | GBP | Multi-channel |
| `valquest-usa` | Valquest USA | USD | Single |
| `ultra-clearance` | Ultra Clearance | GBP | Single |

### V2 Infrastructure
- **CDK Entry Point**: `infrastructure/bin/app-v2.ts`
- **Deploy Command**: `npx cdk deploy --app "npx ts-node bin/app-v2.ts" RepricingV2*`
- **Tables**: All prefixed with `repricing-v2-` (e.g., `repricing-v2-products`, `repricing-v2-accounts`)

### Frontend Deployment
- **S3 Bucket**: `repricing-v2-frontend-610274502245`
- **CloudFront Distribution**: `EO4ZPYXTKH81H` (`d1stq5bxiu9ds3.cloudfront.net`)
- **Build**: `cd packages/frontend && npm run build`
- **Deploy**: `aws s3 sync dist s3://repricing-v2-frontend-610274502245 --delete --region eu-west-2`
- **Invalidate**: `aws cloudfront create-invalidation --distribution-id EO4ZPYXTKH81H --paths "/*"`

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
- **Rate Limiting**: 50 requests/second (Akeneo allows 100/s)
- **Batch Size**: Max 4000 products per run
- **Retry Logic**: Exponential backoff on 429 responses
- **Single Account Mode**: Pass `{"accountId": "xxx"}` to sync only one account

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
- **Date Handling**: Frontend sends explicit `fromDate`/`toDate` for calendar-based ranges

### Charts
1. **Revenue/Units by Channel** - Stacked bar chart by day/week/month with clickable legend
2. **Revenue/Units by Family** - Same layout as channel chart, uses Akeneo Family data

### Channel Tabs UI
- Channels displayed in order: Amazon, B&Q, Shopify, ManoMano, eBay/OnBuy/Debs
- eBay, OnBuy, and Debenhams are collapsed into a single tab (shared pricing)
- The "All" tab shows average price across all channels

## User Management

### Cognito User Pools
- **V2 Pool**: `eu-west-2_XPGjaZEIp` (`repricing-v2-users`) - Used by Lambda API
- **V1 Pool**: `eu-west-2_t4tJsxt3z` (`repricing-users`) - Legacy

### User Roles
| Role | Permissions |
|------|-------------|
| `super-admin` | All access, cross-account management |
| `admin` | Account management, user settings |
| `editor` | Can modify data within allowed accounts |
| `viewer` | Read-only access to allowed accounts |

### User Operations
- **Create**: `POST /users` - Always sends welcome email with temp password
- **Enable**: `POST /users/{email}/enable` - Re-enables disabled user
- **Resend Invitation**: `POST /users/{email}/resend-invitation` - Sends new temp password email
- **Delete**: `DELETE /users/{email}` - Soft delete (disables user)

### Access Control
- Non-super-admin users can only access accounts listed in `custom:allowedAccounts` JWT claim
- Frontend fetches allowed accounts from `/accounts` API (safe view, no API keys)
- Admin routes protected with `<ProtectedRoute requiredRole="admin">`

## Admin Section (Super-Admin Only)

Navigation items under Administration:
- **Accounts** (`/admin/accounts`) - Manage tenant accounts
- **Users** (`/admin/users`) - User management
- **Delivery Costs** (`/admin/delivery-costs`) - Cross-account carrier management

## Delivery Costs

- **Admin Page**: `/admin/delivery-costs` - Cross-account management with account selector
- **API Methods**: `carriersApi.listForAccount()`, `createForAccount()`, `updateForAccount()`, `deleteForAccount()`, `recalculateForAccount()`
- **Recalculate**: `POST /carriers/recalculate` - Calculates delivery cost per SKU from order data

## Key Technical Notes

### V2 Tables (Multi-tenant)
- `repricing-v2-accounts` - Account configuration
- `repricing-v2-products` - PK: accountId, SK: sku
- `repricing-v2-rules` - Pricing rules
- `repricing-v2-proposals` - Price proposals
- `repricing-v2-orders` - Orders
- `repricing-v2-order-lines` - Denormalized order lines for fast sales queries
- `repricing-v2-carriers` - Carrier/delivery cost configuration

### Lambda Functions
| Function | Schedule | Purpose |
|----------|----------|---------|
| `repricing-v2-data-sync` | Daily 5am UTC | Sync products from ChannelEngine + Google Sheets |
| `repricing-v2-order-sync` | Hourly | Sync orders from ChannelEngine (last 24h only) |
| `repricing-v2-akeneo-sync` | Every 15 mins | Sync Family data from Akeneo PIM |
| `repricing-v2-competitor-scrape` | Daily 4am UTC | Scrape competitor prices |
| `repricing-v2-price-calculator` | Weekly Monday 7am | Calculate price proposals |
| `repricing-v2-api` | On demand | REST API handler |

### Environment Variables (Lambdas)
- `AKENEO_SECRET_ARN` - Akeneo credentials secret
- `GOOGLE_SHEETS_SECRET_ARN` - Google Sheets credentials
- `MULTI_TENANT=true` - Enable multi-tenant mode
- `USER_POOL_ID` - Cognito User Pool ID
- `ACCOUNTS_TABLE`, `PRODUCTS_TABLE`, etc. - DynamoDB table names

## API Endpoints

### Analytics
- `GET /analytics/summary` - Dashboard metrics (totalProducts, productsWithCosts, outOfStock, lowStock, avgMargin)
- `GET /analytics/sales` - Sales data with `fromDate`, `toDate`, `days`, `groupBy` params

### Products
- `GET /products` - List products with pagination
- `GET /products/{sku}` - Get single product
- `PUT /products/{sku}` - Update product

### Prices
- `GET /prices/recent?limit=N` - Recent price changes across all SKUs
- `GET /prices/history/{sku}?limit=N` - Price history for single SKU
- `PUT /prices/{sku}` - Update channel price

### Import
- `POST /import/costs` - Import cost prices from CSV
- `POST /import/delivery` - Import delivery costs from CSV

### Carriers
- `GET /carriers` - List carriers for current account
- `POST /carriers` - Create carrier
- `PUT /carriers/{id}` - Update carrier
- `DELETE /carriers/{id}` - Delete carrier
- `POST /carriers/recalculate` - Recalculate delivery costs from orders

## Common Commands

### TypeScript Check
```bash
cd C:/projects/Trading-Dashboard && npx tsc --noEmit -p packages/lambdas/tsconfig.json
```

### Deploy Lambda Stack
```bash
cd C:/projects/Trading-Dashboard/infrastructure && npx cdk deploy --app "npx ts-node bin/app-v2.ts" RepricingV2LambdaStack --require-approval never
```

### Deploy Auth Stack
```bash
cd C:/projects/Trading-Dashboard/infrastructure && npx cdk deploy --app "npx ts-node bin/app-v2.ts" RepricingV2AuthStack --require-approval never
```

### Build & Deploy Frontend
```bash
cd C:/projects/Trading-Dashboard/packages/frontend && npm run build
aws s3 sync dist s3://repricing-v2-frontend-610274502245 --delete --region eu-west-2
aws cloudfront create-invalidation --distribution-id EO4ZPYXTKH81H --paths "/*"
```

### Trigger Data Sync (Single Account)
```bash
aws lambda invoke --function-name repricing-v2-data-sync --region eu-west-2 --invocation-type Event --cli-binary-format raw-in-base64-out --payload '{"accountId":"ku-bathrooms"}' output.json
```

### Trigger Akeneo Sync (Single Account)
```bash
aws lambda invoke --function-name repricing-v2-akeneo-sync --region eu-west-2 --invocation-type Event --cli-binary-format raw-in-base64-out --payload '{"accountId":"ku-bathrooms"}' output.json
```

### Test API via Lambda Invoke
```bash
aws lambda invoke --function-name repricing-v2-api --region eu-west-2 --cli-binary-format raw-in-base64-out --payload '{"httpMethod":"GET","path":"/accounts","queryStringParameters":{},"headers":{},"requestContext":{"authorizer":{"claims":{"sub":"test","email":"test@test.com","cognito:groups":"super-admin"}}}}' response.json && cat response.json
```

## Important Notes

### Order Sync Lambda
**DO NOT MODIFY** `repricing-v2-order-sync` - it ignores all event parameters and always syncs the last 24 hours. For historical backfill, create a temporary Lambda script.

### Historical Order Backfill
When needing to backfill historical orders for a new tenant:
1. Create temporary Lambda using `@repricing/core` services
2. Deploy via temporary CDK stack with 15-min timeout
3. Invoke to fetch from ChannelEngine and write to tables
4. Destroy stack after completion

### File Editing Issues
- Frontend dev server may cause "File has been unexpectedly modified" errors
- For complex edits, use the Task tool to delegate to a subagent
- Avoid bash heredocs for JSX files with template literals

### CloudWatch Logs (Windows)
AWS CLI has emoji encoding issues on Windows. Use Node.js SDK script at `C:/projects/Trading-Dashboard/get-logs.js` instead.

## Rollback Points

Git save points for easy rollback if needed:

| Commit | Date | Description |
|--------|------|-------------|
| `384f65f` | 2025-12-10 | Admin Delivery Costs, Price History fix, Documentation |
| `fae9963` | 2025-12-10 | User management, Akeneo multi-account sync, UI improvements |
| `8398597` | 2025-12-10 | Akeneo PIM integration and Sales by Family chart |
| `c6b6c73` | 2025-12-09 | V2 Multi-Tenant Architecture Complete |
| `72d2e1d` | 2025-12-09 | Complete Trading Dashboard with all features |

### How to Rollback
```bash
# Rollback code only (keeps working directory changes)
git reset --soft <commit>

# Full rollback (discards all changes)
git reset --hard <commit>

# After rollback, redeploy:
cd packages/frontend && npm run build
aws s3 sync dist s3://repricing-v2-frontend-610274502245 --delete --region eu-west-2
aws cloudfront create-invalidation --distribution-id EO4ZPYXTKH81H --paths "/*"

# For Lambda changes, redeploy infrastructure:
cd infrastructure && npx cdk deploy --app "npx ts-node bin/app-v2.ts" RepricingV2LambdaStack --require-approval never
```
