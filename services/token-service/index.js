/**
 * Token Service
 *
 * Combined service for JWT token generation and validation for browser telemetry.
 *
 * Endpoints:
 * - GET /api/telemetry-token - Generate short-lived JWT tokens
 * - GET /validate - Validate tokens for Caddy forward_auth
 * - GET /health - Health check
 * - GET /metrics - Validation metrics
 *
 * Security considerations:
 * - Tokens expire in 2-5 minutes (configurable)
 * - Origin validation prevents cross-site token theft
 * - IP validation prevents token replay from different locations
 * - Short TTL limits damage if token is compromised
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const logger = require('./lib/logger');

const log = logger.child({ component: 'server' });
const securityLog = logger.child({ component: 'security' });

const { getClientIP } = require('./lib/ip');
const {
  generateToken,
  validateToken,
  getMetrics,
  getClockSkewMetrics,
  TOKEN_TTL,
  CLOCK_SKEW_TOLERANCE,
} = require('./lib/jwt');
const { getTenantByOrigin, testConnection: testClickHouse } = require('./lib/clickhouse');

const app = express();
const PORT = process.env.PORT || 3001;

// Configuration from environment variables
const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_PRODUCTION = NODE_ENV === 'production';
const TOKEN_SECRET = process.env.OTEL_TOKEN_SECRET;

// Parse allowed origins from environment variable
// Normalize by removing trailing slashes to ensure consistent matching
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',')
      .map((o) => o.trim().replace(/\/$/, ''))
      .filter(Boolean)
  : null;

// Validate required configuration
if (!TOKEN_SECRET) {
  log.fatal('OTEL_TOKEN_SECRET environment variable is required');
  process.exit(1);
}

// Fail fast in production if ALLOWED_ORIGINS not configured
if (IS_PRODUCTION && !ALLOWED_ORIGINS) {
  log.fatal(
    'ALLOWED_ORIGINS environment variable is required in production. Set ALLOWED_ORIGINS to a comma-separated list of allowed origins.'
  );
  process.exit(1);
}

// Warn in development if not configured
if (!IS_PRODUCTION && !ALLOWED_ORIGINS) {
  log.warn(
    'ALLOWED_ORIGINS not set - allowing all origins. This is insecure and should only be used for local development.'
  );
}

// Middleware
app.use(express.json());

// Trust proxy to get real client IP (important when behind reverse proxy)
app.set('trust proxy', true);

// CORS middleware - must run before any route handlers
// This ensures CORS headers are included even on error responses (like 403)
// so browsers can read the error message instead of showing generic CORS failure
app.use((req, res, next) => {
  const origin = req.headers.origin;

  // Skip CORS for /validate endpoint - it's only called internally by Caddy
  // Adding CORS headers here would conflict with Caddy's CORS headers
  if (req.path === '/validate') {
    return next();
  }

  // Always set CORS headers if there's an origin header
  // This allows browsers to read error responses (403, 500, etc.)
  // The actual security is in origin validation + tenant lookup in route handlers
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Max-Age', '86400'); // Cache preflight for 24h
  }

  // Handle preflight requests immediately
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  next();
});

// Rate limiting to prevent token generation abuse
// Limit: 100 requests per minute per IP
const tokenRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 requests per window
  message: { error: 'Too many token requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    return getClientIP(req) || 'unknown';
  },
  skip: () => false,
});

/**
 * Validate origin against allowed origins list
 */
function validateOrigin(origin) {
  // Development mode with no ALLOWED_ORIGINS set - allow all
  if (!IS_PRODUCTION && !ALLOWED_ORIGINS) {
    return true;
  }

  // Production or ALLOWED_ORIGINS is set - validate against list
  if (!ALLOWED_ORIGINS || ALLOWED_ORIGINS.length === 0) {
    return false;
  }

  // Support '*' as "allow all origins" - tenant lookup provides real security
  if (ALLOWED_ORIGINS.includes('*')) {
    return true;
  }

  if (!origin) {
    // No origin header = non-browser client (curl, Python, etc.)
    // Allow but log (rate limiting will prevent abuse)
    securityLog.warn('Request without Origin header (non-browser client?)');
    return true;
  }

  // Browser request - validate origin matches allowed list
  const allowed = ALLOWED_ORIGINS.some((allowedOrigin) => {
    const normalizedOrigin = origin.replace(/\/$/, '');

    // Exact match
    if (normalizedOrigin === allowedOrigin) {
      return true;
    }

    // Support wildcard subdomains (e.g., https://*.example.com)
    if (allowedOrigin.includes('*.')) {
      const wildcardPattern = allowedOrigin.replace('*.', '');

      if (normalizedOrigin === wildcardPattern) {
        return true;
      }

      const domainPart = wildcardPattern.split('//')[1];
      const originDomain = normalizedOrigin.split('//')[1];

      if (originDomain && domainPart) {
        return originDomain === domainPart || originDomain.endsWith('.' + domainPart);
      }
    }

    return false;
  });

  if (!allowed) {
    securityLog.warn({ origin }, 'Origin not allowed');
  }

  return allowed;
}

/**
 * Extract origin from request (Origin header or Referer)
 */
function extractOrigin(req) {
  let origin = req.headers.origin;
  if (!origin && req.headers.referer) {
    try {
      const refererUrl = new URL(req.headers.referer);
      origin = refererUrl.origin;
    } catch {
      origin = req.headers.referer;
    }
  }
  return origin;
}

/**
 * GET /api/telemetry-token
 *
 * Generates a short-lived JWT token for browser telemetry sessions.
 * Looks up tenant by origin domain and includes TenantId in the token.
 */
app.get('/api/telemetry-token', tokenRateLimit, async (req, res) => {
  try {
    const origin = extractOrigin(req);

    // Validate origin if configured
    if (!validateOrigin(origin)) {
      return res.status(403).json({
        error: 'Origin not allowed',
        origin: origin || 'missing',
      });
    }

    // Look up tenant by origin domain
    const tenant = await getTenantByOrigin(origin);

    // In production, require a valid tenant
    if (IS_PRODUCTION && !tenant) {
      securityLog.warn({ origin }, 'Token request from unknown tenant domain');
      return res.status(403).json({
        error: 'Unknown tenant domain',
        origin: origin || 'missing',
      });
    }

    const clientIP = getClientIP(req);
    const tenantId = tenant ? tenant.tenantId : null;
    const tokenData = generateToken(origin, clientIP, tenantId);

    res.json(tokenData);
  } catch (error) {
    log.error({ err: error }, 'Error generating token');
    res.status(500).json({
      error: 'Internal server error',
      message: error.message,
    });
  }
});

/**
 * GET /validate
 *
 * Validates JWT token for Caddy forward_auth.
 * On success, sets X-Tenant-Id header for downstream services.
 * NOTE: GET method required by Caddy's forward_auth directive
 */
app.get('/validate', (req, res) => {
  try {
    // Extract token from Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        valid: false,
        error: 'Missing or invalid Authorization header',
      });
    }

    const token = authHeader.substring(7);
    const requestOrigin = extractOrigin(req);
    const requestIP = getClientIP(req);

    const result = validateToken(token, requestOrigin, requestIP);

    if (result.valid) {
      // Set X-Tenant-Id header for Caddy to forward to collector
      if (result.tenantId) {
        res.set('X-Tenant-Id', result.tenantId);
      }
      res.status(200).json({ valid: true, tenantId: result.tenantId });
    } else {
      const { status, ...errorResponse } = result;
      res.status(status || 401).json(errorResponse);
    }
  } catch (error) {
    log.error({ err: error }, 'Error validating token');
    res.status(500).json({
      valid: false,
      error: 'Internal server error',
      message: error.message,
    });
  }
});

/**
 * GET /metrics
 *
 * Metrics endpoint for monitoring validation stats and clock skew
 */
app.get('/metrics', (req, res) => {
  const metrics = getMetrics();
  res.json({
    uptime: process.uptime(),
    ...metrics,
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /health
 *
 * Health check endpoint for monitoring and load balancers
 */
app.get('/health', (req, res) => {
  const clockSkewMetrics = getClockSkewMetrics();

  const health = {
    status: 'healthy',
    service: 'token-service',
    timestamp: new Date().toISOString(),
    serverTime: Math.floor(Date.now() / 1000),
    uptime: process.uptime(),
    environment: NODE_ENV,
    configuration: {
      allowedOriginsConfigured: !!ALLOWED_ORIGINS,
      allowedOriginsCount: ALLOWED_ORIGINS ? ALLOWED_ORIGINS.length : 0,
      tokenTTL: TOKEN_TTL,
      clockSkewTolerance: CLOCK_SKEW_TOLERANCE,
      rateLimit: '100/60000ms',
    },
  };

  // Warn if running in production without security config
  if (IS_PRODUCTION && !ALLOWED_ORIGINS) {
    health.status = 'unhealthy';
    health.error = 'ALLOWED_ORIGINS not configured in production';
    return res.status(503).json(health);
  }

  // Warn if significant clock skew detected recently
  if (clockSkewMetrics.maxObservedSkew > CLOCK_SKEW_TOLERANCE * 0.9) {
    health.warnings = [
      `High clock skew detected: ${clockSkewMetrics.maxObservedSkew}s (tolerance: ${CLOCK_SKEW_TOLERANCE}s)`,
    ];
  }

  res.json(health);
});

// Start server
app.listen(PORT, async () => {
  const clickhouseOk = await testClickHouse();

  log.info(
    {
      environment: NODE_ENV,
      port: PORT,
      allowedOrigins: ALLOWED_ORIGINS ? ALLOWED_ORIGINS.join(', ') : 'ALL (development only)',
      tokenTTL: TOKEN_TTL,
      clockSkewTolerance: CLOCK_SKEW_TOLERANCE,
      rateLimit: '100/60s',
      clickhouse: clickhouseOk ? 'connected' : 'NOT CONNECTED (tenant lookup disabled)',
    },
    'Token Service started'
  );

  if (!IS_PRODUCTION) {
    log.warn('Running in development mode');
  }
});

// Graceful shutdown
process.on('SIGTERM', () => {
  log.info('SIGTERM received, shutting down');
  process.exit(0);
});

process.on('SIGINT', () => {
  log.info('SIGINT received, shutting down');
  process.exit(0);
});
