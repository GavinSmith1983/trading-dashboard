# Deployment Guide

> Save Point: December 8, 2025

## Prerequisites

- Node.js 20.x
- AWS CLI configured with appropriate credentials
- CDK CLI installed (`npm install -g aws-cdk`)

## Quick Deploy

```bash
# From project root
npm install
npm run build
npm run deploy

# Deploy frontend to S3
aws s3 sync packages/frontend/dist s3://repricing-frontend-610274502245 --delete

# Invalidate CloudFront cache
aws cloudfront create-invalidation --distribution-id E28VLOA0H027TB --paths "/*"
```

## Step-by-Step Deployment

### 1. Install Dependencies

```bash
cd Trading-Dashboard
npm install
```

### 2. Build All Packages

```bash
npm run build
```

This builds:
- `infrastructure/` - CDK TypeScript
- `packages/core/` - Shared business logic
- `packages/frontend/` - React app
- `packages/lambdas/` - Lambda functions

### 3. Deploy Infrastructure

```bash
npm run deploy
```

This deploys all CDK stacks in order:
1. RepricingAuthStack (Cognito)
2. RepricingDatabaseStack (DynamoDB)
3. RepricingLambdaStack (Lambdas)
4. RepricingApiStack (API Gateway)
5. RepricingFrontendStack (S3 + CloudFront)

### 4. Upload Frontend

CDK doesn't automatically upload frontend files. After deploy:

```bash
aws s3 sync packages/frontend/dist s3://repricing-frontend-610274502245 --delete
```

### 5. Invalidate Cache

CloudFront caches files. Force refresh:

```bash
aws cloudfront create-invalidation --distribution-id E28VLOA0H027TB --paths "/*"
```

Wait 1-2 minutes for propagation.

## Deploying Individual Stacks

```bash
cd infrastructure

# Deploy specific stack
npx cdk deploy RepricingLambdaStack

# Deploy with approval prompt skipped
npx cdk deploy --all --require-approval never
```

## Environment Variables

Lambda functions use these environment variables (set by CDK):

| Variable | Value |
|----------|-------|
| PRODUCTS_TABLE | repricing-products |
| RULES_TABLE | repricing-rules |
| PROPOSALS_TABLE | repricing-proposals |
| CHANNELS_TABLE | repricing-channels |
| ORDERS_TABLE | repricing-orders |
| ORDER_LINES_TABLE | repricing-order-lines |
| CARRIER_COSTS_TABLE | repricing-carrier-costs |
| CHANNELENGINE_SECRET_ARN | (from Secrets Manager) |
| GOOGLE_SHEETS_SECRET_ARN | (from Secrets Manager) |
| SPREADSHEET_ID | 1aSLqRvCJLmHy5h4ELKrXaPU3GYq0YvqiGz3RlbVPWHg |

## Frontend Environment

Create `.env` in `packages/frontend/` for local development:

```env
VITE_API_URL=https://2uf6pmvya1.execute-api.eu-west-2.amazonaws.com/prod
VITE_COGNITO_USER_POOL_ID=eu-west-2_t4tJsxt3z
VITE_COGNITO_CLIENT_ID=7c3s7gtdskn3nhpbivmsapgk74
```

For production, these are hardcoded in `api/client.ts`.

## Rollback Procedures

### Rollback to Previous Git Tag

```bash
git checkout savepoint-2025-12-08
npm run build
npm run deploy
aws s3 sync packages/frontend/dist s3://repricing-frontend-610274502245 --delete
aws cloudfront create-invalidation --distribution-id E28VLOA0H027TB --paths "/*"
```

### Rollback Lambda Only

```bash
# Get previous version
aws lambda list-versions-by-function --function-name repricing-api

# Rollback to specific version
aws lambda update-alias --function-name repricing-api --name prod --function-version 5
```

### Rollback CloudFormation Stack

```bash
# List stack events to find last successful state
aws cloudformation describe-stack-events --stack-name RepricingLambdaStack

# Rollback (requires manual intervention in AWS Console for complex failures)
```

## Testing Deployment

### Verify API

```bash
# Should return 401 (auth required)
curl https://2uf6pmvya1.execute-api.eu-west-2.amazonaws.com/prod/products

# With auth token
curl -H "Authorization: <id-token>" https://2uf6pmvya1.execute-api.eu-west-2.amazonaws.com/prod/products
```

### Verify Frontend

Visit https://dd0eswlutoz5b.cloudfront.net and check browser console for errors.

### Verify Lambdas

```bash
# Check recent logs
aws logs tail "/aws/lambda/repricing-api" --since 5m

# Invoke manually
aws lambda invoke --function-name repricing-data-sync --payload '{}' output.json
cat output.json
```

## Troubleshooting

### "No changes" but code not updated

CDK doesn't detect S3 content changes. Always run:
```bash
aws s3 sync packages/frontend/dist s3://repricing-frontend-610274502245 --delete
```

### Lambda not updated

CDK uses content hash. Rebuild and redeploy:
```bash
npm run build
npm run deploy
```

### CloudFront showing old content

Invalidate cache:
```bash
aws cloudfront create-invalidation --distribution-id E28VLOA0H027TB --paths "/*"
```

### CORS errors

Check API Gateway CORS settings in `infrastructure/lib/api-stack.ts`.

### 401 Unauthorized

- Check Cognito token is valid
- Check token not expired
- Verify API Gateway authorizer configuration
