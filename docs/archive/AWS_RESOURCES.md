# AWS Resources Reference

> Save Point: December 8, 2025

## Account Information
- AWS Account ID: `610274502245`
- Region: `eu-west-2` (London)

## CloudFormation Stacks

### RepricingAuthStack
- Stack ARN: `arn:aws:cloudformation:eu-west-2:610274502245:stack/RepricingAuthStack/a18632a0-cfa7-11f0-ac95-02969230e6cb`

**Outputs:**
| Key | Value |
|-----|-------|
| CognitoRegion | eu-west-2 |
| UserPoolId | eu-west-2_t4tJsxt3z |
| UserPoolClientId | 7c3s7gtdskn3nhpbivmsapgk74 |
| UserPoolDomain | repricing-610274502245.auth.eu-west-2.amazoncognito.com |

### RepricingDatabaseStack
- Stack ARN: `arn:aws:cloudformation:eu-west-2:610274502245:stack/RepricingDatabaseStack/968ba8f0-ceab-11f0-bb6a-0a2005364813`

**Outputs:**
| Key | Value |
|-----|-------|
| ProductsTableName | repricing-products |
| PricingRulesTableName | repricing-rules |
| PriceProposalsTableName | repricing-proposals |
| ChannelConfigTableName | repricing-channels |
| OrdersTableName | repricing-orders |
| OrderLinesTableName | repricing-order-lines |

### RepricingLambdaStack
- Stack ARN: `arn:aws:cloudformation:eu-west-2:610274502245:stack/RepricingLambdaStack/b0aa36c0-ceab-11f0-ba7d-0a9cabfcb7b1`

**Outputs:**
| Key | Value |
|-----|-------|
| DataSyncFunctionArn | arn:aws:lambda:eu-west-2:610274502245:function:repricing-data-sync |
| PriceCalculatorFunctionArn | arn:aws:lambda:eu-west-2:610274502245:function:repricing-price-calculator |
| ApiFunctionArn | arn:aws:lambda:eu-west-2:610274502245:function:repricing-api |
| OrderSyncFunctionArn | arn:aws:lambda:eu-west-2:610274502245:function:repricing-order-sync |
| CompetitorScrapeFunctionArn | arn:aws:lambda:eu-west-2:610274502245:function:repricing-competitor-scrape |

### RepricingApiStack
- Stack ARN: `arn:aws:cloudformation:eu-west-2:610274502245:stack/RepricingApiStack/f7e89630-ceab-11f0-aa97-0abd9a89f333`

**Outputs:**
| Key | Value |
|-----|-------|
| ApiEndpoint | https://2uf6pmvya1.execute-api.eu-west-2.amazonaws.com/prod/ |
| RestApiId | 2uf6pmvya1 |

### RepricingFrontendStack
- Stack ARN: `arn:aws:cloudformation:eu-west-2:610274502245:stack/RepricingFrontendStack/26f6ca50-ceac-11f0-a53e-026fc6ebcf3d`

**Outputs:**
| Key | Value |
|-----|-------|
| WebsiteBucketName | repricing-frontend-610274502245 |
| DistributionDomainName | dd0eswlutoz5b.cloudfront.net |
| WebsiteUrl | https://dd0eswlutoz5b.cloudfront.net |
| CloudFrontDistributionId | E28VLOA0H027TB |

## DynamoDB Tables

### repricing-products
- Primary Key: `sku` (String)
- GSI: `by-brand` (brand → sku)
- Purpose: Product catalog with prices

### repricing-proposals
- Primary Key: `proposalId` (String)
- GSI: `by-status` (status → proposalId)
- GSI: `by-sku` (sku → proposalId)
- Purpose: Price change proposals

### repricing-rules
- Primary Key: `ruleId` (String)
- Purpose: Pricing rule definitions

### repricing-channels
- Primary Key: `channelId` (String)
- Purpose: Channel configuration

### repricing-orders
- Primary Key: `orderId` (String)
- GSI: `by-date` (orderDate → orderId)
- Purpose: Order headers

### repricing-order-lines
- Primary Key: `sku` (String)
- Sort Key: `orderDate#orderId` (String)
- Purpose: Denormalized order lines for fast sales queries

### repricing-carrier-costs
- Primary Key: `carrier` (String)
- Purpose: Delivery cost mappings

## Lambda Functions

| Function | Runtime | Memory | Timeout |
|----------|---------|--------|---------|
| repricing-api | Node.js 20.x | 1024 MB | 30s |
| repricing-data-sync | Node.js 20.x | 1024 MB | 300s |
| repricing-order-sync | Node.js 20.x | 1024 MB | 300s |
| repricing-price-calculator | Node.js 20.x | 1024 MB | 300s |
| repricing-competitor-scrape | Node.js 20.x | 1024 MB | 300s |

## API Gateway

- REST API ID: `2uf6pmvya1`
- Stage: `prod`
- Endpoint Type: Regional
- Authorization: Cognito User Pool

## CloudFront Distribution

- Distribution ID: `E28VLOA0H027TB`
- Domain: `dd0eswlutoz5b.cloudfront.net`
- Origin: S3 bucket `repricing-frontend-610274502245`
- Price Class: PriceClass_100 (NA + EU)
- Default TTL: 86400 (24 hours)

## S3 Buckets

### repricing-frontend-610274502245
- Purpose: Frontend static hosting
- Access: CloudFront OAI
- Contents: React app build artifacts

## Secrets Manager

### repricing/channelengine
- Contains: ChannelEngine API key
- Used by: data-sync, order-sync Lambdas

### repricing/google-sheets
- Contains: Google service account credentials
- Used by: data-sync Lambda, API Lambda (for price push)

## EventBridge Rules

| Rule | Schedule | Target |
|------|----------|--------|
| repricing-data-sync-schedule | Daily 6am UTC | data-sync Lambda |
| repricing-order-sync-schedule | Daily 7am UTC | order-sync Lambda |
| repricing-price-calc-schedule | Daily 8am UTC | price-calculator Lambda |
| repricing-competitor-scrape-schedule | Daily 4am UTC | competitor-scrape Lambda |

## IAM Roles

Each Lambda has an execution role with:
- DynamoDB read/write access to relevant tables
- Secrets Manager read access
- CloudWatch Logs write access
- API Gateway invoke access (for API Lambda)

## Monitoring

### CloudWatch Log Groups
- `/aws/lambda/repricing-api`
- `/aws/lambda/repricing-data-sync`
- `/aws/lambda/repricing-order-sync`
- `/aws/lambda/repricing-price-calculator`
- `/aws/lambda/repricing-competitor-scrape`

### Useful CLI Commands

```bash
# View API logs
aws logs tail "/aws/lambda/repricing-api" --since 1h --follow

# Invoke data sync manually
aws lambda invoke --function-name repricing-data-sync output.json

# Check CloudFront invalidation status
aws cloudfront get-invalidation --distribution-id E28VLOA0H027TB --id <invalidation-id>

# Scan products table
aws dynamodb scan --table-name repricing-products --max-items 10
```
