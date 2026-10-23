const { RoutingRule, MasterMapping } = require('../models');
const { requireAuth, requireRole } = require('../middleware/auth');
const { route } = require('../services/routing');
const { normalize } = require('../services/ingest');
const audit = require('../utils/audit');

const routing = require('express').Router();
routing.use(requireAuth);

routing.get('/', async (_req, res) => res.json(await RoutingRule.find().sort({ priority: 1 })));

routing.post('/', requireRole('ops'), async (req, res) => {
  const r = await RoutingRule.create(req.body);
  audit(req, 'routing.create', 'RoutingRule', r.id, { name: r.name });
  res.status(201).json(r);
});

routing.put('/:id', requireRole('ops'), async (req, res) => {
  const { rrCounter, ...patch } = req.body;
  const r = await RoutingRule.findByIdAndUpdate(req.params.id, patch, { new: true, runValidators: true });
  audit(req, 'routing.update', 'RoutingRule', req.params.id, { name: r?.name });
  res.json(r);
});

routing.delete('/:id', requireRole('ops'), async (req, res) => {
  await RoutingRule.deleteOne({ _id: req.params.id });
  audit(req, 'routing.delete', 'RoutingRule', req.params.id);
  res.json({ ok: true });
});

// "Where would this lead go?" — no side effects.
routing.post('/preview', async (req, res) => {
  const hits = await route(normalize(req.body || {}), { dryRun: true });
  res.json(hits);
});

const mappings = require('express').Router();
mappings.use(requireAuth);

mappings.get('/', async (req, res) => {
  const q = req.query.clientId ? { clientId: req.query.clientId } : {};
  res.json(await MasterMapping.find(q).sort({ field: 1 }));
});

mappings.put('/', requireRole('ops'), async (req, res) => {
  const { clientId, field, entries = [], onMissing = 'passthrough' } = req.body;
  if (!clientId || !field) return res.status(400).json({ error: 'clientId and field are required' });
  const clean = entries.filter((e) => e.from && e.to).map((e) => ({ from: String(e.from).trim(), to: String(e.to).trim() }));
  const m = await MasterMapping.findOneAndUpdate({ clientId, field }, { entries: clean, onMissing }, { new: true, upsert: true });
  audit(req, 'mapping.save', 'MasterMapping', m.id, { clientId, field, count: clean.length });
  res.json(m);
});

mappings.delete('/:id', requireRole('ops'), async (req, res) => {
  await MasterMapping.deleteOne({ _id: req.params.id });
  audit(req, 'mapping.delete', 'MasterMapping', req.params.id);
  res.json({ ok: true });
});

module.exports = { routing, mappings };
