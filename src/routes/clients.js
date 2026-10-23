const router = require('express').Router();
const { Client, Lead, MasterMapping } = require('../models');
const { requireAuth, requireRole } = require('../middleware/auth');
const { encrypt } = require('../utils/crypto');
const { assertSafeUrl } = require('../utils/url');
const { testClient } = require('../services/delivery');
const { enqueue } = require('../services/queue');
const presets = require('../services/presets');
const audit = require('../utils/audit');

router.use(requireAuth);

const FIELDS = ['name', 'crmType', 'apiUrl', 'method', 'contentType', 'timeoutMs', 'headers', 'queryParams', 'payloadTemplate',
  'authType', 'apiKeyIn', 'apiKeyName', 'apiKeySecret', 'oauth', 'defaultValues', 'responseMapping', 'duplicate', 'retry'];
const SECRET_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,40}$/;

// Secrets are never serialized. The UI only learns which secret NAMES are saved.
function serialize(c) {
  const o = c.toObject({ flattenMaps: true });
  o.secretNames = Object.keys(o.secrets || {});
  delete o.secrets;
  return o;
}

function validate(body) {
  if (body.apiUrl) assertSafeUrl(body.apiUrl.replace(/\{\{[^}]*\}\}/g, 'x'));
  if (body.payloadTemplate) JSON.parse(body.payloadTemplate); // throws on invalid JSON
  if (body.method && !['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(body.method)) throw new Error('Unsupported HTTP method');
}

function applyBody(client, body) {
  for (const f of FIELDS) if (body[f] !== undefined) client[f] = body[f];
  if (Array.isArray(body.secretNames)) {
    const next = new Map();
    for (const n of body.secretNames) {
      if (!SECRET_NAME.test(n)) throw new Error(`Invalid secret name "${n}"`);
      const fresh = body.secrets?.[n];
      if (fresh) next.set(n, encrypt(fresh));
      else if (client.secrets?.get?.(n)) next.set(n, client.secrets.get(n)); // blank = keep existing
    }
    client.secrets = next;
  }
}

router.get('/presets', (_req, res) => res.json(presets));

router.get('/', async (_req, res) => res.json((await Client.find().sort({ name: 1 })).map(serialize)));

router.get('/:id', async (req, res) => {
  const c = await Client.findById(req.params.id);
  c ? res.json(serialize(c)) : res.status(404).json({ error: 'Client not found' });
});

router.post('/', requireRole('ops'), async (req, res) => {
  try {
    validate(req.body);
    const c = new Client({ status: 'draft' });
    applyBody(c, req.body);
    await c.save();
    audit(req, 'client.create', 'Client', c.id, { name: c.name, crm: c.crmType });
    res.status(201).json(serialize(c));
  } catch (e) {
    res.status(e.code === 11000 ? 409 : 400).json({ error: e.code === 11000 ? 'A client with this name already exists' : e.message });
  }
});

router.put('/:id', requireRole('ops'), async (req, res) => {
  try {
    const c = await Client.findById(req.params.id);
    if (!c) return res.status(404).json({ error: 'Client not found' });
    validate(req.body);
    applyBody(c, req.body);
    c.lastTest = undefined; // config changed: previous test no longer proves anything
    await c.save();
    audit(req, 'client.update', 'Client', c.id, { fields: Object.keys(req.body).filter((k) => k !== 'secrets'), secretsChanged: Object.keys(req.body.secrets || {}) });
    res.json(serialize(c));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Send Test Lead -> Verify Response. WARNING: creates a real lead in the destination CRM.
router.post('/:id/test', requireRole('ops'), async (req, res) => {
  const c = await Client.findById(req.params.id);
  if (!c) return res.status(404).json({ error: 'Client not found' });
  const r = await testClient(c, req.body?.lead || {});
  c.lastTest = { at: new Date(), success: r.ok, httpStatus: r.httpStatus, error: r.error || undefined };
  await c.save();
  audit(req, 'client.test', 'Client', c.id, { success: r.ok, httpStatus: r.httpStatus });
  res.json({
    success: r.ok, httpStatus: r.httpStatus, error: r.error, externalLeadId: r.externalId,
    durationMs: r.durationMs, request: r.request, responseBody: r.responseBody,
  });
});

router.post('/:id/status', requireRole('ops'), async (req, res) => {
  const { status, force } = req.body;
  if (!['draft', 'active', 'inactive'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
  const c = await Client.findById(req.params.id);
  if (!c) return res.status(404).json({ error: 'Client not found' });
  if (status === 'active' && !c.lastTest?.success && !(force && req.user.role === 'admin')) {
    return res.status(400).json({ error: 'Send a successful test lead before activating this client' });
  }
  c.status = status;
  await c.save();
  audit(req, 'client.status', 'Client', c.id, { status, force: !!force });

  if (status === 'active') { // resume anything parked while the client was inactive
    const parked = await Lead.find({ clientId: c._id, status: 'pending', nextRetryAt: null }).select('_id');
    for (const l of parked) {
      await Lead.updateOne({ _id: l._id }, { status: 'queued' });
      enqueue(l._id).catch(() => {});
    }
  }
  res.json(serialize(c));
});

router.delete('/:id', requireRole('admin'), async (req, res) => {
  if (await Lead.exists({ clientId: req.params.id })) {
    return res.status(409).json({ error: 'This client has leads. Set it to inactive instead of deleting.' });
  }
  await Client.deleteOne({ _id: req.params.id });
  await MasterMapping.deleteMany({ clientId: req.params.id });
  audit(req, 'client.delete', 'Client', req.params.id);
  res.json({ ok: true });
});

module.exports = router;
