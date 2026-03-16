import api from './api';

// Upload a DICOM file — returns immediately with scan in "processing" status
export const uploadScan = async (files) => {
  const formData = new FormData();
  for (const file of files) {
    formData.append('dicom', file);
  }

  const response = await api.post('/scans/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return response.data;
};

// Poll for scan status until completed or failed
export const pollScanStatus = (scanId, onUpdate, intervalMs = 2000, maxWaitMs = 120000) => {
  const startTime = Date.now();

  const interval = setInterval(async () => {
    try {
      const response = await api.get(`/scans/${scanId}/status`);
      const { data } = response.data;

      onUpdate(data);

      if (data.status === 'completed' || data.status === 'failed') {
        clearInterval(interval);
      }

      if (Date.now() - startTime > maxWaitMs) {
        clearInterval(interval);
        onUpdate({ ...data, status: 'failed', _timedOut: true });
      }
    } catch (err) {
      console.error('Polling error:', err);
      clearInterval(interval);
    }
  }, intervalMs);

  return () => clearInterval(interval); // return cleanup function
};

// Fetch a single scan by ID
export const getScan = async (id) => {
  const response = await api.get(`/scans/${id}`);
  return response.data;
};

// Fetch all scans for current user
export const getUserScans = async () => {
  const response = await api.get('/scans');
  return response.data;
};

// Generate AI report for a scan (Doctor only)
export const generateReport = async (scanId) => {
  const response = await api.post('/reports/generate', { scanId });
  return response.data;
};

// Generate AI report from uploaded PDF
export const generateReportFromPdf = async (scanId, pdfFile) => {
  const formData = new FormData();
  formData.append('scanId', scanId);
  formData.append('reportPdf', pdfFile);

  const response = await api.post('/reports/generate-pdf', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return response.data;
};

// Fetch a report by ID
export const getReport = async (id) => {
  const response = await api.get(`/reports/${id}`);
  return response.data;
};
