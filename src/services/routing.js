const get = require('lodash/get');
const { RoutingRule } = require('../models');

const norm = (v) => String(v ?? '').trim().toLowerCase();
const list = (v) => String(v ?? '').split(',').map(norm).filter(Boolean);

function check(cond, lead) {
  const actual = get(lead, cond.field);
  const a = norm(actual);
  switch (cond.op) {
    case 'eq': return a === norm(cond.value);
    case 'neq': return a !== norm(cond.value);
    case 'in': return list(cond.value).includes(a);
    case 'nin': return !list(cond.value).includes(a);
    case 'contains': return a.includes(norm(cond.value));
    case 'startsWith': return a.startsWith(norm(cond.value));
    case 'regex': try { return new RegExp(cond.value, 'i').test(String(actual ?? '')); } catch { return false; }
    case 'exists': return actual !== undefined && actual !== null && a !== '';
    default: return false;
  }
}

function matches(rule, lead) {
  if (!rule.conditions?.length) return true; // no conditions = catch-all
  return rule.match === 'any' ? rule.conditions.some((c) => check(c, lead)) : rule.conditions.every((c) => check(c, lead));
}

async function pickTarget(rule, dryRun) {
  const targets = rule.targets || [];
  if (!targets.length) return null;
  if (rule.strategy === 'single' || targets.length === 1) return targets[0];

  if (rule.strategy === 'round_robin') {
    let n = rule.rrCounter || 0;
    if (!dryRun) {
      const upd = await RoutingRule.findByIdAndUpdate(rule._id, { $inc: { rrCounter: 1 } }, { new: false });
      n = upd?.rrCounter || 0;
    }
    return targets[n % targets.length];
  }
  // weighted random
  const total = targets.reduce((s, t) => s + (t.weight || 1), 0);
  let r = Math.random() * total;
  for (const t of targets) { r -= t.weight || 1; if (r <= 0) return t; }
  return targets[0];
}

/** Returns [{ clientId, ruleId, ruleName }] — first match wins unless a rule has stopOnMatch=false. */
async function route(lead, { dryRun = false } = {}) {
  const rules = await RoutingRule.find({ active: true }).sort({ priority: 1, createdAt: 1 });
  const out = [];
  for (const rule of rules) {
    if (!matches(rule, lead)) continue;
    const t = await pickTarget(rule, dryRun);
    if (t && !out.some((o) => String(o.clientId) === String(t.clientId))) {
      out.push({ clientId: t.clientId, ruleId: rule._id, ruleName: rule.name });
    }
    if (rule.stopOnMatch !== false) break;
  }
  return out;
}

module.exports = { route, matches, check };
