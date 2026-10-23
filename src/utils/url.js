const net = require('net');

const PRIVATE = [/^127\./, /^10\./, /^192\.168\./, /^169\.254\./, /^172\.(1[6-9]|2\d|3[01])\./, /^0\./];

// Basic SSRF guard: ops users configure URLs, so refuse internal targets.
// (Does not defend against DNS rebinding; put the worker behind an egress proxy for that.)
function assertSafeUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { throw new Error('API URL is not a valid URL'); }
  if (process.env.NODE_ENV === 'production' && u.protocol !== 'https:') throw new Error('API URL must use https');
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('API URL must use http(s)');
  const h = u.hostname.toLowerCase();
  const blockedHost = h === 'localhost' || h.endsWith('.internal') || h.endsWith('.local') || h === '::1' || h === '[::1]';
  if (blockedHost || (net.isIPv4(h) && PRIVATE.some((r) => r.test(h)))) {
    if (process.env.ALLOW_PRIVATE_TARGETS !== 'true') throw new Error('API URL points to a private/internal address');
  }
  return u;
}

module.exports = { assertSafeUrl };
