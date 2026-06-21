const Scan = require('../models/Scan');
const Report = require('../models/Report');
const User = require('../models/User');

// @desc      Get dashboard analytics
// @route     GET /api/analytics/dashboard
// @access    Private
exports.getDashboardStats = async (req, res) => {
  try {
    // Total counts
    const totalScans = await Scan.countDocuments();
    const completedScans = await Scan.countDocuments({ status: 'completed' });
    const failedScans = await Scan.countDocuments({ status: 'failed' });
    const processingScans = await Scan.countDocuments({ status: 'processing' });
    const totalReports = await Report.countDocuments();
    const totalUsers = await User.countDocuments();

    // Completed scans with segmentation data
    const completedWithData = await Scan.find(
      { status: 'completed', 'segmentationData.tumorVolume': { $exists: true, $ne: null } },
      'segmentationData uploadDate'
    ).lean();

    // Average metrics
    let avgConfidence = 0;
    let avgVolume = 0;
    const volumes = [];
    const confidences = [];

    completedWithData.forEach(scan => {
      const sd = scan.segmentationData;
      if (sd.confidence) confidences.push(sd.confidence);
      if (sd.tumorVolume) volumes.push(sd.tumorVolume);
    });

    if (confidences.length > 0) {
      avgConfidence = Math.round((confidences.reduce((a, b) => a + b, 0) / confidences.length) * 10) / 10;
    }
    if (volumes.length > 0) {
      avgVolume = Math.round((volumes.reduce((a, b) => a + b, 0) / volumes.length) * 10) / 10;
    }

    // Location distribution
    const locationMap = {};
    completedWithData.forEach(scan => {
      const loc = scan.segmentationData?.location || 'Unknown';
      locationMap[loc] = (locationMap[loc] || 0) + 1;
    });
    const locationDistribution = Object.entries(locationMap).map(([name, count]) => ({ name, count }));

    // Characteristics summary
    let enhancingCount = 0, necroticCount = 0, edemaCount = 0;
    completedWithData.forEach(scan => {
      const chars = scan.segmentationData?.characteristics;
      if (chars?.enhancing) enhancingCount++;
      if (chars?.necrotic) necroticCount++;
      if (chars?.edema) edemaCount++;
    });

    const total = completedWithData.length || 1;
    const characteristicsSummary = {
      enhancing: Math.round((enhancingCount / total) * 100),
      necrotic: Math.round((necroticCount / total) * 100),
      edema: Math.round((edemaCount / total) * 100),
    };

    // Volume distribution (buckets)
    const volumeBuckets = [
      { label: '0-10', min: 0, max: 10, count: 0 },
      { label: '10-30', min: 10, max: 30, count: 0 },
      { label: '30-60', min: 30, max: 60, count: 0 },
      { label: '60-100', min: 60, max: 100, count: 0 },
      { label: '100+', min: 100, max: Infinity, count: 0 },
    ];
    volumes.forEach(v => {
      const bucket = volumeBuckets.find(b => v >= b.min && v < b.max);
      if (bucket) bucket.count++;
    });

    // Scans over time (last 30 days, grouped by day)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const recentScans = await Scan.find(
      { uploadDate: { $gte: thirtyDaysAgo } },
      'uploadDate status'
    ).sort('uploadDate').lean();

    const timelineMap = {};
    recentScans.forEach(scan => {
      const day = scan.uploadDate.toISOString().split('T')[0];
      timelineMap[day] = (timelineMap[day] || 0) + 1;
    });
    const scanTimeline = Object.entries(timelineMap).map(([date, count]) => ({ date, count }));

    res.json({
      success: true,
      data: {
        summary: {
          totalScans,
          completedScans,
          failedScans,
          processingScans,
          totalReports,
          totalUsers,
          avgConfidence,
          avgVolume,
          successRate: totalScans > 0 ? Math.round((completedScans / totalScans) * 100) : 0,
        },
        locationDistribution,
        characteristicsSummary,
        volumeDistribution: volumeBuckets.map(b => ({ label: b.label, count: b.count })),
        scanTimeline,
      }
    });
  } catch (err) {
    console.error('Analytics error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};
