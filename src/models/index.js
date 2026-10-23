const mongoose = require('mongoose');
const { logTtlDays } = require('../config');
const { Schema } = mongoose;

const kv = { _id: false, key: String, value: String };

const User = new Schema(
  {
    name: String,
    email: { type: String, unique: true, lowercase: true, required: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ['admin', 'ops', 'viewer'], default: 'viewer' },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

const Client = new Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    crmType: { type: String, default: 'generic_rest' }, // npf | meritto | leadsquared | zoho | generic_rest | generic_webhook
    status: { type: String, enum: ['draft', 'active', 'inactive'], default: 'draft' },

    // --- Request ---
    apiUrl: String,
    method: { type: String, default: 'POST' },
    contentType: { type: String, default: 'json' }, // json | form
    timeoutMs: { type: Number, default: 15000 },
    headers: [kv],
    queryParams: [kv],
    payloadTemplate: String, // JSON text with {{lead.x}} {{campaign.x}} {{client.x}} {{secrets.x}}

    // --- Auth ---
    authType: { type: String, default: 'none' }, // none | api_key | bearer | basic | oauth2
    apiKeyIn: { type: String, default: 'header' },
    apiKeyName: String,
    apiKeySecret: { type: String, default: 'apiKey' }, // which stored secret holds the key
    oauth: {
      tokenUrl: String,
      grantType: { type: String, default: 'refresh_token' }, // refresh_token | client_credentials
      scope: String,
      tokenPrefix: { type: String, default: 'Bearer' },
    },
    // Named secrets, AES-256-GCM encrypted. Never returned by the API.
    secrets: { type: Map, of: String, default: {} },

    // --- Static values usable as {{client.*}} / {{campaign.*}} ---
    defaultValues: { collegeId: String, source: String, medium: String, campaign: String },

    // --- Response interpretation ---
    responseMapping: {
      successStatusCodes: { type: [Number], default: [] }, // empty = any 2xx
      successPath: String, // e.g. Status  (optional body check)
      successValue: String, // e.g. Success
      externalIdPath: String, // e.g. data.lead_id
      errorPath: String, // e.g. message
    },

    duplicate: {
      enabled: { type: Boolean, default: true },
      keys: { type: [String], default: ['mobile'] }, // mobile | email | leadId
      mode: { type: String, default: 'any' }, // any (OR) | all (AND)
      scope: { type: String, default: 'client' }, // client | global
    },

    retry: {
      maxRetries: { type: Number, default: 3 },
      delaysMinutes: { type: [Number], default: [1, 5, 15] },
      retryOn4xx: { type: Boolean, default: false },
    },

    lastTest: { at: Date, success: Boolean, httpStatus: Number, error: String },
  },
  { timestamps: true }
);

const RoutingRule = new Schema(
  {
    name: { type: String, required: true },
    priority: { type: Number, default: 100 }, // lower runs first
    active: { type: Boolean, default: true },
    match: { type: String, enum: ['all', 'any'], default: 'all' },
    conditions: [
      { _id: false, field: String, op: { type: String, default: 'eq' }, value: String },
    ],
    strategy: { type: String, enum: ['single', 'round_robin', 'weighted'], default: 'single' },
    targets: [{ _id: false, clientId: { type: Schema.Types.ObjectId, ref: 'Client' }, weight: { type: Number, default: 1 } }],
    stopOnMatch: { type: Boolean, default: true },
    rrCounter: { type: Number, default: 0 },
  },
  { timestamps: true }
);

const MasterMapping = new Schema(
  {
    clientId: { type: Schema.Types.ObjectId, ref: 'Client', required: true },
    field: { type: String, required: true }, // course | specialization | campus | state | city | ...
    entries: [{ _id: false, from: String, to: String }],
    onMissing: { type: String, enum: ['passthrough', 'fail'], default: 'passthrough' },
  },
  { timestamps: true }
);
MasterMapping.index({ clientId: 1, field: 1 }, { unique: true });

const Lead = new Schema(
  {
    leadId: { type: String, required: true, index: true },
    clientId: { type: Schema.Types.ObjectId, ref: 'Client', default: null },
    clientName: String,
    crm: String,
    ruleId: Schema.Types.ObjectId,
    data: Schema.Types.Mixed,
    status: {
      type: String,
      enum: ['queued', 'processing', 'pending', 'success', 'failed', 'duplicate', 'unrouted'],
      default: 'queued',
    },
    attempts: { type: Number, default: 0 },
    externalLeadId: String,
    lastError: String,
    lastHttpStatus: Number,
    nextRetryAt: Date,
    enqueuedAt: Date,
    lastAttemptAt: Date,
    pushedAt: Date,
    duplicateOf: Schema.Types.ObjectId,
  },
  { timestamps: true }
);
Lead.index({ status: 1, createdAt: -1 });
Lead.index({ clientId: 1, status: 1, createdAt: -1 });
Lead.index({ clientId: 1, 'data.mobile': 1 });
Lead.index({ clientId: 1, 'data.email': 1 });
Lead.index({ 'data.mobile': 1 });
Lead.index({ 'data.email': 1 });

const PushLog = new Schema({
  leadDocId: Schema.Types.ObjectId,
  leadId: { type: String, index: true },
  clientId: Schema.Types.ObjectId,
  clientName: String,
  crm: String,
  apiUrl: String,
  method: String,
  requestAt: Date,
  requestHeaders: Schema.Types.Mixed, // redacted
  requestPayload: Schema.Types.Mixed, // redacted
  responseAt: Date,
  durationMs: Number,
  httpStatus: Number,
  responseBody: String, // redacted + truncated
  success: Boolean,
  error: String,
  attempt: Number,
  externalLeadId: String,
  isTest: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});
PushLog.index({ clientId: 1, createdAt: -1 });
PushLog.index({ createdAt: 1 }, { expireAfterSeconds: logTtlDays * 86400 });

const AuditLog = new Schema(
  {
    userId: Schema.Types.ObjectId,
    userEmail: String,
    action: String,
    entity: String,
    entityId: String,
    details: Schema.Types.Mixed,
    ip: String,
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

module.exports = {
  User: mongoose.model('User', User),
  Client: mongoose.model('Client', Client),
  RoutingRule: mongoose.model('RoutingRule', RoutingRule),
  MasterMapping: mongoose.model('MasterMapping', MasterMapping),
  Lead: mongoose.model('Lead', Lead),
  PushLog: mongoose.model('PushLog', PushLog),
  AuditLog: mongoose.model('AuditLog', AuditLog),
};
