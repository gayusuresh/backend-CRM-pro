const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { jwtSecret, ingestKeys } = require('../config');

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();

exports.requireAuth = (req, res, next) => {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not signed in' });
  try {
    req.user = jwt.verify(token, jwtSecret);
    next();
  } catch {
    res.status(401).json({ error: 'Session expired. Sign in again.' });
  }
};

// admin > ops > viewer. requireRole('ops') allows ops and admin.
const RANK = { viewer: 1, ops: 2, admin: 3 };
exports.requireRole = (min) => (req, res, next) =>
  (RANK[req.user?.role] || 0) >= RANK[min] ? next() : res.status(403).json({ error: `Requires ${min} role` });

// CollegeSera central CRM -> middleware
exports.requireIngestKey = (req, res, next) => {
  const supplied = sha(req.headers['x-api-key'] || '');
  const ok = ingestKeys.some((k) => crypto.timingSafeEqual(supplied, sha(k)));
  return ok ? next() : res.status(401).json({ success: false, error: 'Invalid API key' });
};
