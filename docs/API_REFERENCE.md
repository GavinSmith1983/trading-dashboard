# API Reference

> Save Point: December 8, 2025

Base URL: `https://2uf6pmvya1.execute-api.eu-west-2.amazonaws.com/prod`

All endpoints require Cognito ID token in `Authorization` header.

---

## Products

### List Products
```
GET /products
```

Query Parameters:
| Param | Type | Description |
|-------|------|-------------|
| brand | string | Filter by brand |
| category | string | Filter by category |
| search | string | Search SKU or title |
| page | number | Page number (default: 1) |
| pageSize | number | Items per page (default: 50) |

Response:
```json
{
  "items": [Product],
  "totalCount": 150,
  "page": 1,
  "pageSize": 50,
  "hasMore": true
}
```

### Get Product
```
GET /products/{sku}
```

Response: `Product`

### Update Product
```
PUT /products/{sku}
```

Body:
```json
{
  "costPrice": 25.99,
  "deliveryCost": 5.00,
  "channelPrices": {
    "amazon": 45.99,
    "ebay": 42.99
  }
}
```

Response: `Product`

---

## Proposals

### List Proposals
```
GET /proposals
```

Query Parameters:
| Param | Type | Description |
|-------|------|-------------|
| status | string | pending, approved, rejected, modified, pushed |
| brand | string | Filter by brand |
| search | string | Search SKU or title |
| appliedRuleName | string | Filter by rule name |
| hasWarnings | boolean | Only show proposals with warnings |
| page | number | Page number |
| pageSize | number | Items per page |

Response:
```json
{
  "items": [PriceProposal],
  "totalCount": 50,
  "page": 1,
  "pageSize": 50,
  "hasMore": false
}
```

### Get Proposal
```
GET /proposals/{proposalId}
```

Response: `PriceProposal`

### Update Proposal (Approve/Reject/Modify)
```
PUT /proposals/{proposalId}
```

Body:
```json
{
  "action": "approve" | "reject" | "modify",
  "reviewedBy": "user@example.com",
  "notes": "Optional notes",
  "modifiedPrice": 39.99  // Required for "modify" action
}
```

Response: `PriceProposal`

### Bulk Approve
```
POST /proposals/bulk-approve
```

Body:
```json
{
  "proposalIds": ["id1", "id2", "id3"],
  "reviewedBy": "user@example.com",
  "notes": "Bulk approved"
}
```

Response:
```json
{
  "success": true,
  "approved": 3,
  "errors": []
}
```

### Bulk Reject
```
POST /proposals/bulk-reject
```

Body:
```json
{
  "proposalIds": ["id1", "id2"],
  "reviewedBy": "user@example.com",
  "notes": "Not applicable"
}
```

### Push Approved Prices
```
POST /proposals/push
```

Body:
```json
{
  "dryRun": false
}
```

Response:
```json
{
  "success": true,
  "pushed": 15,
  "errors": ["SKU123: Failed to update Google Sheet"]
}
```

---

## Pricing Rules

### List Rules
```
GET /rules
```

Response:
```json
{
  "items": [PricingRule],
  "count": 5
}
```

### Get Rule
```
GET /rules/{ruleId}
```

Response: `PricingRule`

### Create Rule
```
POST /rules
```

Body:
```json
{
  "name": "High Margin Low Sales",
  "description": "Reduce price for high margin products with low sales",
  "priority": 1,
  "isActive": true,
  "conditions": {
    "minMargin": 30,
    "maxSales": 0.5
  },
  "actions": {
    "targetMargin": 20,
    "priceChangeType": "percentage",
    "maxPriceChange": 15
  }
}
```

### Update Rule
```
PUT /rules/{ruleId}
```

Body: Same as create

### Delete Rule
```
DELETE /rules/{ruleId}
```

---

## Channels

### List Channels
```
GET /channels
```

Response:
```json
{
  "items": [Channel],
  "count": 6
}
```

### Update Channel
```
PUT /channels/{channelId}
```

Body:
```json
{
  "isActive": true,
  "feePercentage": 20,
  "minMargin": 15
}
```

---

## Analytics

### Dashboard Summary
```
GET /analytics/summary
```

Response:
```json
{
  "totalProducts": 1500,
  "activeProducts": 1200,
  "pendingProposals": 45,
  "totalRevenue30d": 125000,
  "avgMargin": 22.5,
  "topBrands": [
    { "brand": "Brand A", "revenue": 45000, "units": 320 }
  ]
}
```

### Sales Analytics
```
GET /analytics/sales
```

Query Parameters:
| Param | Type | Description |
|-------|------|-------------|
| period | string | 7d, 30d, 90d, 180d |
| brand | string | Filter by brand |
| channel | string | Filter by channel |

Response:
```json
{
  "totalRevenue": 125000,
  "totalUnits": 3500,
  "avgOrderValue": 35.71,
  "dailySales": [
    { "date": "2025-12-01", "revenue": 4500, "units": 120 }
  ],
  "byChannel": [
    { "channel": "amazon", "revenue": 50000, "units": 1400 }
  ],
  "byBrand": [
    { "brand": "Brand A", "revenue": 30000, "units": 800 }
  ]
}
```

### Insights
```
GET /analytics/insights
```

Response:
```json
{
  "insights": [
    {
      "type": "opportunity",
      "title": "Price increase opportunity",
      "description": "15 products have margin below target but strong sales",
      "impact": "high",
      "affectedSkus": ["SKU1", "SKU2"]
    }
  ]
}
```

---

## Carriers / Delivery Costs

### List Carriers
```
GET /carriers
```

Response:
```json
{
  "items": [
    { "carrier": "DPD", "baseCost": 5.99, "weightBands": [...] }
  ]
}
```

### Update Carrier
```
PUT /carriers/{carrier}
```

### Recalculate Delivery Costs
```
POST /carriers/recalculate
```

Recalculates delivery costs for all products based on order history.

---

## History

### Get SKU History
```
GET /history/{sku}
```

Query Parameters:
| Param | Type | Description |
|-------|------|-------------|
| days | number | Number of days (default: 90) |

Response:
```json
{
  "sku": "SKU123",
  "history": [
    {
      "date": "2025-12-01",
      "channelPrices": { "amazon": 45.99 },
      "costPrice": 25.00,
      "margin": 45.6,
      "sales": 5
    }
  ]
}
```

---

## Import

### Import Cost Prices
```
POST /import/costs
```

Body (CSV format):
```json
{
  "csv": "sku,costPrice\nSKU1,25.99\nSKU2,30.00"
}
```

Response:
```json
{
  "success": true,
  "imported": 2,
  "errors": []
}
```

---

## Competitors

### Trigger Scrape
```
POST /competitors/scrape
```

Body:
```json
{
  "skus": ["SKU1", "SKU2"]  // Optional, scrapes all if empty
}
```

---

## Type Definitions

### Product
```typescript
interface Product {
  sku: string;
  title: string;
  brand: string;
  category: string;
  imageUrl?: string;
  costPrice?: number;
  deliveryCost?: number;
  stockLevel: number;
  channelPrices: Record<string, number>;
  competitorPrices?: Record<string, number>;
  avgDailySales?: number;
  lastUpdated: string;
}
```

### PriceProposal
```typescript
interface PriceProposal {
  proposalId: string;
  sku: string;
  productTitle: string;
  brand: string;
  channel: string;
  currentPrice: number;
  proposedPrice: number;
  priceChange: number;
  priceChangePercent: number;
  currentMargin: number;
  proposedMargin: number;
  reason: string;
  appliedRuleName: string;
  status: 'pending' | 'approved' | 'rejected' | 'modified' | 'pushed';
  warnings: string[];
  stockLevel: number;
  avgDailySales: number;
  estimatedWeeklyProfitImpact: number;
  createdAt: string;
  reviewedAt?: string;
  reviewedBy?: string;
  reviewNotes?: string;
}
```

### PricingRule
```typescript
interface PricingRule {
  ruleId: string;
  name: string;
  description: string;
  priority: number;
  isActive: boolean;
  conditions: {
    minMargin?: number;
    maxMargin?: number;
    minSales?: number;
    maxSales?: number;
    minStock?: number;
    maxStock?: number;
    brands?: string[];
    channels?: string[];
  };
  actions: {
    targetMargin?: number;
    priceChangeType: 'percentage' | 'fixed';
    maxPriceChange: number;
  };
  createdAt: string;
  updatedAt: string;
}
```
