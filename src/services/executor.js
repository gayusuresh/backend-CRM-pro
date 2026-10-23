const axios = require('axios');
const get = require('lodash/get');
const { render, renderString } = require('../utils/template');
const { redactSecrets, redactHeaders } = require('../utils/redact');
const { assertSafeUrl } = require('../utils/url');

// ---- OAuth2 token cache (in-process) ----
const tokenCache = new Map();

async function getOAuthToken(client, secrets) {
  const cacheKey = `${client._id}:${client.updatedAt?.getTime?.() || 0}`;
  const hit = tokenCache.get(cacheKey);
  if (hit && hit.exp > Date.now() + 30000) return hit.token;

  const o = client.oauth || {};
  const body = new URLSearchParams({ grant_type: o.grantType || 'refresh_token' });
  if (secrets.clientId) body.set('client_id', secrets.clientId);
  if (secrets.clientSecret) body.set('client_secret', secrets.clientSecret);
  if (o.grantType === 'refresh_token') body.set('refresh_token', secrets.refreshToken || '');
  if (o.scope) body.set('scope', o.scope);

  const res = await axios.post(o.tokenUrl, body, { timeout: 10000, validateStatus: () => true });
  const token = res.data?.access_token;
  if (!token) throw new Error(`OAuth token request failed (HTTP ${res.status})`);
  tokenCache.set(cacheKey, { token, exp: Date.now() + (Number(res.data.expires_in) || 3000) * 1000 });
  return token;
}

// ---- Build the outgoing request from the client's configuration ----
function buildRequest(client, ctx) {
  const headers = {};
  for (const h of client.headers || []) if (h.key) headers[h.key] = renderString(h.value, ctx);
  const params = {};
  for (const q of client.queryParams || []) if (q.key) params[q.key] = renderString(q.value, ctx);

  let body;
  const method = (client.method || 'POST').toUpperCase();
  if (method !== 'GET' && method !== 'DELETE' && client.payloadTemplate) {
    body = render(JSON.parse(client.payloadTemplate), ctx);
  }
  const url = renderString(client.apiUrl, ctx);
  assertSafeUrl(url);
  return { url, method, headers, params, body };
}

async function applyAuth(client, req, secrets) {
  const t = client.authType;
  if (t === 'bearer') req.headers.Authorization = `Bearer ${secrets.token || ''}`;
  else if (t === 'basic') req.auth = { username: secrets.username || '', password: secrets.password || '' };
  else if (t === 'api_key') {
    const val = secrets[client.apiKeySecret || 'apiKey'] || '';
    if (client.apiKeyIn === 'query') req.params[client.apiKeyName || 'api_key'] = val;
    else req.headers[client.apiKeyName || 'x-api-key'] = val;
  } else if (t === 'oauth2') {
    const token = await getOAuthToken(client, secrets);
    req.headers.Authorization = `${client.oauth?.tokenPrefix || 'Bearer'} ${token}`;
  }
}

// ---- Decide success / extract ids from the response ----
function evaluate(client, status, data) {
  const rm = client.responseMapping || {};
  const codes = rm.successStatusCodes || [];
  let ok = codes.length ? codes.includes(status) : status >= 200 && status < 300;
  if (ok && rm.successPath) {
    ok = String(get(data, rm.successPath)).toLowerCase() === String(rm.successValue ?? 'true').toLowerCase();
  }
  const externalId = rm.externalIdPath ? get(data, rm.externalIdPath) : undefined;
  const apiError = !ok && rm.errorPath ? get(data, rm.errorPath) : undefined;
  return {
    ok,
    externalId: externalId != null ? String(externalId) : undefined,
    error: ok ? null : String(apiError || `HTTP ${status}`).slice(0, 500),
  };
}

/**
 * Executes one push. Never throws for network/HTTP failures; returns a result object.
 * `request` and `responseBody` in the result are already redacted and safe to store/log.
 */
async function execute(client, ctx, secrets) {
  const secretValues = Object.values(secrets);
  const requestAt = new Date();
  let built;
  try {
    built = buildRequest(client, { ...ctx, secrets });
    await applyAuth(client, built, secrets);
  } catch (e) {
    return { ok: false, error: `Request build failed: ${e.message}`, requestAt, responseAt: new Date(), retryable: false, request: {} };
  }

  const axiosReq = {
    url: built.url,
    method: built.method,
    headers: { ...built.headers },
    params: built.params,
    auth: built.auth,
    timeout: client.timeoutMs || 15000,
    validateStatus: () => true,
    maxRedirects: 2,
  };
  if (built.body !== undefined) {
    if (client.contentType === 'form') {
      axiosReq.data = new URLSearchParams(Object.entries(built.body).map(([k, v]) => [k, typeof v === 'object' ? JSON.stringify(v) : String(v)]));
      axiosReq.headers['Content-Type'] ||= 'application/x-www-form-urlencoded';
    } else {
      axiosReq.data = built.body;
      axiosReq.headers['Content-Type'] ||= 'application/json';
    }
  }

  const safeRequest = {
    url: redactSecrets(built.url, secretValues),
    method: built.method,
    headers: redactHeaders(redactSecrets(built.headers, secretValues)),
    params: redactSecrets(built.params, secretValues),
    body: redactSecrets(built.body, secretValues),
  };

  const started = Date.now();
  try {
    const res = await axios.request(axiosReq);
    const ev = evaluate(client, res.status, res.data);
    const raw = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
    return {
      ok: ev.ok,
      httpStatus: res.status,
      externalId: ev.externalId,
      error: ev.error,
      requestAt,
      responseAt: new Date(),
      durationMs: Date.now() - started,
      request: safeRequest,
      responseBody: redactSecrets((raw || '').slice(0, 5000), secretValues),
      // 4xx (except 408/429) usually means bad data; retrying will not help unless configured.
      retryable: ev.ok ? false : !(res.status >= 400 && res.status < 500 && ![408, 429].includes(res.status)) || !!client.retry?.retryOn4xx,
    };
  } catch (e) {
    return {
      ok: false,
      httpStatus: undefined,
      error: redactSecrets(`${e.code || 'NETWORK_ERROR'}: ${e.message}`, secretValues),
      requestAt,
      responseAt: new Date(),
      durationMs: Date.now() - started,
      request: safeRequest,
      retryable: true,
    };
  }
}

module.exports = { execute, buildRequest, evaluate };
