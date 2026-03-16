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
    tumorVolume: Number,
    location: String,
    confidence: Number,
    characteristics: {
      enhancing: Boolean,
      necrotic: Boolean,
      edema: Boolean,
      margins: String
    },
    nearbyRegions: [String]
  },
  meshFiles: {
    brain: String, // path or url to mesh
    tumor: String,
    combined: String
  }
});

module.exports = mongoose.model('Scan', ScanSchema);
