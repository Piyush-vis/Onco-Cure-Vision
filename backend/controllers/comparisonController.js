const Scan = require('../models/Scan');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

// @desc      Compare two scans (longitudinal tracking)
// @route     POST /api/compare
// @access    Private
exports.compareScans = async (req, res) => {
  try {
    const { scanId1, scanId2 } = req.body;

    if (!scanId1 || !scanId2) {
      return res.status(400).json({ success: false, error: 'Both scanId1 and scanId2 are required' });
    }
    if (scanId1 === scanId2) {
      return res.status(400).json({ success: false, error: 'Cannot compare a scan with itself' });
    }

    const scan1 = await Scan.findById(scanId1);
    const scan2 = await Scan.findById(scanId2);

    if (!scan1 || !scan2) {
      return res.status(404).json({ success: false, error: 'One or both scans not found' });
    }
    if (scan1.status !== 'completed' || scan2.status !== 'completed') {
      return res.status(400).json({ success: false, error: 'Both scans must be completed' });
    }

    // Determine which is older (baseline) and which is newer (follow-up)
    const isSwapped = new Date(scan1.uploadDate) > new Date(scan2.uploadDate);
    const oldScan = isSwapped ? scan2 : scan1;
    const newScan = isSwapped ? scan1 : scan2;

    const oldFolder = path.join(__dirname, '..', 'uploads', oldScan._id.toString());
    const newFolder = path.join(__dirname, '..', 'uploads', newScan._id.toString());

    // Check that NIfTI files exist
    const oldSegPath = path.join(oldFolder, 'tumor_seg.nii');
    const newSegPath = path.join(newFolder, 'tumor_seg.nii');

    if (!fs.existsSync(oldSegPath) || !fs.existsSync(newSegPath)) {
      return res.status(400).json({ success: false, error: 'Segmentation data files missing for one or both scans' });
    }

    // Output folder for comparison images
    const comparisonId = `${oldScan._id}_vs_${newScan._id}`;
    const outputFolder = path.join(__dirname, '..', 'uploads', 'comparisons', comparisonId);
    fs.mkdirSync(outputFolder, { recursive: true });

    // Run comparison script
    const compareScript = path.join(__dirname, '..', '..', 'segmentation-service', 'compare_scans.py');
    const pythonExe = process.env.PYTHON_EXECUTABLE || 'python';

    const result = await new Promise((resolve, reject) => {
      const proc = spawn(pythonExe, [compareScript, oldFolder, newFolder, outputFolder, '--num-slices', '20']);
      let stdout = '';

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      proc.stderr.on('data', (data) => {
        console.log(`[Compare]: ${data.toString().trim()}`);
      });
      proc.on('close', (code) => {
        if (code === 0) {
          try {
            const lines = stdout.split('\n');
            for (let line of lines) {
              line = line.trim();
              if (line.startsWith('{')) {
                const parsed = JSON.parse(line);
                if (parsed.success) {
                  resolve(parsed);
                  return;
                }
              }
            }
            resolve({ success: true, metrics: {} });
          } catch (e) {
            resolve({ success: true, metrics: {} });
          }
        } else {
          reject(new Error(`Comparison script exited with code ${code}`));
        }
      });
    });

    // Compute volume in cm³ from scan data
    const oldVolume = oldScan.segmentationData?.tumorVolume || 0;
    const newVolume = newScan.segmentationData?.tumorVolume || 0;
    const volumeChangeCm3 = Math.round((newVolume - oldVolume) * 100) / 100;
    const volumeChangePct = oldVolume > 0 ? Math.round(((newVolume - oldVolume) / oldVolume) * 1000) / 10 : 0;

    res.json({
      success: true,
      data: {
        baseline: {
          id: oldScan._id,
          fileName: oldScan.fileName,
          uploadDate: oldScan.uploadDate,
          volume: oldVolume,
          location: oldScan.segmentationData?.location || 'N/A',
          confidence: oldScan.segmentationData?.confidence || 0,
          characteristics: oldScan.segmentationData?.characteristics || {},
        },
        followUp: {
          id: newScan._id,
          fileName: newScan.fileName,
          uploadDate: newScan.uploadDate,
          volume: newVolume,
          location: newScan.segmentationData?.location || 'N/A',
          confidence: newScan.segmentationData?.confidence || 0,
          characteristics: newScan.segmentationData?.characteristics || {},
        },
        delta: {
          volumeChangeCm3,
          volumeChangePct,
          assessment: volumeChangePct < -10 ? 'Improving' : (volumeChangePct > 10 ? 'Progressing' : 'Stable'),
          voxelMetrics: result.metrics || {},
        },
        comparisonImages: {
          basePath: `/uploads/comparisons/${comparisonId}`,
          manifestFile: 'comparison_manifest.json',
        },
      },
    });
  } catch (err) {
    console.error('Comparison error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};
