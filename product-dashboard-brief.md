# Product Dashboard Redesign Brief

## Context
This is a repricing dashboard for merchandisers managing bathroom/kitchen products. The product detail page displays metrics for individual SKUs to help merchandisers understand profitability and sales performance.

## Current Problem
All 10 metrics are displayed in a flat 5x2 grid with equal visual weight. This buries the story - merchandisers can't quickly assess product health or understand the relationship between costs, pricing, and performance.

## Proposed Solution
Reorganise the metrics into **three distinct visual sections** that tell a clear story.

---

### Section 1: Cost Inputs (Editable)
**Purpose:** These are the levers the merchandiser controls.

| Metric | Current Value | Notes |
|--------|---------------|-------|
| Cost | £6.52 | Editable field |
| Delivery | £4.28 | Editable field |

**UI Requirements:**
- Visually distinguish as editable (e.g., subtle input field styling, pencil icon, or different background)
- Group together with a section header like "Cost Inputs" or "Your Inputs"
- Consider inline editing capability

---

### Section 2: Pricing & Margin (Calculated)
**Purpose:** Shows how inputs translate to profitability.

| Metric | Current Value | Notes |
|--------|---------------|-------|
| Price | £19.99 | Selling price |
| 20% Costs | £3.33 | Platform/channel fees |
| PPO | £14.13 | Price Post Overhead |
| **Margin** | **15.2%** | **Hero metric - make prominent** |

**UI Requirements:**
- Show a visual flow: Inputs → Deductions → Margin
- **Margin should be the hero of this section:**
  - Larger font size (1.5-2x other metrics)
  - Colour-coded by threshold:
    - Red: < 10%
    - Amber: 10-20%
    - Green: > 20%
  - Consider a gauge or progress-style visualisation
- Optionally show the calculation breakdown on hover or in a subtle subtitle

---

### Section 3: Sales Performance (Read-only)
**Purpose:** Shows how well the product is actually selling.

| Metric | Current Value | Notes |
|--------|---------------|-------|
| Avg Daily Sales | 4.23 | Units per day |
| Avg Daily Revenue | £77.16 | Revenue per day |
| Stock | 200 | Current inventory |
| **Days of Stock** | ~47 days | **NEW: Calculated field (Stock ÷ Avg Daily Sales)** |

**UI Requirements:**
- Add "Days of Stock" as a calculated metric
- Colour-code Days of Stock:
  - Red: < 14 days (low stock warning)
  - Amber: 14-30 days
  - Green: 30-90 days
  - Blue/Grey: > 90 days (potential overstock)
- Group with section header like "Sales Performance" or "How It's Selling"

---

### Section 4: Product Identity (Existing)
Keep the existing product header with:
- Product image
- SKU code (BKW813R)
- Product title
- Brand badge (Balterley)

---

## Visual Layout Suggestion

```
┌─────────────────────────────────────────────────────────────────┐
│  [Image]  BKW813R                                    [Balterley]│
│           90mm - Fireclay Kitchen Sink Basket...                │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─ COST INPUTS ──────────┐  ┌─ MARGIN ─────────────────────┐  │
│  │                        │  │                               │  │
│  │  Cost      [£6.52 ✎]  │  │   Price        £19.99        │  │
│  │  Delivery  [£4.28 ✎]  │  │   20% Costs   -£3.33        │  │
│  │                        │  │   PPO          £14.13        │  │
│  │                        │  │   ─────────────────          │  │
│  │                        │  │        15.2%                 │  │
│  │                        │  │      [MARGIN]                │  │
│  │                        │  │    (colour-coded)            │  │
│  └────────────────────────┘  └───────────────────────────────┘  │
│                                                                 │
│  ┌─ SALES PERFORMANCE ──────────────────────────────────────┐  │
│  │                                                           │  │
│  │  Daily Sales    Daily Revenue    Stock    Days of Stock  │  │
│  │     4.23           £77.16         200        ~47 days    │  │
│  │    units/day                               (colour-coded) │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│  Historical Data (chart - keep as-is)                          │
└─────────────────────────────────────────────────────────────────┘
```

---

## Technical Notes

- This appears to be a React application (based on the existing UI)
- Maintain consistency with existing design system (colours, card styles, etc.)
- The historical chart section below should remain unchanged
- Margin thresholds and stock day thresholds should ideally be configurable (constants at top of file is fine for now)

---

## Acceptance Criteria

1. Metrics are grouped into three logical sections with clear headers
2. Cost and Delivery fields are visually distinguished as editable
3. Margin is prominently displayed with colour-coding based on thresholds
4. Days of Stock is calculated and displayed with colour-coding
5. Layout is responsive and works on standard desktop screens
6. Existing chart and product header remain functional

---

## Out of Scope (For Now)
- Actual edit functionality for Cost/Delivery (just visual indication)
- Saving threshold configurations
- Mobile responsive design
- Changes to the historical chart
