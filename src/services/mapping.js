const { MasterMapping } = require('../models');

class PermanentError extends Error {}
const norm = (v) => String(v ?? '').trim().toLowerCase();

/** Translates CollegeSera values (course, specialization, ...) to the client's own master data. */
async function applyMappings(clientId, lead) {
  const maps = await MasterMapping.find({ clientId });
  const out = { ...lead };
  for (const m of maps) {
    const raw = lead[m.field];
    if (raw === undefined || raw === null || raw === '') continue;
    const hit = m.entries.find((e) => norm(e.from) === norm(raw));
    if (hit) out[m.field] = hit.to;
    else if (m.onMissing === 'fail') throw new PermanentError(`No "${m.field}" mapping for "${raw}"`);
  }
  return out;
}

module.exports = { applyMappings, PermanentError };
