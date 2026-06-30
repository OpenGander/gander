/**
 * IP Address Utilities
 *
 * Shared utilities for IP address normalization and extraction.
 * Used by both token generation and validation endpoints.
 */

const logger = require('./logger');
const log = logger.child({ component: 'ip' });

/**
 * Normalize IP address to handle IPv6 localhost variants
 * Ensures consistent IP representation across IPv4 and IPv6
 */
function normalizeIp(ip) {
  if (!ip) return ip;

  // Convert IPv6 localhost to IPv4
  if (ip === '::1' || ip === '::ffff:127.0.0.1') {
    return '127.0.0.1';
  }

  // Strip IPv6-mapped IPv4 prefix
  if (ip.startsWith('::ffff:')) {
    return ip.substring(7);
  }

  return ip;
}

/**
 * Extract client IP from request
 * AWS ALB sets X-Forwarded-For: <client-ip>, <cloudflare-ip>, ...
 * Take the first (leftmost) IP which is the original client
 */
function getClientIP(req) {
  // AWS ALB sets X-Forwarded-For with client IP first
  const xForwardedFor = req.headers['x-forwarded-for'];
  if (xForwardedFor) {
    const clientIp = xForwardedFor.split(',')[0].trim();
    return normalizeIp(clientIp);
  }

  // Fallback for local development
  const clientIp = normalizeIp(
    req.headers['x-real-ip'] || req.connection.remoteAddress || req.socket.remoteAddress || req.ip
  );

  log.debug(
    {
      xRealIp: req.headers['x-real-ip'],
      xForwardedFor: req.headers['x-forwarded-for'],
      connectionRemoteAddress: req.connection.remoteAddress,
      socketRemoteAddress: req.socket.remoteAddress,
      reqIp: req.ip,
      selected: clientIp,
    },
    'Client IP extraction'
  );

  return clientIp;
}

module.exports = {
  normalizeIp,
  getClientIP,
};
