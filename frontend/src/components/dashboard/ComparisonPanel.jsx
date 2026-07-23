import React, { useState, useEffect, useCallback } from 'react';
import { getUserScans } from '../../services/segmentationService';
import api from '../../services/api';
import { FiGitBranch, FiArrowRight, FiTrendingUp, FiTrendingDown, FiMinus, FiPlay, FiPause, FiChevronLeft, FiChevronRight, FiLayers, FiColumns } from 'react-icons/fi';

const PLANES = [
  { id: 'axial', label: 'Axial' },
  { id: 'sagittal', label: 'Sagittal' },
  { id: 'coronal', label: 'Coronal' },
];

const ComparisonPanel = () => {
  const [scans, setScans] = useState([]);
  const [scanId1, setScanId1] = useState('');
  const [scanId2, setScanId2] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingScans, setLoadingScans] = useState(true);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  // Viewer state
  const [viewMode, setViewMode] = useState('overlay'); // 'overlay' or 'sideBySide'
  const [plane, setPlane] = useState('axial');
  const [sliceIndex, setSliceIndex] = useState(10);
  const [manifest, setManifest] = useState(null);
  const [playing, setPlaying] = useState(false);

  // Fetch completed scans
  useEffect(() => {
    const fetchScans = async () => {
      try {
        const res = await getUserScans();
        if (res.success) {
          const completed = (res.data || []).filter(s => s.status === 'completed');
          setScans(completed);
        }
      } catch (err) {
        console.error('Failed to load scans:', err);
      } finally {
        setLoadingScans(false);
      }
    };
    fetchScans();
  }, []);

  // Load comparison manifest when result comes in
  useEffect(() => {
    if (!result?.comparisonImages?.basePath) return;
    const url = `${result.comparisonImages.basePath}/${result.comparisonImages.manifestFile}`;
    fetch(url)
      .then(res => res.json())
      .then(data => {
        setManifest(data);
        if (data.planes?.axial) {
          setSliceIndex(Math.floor(data.planes.axial.count / 2));
        }
      })
      .catch(err => console.error('Failed to load manifest:', err));
  }, [result]);

  // Auto-play
  useEffect(() => {
    if (!playing || !manifest) return;
    const planeData = manifest.planes[plane];
    if (!planeData) return;
    const interval = setInterval(() => {
      setSliceIndex(prev => (prev + 1) >= planeData.count ? 0 : prev + 1);
    }, 200);
    return () => clearInterval(interval);
  }, [playing, plane, manifest]);

  // Reset slice on plane change
  useEffect(() => {
    if (manifest?.planes[plane]) {
      setSliceIndex(Math.floor(manifest.planes[plane].count / 2));
    }
  }, [plane, manifest]);

  const handleCompare = async () => {
    if (!scanId1 || !scanId2) return;
    setLoading(true);
    setError('');
    setResult(null);
    setManifest(null);
    try {
      const res = await api.post('/compare', { scanId1, scanId2 });
      if (res.data.success) {
        setResult(res.data.data);
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Comparison failed');
    } finally {
      setLoading(false);
    }
  };

  const getImageUrl = useCallback(() => {
    if (!manifest || !result) return null;
    const planeData = manifest.planes[plane];
    if (!planeData) return null;
    const files = viewMode === 'overlay' ? planeData.overlay : planeData.sideBySide;
    if (!files || files.length === 0) return null;
    const idx = Math.min(sliceIndex, files.length - 1);
    return `${result.comparisonImages.basePath}/${files[idx]}`;
  }, [manifest, result, plane, viewMode, sliceIndex]);

  const maxSlice = manifest?.planes[plane]?.count ? manifest.planes[plane].count - 1 : 0;

  return (
    <div className="max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-indigo-500/20 flex items-center justify-center">
          <FiGitBranch className="w-5 h-5 text-indigo-400" />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-slate-100">Longitudinal Comparison</h2>
          <p className="text-sm text-slate-400">Track tumor progression between two scans</p>
        </div>
      </div>

      {/* Scan Selectors */}
      <div className="bg-slate-800 rounded-xl border border-slate-700 p-6 mb-6">
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <label className="text-xs text-slate-400 mb-1.5 block font-medium">Baseline Scan (Older)</label>
            <select
              value={scanId1}
              onChange={e => setScanId1(e.target.value)}
              className="w-full bg-slate-900 border border-slate-600 text-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              disabled={loadingScans}
            >
              <option value="">Select baseline scan...</option>
              {scans.map(s => (
                <option key={s._id} value={s._id} disabled={s._id === scanId2}>
                  {s.fileName || 'Unnamed'} — {new Date(s.uploadDate).toLocaleDateString()} ({s.segmentationData?.tumorVolume || '?'} cm³)
                </option>
              ))}
            </select>
          </div>

          <div className="pt-5">
            <FiArrowRight className="w-6 h-6 text-indigo-400" />
          </div>

          <div className="flex-1">
            <label className="text-xs text-slate-400 mb-1.5 block font-medium">Follow-up Scan (Newer)</label>
            <select
              value={scanId2}
              onChange={e => setScanId2(e.target.value)}
              className="w-full bg-slate-900 border border-slate-600 text-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              disabled={loadingScans}
            >
              <option value="">Select follow-up scan...</option>
              {scans.map(s => (
                <option key={s._id} value={s._id} disabled={s._id === scanId1}>
                  {s.fileName || 'Unnamed'} — {new Date(s.uploadDate).toLocaleDateString()} ({s.segmentationData?.tumorVolume || '?'} cm³)
                </option>
              ))}
            </select>
          </div>

          <div className="pt-5">
            <button
              onClick={handleCompare}
              disabled={loading || !scanId1 || !scanId2}
              className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-700 disabled:text-slate-500 text-white font-medium rounded-lg transition-all text-sm whitespace-nowrap"
            >
              {loading ? 'Comparing...' : 'Compare'}
            </button>
          </div>
        </div>

        {error && <p className="text-red-400 text-sm mt-3">{error}</p>}
      </div>

      {/* Results */}
      {result && (
        <>
          {/* Delta Metrics */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <DeltaCard
              label="Volume Change"
              oldVal={`${result.baseline.volume} cm³`}
              newVal={`${result.followUp.volume} cm³`}
              delta={`${result.delta.volumeChangePct > 0 ? '+' : ''}${result.delta.volumeChangePct}%`}
              trend={result.delta.volumeChangePct}
            />
            <DeltaCard
              label="Location"
              oldVal={result.baseline.location}
              newVal={result.followUp.location}
              delta={result.baseline.location === result.followUp.location ? 'Stable' : 'Shifted'}
              trend={result.baseline.location === result.followUp.location ? 0 : 1}
            />
            <DeltaCard
              label="Confidence"
              oldVal={`${result.baseline.confidence}%`}
              newVal={`${result.followUp.confidence}%`}
              delta={`${(result.followUp.confidence - result.baseline.confidence) > 0 ? '+' : ''}${Math.round((result.followUp.confidence - result.baseline.confidence) * 10) / 10}%`}
              trend={0}
            />
            <AssessmentCard assessment={result.delta.assessment} />
          </div>

          {/* RANO 2.0 response assessment (P2) */}
          {result.delta.rano && (
            <RanoPanel
              rano={result.delta.rano}
              growth={result.delta.growth}
              pseudo={result.delta.pseudoprogression}
              intervalDays={result.delta.intervalDays}
            />
          )}

          {/* Comparison Viewer */}
          {manifest && (
            <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
              {/* Viewer Header */}
              <div className="px-5 py-4 border-b border-slate-700 flex items-center justify-between">
                <div className="flex gap-1">
                  {PLANES.map(p => (
                    <button
                      key={p.id}
                      onClick={() => { setPlane(p.id); setPlaying(false); }}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                        plane === p.id ? 'bg-indigo-600 text-white' : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>

                <div className="flex bg-slate-900 rounded-lg p-0.5 border border-slate-600">
                  <button
                    onClick={() => setViewMode('overlay')}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md flex items-center gap-1 transition-all ${
                      viewMode === 'overlay' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    <FiLayers className="w-3 h-3" /> Overlay
                  </button>
                  <button
                    onClick={() => setViewMode('sideBySide')}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md flex items-center gap-1 transition-all ${
                      viewMode === 'sideBySide' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    <FiColumns className="w-3 h-3" /> Side by Side
                  </button>
                </div>
              </div>

              {/* Image Display */}
              <div className="relative bg-black flex items-center justify-center" style={{ minHeight: '400px' }}>
                {getImageUrl() ? (
                  <img
                    src={getImageUrl()}
                    alt={`Comparison ${plane} slice ${sliceIndex}`}
                    className="max-w-full max-h-[500px] object-contain"
                  />
                ) : (
                  <p className="text-slate-500">No comparison images available</p>
                )}

                {/* Legend */}
                {viewMode === 'overlay' && (
                  <div className="absolute bottom-3 left-3 flex gap-2">
                    <span className="px-2 py-0.5 bg-blue-500/30 border border-blue-500/50 rounded text-[10px] text-blue-300">🔵 Shrinkage</span>
                    <span className="px-2 py-0.5 bg-red-500/30 border border-red-500/50 rounded text-[10px] text-red-300">🔴 Growth</span>
                    <span className="px-2 py-0.5 bg-purple-500/30 border border-purple-500/50 rounded text-[10px] text-purple-300">🟣 Stable</span>
                  </div>
                )}
                {viewMode === 'sideBySide' && (
                  <div className="absolute bottom-3 left-3 flex gap-4">
                    <span className="px-2 py-0.5 bg-slate-800/80 rounded text-[10px] text-slate-300">← Baseline</span>
                    <span className="px-2 py-0.5 bg-slate-800/80 rounded text-[10px] text-slate-300">Follow-up →</span>
                  </div>
                )}

                {/* Slice counter */}
                <div className="absolute top-3 left-3 px-2 py-1 bg-black/60 rounded text-xs text-slate-300 backdrop-blur-sm">
                  Slice {sliceIndex + 1}/{maxSlice + 1}
                </div>
              </div>

              {/* Controls */}
              <div className="px-5 py-3 border-t border-slate-700 flex items-center gap-3">
                <button
                  onClick={() => setPlaying(!playing)}
                  className="p-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 hover:text-white transition-all"
                >
                  {playing ? <FiPause className="w-4 h-4" /> : <FiPlay className="w-4 h-4" />}
                </button>
                <button onClick={() => { setSliceIndex(Math.max(0, sliceIndex - 1)); setPlaying(false); }} className="p-1.5 text-slate-400 hover:text-white">
                  <FiChevronLeft className="w-4 h-4" />
                </button>
                <input
                  type="range"
                  min={0}
                  max={maxSlice}
                  value={sliceIndex}
                  onChange={e => { setSliceIndex(parseInt(e.target.value)); setPlaying(false); }}
                  className="flex-1 accent-indigo-500 cursor-pointer"
                />
                <button onClick={() => { setSliceIndex(Math.min(maxSlice, sliceIndex + 1)); setPlaying(false); }} className="p-1.5 text-slate-400 hover:text-white">
                  <FiChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* Sub-region Changes */}
          {result.delta.voxelMetrics?.spatial && (
            <div className="mt-6 grid grid-cols-3 gap-4">
              <VoxelCard label="Growth Voxels" value={result.delta.voxelMetrics.spatial.growthVoxels} color="text-red-400" bg="bg-red-500/10 border-red-500/30" />
              <VoxelCard label="Shrinkage Voxels" value={result.delta.voxelMetrics.spatial.shrinkageVoxels} color="text-blue-400" bg="bg-blue-500/10 border-blue-500/30" />
              <VoxelCard label="Overlap Voxels" value={result.delta.voxelMetrics.spatial.overlapVoxels} color="text-purple-400" bg="bg-purple-500/10 border-purple-500/30" />
            </div>
          )}
        </>
      )}

      {/* Empty state */}
      {!result && !loading && (
        <div className="bg-slate-800/50 rounded-xl border border-dashed border-slate-600 p-12 text-center">
          <FiGitBranch className="w-12 h-12 text-slate-600 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-slate-300 mb-2">Compare Two Scans</h3>
          <p className="text-sm text-slate-500 max-w-md mx-auto">
            Select a baseline and follow-up scan above to visualize tumor changes over time.
            The overlay view shows growth (red), shrinkage (blue), and stable regions (purple).
          </p>
        </div>
      )}

      {loading && (
        <div className="bg-slate-800 rounded-xl border border-slate-700 p-12 flex flex-col items-center justify-center">
          <div className="w-12 h-12 border-4 border-slate-700 border-t-indigo-500 rounded-full animate-spin mb-4"></div>
          <p className="text-slate-400 text-sm">Generating comparison images...</p>
        </div>
      )}
    </div>
  );
};

const DeltaCard = ({ label, oldVal, newVal, delta, trend }) => (
  <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
    <div className="text-xs text-slate-400 mb-2">{label}</div>
    <div className="flex items-center gap-2 mb-2">
      <span className="text-sm text-slate-400 font-mono">{oldVal}</span>
      <FiArrowRight className="w-3 h-3 text-slate-500" />
      <span className="text-sm text-white font-mono font-bold">{newVal}</span>
    </div>
    <div className={`flex items-center gap-1 text-sm font-bold ${
      trend < 0 ? 'text-green-400' : trend > 0 ? 'text-red-400' : 'text-slate-300'
    }`}>
      {trend < 0 ? <FiTrendingDown /> : trend > 0 ? <FiTrendingUp /> : <FiMinus />}
      {delta}
    </div>
  </div>
);

const AssessmentCard = ({ assessment }) => {
  const config = {
    Improving: { bg: 'bg-green-500/10 border-green-500/30', text: 'text-green-400', icon: '📉' },
    Stable: { bg: 'bg-yellow-500/10 border-yellow-500/30', text: 'text-yellow-400', icon: '📊' },
    Progressing: { bg: 'bg-red-500/10 border-red-500/30', text: 'text-red-400', icon: '📈' },
  };
  const c = config[assessment] || config.Stable;
  return (
    <div className={`rounded-xl border p-4 flex flex-col items-center justify-center ${c.bg}`}>
      <div className="text-2xl mb-1">{c.icon}</div>
      <div className={`text-lg font-bold ${c.text}`}>{assessment}</div>
      <div className="text-xs text-slate-400">Overall Assessment</div>
    </div>
  );
};

const VoxelCard = ({ label, value, color, bg }) => (
  <div className={`rounded-xl border p-4 ${bg}`}>
    <div className="text-xs text-slate-400 mb-1">{label}</div>
    <div className={`text-xl font-bold font-mono ${color}`}>{value?.toLocaleString() || 0}</div>
  </div>
);

// RANO 2.0 volumetric response, growth kinetics, and pseudoprogression triage (P2)
const RANO_CONFIG = {
  CR: { bg: 'bg-green-500/10 border-green-500/40', text: 'text-green-400', label: 'Complete Response' },
  PR: { bg: 'bg-green-500/10 border-green-500/30', text: 'text-green-300', label: 'Partial Response' },
  SD: { bg: 'bg-yellow-500/10 border-yellow-500/30', text: 'text-yellow-300', label: 'Stable Disease' },
  PD: { bg: 'bg-red-500/10 border-red-500/40', text: 'text-red-400', label: 'Progressive Disease' },
};

const PSEUDO_CONFIG = {
  high: { bg: 'bg-amber-500/15 border-amber-500/50', text: 'text-amber-300' },
  moderate: { bg: 'bg-amber-500/10 border-amber-500/30', text: 'text-amber-300' },
  low: { bg: 'bg-slate-700/40 border-slate-600', text: 'text-slate-300' },
};

const RanoPanel = ({ rano, growth, pseudo, intervalDays }) => {
  const c = RANO_CONFIG[rano.category] || RANO_CONFIG.SD;
  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700 p-5 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h4 className="text-sm font-semibold text-slate-200">RANO 2.0 Response Assessment</h4>
        {intervalDays != null && (
          <span className="text-xs text-slate-500">{intervalDays} days between scans</span>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Response category */}
        <div className={`rounded-lg border p-4 flex flex-col justify-center ${c.bg}`}>
          <div className={`text-2xl font-extrabold ${c.text}`}>{rano.category}</div>
          <div className={`text-sm font-medium ${c.text}`}>{c.label}</div>
          <div className="text-xs text-slate-400 mt-2">
            {rano.target}: {rano.targetChangePercent == null ? 'new lesion' : `${rano.targetChangePercent > 0 ? '+' : ''}${rano.targetChangePercent}%`}
          </div>
        </div>

        {/* Growth kinetics */}
        <div className="rounded-lg border border-slate-700 bg-slate-900 p-4">
          <div className="text-xs text-slate-400 mb-2">Growth Kinetics</div>
          <div className="space-y-1.5 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-400">Doubling time</span>
              <span className="font-mono text-slate-200">
                {growth?.volumeDoublingTimeDays ? `${growth.volumeDoublingTimeDays} d` : '—'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Monthly change</span>
              <span className={`font-mono ${growth?.monthlyVolumeChangePercent > 0 ? 'text-red-400' : 'text-green-400'}`}>
                {growth?.monthlyVolumeChangePercent != null
                  ? `${growth.monthlyVolumeChangePercent > 0 ? '+' : ''}${growth.monthlyVolumeChangePercent}%`
                  : '—'}
              </span>
            </div>
          </div>
        </div>

        {/* Pseudoprogression triage */}
        {pseudo?.applicable ? (
          <div className={`rounded-lg border p-4 ${(PSEUDO_CONFIG[pseudo.riskLevel] || PSEUDO_CONFIG.low).bg}`}>
            <div className="text-xs text-slate-400 mb-1">Pseudoprogression risk</div>
            <div className={`text-lg font-bold capitalize ${(PSEUDO_CONFIG[pseudo.riskLevel] || PSEUDO_CONFIG.low).text}`}>
              {pseudo.riskLevel}
            </div>
            {pseudo.factors?.length > 0 && (
              <ul className="mt-2 text-[11px] text-slate-400 list-disc list-inside space-y-0.5">
                {pseudo.factors.map((f, i) => <li key={i}>{f}</li>)}
              </ul>
            )}
          </div>
        ) : (
          <div className="rounded-lg border border-slate-700 bg-slate-900 p-4 flex items-center justify-center">
            <span className="text-xs text-slate-500 text-center">
              Pseudoprogression check applies only to apparent progression
            </span>
          </div>
        )}
      </div>

      {rano.note && (
        <p className="text-[11px] text-slate-500 mt-3 italic">{rano.note}</p>
      )}
    </div>
  );
};

export default ComparisonPanel;
