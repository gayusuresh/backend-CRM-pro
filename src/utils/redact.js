const SENSITIVE_HEADER = /authorization|key|secret|token|password|cookie/i;

// Replace every occurrence of a known secret value with ***, anywhere in the structure.
function redactSecrets(value, secretValues) {
  const secrets = (secretValues || []).filter((s) => s && String(s).length >= 4);
  if (!secrets.length || value === undefined) return value;
  let text = typeof value === 'string' ? value : JSON.stringify(value);
  for (const s of secrets) {
    text = text.split(s).join('***');
    text = text.split(encodeURIComponent(s)).join('***');
  }
  if (typeof value === 'string') return text;
  try { return JSON.parse(text); } catch { return text; }
}

function redactHeaders(headers) {
  return Object.fromEntries(
    Object.entries(headers || {}).map(([k, v]) => [k, SENSITIVE_HEADER.test(k) ? '***' : v])
  );
}

module.exports = { redactSecrets, redactHeaders };
