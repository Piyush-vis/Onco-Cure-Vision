const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const upload = require('../middleware/upload');
const {
  uploadScan,
  getScans,
  getScan,
  getScanStatus,
} = require('../controllers/scanController');

router.get('/', protect, getScans);
router.post('/upload', protect, upload.array('dicom', 10), uploadScan);
router.get('/:id/status', protect, getScanStatus);
router.get('/:id', protect, getScan);

module.exports = router;


