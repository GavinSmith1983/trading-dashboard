# Claude AI Instructions

> Quick reference for Claude AI sessions. See README.md for full documentation.

## Quick Commands

### TypeScript Check
```bash
npx tsc --noEmit -p packages/lambdas/tsconfig.json
```

### Deploy Lambda Stack
```bash
cd infrastructure && npx cdk deploy --app "npx ts-node bin/app-v2.ts" RepricingV2LambdaStack --require-approval never
```

### Deploy Frontend
```bash
cd packages/frontend && npm run build
aws s3 sync dist s3://repricing-v2-frontend-610274502245 --delete --region eu-west-2
aws cloudfront create-invalidation --distribution-id EO4ZPYXTKH81H --paths "/*"
```

### Test API via Lambda
```bash
aws lambda invoke --function-name repricing-v2-api --region eu-west-2 --cli-binary-format raw-in-base64-out --payload '{"httpMethod":"GET","path":"/accounts","queryStringParameters":{},"headers":{},"requestContext":{"authorizer":{"claims":{"sub":"test","email":"test@test.com","cognito:groups":"super-admin"}}}}' response.json && cat response.json
```

### Trigger Sync (Single Account)
```bash
aws lambda invoke --function-name repricing-v2-data-sync --region eu-west-2 --invocation-type Event --cli-binary-format raw-in-base64-out --payload '{"accountId":"ku-bathrooms"}' output.json
```

---

## Project Structure

```
Trading-Dashboard/
├── infrastructure/          # AWS CDK
│   └── lib/v2/             # V2 stacks (use app-v2.ts)
├── packages/
│   ├── core/               # Shared types & services
│   │   └── src/services/
│   │       └── dynamodb-v2.ts  # Multi-tenant DB service
│   ├── frontend/           # React app
│   │   └── src/
│   │       ├── api/        # Split by domain (products, proposals, etc.)
│   │       ├── components/ # Reusable UI (Modal, Card, Table, etc.)
│   │       ├── hooks/      # useDateRange, usePagination
│   │       ├── utils/      # format, dates, calculations, channels
│   │       └── pages/      # Route components
│   └── lambdas/
│       └── api-v2/         # REST API handler
```

---

## Key Technical Details

### Multi-Tenant Architecture
- All tables use `accountId` as partition key
- Account extracted from JWT `custom:allowedAccounts` claim
- Tables prefixed with `repricing-v2-`

### Current Accounts
- `ku-bathrooms` (GBP)
- `valquest-usa` (USD)
- `ultra-clearance` (GBP)

### Data Sources
| Data | Source |
|------|--------|
| Products, Orders, Stock | ChannelEngine |
| Channel Prices | Google Sheets (Columns F-J) |
| Product Family | Akeneo PIM |

### Google Sheets Columns
- **Column C**: Balterley SKU (primary key)
- **Columns F-J**: B&Q, Amazon, eBay, ManoMano, Shopify prices
- eBay pricing also applies to OnBuy and Debenhams

---

## AWS Resources

| Resource | ID/Name |
|----------|---------|
| API Gateway | lvsj0zgfz2 |
| Cognito User Pool | eu-west-2_XPGjaZEIp |
| S3 Frontend | repricing-v2-frontend-610274502245 |
| CloudFront | EO4ZPYXTKH81H |
| Region | eu-west-2 |

---

## Common Gotchas

### File Editing Issues
Frontend dev server may cause "File has been unexpectedly modified" errors. For complex edits, use Task tool to delegate to a subagent.

### Order Sync Lambda
**DO NOT MODIFY** `repricing-v2-order-sync` - it ignores event parameters and always syncs last 24 hours. For backfill, create temporary Lambda.

### React Query Pattern
```typescript
const { accountId } = useAccountQuery();
const hasAccount = accountId !== 'no-account';

const { data } = useQuery({
  queryKey: ['products', accountId],
  queryFn: () => productsApi.list(),
  enabled: hasAccount,  // Prevents duplicate requests
});
```

### CloudWatch Logs (Windows)
AWS CLI has emoji encoding issues. Use Node.js SDK script at `get-logs.js` instead.

### API Compression Fix (Git Bash)
```bash
MSYS_NO_PATHCONV=1 aws apigateway update-rest-api --rest-api-id lvsj0zgfz2 --region eu-west-2 --patch-operations "op=replace,path=/minimumCompressionSize,value=1000"
MSYS_NO_PATHCONV=1 aws apigateway create-deployment --rest-api-id lvsj0zgfz2 --stage-name prod --region eu-west-2
```

---

## Security Config (2025-12-15)

### CORS Origins
- `https://d1stq5bxiu9ds3.cloudfront.net`
- `http://localhost:5173`
- `http://localhost:3000`

### Rate Limits
- 10 req/sec, 20 burst

### Cognito Env Vars
Frontend requires `.env`:
```
VITE_COGNITO_USER_POOL_ID=eu-west-2_XPGjaZEIp
VITE_COGNITO_CLIENT_ID=<client-id>
```

---

## Rollback Points

| Commit | Description |
|--------|-------------|
| `backup-pre-refactor-2025-12-15` | Tag before frontend restructure |
| `0da1373` | Security and efficiency improvements |
| `0c50daf` | Performance fix (55s to 5s) |

```bash
git reset --hard <commit>
cd packages/frontend && npm run build
aws s3 sync dist s3://repricing-v2-frontend-610274502245 --delete --region eu-west-2
aws cloudfront create-invalidation --distribution-id EO4ZPYXTKH81H --paths "/*"
```
