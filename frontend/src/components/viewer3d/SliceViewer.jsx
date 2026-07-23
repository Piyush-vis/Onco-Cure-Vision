import React, { useState, useEffect, useCallback } from 'react';
import { FiGrid, FiEye, FiActivity, FiPlay, FiPause, FiChevronLeft, FiChevronRight, FiHelpCircle } from 'react-icons/fi';

const PLANES = [
  { id: 'axial', label: 'Axial', icon: '⬡' },
  { id: 'sagittal', label: 'Sagittal', icon: '◧' },
  { id: 'coronal', label: 'Coronal', icon: '⬠' },
];

const VIEW_MODES = [
  { id: 'raw', label: 'Raw MRI', icon: FiGrid, color: 'text-slate-300', desc: 'Original FLAIR scan' },
  { id: 'seg', label: 'Segmentation', icon: FiEye, color: 'text-indigo-400', desc: 'AI tumor overlay' },
  { id: 'heatmap', label: 'Grad-CAM', icon: FiActivity, color: 'text-amber-400', desc: 'AI attention map' },
  { id: 'uncertainty', label: 'Uncertainty', icon: FiHelpCircle, color: 'text-orange-400', desc: 'Where the model is unsure' },
];

const SliceViewer = ({ scanData }) => {
  const [plane, setPlane] = useState('axial');
  const [viewMode, setViewMode] = useState('seg');
  const [sliceIndex, setSliceIndex] = useState(10);
  const [manifest, setManifest] = useState(null);
  const [loading, setLoading] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState('');

  const sliceData = scanData?.sliceData;
  const basePath = sliceData?.basePath;

  // Load manifest
  useEffect(() => {
    if (!basePath) return;
    setLoading(true);
    setError('');

    fetch(`${basePath}/manifest.json`)
      .then(res => {
        if (!res.ok) throw new Error('Manifest not found');
        return res.json();
      })
      .then(data => {
        setManifest(data);
        setLoading(false);
      })
      .catch(err => {
        setError('2D slices not available for this scan');
        setLoading(false);
      });
  }, [basePath]);

  // Auto-play
  useEffect(() => {
    if (!playing || !manifest) return;
    const planeData = manifest.planes[plane];
    if (!planeData) return;

    const interval = setInterval(() => {
      setSliceIndex(prev => {
        const next = prev + 1;
        return next >= planeData.count ? 0 : next;
      });
    }, 200);

    return () => clearInterval(interval);
  }, [playing, plane, manifest]);

  // Reset slice index when plane changes
  useEffect(() => {
    if (manifest?.planes[plane]) {
      setSliceIndex(Math.floor(manifest.planes[plane].count / 2));
    }
  }, [plane, manifest]);

  const getImageUrl = useCallback(() => {
    if (!manifest || !basePath) return null;
    const planeData = manifest.planes[plane];
    if (!planeData) return null;

    let files;
    if (viewMode === 'raw') files = planeData.raw;
    else if (viewMode === 'seg') files = planeData.seg;
    else if (viewMode === 'heatmap') files = planeData.heatmap;
    else if (viewMode === 'uncertainty') files = planeData.uncertainty;

    if (!files || files.length === 0) return null;
    const idx = Math.min(sliceIndex, files.length - 1);
    return `${basePath}/${files[idx]}`;
  }, [manifest, basePath, plane, viewMode, sliceIndex]);

  if (!sliceData?.available) {
    return (
      <div className="bg-slate-800 rounded-xl border border-slate-700 p-6 flex items-center justify-center h-full">
        <p className="text-slate-500 text-sm">2D slice data not available for this scan.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="bg-slate-800 rounded-xl border border-slate-700 p-6 flex items-center justify-center h-full">
        <div className="w-8 h-8 border-3 border-slate-600 border-t-indigo-500 rounded-full animate-spin"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-slate-800 rounded-xl border border-slate-700 p-6 flex items-center justify-center h-full">
        <p className="text-red-400 text-sm">{error}</p>
      </div>
    );
  }

  const planeData = manifest?.planes[plane];
  const maxSlice = planeData ? planeData.count - 1 : 0;
  const imageUrl = getImageUrl();
  const hasHeatmap = manifest?.hasHeatmap;
  const hasUncertainty = manifest?.hasUncertainty;

  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700 flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-700 shrink-0">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
            <FiGrid className="text-indigo-400" />
            2D Slice Viewer
          </h3>
          <span className="text-xs text-slate-500 font-mono">
            Slice {sliceIndex + 1}/{maxSlice + 1}
          </span>
        </div>

        {/* Plane selector */}
        <div className="flex gap-1 mb-3">
          {PLANES.map(p => (
            <button
              key={p.id}
              onClick={() => { setPlane(p.id); setPlaying(false); }}
              className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-all ${
                plane === p.id
                  ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/20'
                  : 'bg-slate-700 text-slate-400 hover:bg-slate-600 hover:text-slate-200'
              }`}
            >
              {p.icon} {p.label}
            </button>
          ))}
        </div>

        {/* View mode selector */}
        <div className="flex gap-1">
          {VIEW_MODES.map(mode => {
            const Icon = mode.icon;
            const disabled = (mode.id === 'heatmap' && !hasHeatmap) ||
                             (mode.id === 'uncertainty' && !hasUncertainty);
            return (
              <button
                key={mode.id}
                onClick={() => !disabled && setViewMode(mode.id)}
                disabled={disabled}
                className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-all flex items-center justify-center gap-1 ${
                  viewMode === mode.id
                    ? 'bg-slate-900 text-white border border-slate-600'
                    : disabled
                      ? 'bg-slate-800 text-slate-600 cursor-not-allowed'
                      : 'bg-slate-700/50 text-slate-400 hover:bg-slate-700 hover:text-slate-200'
                }`}
                title={disabled ? `${mode.label} not available` : mode.desc}
              >
                <Icon className={`text-xs ${viewMode === mode.id ? mode.color : ''}`} />
                {mode.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Image display */}
      <div className="flex-1 flex items-center justify-center bg-black relative p-2 min-h-0">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={`${plane} slice ${sliceIndex}`}
            className="max-w-full max-h-full object-contain rounded"
            style={{ imageRendering: 'auto' }}
          />
        ) : (
          <p className="text-slate-500 text-sm">No image available</p>
        )}

        {/* View mode label */}
        <div className="absolute top-3 left-3 px-2 py-1 bg-black/60 rounded text-xs text-slate-300 backdrop-blur-sm">
          {VIEW_MODES.find(m => m.id === viewMode)?.label} • {PLANES.find(p => p.id === plane)?.label}
        </div>

        {/* Legend for segmentation */}
        {viewMode === 'seg' && (
          <div className="absolute bottom-3 left-3 flex gap-2">
            <span className="px-2 py-0.5 bg-purple-500/30 border border-purple-500/50 rounded text-[10px] text-purple-300">Necrotic</span>
            <span className="px-2 py-0.5 bg-blue-500/30 border border-blue-500/50 rounded text-[10px] text-blue-300">Edema</span>
            <span className="px-2 py-0.5 bg-red-500/30 border border-red-500/50 rounded text-[10px] text-red-300">Enhancing</span>
          </div>
        )}

        {/* Legend for heatmap */}
        {viewMode === 'heatmap' && (
          <div className="absolute bottom-3 left-3 flex items-center gap-2">
            <span className="text-[10px] text-blue-400">Low</span>
            <div className="w-24 h-2 rounded-full" style={{
              background: 'linear-gradient(to right, #0000FF, #00FFFF, #00FF00, #FFFF00, #FF0000)'
            }}></div>
            <span className="text-[10px] text-red-400">High</span>
            <span className="text-[10px] text-slate-400 ml-1">AI Attention</span>
          </div>
        )}

        {/* Legend for uncertainty */}
        {viewMode === 'uncertainty' && (
          <div className="absolute bottom-3 left-3 flex items-center gap-2">
            <span className="text-[10px] text-slate-400">Confident</span>
            <div className="w-24 h-2 rounded-full" style={{
              background: 'linear-gradient(to right, #000004, #51127c, #b73779, #fc8961, #fcfdbf)'
            }}></div>
            <span className="text-[10px] text-yellow-200">Unsure</span>
            <span className="text-[10px] text-slate-400 ml-1">Model uncertainty</span>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="px-4 py-3 border-t border-slate-700 shrink-0">
        <div className="flex items-center gap-3">
          {/* Play/Pause */}
          <button
            onClick={() => setPlaying(!playing)}
            className="p-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 hover:text-white transition-all"
            title={playing ? 'Pause' : 'Play through slices'}
          >
            {playing ? <FiPause className="w-4 h-4" /> : <FiPlay className="w-4 h-4" />}
          </button>

          {/* Previous */}
          <button
            onClick={() => { setSliceIndex(Math.max(0, sliceIndex - 1)); setPlaying(false); }}
            className="p-1.5 rounded text-slate-400 hover:text-white transition-all"
          >
            <FiChevronLeft className="w-4 h-4" />
          </button>

          {/* Slider */}
          <input
            type="range"
            min={0}
            max={maxSlice}
            value={sliceIndex}
            onChange={(e) => { setSliceIndex(parseInt(e.target.value)); setPlaying(false); }}
            className="flex-1 accent-indigo-500 cursor-pointer"
          />

          {/* Next */}
          <button
            onClick={() => { setSliceIndex(Math.min(maxSlice, sliceIndex + 1)); setPlaying(false); }}
            className="p-1.5 rounded text-slate-400 hover:text-white transition-all"
          >
            <FiChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default SliceViewer;
