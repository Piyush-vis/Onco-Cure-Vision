const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const { generateReport, generateReportFromPdf, getReport } = require('../controllers/reportController');

const upload = require('../middleware/upload');

router.post('/generate', protect, authorize('doctor'), generateReport);
router.post('/generate-pdf', protect, authorize('doctor'), upload.single('reportPdf'), generateReportFromPdf);

router.get('/:id', protect, getReport);

module.exports = router;
