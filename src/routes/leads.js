const router = require('express').Router();
const escapeRegExp = require('lodash/escapeRegExp');
const { Lead, PushLog, AuditLog, Client } = require('../models');
const { requireAuth, requireRole } = require('../middleware/auth');
const { enqueue } = require('../services/queue');
const audit = require('../utils/audit');

router.use(requireAuth);

const page = (req) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  return { limit, skip: ((Number(req.query.page) || 1) - 1) * limit };
};

function leadFilter(q) {
  const f = {};
  if (q.status) f.status = { $in: String(q.status).split(',') };
  if (q.clientId) f.clientId = q.clientId;
  if (q.from || q.to) f.createdAt = { ...(q.from && { $gte: new Date(q.from) }), ...(q.to && { $lte: new Date(q.to) }) };
  if (q.q) {
    const rx = new RegExp(`^${escapeRegExp(String(q.q).trim())}`, 'i');
    f.$or = [{ leadId: rx }, { 'data.mobile': rx }, { 'data.email': rx }];
  }
  return f;
}

router.get('/leads', async (req, res) => {
  const f = leadFilter(req.query);
  const { limit, skip } = page(req);
  const [items, total] = await Promise.all([
    Lead.find(f).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Lead.countDocuments(f),
  ]);
  res.json({ items, total });
});

router.get('/leads/:id', async (req, res) => {
  const lead = await Lead.findById(req.params.id).lean();
  if (!lead) return res.status(404).json({ error: 'Lead not found' });
  const logs = await PushLog.find({ leadDocId: lead._id }).sort({ createdAt: -1 }).lean();
  res.json({ lead, logs });
});

async function requeue(ids) {
  await Lead.updateMany(
    { _id: { $in: ids }, status: { $in: ['failed', 'pending'] } },
    { status: 'queued', attempts: 0, nextRetryAt: null, lastError: null }
  );
  for (const id of ids) enqueue(id).catch(() => {}); // sweeper covers any enqueue failure
}

router.post('/leads/:id/retry', requireRole('ops'), async (req, res) => {
  const lead = await Lead.findById(req.params.id).select('status');
  if (!lead || !['failed', 'pending'].includes(lead.status)) return res.status(400).json({ error: 'Only failed or pending leads can be retried' });
  await requeue([lead._id]);
  audit(req, 'lead.retry', 'Lead', lead.id);
  res.json({ ok: true });
});

router.post('/leads-retry-bulk', requireRole('ops'), async (req, res) => {
  const f = { ...leadFilter(req.body || {}), status: { $in: ['failed', 'pending'] } };
  const ids = (await Lead.find(f).limit(2000).select('_id')).map((l) => l._id);
  await requeue(ids);
  audit(req, 'lead.retry_bulk', 'Lead', null, { count: ids.length, clientId: req.body?.clientId });
  res.json({ requeued: ids.length });
});

router.get('/logs', async (req, res) => {
  const f = {};
  if (req.query.clientId) f.clientId = req.query.clientId;
  if (req.query.success === 'true' || req.query.success === 'false') f.success = req.query.success === 'true';
  if (req.query.leadId) f.leadId = new RegExp(`^${escapeRegExp(req.query.leadId)}`, 'i');
  const { limit, skip } = page(req);
  const [items, total] = await Promise.all([
    PushLog.find(f).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    PushLog.countDocuments(f),
  ]);
  res.json({ items, total });
});

router.get('/dashboard', async (req, res) => {
  const from = req.query.from ? new Date(req.query.from) : new Date(new Date().setHours(0, 0, 0, 0));
  const to = req.query.to ? new Date(req.query.to) : new Date();
  const range = { createdAt: { $gte: from, $lte: to } };

  const [byStatus, byClient] = await Promise.all([
    Lead.aggregate([{ $match: range }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
    Lead.aggregate([{ $match: { ...range, clientId: { $ne: null } } }, { $group: { _id: { c: '$clientId', s: '$status' }, n: { $sum: 1 } } }]),
  ]);

  const summarize = (rows) => {
    const s = Object.fromEntries(rows.map(([k, n]) => [k, n]));
    const g = (k) => s[k] || 0;
    const total = Object.values(s).reduce((a, b) => a + b, 0);
    const eligible = total - g('unrouted');
    return {
      total, eligible,
      success: g('success'), failed: g('failed'), duplicates: g('duplicate'), unrouted: g('unrouted'),
      pending: g('queued') + g('processing') + g('pending'),
      successRate: eligible ? Math.round((g('success') / eligible) * 1000) / 10 : 0,
    };
  };

  const clients = await Client.find({ _id: { $in: [...new Set(byClient.map((r) => String(r._id.c)))] } }).select('name');
  const names = Object.fromEntries(clients.map((c) => [String(c._id), c.name]));
  const grouped = {};
  for (const r of byClient) (grouped[r._id.c] ||= []).push([r._id.s, r.n]);

  res.json({
    from, to,
    summary: summarize(byStatus.map((r) => [r._id, r.n])),
    clients: Object.entries(grouped).map(([id, rows]) => ({ clientId: id, name: names[id] || 'Deleted client', ...summarize(rows) }))
      .sort((a, b) => b.total - a.total),
  });
});

router.get('/audit', requireRole('admin'), async (req, res) => {
  const { limit, skip } = page(req);
  res.json({ items: await AuditLog.find().sort({ createdAt: -1 }).skip(skip).limit(limit).lean(), total: await AuditLog.estimatedDocumentCount() });
});

module.exports = router;
