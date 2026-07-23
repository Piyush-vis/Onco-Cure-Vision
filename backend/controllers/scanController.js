const Scan = require('../models/Scan');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { writeAudit } = require('../services/auditService');


// @desc      Upload DICOM and start processing
// @route     POST /api/scans/upload
// @access    Private
exports.uploadScan = async (req, res, next) => {
  try {
    let files = req.files;
    // Fallback if someone sends a single file via single('dicom')
    if (!files || files.length === 0) {
      if (req.file) files = [req.file];
      else return res.status(400).json({ success: false, error: 'No files received. Please upload .nii files using field name "dicom".' });
    }

    const fileNames = files.map(f => f.originalname).join(', ');

    // Create scan record immediately (status: processing)
    const scan = await Scan.create({
      user: req.user.id,
      fileName: fileNames,
      status: 'processing'
    });

    await writeAudit({ scan: scan._id, user: req.user.id, action: 'scan_uploaded', details: { fileName: fileNames } });

    // Fire-and-forget async segmentation (doesn't block the HTTP response)
    processScan(scan._id, files).catch(err =>
      console.error(`Background processScan error for scan ${scan._id}:`, err)
    );

    res.status(202).json({
      success: true,
      message: 'Scan uploaded successfully. Processing has started.',
      data: scan
    });
  } catch (err) {
    console.error('uploadScan error:', err);
    res.status(400).json({ success: false, error: err.message });
  }
};



// @desc      Get all scans for current user
// @route     GET /api/scans
// @access    Private
exports.getScans = async (req, res, next) => {
  try {
    // Doctors can see all scans, patients only see their own
    const filter = req.user.role === 'patient' ? { user: req.user.id } : {};
    const scans = await Scan.find(filter).sort('-uploadDate').populate('user', 'name email');

    res.status(200).json({
      success: true,
      count: scans.length,
      data: scans
    });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
};

// @desc      Triage worklist — scans ranked by clinical urgency
// @route     GET /api/scans/worklist
// @access    Private
// Non-interruptive: returns a ranked list (no alerts). Doctors see all scans,
// patients see only their own.
exports.getWorklist = async (req, res, next) => {
  try {
    const filter = req.user.role === 'patient' ? { user: req.user.id } : {};
    // Only completed scans carry the metrics we rank on.
    const scans = await Scan.find({ ...filter, status: 'completed' })
      .sort('-uploadDate')
      .populate('user', 'name email');

    const items = scans.map((scan) => {
      const s = scan.segmentationData || {};
      const confidence = s.confidence ?? 100;
      const volume = s.tumorVolume ?? 0;
      const uncertainty = s.tumorUncertainty ?? 0;
      const type = s.tumorType || '';

      // Weighted urgency score (0-100+). Higher = review sooner.
      let score = 0;
      const reasons = [];
      if (s.flagForReview) { score += 40; reasons.push('Flagged for manual review'); }
      // Larger tumor burden is more urgent (saturates at 150 cm³).
      const volScore = Math.min(volume, 150) / 150 * 25;
      if (volScore > 0) { score += volScore; if (volume >= 50) reasons.push(`Large tumor burden (${volume} cm³)`); }
      // Low confidence is more urgent.
      const confScore = Math.max(0, (100 - confidence)) / 100 * 20;
      score += confScore;
      if (confidence < 65) reasons.push(`Low confidence (${Math.round(confidence)}%)`);
      // High model uncertainty is more urgent.
      score += Math.min(uncertainty, 1) * 15;
      if (uncertainty >= 0.35) reasons.push('High model uncertainty');
      // Aggressive tumor types.
      if (/HGG|GBM|Glioblastoma|High-Grade/i.test(type)) { score += 15; reasons.push('Aggressive tumor type'); }

      score = Math.round(score);
      let priority = 'Routine';
      if (score >= 60) priority = 'Critical';
      else if (score >= 40) priority = 'High';
      else if (score >= 20) priority = 'Moderate';

      return {
        id: scan._id,
        fileName: scan.fileName,
        uploadDate: scan.uploadDate,
        patient: scan.user ? { name: scan.user.name, email: scan.user.email } : null,
        tumorType: type || null,
        volume,
        confidence,
        uncertainty,
        flagForReview: !!s.flagForReview,
        urgencyScore: score,
        priority,
        reasons,
      };
    });

    // Rank by urgency, then most recent.
    items.sort((a, b) => b.urgencyScore - a.urgencyScore ||
      new Date(b.uploadDate) - new Date(a.uploadDate));

    res.status(200).json({ success: true, count: items.length, data: items });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
};

// @desc      Get single scan
// @route     GET /api/scans/:id
// @access    Private
exports.getScan = async (req, res, next) => {
  try {
    const scan = await Scan.findById(req.params.id).populate('user', 'name email');

    if (!scan) {
      return res.status(404).json({ success: false, error: 'Scan not found' });
    }

    res.status(200).json({
      success: true,
      data: scan
    });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
};

// @desc      Poll scan status
// @route     GET /api/scans/:id/status
// @access    Private
exports.getScanStatus = async (req, res, next) => {
  try {
    const scan = await Scan.findById(req.params.id, 'status segmentationData meshFiles sliceData uploadDate fileName');

    if (!scan) {
      return res.status(404).json({ success: false, error: 'Scan not found' });
    }

    res.status(200).json({
      success: true,
      status: scan.status,
      data: scan
    });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
};

// ─────────────────────────────────────────────
//  Background processing pipeline
// ─────────────────────────────────────────────
async function processScan(scanId, files) {
  console.log(`[Segmentation] Starting for scan ${scanId}`);
  try {
    const scan = await Scan.findById(scanId);
    if (!scan) {
      console.error(`[Segmentation] Scan ${scanId} not found in DB`);
      return;
    }

    // 1. Create a staging folder inside uploads
    const tempDir = path.join(__dirname, '..', 'uploads', scanId.toString());
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // 2. Move files from their temporary multer location into the staging folder
    // For DICOMs, we may have dozens of files. We place them all inside tempDir.
    for (const file of files) {
      const oldPath = file.path;
      const newPath = path.join(tempDir, file.originalname);
      fs.renameSync(oldPath, newPath);
    }

    // 3. Detect file type: DICOM vs NIfTI to choose pipeline
    const hasDicom = files.some(f => 
      f.originalname.toLowerCase().endsWith('.dcm') || 
      f.originalname.toLowerCase().endsWith('.dicom')
    );
    const hasNifti = files.some(f => 
      f.originalname.toLowerCase().includes('.nii')
    );

    const predictScript = path.join(__dirname, '..', '..', 'segmentation-service', 'predict_segmentation.py');
    let mlMetadata = null;
    let mlProvenance = null;

    if (hasDicom) {
      // DICOM workflow: run U-Net first to predict tumor mask -> generate NIfTI outputs
      console.log(`[Segmentation] Triggering ML Inference (U-Net) on DICOMs...`);
      
      await new Promise((resolve, reject) => {
        const pythonExecutable = process.env.PYTHON_EXECUTABLE || 'python';
        const pyProcess = spawn(pythonExecutable, [predictScript, tempDir]);
        
        let outData = '';
        
        pyProcess.stdout.on('data', (data) => {
            const chunk = data.toString();
            outData += chunk;
            console.log(`[U-Net]: ${chunk.trim()}`);
        });
        
        pyProcess.stderr.on('data', (data) => {
            console.error(`[Python U-Net Err]: ${data.toString().trim()}`);
        });
        
        pyProcess.on('close', (code) => {
            if (code === 0) {
                try {
                    const lines = outData.split('\n');
                    for (let line of lines) {
                        line = line.trim();
                        if (line.startsWith('{')) {
                            const parsed = JSON.parse(line);
                            if (parsed.metadata) mlMetadata = parsed.metadata;
                            if (parsed.provenance) mlProvenance = parsed.provenance;
                        }
                    }
                } catch(e) { /* ignore JSON parse error */ }
                resolve();
            } else {
                reject(new Error(`U-Net ML script exited with code ${code}`));
            }
        });
      });
    } else if (hasNifti) {
      console.log(`[Segmentation] NIfTI files detected — running ML inference...`);
      
      await new Promise((resolve, reject) => {
        const pythonExecutable = process.env.PYTHON_EXECUTABLE || 'python';
        const pyProcess = spawn(pythonExecutable, [predictScript, tempDir]);
        
        let outData = '';
        
        pyProcess.stdout.on('data', (data) => {
            const chunk = data.toString();
            outData += chunk;
            console.log(`[U-Net]: ${chunk.trim()}`);
        });
        
        pyProcess.stderr.on('data', (data) => {
            console.error(`[Python U-Net Err]: ${data.toString().trim()}`);
        });
        
        pyProcess.on('close', (code) => {
            if (code === 0) {
                try {
                    const lines = outData.split('\n');
                    for (let line of lines) {
                        line = line.trim();
                        if (line.startsWith('{')) {
                            const parsed = JSON.parse(line);
                            if (parsed.metadata) mlMetadata = parsed.metadata;
                            if (parsed.provenance) mlProvenance = parsed.provenance;
                        }
                    }
                } catch(e) { /* ignore JSON parse error */ }
                resolve();
            } else {
                reject(new Error(`U-Net ML script exited with code ${code}`));
            }
        });
      });
    } else {
      throw new Error('Unsupported file type. Please upload .nii, .nii.gz, or .dcm files.');
    }


    // 4. ML Script completed, generating Mesh from the NIfTI outputs
    const outputGlbFile = `scan_${scanId}.glb`;
    const outputGlbPath = path.join(__dirname, '..', 'uploads', outputGlbFile);
    
    const meshScript = path.join(__dirname, '..', '..', 'segmentation-service', 'mesh_generator.py');
    console.log(`[Segmentation] Triggering Python mesh generation...`);

    // Spawning Python Mesh script
    await new Promise((resolve, reject) => {

      // Use the specific python environment provided by the user
      const pythonExecutable = process.env.PYTHON_EXECUTABLE || 'python';
      const pyProcess = spawn(pythonExecutable, [meshScript, tempDir, outputGlbPath]);
      
      pyProcess.stdout.on('data', (data) => {
          console.log(`[Python]: ${data.toString().trim()}`);
      });
      
      pyProcess.stderr.on('data', (data) => {
          console.error(`[Python Err]: ${data.toString().trim()}`);
      });
      
      pyProcess.on('close', (code) => {
          if (code === 0) {
              resolve();
          } else {
              reject(new Error(`Python script exited with code ${code}`));
          }
      });
    });


    // Provide segmentation report data driven from the ML python script output
    scan.segmentationData = {
        tumorType: mlMetadata?.type || null,
        tumorVolume: mlMetadata?.volume_cm3 ?? null,
        location: mlMetadata?.location || null,
        confidence: mlMetadata?.confidence ?? null,
        characteristics: {
            enhancing: mlMetadata?.characteristics?.enhancing ?? null,
            necrotic: mlMetadata?.characteristics?.necrotic ?? null,
            edema: mlMetadata?.characteristics?.edema ?? null,
            margins: mlMetadata?.characteristics?.margins || null
        },
        nearbyRegions: mlMetadata?.nearbyRegions || [],
        // Uncertainty & explainability (P1)
        confidenceInterval: mlMetadata?.confidence_interval || null,
        confidenceStd: mlMetadata?.confidence_std ?? null,
        tumorUncertainty: mlMetadata?.tumor_uncertainty ?? null,
        heatmapAgreement: mlMetadata?.heatmap_agreement ?? null,
        ttaPasses: mlMetadata?.tta_passes ?? null,
        flagForReview: mlMetadata?.flag_for_review ?? false,
        reviewReasons: mlMetadata?.review_reasons || []
    };
    // Include the generated GLB
    scan.meshFiles = {
        combined: `/uploads/${outputGlbFile}`
    };

    // Store provenance snapshot (P3)
    if (mlProvenance) {
        scan.provenance = {
            modelVersion: mlProvenance.model_version || null,
            modelHash: mlProvenance.model_hash || null,
            inputHash: mlProvenance.input_hash || null,
            ttaPasses: mlProvenance.tta_passes ?? null,
            device: mlProvenance.device || null,
        };
    }

    // Generate 2D slice images (raw + segmentation overlay + Grad-CAM heatmap)
    try {
      console.log(`[Slices] Generating 2D slice images for scan ${scanId}...`);
      const sliceScript = path.join(__dirname, '..', '..', 'segmentation-service', 'generate_slices.py');
      
      await new Promise((resolve, reject) => {
        const pythonExe = process.env.PYTHON_EXECUTABLE || 'python';
        const sliceProcess = spawn(pythonExe, [sliceScript, tempDir, '--num-slices', '20']);
        let sliceOut = '';
        
        sliceProcess.stdout.on('data', (data) => {
          sliceOut += data.toString();
        });
        sliceProcess.stderr.on('data', (data) => {
          console.log(`[Slices]: ${data.toString().trim()}`);
        });
        sliceProcess.on('close', (code) => {
          if (code === 0) {
            try {
              const lines = sliceOut.split('\n');
              for (let line of lines) {
                line = line.trim();
                if (line.startsWith('{')) {
                  const parsed = JSON.parse(line);
                  if (parsed.success) {
                    scan.sliceData = {
                      available: true,
                      hasHeatmap: parsed.hasHeatmap || false,
                      hasUncertainty: parsed.hasUncertainty || false,
                      totalSlices: parsed.totalSlices || 0,
                      basePath: `/uploads/${scanId}/slices`,
                    };
                  }
                }
              }
            } catch(e) { /* ignore */ }
            resolve();
          } else {
            console.error(`[Slices] Script exited with code ${code}`);
            resolve(); // non-fatal — scan still completes
          }
        });
      });
    } catch (sliceErr) {
      console.error(`[Slices] Failed (non-fatal):`, sliceErr.message);
    }

    scan.status = 'completed';
    await scan.save();
    console.log(`[Segmentation] Scan ${scanId} completed. GLB + slices saved.`);

    // Audit trail: record exactly what the model produced (P3)
    await writeAudit({
      scan: scanId,
      user: scan.user,
      action: 'segmentation_completed',
      modelVersion: mlProvenance?.model_version,
      modelHash: mlProvenance?.model_hash,
      inputHash: mlProvenance?.input_hash,
      details: {
        tumorType: mlMetadata?.type,
        volumeCm3: mlMetadata?.volume_cm3,
        confidence: mlMetadata?.confidence,
        confidenceInterval: mlMetadata?.confidence_interval,
        tumorUncertainty: mlMetadata?.tumor_uncertainty,
        heatmapAgreement: mlMetadata?.heatmap_agreement,
        flagForReview: mlMetadata?.flag_for_review,
        reviewReasons: mlMetadata?.review_reasons,
      },
    });

    // Optional: Clean up tempdir
    // fs.rmSync(tempDir, { recursive: true, force: true });
  } catch (error) {
    console.error(`[Segmentation] Failed for scan ${scanId}:`, error.message);
    await Scan.findByIdAndUpdate(scanId, { status: 'failed' });
    await writeAudit({ scan: scanId, action: 'segmentation_failed', details: { error: error.message } });
  }
}
