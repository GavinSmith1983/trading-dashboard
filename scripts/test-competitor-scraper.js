/**
 * Test competitor price scraping
 * Run with: node scripts/test-competitor-scraper.js
 */

const competitorUrls = [
  {
    id: 'heatandplumb-wrsc10',
    competitorName: 'Heat and Plumb',
    url: 'https://www.heatandplumb.com/acatalog/nuie-wet-room-screen-1850mm-x-1000mm-wide-glass-wrsc10'
  },
  {
    id: 'bathroomhouse-wrsc10',
    competitorName: 'Bathroom House',
    url: 'https://www.bathroom-house.co.uk/nuie-wetroom-shower-screen-with-chrome-fixed-profile-support-bar-1850mm-h-x-1000mm-w-x-8mm-glass'
  },
  {
    id: 'tapnshower-wrsc10',
    competitorName: 'Tap N Shower',
    url: 'https://www.tapnshower.com/wetroom-screen-1000-1850'
  },
  {
    id: 'plumbingworld-wrsc10',
    competitorName: 'Plumbing World',
    url: 'https://www.plumbingworld.co.uk/nuie-1000mm-wetroom-screen-support-bar'
  }
];

const MIN_PRICE_THRESHOLD = 5;

const SITE_PATTERNS = {
  'qssupplies.co.uk': [
    /hdnProdPrice"[^>]*value="(\d+\.?\d*)"/i,
  ],
  'heatandplumb.com': [
    /"priceCurrency":\s*"GBP",\s*"price":\s*"(\d+\.?\d*)"/i,
  ],
  'bathroom-house.co.uk': [
    /class="price">&pound;(\d+\.?\d*)/i,
  ],
  'showerstoyou.co.uk': [
    /"offers"[^}]*"price":\s*"?(\d+\.?\d*)"?/i,
  ],
};

const GENERIC_PATTERNS = [
  /"@type":\s*"Offer"[^}]*"price":\s*"?(\d+\.?\d*)"?/i,
  /"offers"[^}]*"price":\s*"?(\d+\.?\d*)"?/i,
  /itemprop="price"[^>]*content="(\d+\.?\d*)"/i,
  /<meta[^>]*property="product:price:amount"[^>]*content="(\d+\.?\d*)"/i,
  /<meta[^>]*name="price"[^>]*content="(\d+\.?\d*)"/i,
  /data-product-price="(\d+\.?\d*)"/i,
  /data-price="(\d+\.?\d*)"/i,
  /class="price">&pound;(\d+\.?\d*)/i,
];

function getDomain(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function extractPrice(html, url) {
  const domain = getDomain(url);
  const isExVatSite = domain === 'qssupplies.co.uk';

  const sitePatterns = SITE_PATTERNS[domain] || [];
  for (const pattern of sitePatterns) {
    const match = html.match(pattern);
    if (match && match[1]) {
      let price = parseFloat(match[1].replace(/,/g, ''));
      if (isExVatSite) {
        price = price * 1.2;
      }
      price = Math.round(price * 100) / 100;
      if (price >= MIN_PRICE_THRESHOLD && price < 100000) {
        return { price, method: 'site-specific', pattern: pattern.toString() };
      }
    }
  }

  for (const pattern of GENERIC_PATTERNS) {
    const match = html.match(pattern);
    if (match && match[1]) {
      const price = parseFloat(match[1].replace(/,/g, ''));
      if (price >= MIN_PRICE_THRESHOLD && price < 100000) {
        return { price, method: 'generic', pattern: pattern.toString() };
      }
    }
  }

  return null;
}

async function scrapeUrl(url) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

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
      return { error: `HTTP ${response.status}: ${response.statusText}` };
    }

    const html = await response.text();
    const result = extractPrice(html, url);

    if (result === null) {
      const fs = require('fs');
      const domain = getDomain(url);
      fs.writeFileSync(`C:/projects/Trading-Dashboard/debug-${domain}.html`, html);
      return { error: 'Could not find price on page (HTML saved for debug)' };
    }

    return result;
  } catch (error) {
    return { error: error.message };
  }
}

async function main() {
  console.log('Testing competitor price scraping for NTP023 (Shower Tray 1200x800)');
  console.log('Your price: £230.83\n');
  console.log('='.repeat(80));

  for (const comp of competitorUrls) {
    console.log(`\n${comp.competitorName}`);
    console.log(`URL: ${comp.url}`);

    const result = await scrapeUrl(comp.url);

    if (result.error) {
      console.log(`❌ Error: ${result.error}`);
    } else {
      console.log(`✅ Price: £${result.price.toFixed(2)}`);
      console.log(`   Method: ${result.method}`);
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('Done!');
}

main().catch(console.error);
