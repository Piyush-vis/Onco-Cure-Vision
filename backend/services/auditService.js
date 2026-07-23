const AuditLog = require('../models/AuditLog');

// Append an audit entry. Never throws into the caller — auditing must not break
// the primary flow (segmentation, reporting) if the log write fails.
async function writeAudit(entry) {
  try {
    await AuditLog.create({
      scan: entry.scan || null,
      user: entry.user || null,
      action: entry.action,
      modelVersion: entry.modelVersion || null,
      modelHash: entry.modelHash || null,
      inputHash: entry.inputHash || null,
      details: entry.details || {},
      note: entry.note || null,
    });
  } catch (err) {
    console.error('[Audit] Failed to write audit entry:', err.message);
  }
}

module.exports = { writeAudit };
