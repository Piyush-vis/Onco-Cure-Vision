const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const {
  getModelCard,
  getAuditTrail,
  recordClinicianAction,
  getFhirReport,
} = require('../controllers/provenanceController');

router.get('/model', protect, getModelCard);
router.get('/audit/:scanId', protect, authorize('doctor'), getAuditTrail);
router.post('/audit/:scanId/action', protect, authorize('doctor'), recordClinicianAction);
router.get('/fhir/:scanId', protect, getFhirReport);

module.exports = router;
