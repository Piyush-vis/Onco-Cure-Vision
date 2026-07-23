const mongoose = require('mongoose');

const ScanSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.ObjectId,
    ref: 'User',
    required: true
  },
  fileName: String,
  uploadDate: {
    type: Date,
    default: Date.now
  },
  status: {
    type: String,
    enum: ['uploaded', 'processing', 'completed', 'failed'],
    default: 'uploaded'
  },
  segmentationData: {
    tumorType: String,
    tumorVolume: Number,
    location: String,
    confidence: Number,
    characteristics: {
      enhancing: Boolean,
      necrotic: Boolean,
      edema: Boolean,
      margins: String
    },
    nearbyRegions: [String],
    // Uncertainty & explainability (P1)
    confidenceInterval: [Number],       // [low, high] percent, from TTA spread
    confidenceStd: Number,              // std of per-pass confidence
    tumorUncertainty: Number,           // mean normalized predictive entropy in tumor [0,1]
    heatmapAgreement: Number,           // IoU of Grad-CAM hot region vs tumor mask [0,1]
    ttaPasses: Number,                  // number of test-time-augmentation passes
    flagForReview: { type: Boolean, default: false },
    reviewReasons: [String]
  },
  meshFiles: {
    brain: String, // path or url to mesh
    tumor: String,
    combined: String
  },
  sliceData: {
    available: { type: Boolean, default: false },
    hasHeatmap: { type: Boolean, default: false },
    hasUncertainty: { type: Boolean, default: false },
    totalSlices: Number,
    basePath: String
  },
  // Provenance snapshot (P3): which model + input produced this result
  provenance: {
    modelVersion: String,
    modelHash: String,
    inputHash: String,
    ttaPasses: Number,
    device: String
  }
});

module.exports = mongoose.model('Scan', ScanSchema);
