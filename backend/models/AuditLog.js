const mongoose = require('mongoose');

// Immutable, append-only record of every AI output a clinician could have acted on.
// Supports the "assistive AI, physician decides" posture and provides a defensible
// trail (model version, input fingerprint, what was shown, clinician actions).
const AuditLogSchema = new mongoose.Schema({
  scan: { type: mongoose.Schema.ObjectId, ref: 'Scan', index: true },
  user: { type: mongoose.Schema.ObjectId, ref: 'User' },
  // What happened
  action: {
    type: String,
    required: true,
    enum: [
      'scan_uploaded',
      'segmentation_completed',
      'segmentation_failed',
      'report_generated',
      'comparison_run',
      'clinician_acknowledged',
      'clinician_overrode',
    ],
  },
  // Provenance snapshot at the time of the event
  modelVersion: String,
  modelHash: String,
  inputHash: String,
  // What the AI reported (a snapshot, not a live reference)
  details: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
  // Free-text note for clinician actions (acknowledge / override reasoning)
  note: String,
  timestamp: { type: Date, default: Date.now, index: true },
});

// Best-effort immutability: block updates to persisted audit entries.
AuditLogSchema.pre('findOneAndUpdate', function (next) {
  next(new Error('Audit log entries are immutable'));
});
AuditLogSchema.pre('updateOne', function (next) {
  next(new Error('Audit log entries are immutable'));
});

module.exports = mongoose.model('AuditLog', AuditLogSchema);
