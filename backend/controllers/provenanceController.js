const AuditLog = require('../models/AuditLog');
const Scan = require('../models/Scan');
const { writeAudit } = require('../services/auditService');

// Static model / data provenance ("model card"). Surfaced in-app so clinicians can
// see what produced a result and its known limitations — a trust + governance need.
const MODEL_CARD = {
  name: 'Onco Cure Vision — 3D U-Net (BraTS2020)',
  version: 'unet3d-brats2020-v1',
  task: 'Brain tumor sub-region segmentation (necrotic core, edema, enhancing tumor)',
  architecture: '3D U-Net, 4-channel input (T1, T1ce, T2, FLAIR), 128³ crops, ~5.6M params',
  trainingData: 'BraTS2020 (369 subjects; 314 train / 55 validation)',
  performance: {
    meanDice: 0.6578,
    necroticCoreDice: 0.598,
    edemaDice: 0.755,
    enhancingTumorDice: 0.621,
  },
  uncertainty: 'Predictive entropy over test-time augmentation (flip TTA); confidence interval from per-pass spread.',
  explainability: 'Ensemble Grad-CAM on the enc3 encoder layer, brain-masked, with a heatmap↔segmentation agreement (IoU) score.',
  intendedUse: 'Assistive decision support for qualified clinicians. NOT a diagnosis; the physician decides.',
  limitations: [
    'Trained on BraTS2020 — performance may drop on scanners/protocols/populations not represented in training.',
    'Single-modality uploads are duplicated across the 4 input channels, reducing accuracy vs. true 4-modality input.',
    'RANO response and pseudoprogression outputs are volumetric estimates requiring clinical correlation and follow-up.',
    'Not FDA/CE cleared. For research and educational use.',
  ],
  regulatoryStatus: 'Investigational — not a certified medical device.',
};

// @desc   Model/data provenance card
// @route  GET /api/provenance/model
// @access Private
exports.getModelCard = async (req, res) => {
  res.status(200).json({ success: true, data: MODEL_CARD });
};

// @desc   Full audit trail for a scan (chronological)
// @route  GET /api/provenance/audit/:scanId
// @access Private (doctor)
exports.getAuditTrail = async (req, res) => {
  try {
    const entries = await AuditLog.find({ scan: req.params.scanId })
      .sort('timestamp')
      .populate('user', 'name email');
    res.status(200).json({ success: true, count: entries.length, data: entries });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
};

// @desc   Record a clinician action (acknowledge / override) — human-in-the-loop
// @route  POST /api/provenance/audit/:scanId/action
// @access Private (doctor)
exports.recordClinicianAction = async (req, res) => {
  try {
    const { action, note } = req.body;
    if (!['clinician_acknowledged', 'clinician_overrode'].includes(action)) {
      return res.status(400).json({ success: false, error: 'Invalid clinician action' });
    }
    await writeAudit({
      scan: req.params.scanId,
      user: req.user.id,
      action,
      note: note || null,
    });
    res.status(201).json({ success: true });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
};

// @desc   Export scan findings as a FHIR R4 DiagnosticReport bundle
// @route  GET /api/provenance/fhir/:scanId
// @access Private
// Emits a self-contained Bundle (DiagnosticReport + Observations) so findings can
// flow into an EHR. Not a substitute for a certified integration, but standards-shaped.
exports.getFhirReport = async (req, res) => {
  try {
    const scan = await Scan.findById(req.params.scanId).populate('user', 'name');
    if (!scan) return res.status(404).json({ success: false, error: 'Scan not found' });

    const s = scan.segmentationData || {};
    const effective = scan.uploadDate ? new Date(scan.uploadDate).toISOString() : undefined;
    const scanId = scan._id.toString();

    // Observation: tumor volume
    const volumeObs = {
      resourceType: 'Observation',
      id: `vol-${scanId}`,
      status: 'preliminary',
      code: { text: 'Brain tumor volume (AI volumetric segmentation)' },
      valueQuantity: { value: s.tumorVolume ?? null, unit: 'cm3', system: 'http://unitsofmeasure.org', code: 'cm3' },
      effectiveDateTime: effective,
    };

    // Observation: model confidence + uncertainty
    const confidenceObs = {
      resourceType: 'Observation',
      id: `conf-${scanId}`,
      status: 'preliminary',
      code: { text: 'AI segmentation confidence' },
      valueQuantity: { value: s.confidence ?? null, unit: '%', system: 'http://unitsofmeasure.org', code: '%' },
      note: [
        s.confidenceInterval ? { text: `95% CI ${s.confidenceInterval[0]}–${s.confidenceInterval[1]}%` } : null,
        s.tumorUncertainty != null ? { text: `Predictive entropy ${s.tumorUncertainty}` } : null,
        s.flagForReview ? { text: `Flagged for manual review: ${(s.reviewReasons || []).join('; ')}` } : null,
      ].filter(Boolean),
      effectiveDateTime: effective,
    };

    const diagnosticReport = {
      resourceType: 'DiagnosticReport',
      id: `dr-${scanId}`,
      status: 'preliminary',
      category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0074', code: 'RAD', display: 'Radiology' }] }],
      code: { text: 'AI brain tumor MRI analysis' },
      effectiveDateTime: effective,
      conclusion: [
        s.tumorType ? `Type: ${s.tumorType}.` : null,
        s.location ? `Location: ${s.location}.` : null,
        s.tumorVolume != null ? `Volume: ${s.tumorVolume} cm³.` : null,
        s.confidence != null ? `Confidence: ${s.confidence}%.` : null,
        s.flagForReview ? 'RECOMMEND MANUAL REVIEW.' : null,
      ].filter(Boolean).join(' '),
      result: [{ reference: `Observation/vol-${scanId}` }, { reference: `Observation/conf-${scanId}` }],
      extension: [{
        url: 'https://oncocurevision.local/fhir/model-provenance',
        valueString: `${MODEL_CARD.version} (assistive; not a diagnosis)`,
      }],
    };

    const bundle = {
      resourceType: 'Bundle',
      type: 'collection',
      entry: [diagnosticReport, volumeObs, confidenceObs].map((r) => ({ resource: r })),
    };

    // Reading the exported report is itself an auditable event.
    await writeAudit({
      scan: scanId,
      user: req.user.id,
      action: 'report_generated',
      details: { format: 'FHIR', kind: 'DiagnosticReport' },
    });

    res.status(200).json(bundle);
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
};

module.exports.MODEL_CARD = MODEL_CARD;
