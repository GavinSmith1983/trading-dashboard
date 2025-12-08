# Trading Dashboard - Claude Instructions

> Project-specific instructions for Claude AI sessions.

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

## Channel Tabs UI
- Channels displayed in order: Amazon, B&Q, Shopify, ManoMano, eBay/OnBuy/Debs
- eBay, OnBuy, and Debenhams are collapsed into a single tab (shared pricing)
- The "All" tab shows average price across all channels

## Data Sources Summary
| Data | Source | Notes |
|------|--------|-------|
| Product metadata (title, brand, category, image) | ChannelEngine | Primary source of truth |
| Stock levels | ChannelEngine | Updated daily |
| Channel prices | Google Sheet | Columns F-J only |
| Cost price | CSV import / manual entry | Stored in DynamoDB |
| Delivery cost | Calculated from orders | Or manual entry |
| Competitor prices | Scraper | Daily 4am UTC |
| Orders & sales | ChannelEngine | Updated daily |

## Key Technical Notes
- Products table: `repricing-products` (DynamoDB)
- Order-lines table: `repricing-order-lines` (denormalized for fast sales queries)
- Price saves write to both DynamoDB and Google Sheet
- 180-day sales data used for analytics
