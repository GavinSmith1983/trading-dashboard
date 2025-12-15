# V2 Multi-Tenant Architecture Implementation Plan

## Overview

This plan details the implementation of a parallel V2 infrastructure for the Trading Dashboard that supports multiple accounts (KU Bathrooms, Clearance, Valquest). The V2 system runs alongside V1, allowing users to continue using the current production system during the transition.

## Current Status (December 2025)

### Completed Phases

#### Phase 1: Infrastructure (COMPLETE)
- [x] V2 CDK entry point (`infrastructure/bin/app-v2.ts`)
- [x] V2 Database Stack with all tables (accountId partition keys)
- [x] V2 Auth Stack with Cognito user pool and groups
- [x] V2 Lambda Stack with all Lambda functions
- [x] V2 API Stack with API Gateway
- [x] V2 Frontend Stack with S3/CloudFront

#### Phase 2: Core Services (COMPLETE)
- [x] `dynamodb-v2.ts` - Multi-tenant DynamoDB service
- [x] Account context extraction from JWT
- [x] All queries scoped by accountId

#### Phase 3: API Updates (COMPLETE)
- [x] Account context middleware
- [x] All endpoints filter by accountId from X-Account-Id header
- [x] `/accounts` endpoints for super-admin account management
- [x] `/users` endpoints for super-admin user management
- [x] `/analytics/insights` endpoint with daily revenue impact

#### Phase 4: Frontend Updates (COMPLETE)
- [x] `AccountContext.tsx` - Account state management
- [x] `AccountSwitcher.tsx` - Dropdown to switch accounts
- [x] API client adds X-Account-Id header to all requests
- [x] `useAccountQuery` hook for React Query cache invalidation
- [x] Admin pages: `Accounts.tsx`, `Users.tsx`
- [x] All pages updated to include accountId in query keys
- [x] "This Month" and "Last Month" time range options on charts

#### Phase 5: Data Migration (COMPLETE)
- [x] KU Bathrooms data migrated to V2
- [x] Valquest orders backfilled (May 2025 onwards - 382 orders)
- [x] Users migrated to V2 Cognito with super-admin group

#### Phase 6: Account Setup (PARTIAL)
- [x] KU Bathrooms account configured and operational
- [x] Valquest account configured and operational
- [ ] Clearance account - needs ChannelEngine credentials

### Recent Fixes (This Session)
- Fixed order-sync Lambda to use tenant-specific ChannelEngine URLs
- Fixed React Query cache not invalidating on account switch
- Added `/analytics/insights` endpoint to V2 API
- Added `dailyRevenueImpact` to stock insights (Danger Stock, OOS)

---

## V2 Live URLs

- **Frontend:** https://d1stq5bxiu9ds3.cloudfront.net
- **API:** https://lvsj0zgfz2.execute-api.eu-west-2.amazonaws.com/prod/

## V1 Live URLs (Still Active)

- **Frontend:** https://dd0eswlutoz5b.cloudfront.net
- **API:** https://2uf6pmvya1.execute-api.eu-west-2.amazonaws.com/prod/

---

## V2 AWS Resources

### CloudFormation Stacks
| Stack | Status | Description |
|-------|--------|-------------|
| RepricingV2AuthStack | Deployed | Cognito user pool, groups |
| RepricingV2DatabaseStack | Deployed | All DynamoDB tables |
| RepricingV2LambdaStack | Deployed | Lambda functions |
| RepricingV2ApiStack | Deployed | API Gateway |
| RepricingV2FrontendStack | Deployed | S3, CloudFront |

### DynamoDB Tables
| Table | Partition Key | Sort Key |
|-------|---------------|----------|
| repricing-v2-accounts | accountId | - |
| repricing-v2-products | accountId | sku |
| repricing-v2-rules | accountId | ruleId |
| repricing-v2-proposals | accountId | proposalId |
| repricing-v2-channels | accountId | channelId |
| repricing-v2-orders | accountId | orderId |
| repricing-v2-order-lines | accountId | skuOrderDate |
| repricing-v2-carrier-costs | accountId | carrierId |
| repricing-v2-sku-history | accountId | skuDate |

### Lambda Functions
| Function | Schedule | Purpose |
|----------|----------|---------|
| repricing-v2-api | On-demand | REST API handler |
| repricing-v2-data-sync | Daily 5am UTC | Sync products from ChannelEngine |
| repricing-v2-order-sync | Daily 6am UTC | Sync orders from ChannelEngine |
| repricing-v2-price-calculator | Monday 7am UTC | Generate price proposals |
| repricing-v2-competitor-scrape | Daily 4am UTC | Scrape competitor prices |

### Cognito User Pool
- **Pool ID:** eu-west-2_XPGjaZEIp
- **Client ID:** 2p3tp0imhrmlh6qfn06pdhebok
- **Domain:** repricing-v2-610274502245.auth.eu-west-2.amazoncognito.com

### User Groups
- `super-admin` - Full access to all accounts and admin functions
- `admin` - Account-level admin
- `editor` - Can edit products/proposals
- `viewer` - Read-only access

---

## Accounts Configured

### KU Bathrooms
- **Account ID:** `ku-bathrooms`
- **Status:** Active
- **ChannelEngine Tenant:** ku-bathrooms
- **Products:** ~6,200 SKUs
- **Orders:** Full history migrated

### Valquest
- **Account ID:** `valquest`
- **Status:** Active
- **ChannelEngine Tenant:** valquest
- **Products:** Synced from ChannelEngine
- **Orders:** Backfilled from May 2025 (382 orders)

### Clearance
- **Account ID:** `clearance`
- **Status:** Pending
- **Requires:** ChannelEngine API credentials

---

## Deployment Commands

### Deploy V2 Infrastructure
```bash
cd infrastructure
npx cdk deploy RepricingV2* --app "npx ts-node bin/app-v2.ts" --require-approval never
```

### Deploy Frontend
```bash
cd packages/frontend
npm run build
aws s3 sync dist/ s3://repricing-v2-frontend-610274502245 --delete
aws cloudfront create-invalidation --distribution-id EO4ZPYXTKH81H --paths "/*"
```

### Run Order Sync Manually
```bash
aws lambda invoke --function-name repricing-v2-order-sync \
  --payload '{"accountId":"ku-bathrooms"}' response.json
```

### Backfill Orders (Script)
```bash
npx ts-node scripts/backfill-orders-v2.ts
```

---

## Remaining Work

### High Priority
1. **Clearance Account Setup**
   - Obtain ChannelEngine API credentials
   - Create account in accounts table
   - Run initial data sync

2. **Data Sync Testing**
   - Verify daily syncs running for all accounts
   - Monitor CloudWatch logs for errors

### Medium Priority
3. **Google Sheets Integration**
   - Per-account spreadsheet configuration
   - Price write-back per account

4. **V1 Deprecation Plan**
   - Set date for V1 shutdown
   - Migrate any remaining users
   - Archive V1 data

### Low Priority
5. **Performance Optimization**
   - Monitor Lambda cold starts
   - Optimize batch queries

6. **Additional Features**
   - Per-account pricing rules
   - Account-level reporting

---

## File Structure (V2)

```
infrastructure/
├── bin/
│   ├── app.ts              # V1 entry point
│   └── app-v2.ts           # V2 entry point
└── lib/
    └── v2/
        ├── auth-stack.ts
        ├── database-stack.ts
        ├── lambda-stack.ts
        ├── api-stack.ts
        └── frontend-stack.ts

packages/
├── core/src/
│   ├── services/
│   │   └── dynamodb-v2.ts  # Multi-tenant DB service
│   └── types/
│       └── account.ts      # Account types
├── frontend/src/
│   ├── context/
│   │   ├── AuthContext.tsx
│   │   └── AccountContext.tsx
│   ├── components/
│   │   └── AccountSwitcher.tsx
│   ├── hooks/
│   │   └── useAccountQuery.ts
│   └── pages/
│       └── admin/
│           ├── Accounts.tsx
│           └── Users.tsx
└── lambdas/
    ├── api-v2/src/
    │   ├── index.ts
    │   ├── account-context.ts
    │   └── user-management.ts
    ├── data-sync-v2/src/
    │   └── index.ts
    └── order-sync-v2/src/
        └── index.ts

scripts/
└── backfill-orders-v2.ts   # Order backfill utility
```

---

## Success Criteria

- [x] KU Bathrooms account operational
- [x] Valquest account operational
- [ ] Clearance account operational
- [x] Users can switch between allowed accounts
- [x] Super admins can manage all accounts
- [x] Data fully isolated between accounts
- [x] Sync jobs run per account with correct tenant URLs
- [x] Admin UI functional for account/user management
- [x] Insights page with daily revenue impact
- [ ] All users transitioned to V2
- [ ] V1 decommissioned

---

*Last updated: 9th December 2025*
