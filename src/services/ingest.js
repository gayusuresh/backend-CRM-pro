const { Lead, Client } = require('../models');
const { route } = require('./routing');
const { findDuplicate } = require('./dedupe');
const { enqueueSafe } = require('./queue');

function normalize(p) {
  const d = { ...p };
  d.leadId = String(p.lead_id ?? p.leadId ?? '').trim();
  d.lead_id = d.leadId;
  if (d.mobile) d.mobile = String(d.mobile).replace(/\D/g, '').slice(-10); // India: last 10 digits
  if (d.email) d.email = String(d.email).trim().toLowerCase();
  if (d.name) d.name = String(d.name).trim();
  return d;
}

function validate(d) {
  const e = [];
  if (!d.leadId) e.push('lead_id is required');
  if (!d.name) e.push('name is required');
  if (!d.mobile && !d.email) e.push('mobile or email is required');
  if (!d.college) e.push('college is required');
  return e;
}

/** Save + route + dedupe, then hand off to the queue. Does NOT call any client CRM. */
async function ingestLead(payload) {
  const data = normalize(payload);
  const errors = validate(data);
  if (errors.length) { const err = new Error('Validation failed'); err.status = 422; err.errors = errors; err.leadId = data.leadId; throw err; }

  const destinations = await route(data);
  if (!destinations.length) {
    const exists = await Lead.findOne({ leadId: data.leadId, clientId: null }).select('_id');
    if (!exists) await Lead.create({ leadId: data.leadId, data, status: 'unrouted', lastError: 'No routing rule matched' });
    return { lead_id: data.leadId, status: 'unrouted', destinations: [] };
  }

  const results = [];
  for (const dest of destinations) {
    const client = await Client.findById(dest.clientId).select('name crmType duplicate status');
    if (!client) continue;

    const same = await Lead.findOne({ leadId: data.leadId, clientId: client._id }).select('status');
    if (same) { results.push({ client: client.name, status: same.status === 'success' ? 'duplicate' : same.status }); continue; }

    const base = { leadId: data.leadId, clientId: client._id, clientName: client.name, crm: client.crmType, ruleId: dest.ruleId, data };
    const dup = await findDuplicate(client, data);
    if (dup) {
      await Lead.create({ ...base, status: 'duplicate', duplicateOf: dup._id, lastError: `Duplicate of ${dup.leadId}` });
      results.push({ client: client.name, status: 'duplicate' });
      continue;
    }
    const doc = await Lead.create({ ...base, status: 'queued' });
    enqueueSafe(doc._id); // intentionally not awaited beyond a 2s guard inside
    results.push({ client: client.name, status: 'queued' });
  }

  const status = results.some((r) => r.status === 'queued') ? 'queued' : results[0]?.status || 'unrouted';
  return { lead_id: data.leadId, status, destinations: results };
}

module.exports = { ingestLead, normalize };
