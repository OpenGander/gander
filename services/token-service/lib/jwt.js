/**
 * JWT Token Utilities
 *
 * Shared utilities for JWT token generation and validation.
 */

const jwt = require('jsonwebtoken');
const { trace, metrics, SpanStatusCode } = require('@opentelemetry/api');
const logger = require('./logger');

const log = logger.child({ component: 'jwt' });

const TOKEN_SECRET = process.env.OTEL_TOKEN_SECRET;
const TOKEN_TTL = parseInt(process.env.TOKEN_TTL || '300', 10); // Default 5 minutes
const CLOCK_SKEW_TOLERANCE = parseInt(process.env.CLOCK_SKEW_TOLERANCE || '60', 10);

// OTEL instrumentation
const tracer = trace.getTracer('token-service');
const meter = metrics.getMeter('token-service');

const tokensGenerated = meter.createCounter('token.generated', {
  description: 'Number of tokens generated',
});
const tokensValidated = meter.createCounter('token.validated', {
  description: 'Number of tokens validated',
});
const tokensInvalid = meter.createCounter('token.invalid', {
  description: 'Number of invalid token attempts',
});
const clockSkewGauge = meter.createGauge('token.clock_skew_seconds', {
  description: 'Maximum observed clock skew in seconds',
});

// Clock skew metrics tracking (kept for /metrics endpoint)
const clockSkewMetrics = {
  detectedSkews: 0,
  maxObservedSkew: 0,
  skewWarnings: 0,
};

// Validation metrics (kept for /metrics endpoint)
let validationCount = 0;
let validCount = 0;
let invalidCount = 0;

/**
 * Generate a JWT token for telemetry sessions
 * @param {string} origin - The origin of the requesting page
 * @param {string} clientIP - The client IP address
 * @param {string} tenantId - The tenant ID for this origin (optional)
 * @returns {Object} Token data including token string and expiry info
 */
function generateToken(origin, clientIP, tenantId = null) {
  return tracer.startActiveSpan('token.generate', (span) => {
    const now = Math.floor(Date.now() / 1000);
    const exp = now + TOKEN_TTL;

    const claims = {
      origin: origin || 'unknown',
      ip: clientIP,
      iat: now,
      exp: exp,
    };

    if (tenantId) {
      claims.tenantId = tenantId;
    }

    const token = jwt.sign(claims, TOKEN_SECRET, { algorithm: 'HS256' });

    span.setAttributes({
      'token.origin': claims.origin,
      'token.tenant_id': tenantId || 'none',
      'token.ttl_seconds': TOKEN_TTL,
    });
    span.end();

    tokensGenerated.add(1, { origin: claims.origin });

    return {
      token,
      expiresIn: TOKEN_TTL,
      expiresAt: new Date(exp * 1000).toISOString(),
      tenantId: tenantId || null,
    };
  });
}

/**
 * Detect and track clock skew between services
 * Returns the absolute clock skew in seconds
 */
function detectClockSkew(decoded) {
  const now = Math.floor(Date.now() / 1000);
  const tokenTime = decoded.iat;
  const skew = Math.abs(now - tokenTime);

  // Update metrics if significant skew detected
  if (skew > 5) {
    // More than 5 seconds difference
    clockSkewMetrics.detectedSkews++;
    clockSkewMetrics.maxObservedSkew = Math.max(clockSkewMetrics.maxObservedSkew, skew);
    clockSkewGauge.record(clockSkewMetrics.maxObservedSkew);

    if (skew > CLOCK_SKEW_TOLERANCE * 0.8) {
      // 80% of tolerance
      clockSkewMetrics.skewWarnings++;
      log.warn(
        {
          skewSeconds: skew,
          toleranceSeconds: CLOCK_SKEW_TOLERANCE,
          percentOfTolerance: Math.round((skew / CLOCK_SKEW_TOLERANCE) * 100),
        },
        'Large clock skew detected'
      );
    }
  }

  return skew;
}

/**
 * Validate a JWT token
 * @param {string} token - The JWT token to validate
 * @param {string} requestOrigin - The origin from the request
 * @param {string} requestIP - The IP from the request
 * @returns {Object} Validation result with valid flag and optional error
 */
function validateToken(token, requestOrigin, requestIP) {
  return tracer.startActiveSpan('token.validate', (span) => {
    validationCount++;

    // Verify and decode JWT token (ignore expiration, we'll check it manually with clock skew)
    let decoded;
    try {
      decoded = jwt.verify(token, TOKEN_SECRET, {
        algorithms: ['HS256'],
        ignoreExpiration: true,
      });
    } catch (error) {
      invalidCount++;
      tokensInvalid.add(1, { reason: 'invalid_signature' });
      span.setStatus({ code: SpanStatusCode.ERROR, message: 'Invalid token signature' });
      span.end();
      if (error.name === 'JsonWebTokenError') {
        return { valid: false, error: 'Invalid token signature', status: 401 };
      }
      return {
        valid: false,
        error: 'Token validation failed',
        details: error.message,
        status: 401,
      };
    }

    span.setAttributes({
      'token.origin': decoded.origin || 'unknown',
      'token.tenant_id': decoded.tenantId || 'none',
    });

    // Validate token has required claims
    if (!decoded.origin || !decoded.ip || !decoded.exp) {
      invalidCount++;
      tokensInvalid.add(1, { reason: 'missing_claims' });
      span.setStatus({ code: SpanStatusCode.ERROR, message: 'Missing required claims' });
      span.end();
      return { valid: false, error: 'Token missing required claims', status: 401 };
    }

    // Detect and track clock skew
    detectClockSkew(decoded);

    // Validate expiration with clock skew tolerance
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = decoded.exp;

    if (expiresAt + CLOCK_SKEW_TOLERANCE < now) {
      const skew = now - expiresAt;

      log.debug(
        {
          now,
          expiresAt,
          skewSeconds: skew,
          toleranceSeconds: CLOCK_SKEW_TOLERANCE,
          origin: decoded.origin,
        },
        'Token expired'
      );

      invalidCount++;
      tokensInvalid.add(1, { reason: 'expired' });
      span.setStatus({ code: SpanStatusCode.ERROR, message: 'Token expired' });
      span.end();
      return { valid: false, error: 'Token expired', status: 401 };
    }

    // Check if token was issued in the future (clock running behind)
    const issuedAt = decoded.iat;
    if (issuedAt - CLOCK_SKEW_TOLERANCE > now) {
      const skew = issuedAt - now;

      log.debug(
        {
          now,
          issuedAt,
          skewSeconds: skew,
          toleranceSeconds: CLOCK_SKEW_TOLERANCE,
          origin: decoded.origin,
        },
        'Token issued in future'
      );

      invalidCount++;
      tokensInvalid.add(1, { reason: 'future_issued' });
      span.setStatus({ code: SpanStatusCode.ERROR, message: 'Token issued in future' });
      span.end();
      return { valid: false, error: 'Token issued in future (clock skew)', status: 401 };
    }

    log.debug({ timeRemaining: expiresAt - now }, 'Token valid');

    // Validate origin matches
    if (decoded.origin !== requestOrigin) {
      invalidCount++;
      tokensInvalid.add(1, { reason: 'origin_mismatch' });
      span.setStatus({ code: SpanStatusCode.ERROR, message: 'Origin mismatch' });
      span.end();
      return {
        valid: false,
        error: 'Origin mismatch',
        tokenOrigin: decoded.origin,
        requestOrigin: requestOrigin || 'missing',
        status: 401,
      };
    }

    // Log IP changes
    if (decoded.ip !== requestIP) {
      log.info(
        {
          tokenIp: decoded.ip,
          requestIp: requestIP,
          origin: decoded.origin,
          tokenAge: now - (decoded.iat || 0),
        },
        'IP changed during session'
      );
      span.setAttribute('token.ip_changed', true);
    }

    // All validations passed
    validCount++;
    tokensValidated.add(1, { origin: decoded.origin });
    span.end();
    return {
      valid: true,
      tenantId: decoded.tenantId || null,
    };
  });
}

/**
 * Get validation metrics
 */
function getMetrics() {
  return {
    validationCount,
    validCount,
    invalidCount,
    clockSkew: {
      tolerance: CLOCK_SKEW_TOLERANCE,
      detectedSkews: clockSkewMetrics.detectedSkews,
      maxObservedSkew: clockSkewMetrics.maxObservedSkew,
      warnings: clockSkewMetrics.skewWarnings,
    },
  };
}

/**
 * Get clock skew metrics for health check
 */
function getClockSkewMetrics() {
  return clockSkewMetrics;
}

module.exports = {
  generateToken,
  validateToken,
  getMetrics,
  getClockSkewMetrics,
  TOKEN_TTL,
  CLOCK_SKEW_TOLERANCE,
};
