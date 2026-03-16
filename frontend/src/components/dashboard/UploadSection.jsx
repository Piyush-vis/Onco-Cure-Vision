import React, { useState, useCallback, useRef } from 'react';
import { uploadScan, pollScanStatus } from '../../services/segmentationService';

const STAGES = {
  idle: { label: '', pct: 0 },
  uploading: { label: 'Uploading file...', pct: 20 },
  processing: { label: 'AI Predicting Tumor...', pct: 40 },
  analyzing: { label: 'Generating mesh data...', pct: 80 },
  done: { label: 'Analysis complete!', pct: 100 },
  failed: { label: 'Processing failed', pct: 0 },
};

const UploadSection = ({ onScanComplete, backendOnline }) => {
  const [files, setFiles] = useState([]);
  const [stage, setStage] = useState('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);
  const cleanupPollRef = useRef(null);

  const isUploading = stage !== 'idle' && stage !== 'failed';

  const handleFiles = (newFiles) => {
    if (!newFiles || newFiles.length === 0) return;
    setFiles(Array.from(newFiles));
    setError('');
    setStage('idle');
    setProgress(0);
  };

  const handleFileChange = (e) => {
    if (e.target.files?.length > 0) handleFiles(e.target.files);
  };

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files?.length > 0) handleFiles(e.dataTransfer.files);
  }, []);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => setIsDragOver(false), []);

  const handleRemove = (e) => {
    e.stopPropagation();
    setFiles([]);
    setStage('idle');
    setProgress(0);
    setError('');
    if (cleanupPollRef.current) cleanupPollRef.current();
  };

  const handleUpload = async () => {
    if (files.length === 0 || isUploading) return;

    if (!backendOnline) {
      setError('Backend server is not reachable. Please start the backend (npm run dev in /backend) before uploading.');
      return;
    }

    setError('');
    setStage('uploading');
    setProgress(STAGES.uploading.pct);

    try {
      // 1. Upload the files
      const result = await uploadScan(files);
      if (!result.success) throw new Error(result.error || 'Upload failed');

      const scanId = result.data._id;

      // 2. Move to processing stage
      setStage('processing');
      setProgress(STAGES.processing.pct);

      // 3. Poll until done
      let analysisProgress = STAGES.processing.pct;
      const cleanup = pollScanStatus(
        scanId,
        (scanData) => {
          if (scanData.status === 'completed') {
            setStage('done');
            setProgress(100);
            setTimeout(() => onScanComplete(scanId, scanData), 800);
          } else if (scanData.status === 'failed') {
            setStage('failed');
            setError(scanData._timedOut
              ? 'Processing timed out. The segmentation service may be unavailable.'
              : 'AI segmentation failed. Please try a different scan file.');
          } else {
            // Still processing — nudge progress bar forward
            analysisProgress = Math.min(analysisProgress + 3, 90);
            setProgress(analysisProgress);
          }
        },
        2000,   // poll every 2s
        120000  // max 2 minutes
      );
      cleanupPollRef.current = cleanup;

    } catch (err) {
      setStage('failed');
      setError(err.response?.data?.error || err.message || 'Upload failed. Is the backend running?');
    }
  };

  const currentStage = STAGES[stage] || STAGES.idle;

  return (
    <div className="flex flex-col space-y-5">
      {/* Drop Zone */}
      <div
        onClick={() => !isUploading && document.getElementById('dicom-file-input').click()}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        style={{
          border: `2px dashed ${isDragOver ? '#6366f1' : files.length > 0 ? '#4f46e5' : '#334155'}`,
          background: isDragOver
            ? 'rgba(99,102,241,0.08)'
            : files.length > 0
            ? 'rgba(79,70,229,0.05)'
            : 'rgba(15,23,42,0.3)',
          transition: 'all 0.2s',
          cursor: isUploading ? 'default' : 'pointer',
        }}
        className="rounded-xl p-10 flex flex-col items-center justify-center text-center select-none"
      >
        <input
          id="dicom-file-input"
          type="file"
          accept=".dcm,.dicom,.zip,.nii,.nii.gz"
          className="hidden"
          onChange={handleFileChange}
          disabled={isUploading}
          multiple
        />

        {files.length > 0 ? (
          <div className="flex flex-col items-center">
            {/* File icon */}
            <div style={{ background: 'rgba(99,102,241,0.15)' }} className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <p className="text-white font-semibold text-lg max-w-xs truncate">
                {files.length === 1 ? files[0].name : `${files.length} files selected`}
            </p>
            <p className="text-slate-400 text-sm mt-1">
                {(files.reduce((acc, f) => acc + f.size, 0) / (1024 * 1024)).toFixed(2)} MB
            </p>
            {!isUploading && (
              <button
                onClick={handleRemove}
                className="mt-3 text-red-400 hover:text-red-300 text-sm flex items-center gap-1 transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                Remove File
              </button>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center">
            <div style={{ background: 'rgba(99,102,241,0.1)' }} className="w-20 h-20 rounded-full flex items-center justify-center mb-5">
              <svg className="w-10 h-10 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
            </div>
            <p className="text-lg font-semibold text-slate-200 mb-1">
              {isDragOver ? 'Drop your file here' : 'Drop DICOM file here'}
            </p>
            <p className="text-sm text-slate-500 mb-4">or click to browse from your computer</p>
            <div style={{ background: 'rgba(15,23,42,0.5)', border: '1px solid rgba(71,85,105,0.4)' }}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs text-slate-500"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Supported: .dcm, .zip, .nii, .nii.gz — max 200MB
            </div>
          </div>
        )}
      </div>

      {/* Error display */}
      {error && (
        <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.4)' }}
          className="rounded-lg px-4 py-3 flex items-start gap-2 text-red-400 text-sm"
        >
          <svg className="w-4 h-4 shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
          {error}
        </div>
      )}

      {/* Progress Bar (while processing) */}
      {isUploading && (
        <div className="w-full space-y-2">
          <div className="flex justify-between items-center text-xs text-slate-400">
            <span className="flex items-center gap-2">
              <svg className="animate-spin w-3.5 h-3.5 text-indigo-400" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
              {currentStage.label}
            </span>
            <span className="font-mono text-indigo-400">{progress}%</span>
          </div>
          <div style={{ background: 'rgba(30,41,59,0.8)' }} className="w-full h-2 rounded-full overflow-hidden">
            <div
              className="h-2 rounded-full transition-all duration-700"
              style={{
                width: `${progress}%`,
                background: 'linear-gradient(90deg, #6366f1, #8b5cf6)',
                boxShadow: '0 0 8px rgba(99,102,241,0.6)'
              }}
            />
          </div>
          {/* Stage steps indicator */}
          <div className="flex justify-between text-xs text-slate-600 pt-1">
            {['Upload', 'AI Predict', 'Mesh', 'Complete'].map((s, i) => {
              const stepPct = [20, 40, 80, 100][i];
              const active = progress >= stepPct;
              return (
                <span key={s} className={`flex items-center gap-1 ${active ? 'text-indigo-400' : ''}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-indigo-400' : 'bg-slate-700'}`}/>
                  {s}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* Stage = done (brief success) */}
      {stage === 'done' && (
        <div style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.4)' }}
          className="rounded-lg px-4 py-3 flex items-center gap-2 text-emerald-400 text-sm font-medium"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          Analysis complete! Opening 3D viewer...
        </div>
      )}

      {/* Upload Button */}
      {!isUploading && stage !== 'done' && (
        <button
          id="upload-analyze-btn"
          onClick={handleUpload}
          disabled={files.length === 0}
          style={{
            background: files.length > 0
              ? 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)'
              : 'rgba(30,41,59,0.8)',
            boxShadow: files.length > 0 ? '0 4px 15px rgba(99,102,241,0.35)' : 'none',
            transition: 'all 0.2s',
            border: files.length > 0 ? 'none' : '1px solid rgba(71,85,105,0.4)',
          }}
          className="w-full py-3.5 px-4 text-white font-semibold rounded-xl text-sm flex items-center justify-center gap-2 hover:opacity-90 disabled:cursor-not-allowed disabled:text-slate-500"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
          Analyze MRI Scan with AI
        </button>
      )}

      {/* Retry after fail */}
      {stage === 'failed' && (
        <button
          onClick={() => { setStage('idle'); setProgress(0); setError(''); }}
          style={{ border: '1px solid rgba(99,102,241,0.4)' }}
          className="w-full py-2.5 text-indigo-400 hover:text-indigo-300 font-medium rounded-xl text-sm hover:bg-indigo-500/10 transition-colors"
        >
          Try Again
        </button>
      )}
    </div>
  );
};

export default UploadSection;
