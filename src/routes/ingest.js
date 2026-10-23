const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const { requireIngestKey } = require('../middleware/auth');
const { ingestLead } = require('../services/ingest');

router.use(rateLimit({ windowMs: 60e3, limit: 1200, standardHeaders: true, legacyHeaders: false }));
router.use(requireIngestKey);

// POST /api/v1/leads  — one lead object, or an array of up to 500
router.post('/', async (req, res, next) => {
  try {
    const batch = Array.isArray(req.body);
    const items = batch ? req.body : [req.body];
    if (items.length > 500) return res.status(413).json({ success: false, error: 'Max 500 leads per request' });

    const results = [];
    for (const item of items) {
      try {
        const r = await ingestLead(item || {});
        results.push({ success: true, ...r });
      } catch (e) {
        if (e.status === 422) results.push({ success: false, lead_id: e.leadId || null, errors: e.errors });
        else throw e;
      }
    }
    if (!batch) {
      const r = results[0];
      return res.status(r.success ? 202 : 422).json(r.success ? { success: true, lead_id: r.lead_id, status: r.status } : r);
    }
    res.status(202).json({ success: results.every((r) => r.success), results });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
