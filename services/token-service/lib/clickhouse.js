/**
 * ClickHouse Client for Tenant Lookups
 *
 * Provides tenant lookup by origin domain for TenantId injection into JWTs.
 */

const http = require('http');
const https = require('https');

// Configuration from environment
const CLICKHOUSE_HOST = process.env.CLICKHOUSE_HOST || 'localhost';
const CLICKHOUSE_PORT = parseInt(process.env.CLICKHOUSE_PORT || '8123', 10);
const CLICKHOUSE_USER = process.env.CLICKHOUSE_USER || 'default';
const CLICKHOUSE_PASSWORD = process.env.CLICKHOUSE_PASSWORD || '';
const CLICKHOUSE_DATABASE = process.env.CLICKHOUSE_DATABASE || 'opengander';
const CLICKHOUSE_PROTOCOL = process.env.CLICKHOUSE_PROTOCOL || 'http';

const logger = require('./logger');
const log = logger.child({ component: 'clickhouse' });

// Simple in-memory cache for tenant lookups (avoid hitting DB on every request)
const tenantCache = new Map();
const CACHE_TTL_MS = 60 * 1000; // 1 minute cache

/**
 * Execute a ClickHouse query via HTTP interface
 * @param {string} query - SQL query to execute (can include {param:Type} placeholders)
 * @param {Object} params - Optional parameters for parameterized queries
 * @returns {Promise<Object[]>} Array of result rows
 */
async function executeQuery(query, params = {}) {
  return new Promise((resolve, reject) => {
    const isHttps = CLICKHOUSE_PROTOCOL === 'https';
    const client = isHttps ? https : http;

    const auth = CLICKHOUSE_PASSWORD
      ? `${CLICKHOUSE_USER}:${CLICKHOUSE_PASSWORD}`
      : CLICKHOUSE_USER;

    // Build query string with parameters
    const queryParams = new URLSearchParams({
      database: CLICKHOUSE_DATABASE,
    });

    // Add query parameters (ClickHouse parameterized query syntax)
    for (const [key, value] of Object.entries(params)) {
      queryParams.set(`param_${key}`, String(value));
    }

    const options = {
      hostname: CLICKHOUSE_HOST,
      port: CLICKHOUSE_PORT,
      path: `/?${queryParams.toString()}`,
      method: 'POST',
      auth: auth,
      headers: {
        'Content-Type': 'text/plain',
      },
    };

    const req = client.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`ClickHouse error (${res.statusCode}): ${data}`));
          return;
        }

        // Parse JSON Lines format
        const lines = data.trim().split('\n').filter(Boolean);
        const results = lines
          .map((line) => {
            try {
              return JSON.parse(line);
            } catch {
              return null;
            }
          })
          .filter(Boolean);

        resolve(results);
      });
    });

    req.on('error', reject);
    req.setTimeout(5000, () => {
      req.destroy();
      reject(new Error('ClickHouse query timeout'));
    });

    // Append FORMAT JSONEachRow for structured output
    req.write(query + ' FORMAT JSONEachRow');
    req.end();
  });
}

/**
 * Normalize domain by stripping www. prefix for consistent matching
 * @param {string} domain - Domain to normalize
 * @returns {string|null} Normalized domain
 */
function normalizeDomain(domain) {
  if (!domain) return null;
  // Strip www. prefix for consistent matching
  return domain.toLowerCase().replace(/^www\./, '');
}

/**
 * Extract domain from origin URL
 * @param {string} origin - Origin URL (e.g., 'https://example.com')
 * @returns {string} Normalized domain (e.g., 'example.com')
 */
function extractDomain(origin) {
  if (!origin) return null;

  try {
    const url = new URL(origin);
    return normalizeDomain(url.hostname);
  } catch {
    // Handle bare domains without protocol
    return normalizeDomain(origin.replace(/^https?:\/\//, '').split('/')[0]);
  }
}

/**
 * Look up tenant by origin domain
 * @param {string} origin - Origin URL (e.g., 'https://example.com')
 * @returns {Promise<{tenantId: string, name: string} | null>} Tenant info or null
 */
async function getTenantByOrigin(origin) {
  const domain = extractDomain(origin);
  if (!domain) {
    log.debug({ origin }, 'No domain extracted from origin');
    return null;
  }

  // Check cache first
  const cacheKey = domain.toLowerCase();
  const cached = tenantCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    log.debug({ domain }, 'Cache hit for domain');
    return cached.tenant;
  }

  try {
    // Query tenants where AllowedDomains contains this domain
    // Using parameterized query to prevent SQL injection
    const query = `
      SELECT TenantId, Name
      FROM tenants FINAL
      WHERE has(AllowedDomains, {domain:String})
      LIMIT 1
    `;

    log.debug({ query: query.trim(), params: { domain } }, 'Executing query');

    const results = await executeQuery(query, { domain });

    if (results.length > 0) {
      const tenant = {
        tenantId: results[0].TenantId,
        name: results[0].Name,
      };

      // Cache the result
      tenantCache.set(cacheKey, { tenant, timestamp: Date.now() });

      log.debug({ tenant }, 'Found tenant');
      return tenant;
    }

    // Cache negative result too (to avoid repeated lookups for unknown domains)
    tenantCache.set(cacheKey, { tenant: null, timestamp: Date.now() });

    log.debug({ domain }, 'No tenant found for domain');
    return null;
  } catch (error) {
    log.error({ err: error }, 'Error looking up tenant');
    // On error, don't cache - let subsequent requests try again
    return null;
  }
}

/**
 * Test ClickHouse connection
 * @returns {Promise<boolean>} True if connection successful
 */
async function testConnection() {
  try {
    const results = await executeQuery('SELECT 1 as ok');
    return results.length > 0 && results[0].ok === 1;
  } catch (error) {
    log.error({ err: error }, 'Connection test failed');
    return false;
  }
}

/**
 * Clear tenant cache (useful for testing)
 */
function clearCache() {
  tenantCache.clear();
}

module.exports = {
  getTenantByOrigin,
  testConnection,
  clearCache,
  // Export for testing
  extractDomain,
  normalizeDomain,
};
