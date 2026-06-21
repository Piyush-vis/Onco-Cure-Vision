const mongoose = require('mongoose');

const ReportSchema = new mongoose.Schema({
  scan: {
    type: mongoose.Schema.ObjectId,
    ref: 'Scan',
    required: false
  },
  user: {
    type: mongoose.Schema.ObjectId,
    ref: 'User',
    required: true
  },
  doctorReport: String,
  patientReport: String,
  language: {
    type: String,
    default: 'English'
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Report', ReportSchema);
