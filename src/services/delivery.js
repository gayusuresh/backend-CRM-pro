const { Lead, Client, PushLog } = require('../models');
const { decrypt } = require('../utils/crypto');
const { execute } = require('./executor');
const { applyMappings, PermanentError } = require('./mapping');
const { enqueue } = require('./queue');

const SAMPLE_LEAD = {
  lead_id: 'TEST-0001', leadId: 'TEST-0001', name: 'Test Student', email: 'test.student@example.com', mobile: '9000000001',
  state: 'Tamil Nadu', city: 'Coimbatore', college: 'Test College', course: 'B.Com', specialization: 'Accounting',
  source: 'CollegeSera', campaign: 'Test Campaign',
};

function decryptSecrets(client) {
  const out = {};
  const m = client.secrets;
  if (!m) return out;
  for (const [k, v] of m instanceof Map ? m.entries() : Object.entries(m)) out[k] = decrypt(v);
  return out;
}

async function buildContext(client, rawLead) {
  const lead = await applyMappings(client._id, rawLead);
  const dv = client.defaultValues || {};
  return {
    lead,
    raw: rawLead,
    campaign: { name: rawLead.campaign || dv.campaign || '', medium: rawLead.medium || dv.medium || '', source: dv.source || rawLead.source || '' },
    client: { name: client.name, collegeId: dv.collegeId, source: dv.source, medium: dv.medium, campaign: dv.campaign },
    now: new Date().toISOString(),
  };
}

async function push(client, rawLead) {
  try {
    const ctx = await buildContext(client, rawLead);
    return await execute(client, ctx, decryptSecrets(client));
  } catch (e) {
    return { ok: false, error: e.message, requestAt: new Date(), responseAt: new Date(), retryable: !(e instanceof PermanentError), request: {} };
  }
}

const writeLog = (client, leadDoc, r, attempt, isTest) =>
  PushLog.create({
    leadDocId: leadDoc?._id,
    leadId: leadDoc?.leadId || SAMPLE_LEAD.lead_id,
    clientId: client._id,
    clientName: client.name,
    crm: client.crmType,
    apiUrl: r.request?.url || client.apiUrl,
    method: r.request?.method || client.method,
    requestAt: r.requestAt,
    requestHeaders: r.request?.headers,
    requestPayload: r.request?.body ?? r.request?.params,
    responseAt: r.responseAt,
    durationMs: r.durationMs,
    httpStatus: r.httpStatus,
    responseBody: r.responseBody,
    success: r.ok,
    error: r.error || undefined,
    attempt,
    externalLeadId: r.externalId,
    isTest,
  });

/** Worker entry point: one delivery attempt for one lead document. */
async function deliverLead(id) {
  // Atomic claim: prevents two workers (or a duplicate job) from pushing the same lead twice.
  const lead = await Lead.findOneAndUpdate(
    { _id: id, status: { $in: ['queued', 'pending'] } },
    { $set: { status: 'processing', lastAttemptAt: new Date() } },
    { new: true }
  );
  if (!lead) return;

  const client = await Client.findById(lead.clientId);
  if (!client) {
    await Lead.updateOne({ _id: id }, { status: 'failed', lastError: 'Client no longer exists' });
    return;
  }
  if (client.status !== 'active') {
    await Lead.updateOne({ _id: id }, { status: 'pending', lastError: 'Client is not active. Will resume when activated.', nextRetryAt: null });
    return;
  }

  const attempt = lead.attempts + 1;
  const r = await push(client, lead.data);
  await writeLog(client, lead, r, attempt, false);

  if (r.ok) {
    await Lead.updateOne({ _id: id }, {
      status: 'success', attempts: attempt, externalLeadId: r.externalId, lastHttpStatus: r.httpStatus,
      lastError: null, nextRetryAt: null, pushedAt: new Date(),
    });
    return;
  }

  const maxRetries = client.retry?.maxRetries ?? 3;
  const delays = client.retry?.delaysMinutes?.length ? client.retry.delaysMinutes : [1, 5, 15];
  const base = { attempts: attempt, lastError: r.error, lastHttpStatus: r.httpStatus };

  if (r.retryable && attempt <= maxRetries) {
    const delayMin = delays[Math.min(attempt - 1, delays.length - 1)];
    await Lead.updateOne({ _id: id }, { ...base, status: 'pending', nextRetryAt: new Date(Date.now() + delayMin * 60000) });
    await enqueue(id, delayMin * 60000);
  } else {
    await Lead.updateOne({ _id: id }, { ...base, status: 'failed', nextRetryAt: null });
  }
}

/** "Send test lead" from the admin panel. NOTE: this creates a real lead in the destination CRM. */
async function testClient(client, override = {}) {
  const sample = { ...SAMPLE_LEAD, ...override };
  const r = await push(client, sample);
  await writeLog(client, { leadId: sample.lead_id }, r, 1, true);
  return r;
}

module.exports = { deliverLead, testClient, SAMPLE_LEAD };
