/**
 * Akeneo PIM Service
 * Fetches product enrichment data (family, attributes) from Akeneo PIM
 *
 * Rate Limits (per Akeneo docs):
 * - Up to 4 concurrent API calls per connection
 * - Up to 10 concurrent API calls per PIM instance
 * - Up to 100 API requests per second per instance
 * - 429 responses when limits exceeded
 */

/**
 * Akeneo API configuration
 */
export interface AkeneoConfig {
  apiUrl: string; // e.g., https://tenant.cloud.akeneo.com
  clientId: string;
  clientSecret: string;
  username: string;
  password: string;
}

/**
 * Rate limiter configuration
 */
export interface RateLimiterConfig {
  requestsPerSecond: number;  // Max requests per second (default: 10, conservative)
  retryAfterMs: number;       // Delay after 429 response (default: 1000ms)
  maxRetries: number;         // Max retries on 429 (default: 3)
}

/**
 * Akeneo product from API
 */
interface AkeneoApiProduct {
  uuid?: string;
  identifier: string; // SKU
  enabled: boolean;
  family: string | null;
  categories: string[];
  groups: string[];
  parent: string | null;
  values: Record<string, Array<{
    locale: string | null;
    scope: string | null;
    data: unknown;
  }>>;
  created: string;
  updated: string;
}

/**
 * Akeneo API paginated response
 */
interface AkeneoPaginatedResponse<T> {
  _links: {
    self: { href: string };
    first: { href: string };
    next?: { href: string };
  };
  current_page: number;
  _embedded: {
    items: T[];
  };
}

/**
 * Simplified product enrichment data from Akeneo
 */
export interface AkeneoProductEnrichment {
  sku: string;
  family: string | null;
  categories: string[];
  enabled: boolean;
  updated: string;
}

/**
 * Akeneo PIM Service
 */
export class AkeneoService {
  private apiUrl: string;
  private clientId: string;
  private clientSecret: string;
  private username: string;
  private password: string;
  private accessToken?: string;
  private tokenExpiry?: Date;

  // Rate limiting
  private rateLimiter: RateLimiterConfig;
  private lastRequestTime: number = 0;
  private requestCount: number = 0;
  private requestWindowStart: number = 0;

  constructor(config: AkeneoConfig, rateLimiter?: Partial<RateLimiterConfig>) {
    // Remove trailing slash from API URL
    this.apiUrl = config.apiUrl.replace(/\/$/, '');
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.username = config.username;
    this.password = config.password;

    // Conservative rate limits to stay well under Akeneo's 100 req/s limit
    this.rateLimiter = {
      requestsPerSecond: rateLimiter?.requestsPerSecond ?? 10,
      retryAfterMs: rateLimiter?.retryAfterMs ?? 1000,
      maxRetries: rateLimiter?.maxRetries ?? 3,
    };
  }

  /**
   * Wait to respect rate limits
   */
  private async throttle(): Promise<void> {
    const now = Date.now();

    // Reset window if more than 1 second has passed
    if (now - this.requestWindowStart >= 1000) {
      this.requestCount = 0;
      this.requestWindowStart = now;
    }

    // If we've hit the limit, wait until the window resets
    if (this.requestCount >= this.rateLimiter.requestsPerSecond) {
      const waitTime = 1000 - (now - this.requestWindowStart);
      if (waitTime > 0) {
        await this.sleep(waitTime);
        this.requestCount = 0;
        this.requestWindowStart = Date.now();
      }
    }

    this.requestCount++;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get OAuth2 access token (cached until expiry)
   */
  private async getAccessToken(): Promise<string> {
    // Return cached token if still valid (with 60s buffer)
    if (this.accessToken && this.tokenExpiry && new Date() < this.tokenExpiry) {
      return this.accessToken;
    }

    console.log('[Akeneo] Authenticating...');

    // Base64 encode client credentials
    const credentials = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');

    const response = await fetch(`${this.apiUrl}/api/oauth/v1/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${credentials}`,
      },
      body: JSON.stringify({
        grant_type: 'password',
        username: this.username,
        password: this.password,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Akeneo authentication failed: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const data = await response.json() as {
      access_token: string;
      expires_in: number;
      token_type: string;
      scope: string;
      refresh_token: string;
    };

    this.accessToken = data.access_token;
    // Set expiry with 60 second buffer
    this.tokenExpiry = new Date(Date.now() + (data.expires_in - 60) * 1000);

    console.log(`[Akeneo] Authenticated successfully, token expires in ${data.expires_in}s`);

    return this.accessToken;
  }

  /**
   * Make authenticated request to Akeneo API with rate limiting and retry on 429
   */
  private async request<T>(
    endpoint: string,
    method: 'GET' | 'POST' | 'PATCH' = 'GET',
    body?: unknown
  ): Promise<T> {
    const token = await this.getAccessToken();

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.rateLimiter.maxRetries; attempt++) {
      // Apply rate limiting before request
      await this.throttle();

      const response = await fetch(`${this.apiUrl}${endpoint}`, {
        method,
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
      });

      // Handle rate limit (429) with retry
      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After');
        const waitMs = retryAfter
          ? parseInt(retryAfter, 10) * 1000
          : this.rateLimiter.retryAfterMs * (attempt + 1); // Exponential backoff

        console.log(`[Akeneo] Rate limited (429), waiting ${waitMs}ms before retry ${attempt + 1}/${this.rateLimiter.maxRetries}`);
        await this.sleep(waitMs);
        continue;
      }

      if (!response.ok) {
        const errorText = await response.text();
        lastError = new Error(`Akeneo API error: ${response.status} ${response.statusText} - ${errorText}`);
        throw lastError;
      }

      return response.json() as Promise<T>;
    }

    throw lastError || new Error('Akeneo API request failed after retries');
  }

  /**
   * Fetch all products from Akeneo with pagination
   * Returns a map of SKU -> enrichment data for easy lookup
   */
  async fetchAllProducts(
    onBatch?: (products: AkeneoProductEnrichment[], page: number) => Promise<void>
  ): Promise<Map<string, AkeneoProductEnrichment>> {
    const allProducts = new Map<string, AkeneoProductEnrichment>();
    let page = 1;
    let nextUrl: string | undefined = '/api/rest/v1/products?limit=100';

    console.log('[Akeneo] Fetching products...');

    while (nextUrl) {
      const apiResponse: AkeneoPaginatedResponse<AkeneoApiProduct> = await this.request<AkeneoPaginatedResponse<AkeneoApiProduct>>(nextUrl);

      const enrichedProducts = apiResponse._embedded.items.map((p: AkeneoApiProduct): AkeneoProductEnrichment => ({
        sku: p.identifier,
        family: p.family,
        categories: p.categories,
        enabled: p.enabled,
        updated: p.updated,
      }));

      // Add to map
      for (const product of enrichedProducts) {
        allProducts.set(product.sku, product);
      }

      // Callback for batch processing
      if (onBatch) {
        await onBatch(enrichedProducts, page);
      }

      console.log(`[Akeneo] Fetched page ${page}: ${enrichedProducts.length} products (total: ${allProducts.size})`);

      // Get next page URL
      const nextLink = apiResponse._links.next?.href;
      if (nextLink) {
        // Extract just the path from the full URL
        const parsedUrl = new URL(nextLink);
        nextUrl = parsedUrl.pathname + parsedUrl.search;
      } else {
        nextUrl = undefined;
      }
      page++;
    }

    console.log(`[Akeneo] Completed: ${allProducts.size} total products`);

    return allProducts;
  }

  /**
   * Fetch a single product by SKU
   */
  async getProduct(sku: string): Promise<AkeneoProductEnrichment | null> {
    try {
      const product = await this.request<AkeneoApiProduct>(
        `/api/rest/v1/products/${encodeURIComponent(sku)}`
      );

      return {
        sku: product.identifier,
        family: product.family,
        categories: product.categories,
        enabled: product.enabled,
        updated: product.updated,
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes('404')) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Fetch products by a list of SKUs (for targeted sync)
   * Respects rate limits and returns results as available
   */
  async fetchProductsBySKUs(
    skus: string[],
    onProgress?: (completed: number, total: number, product: AkeneoProductEnrichment | null) => void
  ): Promise<Map<string, AkeneoProductEnrichment>> {
    const results = new Map<string, AkeneoProductEnrichment>();

    console.log(`[Akeneo] Fetching ${skus.length} products by SKU...`);

    for (let i = 0; i < skus.length; i++) {
      const sku = skus[i];
      try {
        const product = await this.getProduct(sku);
        if (product) {
          results.set(sku, product);
        }
        if (onProgress) {
          onProgress(i + 1, skus.length, product);
        }
      } catch (error) {
        console.error(`[Akeneo] Failed to fetch product ${sku}:`, error);
        if (onProgress) {
          onProgress(i + 1, skus.length, null);
        }
      }
    }

    console.log(`[Akeneo] Completed: ${results.size}/${skus.length} products fetched`);
    return results;
  }

  /**
   * Fetch all product families (for reference/display)
   */
  async fetchFamilies(): Promise<Array<{ code: string; labels: Record<string, string> }>> {
    const response = await this.request<AkeneoPaginatedResponse<{
      code: string;
      labels: Record<string, string>;
    }>>('/api/rest/v1/families?limit=100');

    return response._embedded.items;
  }
}

/**
 * Create Akeneo service from AWS Secrets Manager
 */
export async function createAkeneoServiceFromSecret(
  secretArn: string,
  rateLimiter?: Partial<RateLimiterConfig>
): Promise<AkeneoService> {
  const { SecretsManagerClient, GetSecretValueCommand } = await import(
    '@aws-sdk/client-secrets-manager'
  );

  const client = new SecretsManagerClient({});
  const response = await client.send(
    new GetSecretValueCommand({ SecretId: secretArn })
  );

  if (!response.SecretString) {
    throw new Error('Akeneo secret is empty');
  }

  const secret = JSON.parse(response.SecretString) as AkeneoConfig;

  return new AkeneoService(secret, rateLimiter);
}

/**
 * Create Akeneo service from account configuration
 */
export function createAkeneoServiceFromAccount(
  akeneoConfig: AkeneoConfig,
  rateLimiter?: Partial<RateLimiterConfig>
): AkeneoService {
  return new AkeneoService(akeneoConfig, rateLimiter);
}
