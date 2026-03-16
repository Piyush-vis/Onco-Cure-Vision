const Report = require('../models/Report');
const Scan = require('../models/Scan');
const fs = require('fs');
const { PDFParse } = require('pdf-parse');
const { generateReports, generateReportsFromText } = require('../services/geminiService');

// @desc      Generate and save report
// @route     POST /api/reports/generate
// @access    Private (Doctor only)
exports.generateReport = async (req, res, next) => {
  try {
    const { scanId } = req.body;

    // Verify scan exists
    const scan = await Scan.findById(scanId);

    if (!scan) {
      return res.status(404).json({ success: false, error: 'Scan not found' });
    }

    // Require segmentation data rather than strict status check,
    // in case status didn't update but data is present.
    if (!scan.segmentationData || !scan.segmentationData.tumorVolume) {
      return res.status(400).json({
        success: false,
        error: 'Scan segmentation data not available yet. Please wait for processing to finish.',
      });
    }
    
    // Call Gemini API
    const reports = await generateReports(scan.segmentationData);

    // Save to DB
    const report = await Report.create({
      scan: scanId,
      user: scan.user,
      doctorReport: reports.doctorReport,
      patientReport: reports.patientReport
    });

    res.status(201).json({
      success: true,
      data: report
    });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
};

// @desc      Get report
// @route     GET /api/reports/:id
// @access    Private
exports.getReport = async (req, res, next) => {
  try {
    const report = await Report.findById(req.params.id);

    if (!report) {
      return res.status(404).json({ success: false, error: 'Report not found' });
    }

    // Authorization checks could be added here
    res.status(200).json({
      success: true,
      data: report
    });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
};

// @desc      Generate and save report from an uploaded PDF
// @route     POST /api/reports/generate-pdf
// @access    Private (Doctor only)
exports.generateReportFromPdf = async (req, res, next) => {
  try {
    const { scanId } = req.body;

    if (!req.file) {
      return res.status(400).json({ success: false, error: 'Please upload a PDF file' });
    }

    // Verify scan exists if a scanId was provided
    let scan = null;
    if (scanId && scanId !== 'null' && scanId !== 'undefined') {
        scan = await Scan.findById(scanId);
        if (!scan) {
          return res.status(404).json({ success: false, error: 'Associated scan not found' });
        }
    }

    // Parse the PDF buffer
    let pdfText = '';
    try {
        const dataBuffer = req.file.buffer || fs.readFileSync(req.file.path);
        const parser = new PDFParse({ data: dataBuffer });
        const pdfData = await parser.getText();
        pdfText = pdfData.text;
        
        // Clean up resources
        if (typeof parser.destroy === 'function') {
           await parser.destroy();
        }

        // Optional: delete the file from disk so it doesn't pile up in /uploads
        if (req.file.path) {
            fs.unlinkSync(req.file.path);
        }
    } catch (parseErr) {
        console.error('PDF Parse Error:', parseErr);
        return res.status(400).json({ success: false, error: 'Failed to process PDF file. Ensure it is a valid text-based PDF. Details: ' + parseErr.message });
    }

    if (!pdfText || pdfText.trim().length === 0) {
       return res.status(400).json({ success: false, error: 'Could not extract text from the PDF' });
    }

    // Call Gemini API specifically for text
    const reports = await generateReportsFromText(pdfText);

    // Save to DB
    const reportData = {
      user: req.user.id,
      doctorReport: reports.doctorReport,
      patientReport: reports.patientReport
    };
    
    if (scan) {
       reportData.scan = scan._id;
    }
    
    const report = await Report.create(reportData);

    res.status(201).json({
      success: true,
      data: report
    });
  } catch (err) {
    console.error('generateReportFromPdf error:', err);
    res.status(400).json({ success: false, error: err.message });
  }
};
