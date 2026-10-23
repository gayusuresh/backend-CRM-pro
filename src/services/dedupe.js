const { Lead } = require('../models');

/** Has an equivalent lead already been (or is being) pushed, per the client's duplicate rule? */
async function findDuplicate(client, lead) {
  const d = client.duplicate || {};
  if (d.enabled === false) return null;
  const conds = (d.keys?.length ? d.keys : ['mobile'])
    .filter((k) => lead[k])
    .map((k) => ({ [`data.${k}`]: lead[k] }));
  if (!conds.length) return null;

  const filter = { status: { $in: ['success', 'queued', 'processing', 'pending'] } };
  if (d.scope !== 'global') filter.clientId = client._id;
  if (d.mode === 'all') filter.$and = conds;
  else filter.$or = conds;
  return Lead.findOne(filter).select('_id leadId clientId status').lean();
}

module.exports = { findDuplicate };
