const get = require('lodash/get');

const ANY = /\{\{\s*([\w.\-\[\]]+)\s*\}\}/g;
const WHOLE = /^\{\{\s*([\w.\-\[\]]+)\s*\}\}$/;

// "{{lead.name}}" alone keeps the raw value type (number, object, array).
// Mixed text like "Hi {{lead.name}}" always yields a string.
function renderValue(str, ctx) {
  const m = str.match(WHOLE);
  if (m) {
    const v = get(ctx, m[1]);
    return v === undefined || v === null ? '' : v;
  }
  return str.replace(ANY, (_, p) => {
    const v = get(ctx, p);
    return v === undefined || v === null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  });
}

const renderString = (str, ctx) => String(renderValue(String(str ?? ''), ctx));

function render(node, ctx) {
  if (typeof node === 'string') return renderValue(node, ctx);
  if (Array.isArray(node)) return node.map((n) => render(n, ctx));
  if (node && typeof node === 'object') {
    return Object.fromEntries(Object.entries(node).map(([k, v]) => [renderString(k, ctx), render(v, ctx)]));
  }
  return node;
}

module.exports = { render, renderValue, renderString };
