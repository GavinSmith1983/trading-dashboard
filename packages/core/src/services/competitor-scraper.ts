import { Product, CompetitorUrl } from '../types';

/**
 * Minimum price threshold - bathroom products typically £20+
 * This prevents picking up CSS values, font sizes, etc.
 */
const MIN_PRICE_THRESHOLD = 15;

/**
 * Price scraping patterns for known competitor sites
 * Each site has specific, reliable selectors identified from their HTML structure
 */
const SITE_PATTERNS: Record<string, RegExp[]> = {
  'victorianplumbing.co.uk': [
    // JSON-LD schema in #pdp-schema script tag - "price":129.95 (inc VAT)
    /id="pdp-schema"[^>]*>[^<]*"price":\s*(\d+\.?\d*)/i,
  ],
  'heatandplumb.com': [
    // JSON-LD with priceCurrency GBP followed by price (now inc VAT as of Dec 2025)
    // Pattern: "priceCurrency": "GBP",\s*"price": "121.95"
    /"priceCurrency":\s*"GBP",\s*"price":\s*"(\d+\.?\d*)"/i,
  ],
  'qssupplies.co.uk': [
    // Hidden input field hdnProdPrice contains ex-VAT price
    // We multiply by 1.2 in post-processing
    /name="hdnProdPrice"[^>]*value="(\d+\.?\d*)"/i,
  ],
  'screwfix.com': [
    /data-product-price="(\d+\.?\d*)"/i,
  ],
  'toolstation.com': [
    /data-price="(\d+\.?\d*)"/i,
  ],
};

/**
 * Sites that show prices ex-VAT (need to multiply by 1.2 for inc VAT)
 * Note: heatandplumb.com changed to inc-VAT in Dec 2025
 */
const EX_VAT_SITES: string[] = [];

/**
 * Generic price patterns to try if site-specific ones don't work
 * These are ordered by reliability - schema.org/JSON-LD first, then meta tags, then HTML
 */
const GENERIC_PATTERNS: RegExp[] = [
  // JSON-LD structured data (most reliable)
  /"@type":\s*"Offer"[^}]*"price":\s*"?(\d+\.?\d*)"?/i,
  /"offers"[^}]*"price":\s*"?(\d+\.?\d*)"?/i,

  // Schema.org itemprop (very reliable)
  /itemprop="price"[^>]*content="(\d+\.?\d*)"/i,

  // Meta tags (reliable)
  /<meta[^>]*property="product:price:amount"[^>]*content="(\d+\.?\d*)"/i,
  /<meta[^>]*name="price"[^>]*content="(\d+\.?\d*)"/i,

  // Data attributes (reliable)
  /data-product-price="(\d+\.?\d*)"/i,
  /data-price="(\d+\.?\d*)"/i,
];

/**
 * Extract domain from URL
 */
function getDomain(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * Extract price from HTML content
 */
export function extractPrice(html: string, url: string): number | null {
  const domain = getDomain(url);
  const isExVatSite = EX_VAT_SITES.includes(domain);

  // Try site-specific patterns first
  const sitePatterns = SITE_PATTERNS[domain] || [];
  for (const pattern of sitePatterns) {
    const match = html.match(pattern);
    if (match && match[1]) {
      let price = parseFloat(match[1].replace(/,/g, ''));

      // Convert ex-VAT to inc-VAT if needed
      if (isExVatSite) {
        price = price * 1.2;
      }

      // Round to 2 decimal places
      price = Math.round(price * 100) / 100;

      // Sanity check: price must be reasonable (£15 - £100,000)
      if (price >= MIN_PRICE_THRESHOLD && price < 100000) {
        return price;
      }
    }
  }

  // Fall back to generic patterns (these are assumed to be inc VAT)
  for (const pattern of GENERIC_PATTERNS) {
    const match = html.match(pattern);
    if (match && match[1]) {
      const price = parseFloat(match[1].replace(/,/g, ''));
      if (price >= MIN_PRICE_THRESHOLD && price < 100000) {
        return price;
      }
    }
  }

  return null;
}

/**
 * Fetch a URL and extract the price
 */
export async function scrapePrice(url: string): Promise<{ price: number | null; error?: string }> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000); // 15 second timeout

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-GB,en;q=0.9',
      },
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return { price: null, error: `HTTP ${response.status}: ${response.statusText}` };
    }

    const html = await response.text();
    const price = extractPrice(html, url);

    if (price === null) {
      return { price: null, error: 'Could not find price on page' };
    }

    return { price };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { price: null, error: message };
  }
}

/**
 * Scrape all competitor URLs for a product
 */
export async function scrapeProductCompetitors(
  product: Product
): Promise<{
  updatedUrls: CompetitorUrl[];
  lowestPrice: number | null;
  errors: string[];
}> {
  const urls = product.competitorUrls || [];
  if (urls.length === 0) {
    return { updatedUrls: [], lowestPrice: null, errors: [] };
  }

  const errors: string[] = [];
  const updatedUrls: CompetitorUrl[] = [];
  let lowestPrice: number | null = null;

  for (const urlEntry of urls) {
    const result = await scrapePrice(urlEntry.url);

    const updatedEntry: CompetitorUrl = {
      ...urlEntry,
      lastScrapedAt: new Date().toISOString(),
    };

    if (result.price !== null) {
      updatedEntry.lastPrice = result.price;
      updatedEntry.lastError = undefined;

      if (lowestPrice === null || result.price < lowestPrice) {
        lowestPrice = result.price;
      }
    } else {
      updatedEntry.lastError = result.error;
      errors.push(`${urlEntry.competitorName}: ${result.error}`);
    }

    updatedUrls.push(updatedEntry);
  }

  return { updatedUrls, lowestPrice, errors };
}

/**
 * Extract competitor name from URL
 */
export function getCompetitorNameFromUrl(url: string): string {
  const domain = getDomain(url);

  const nameMap: Record<string, string> = {
    'victorianplumbing.co.uk': 'Victorian Plumbing',
    'heatandplumb.com': 'Heat and Plumb',
    'qssupplies.co.uk': 'QS Supplies',
    'screwfix.com': 'Screwfix',
    'toolstation.com': 'Toolstation',
    'plumbworld.co.uk': 'Plumbworld',
    'bigbathroomshop.co.uk': 'Big Bathroom Shop',
    'bathroomplanet.com': 'Bathroom Planet',
  };

  return nameMap[domain] || domain;
}
