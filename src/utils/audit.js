const { AuditLog } = require('../models');

module.exports = (req, action, entity, entityId, details = {}) =>
  AuditLog.create({
    userId: req.user?.id,
    userEmail: req.user?.email,
    action,
    entity,
    entityId: entityId ? String(entityId) : undefined,
    details,
    ip: req.ip,
  }).catch((e) => console.error('audit failed', e.message));
