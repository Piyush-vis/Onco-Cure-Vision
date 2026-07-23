const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const upload = require('../middleware/upload');
const {
  uploadScan,
  getScans,
  getScan,
  getScanStatus,
  getWorklist,
} = require('../controllers/scanController');

router.get('/', protect, getScans);
// Must precede '/:id' so 'worklist' isn't captured as an :id param.
router.get('/worklist', protect, getWorklist);
router.post('/upload', protect, upload.array('dicom', 10), uploadScan);
router.get('/:id/status', protect, getScanStatus);
router.get('/:id', protect, getScan);

module.exports = router;


