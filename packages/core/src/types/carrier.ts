/**
 * Carrier cost configuration
 * Used to define delivery costs per carrier
 */
export interface CarrierCost {
  carrierId: string; // Normalized carrier name (e.g., 'homefleet', 'dx', 'dpd')
  carrierName: string; // Display name (e.g., 'HomeFleet', 'DX', 'DPD Logistics')
  costPerParcel: number; // Cost per parcel in GBP
  isActive: boolean;
  lastUpdated: string;
}

/**
 * Delivery data from Vector Summary report
 */
export interface DeliveryRecord {
  orderNumber: string; // PONumber from report (ChannelEngine order number)
  parcels: number; // NoOfPackages
  carrier: string; // ActualCarrier (normalized)
  rawCarrier: string; // Original carrier value before normalization
}

/**
 * Product carrier statistics
 * Used to track which carriers are used most for each product
 */
export interface ProductCarrierStats {
  sku: string;
  carrierCounts: Record<string, number>; // carrier -> count of deliveries
  predominantCarrier: string;
  totalDeliveries: number;
}

/**
 * Summary of delivery report import
 */
export interface DeliveryImportResult {
  ordersProcessed: number;
  ordersMatched: number; // Orders matched to our DynamoDB orders
  ordersNotFound: number;
  carriersFound: string[]; // Unique carriers discovered
  productsUpdated: number; // Products with delivery cost updated
  skuCarrierStats: Record<string, ProductCarrierStats>;
}

/**
 * Normalize carrier name to a standard format
 * e.g., "HomeFleet - Route 62" -> "homefleet"
 */
export function normalizeCarrierName(rawCarrier: string): string {
  if (!rawCarrier || rawCarrier.trim() === '') {
    return 'unknown';
  }

  const lower = rawCarrier.toLowerCase().trim();

  // HomeFleet variants - strip route numbers
  if (lower.startsWith('homefleet')) {
    return 'homefleet';
  }

  // Standard carriers - just lowercase and trim
  if (lower.includes('dpd')) return 'dpd';
  if (lower.includes('dx')) return 'dx';
  if (lower.includes('arrow')) return 'arrowxl';
  if (lower.includes('parcelforce')) return 'parcelforce';
  if (lower.includes('worthington')) return 'ak_worthington';
  if (lower.includes('consolidated')) return 'consolidated';
  if (lower.includes('hold delivery')) return 'hold_delivery';

  // Fallback - just normalize the name
  return lower.replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
}

/**
 * Get display name for a normalized carrier ID
 */
export function getCarrierDisplayName(carrierId: string): string {
  const displayNames: Record<string, string> = {
    homefleet: 'HomeFleet',
    dpd: 'DPD Logistics',
    dx: 'DX',
    arrowxl: 'ArrowXL',
    parcelforce: 'Parcelforce',
    ak_worthington: 'AK Worthington',
    consolidated: 'Consolidated Delivery',
    hold_delivery: 'Hold Delivery',
    today_despatch: 'Today Despatch',
    unknown: 'Unknown',
  };

  return displayNames[carrierId] || carrierId;
}

/**
 * Check if a carrier should be excluded from delivery cost calculations
 * Excludes: Hold Delivery, Consolidated Delivery, today_despatch
 */
export function isExcludedCarrier(rawCarrier: string): boolean {
  if (!rawCarrier) return true;

  const lower = rawCarrier.toLowerCase().trim();

  // Excluded carriers
  if (lower.includes('hold delivery') || lower.includes('hold_delivery')) return true;
  if (lower.includes('consolidated delivery') || lower.includes('consolidated')) return true;
  if (lower.includes('today_despatch') || lower.includes('today despatch') || lower === 'today_despatch') return true;

  return false;
}
