import React, { useState, useEffect } from 'react';
import { getWorklist } from '../../services/segmentationService';
import { FiAlertTriangle, FiClock, FiChevronRight, FiRefreshCcw, FiInbox } from 'react-icons/fi';

const PRIORITY_STYLES = {
  Critical: { dot: 'bg-red-500', badge: 'bg-red-500/15 text-red-300 border-red-500/40', bar: 'bg-red-500' },
  High: { dot: 'bg-orange-500', badge: 'bg-orange-500/15 text-orange-300 border-orange-500/40', bar: 'bg-orange-500' },
  Moderate: { dot: 'bg-yellow-500', badge: 'bg-yellow-500/15 text-yellow-300 border-yellow-500/40', bar: 'bg-yellow-500' },
  Routine: { dot: 'bg-slate-500', badge: 'bg-slate-600/30 text-slate-300 border-slate-600', bar: 'bg-slate-500' },
};

const WorklistPanel = ({ onSelectScan }) => {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    try {
      setLoading(true);
      setError('');
      const res = await getWorklist();
      if (res.success) setItems(res.data);
      else setError('Failed to load worklist');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load worklist');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const counts = items.reduce((acc, it) => {
    acc[it.priority] = (acc[it.priority] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-xl font-bold text-slate-100">Triage Worklist</h2>
          <p className="text-sm text-slate-400">Cases ranked by clinical urgency — most pressing first.</p>
        </div>
        <button
          onClick={load}
          className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-all"
          title="Refresh"
        >
          <FiRefreshCcw className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Priority summary */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        {['Critical', 'High', 'Moderate', 'Routine'].map((p) => (
          <div key={p} className="bg-slate-800 rounded-xl border border-slate-700 p-3 flex items-center gap-3">
            <span className={`w-2.5 h-2.5 rounded-full ${PRIORITY_STYLES[p].dot}`}></span>
            <div>
              <div className="text-lg font-bold text-slate-100">{counts[p] || 0}</div>
              <div className="text-[11px] text-slate-400">{p}</div>
            </div>
          </div>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-8 h-8 border-3 border-slate-600 border-t-indigo-500 rounded-full animate-spin"></div>
        </div>
      ) : error ? (
        <p className="text-red-400 text-sm">{error}</p>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-slate-500">
          <FiInbox className="w-10 h-10 mb-3" />
          <p className="text-sm">No completed scans to triage yet.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((it) => {
            const style = PRIORITY_STYLES[it.priority] || PRIORITY_STYLES.Routine;
            return (
              <button
                key={it.id}
                onClick={() => onSelectScan?.(it.id)}
                className="w-full text-left bg-slate-800 hover:bg-slate-750 rounded-xl border border-slate-700 hover:border-slate-600 p-4 flex items-center gap-4 transition-all group"
              >
                {/* Urgency bar */}
                <div className="flex flex-col items-center w-10 shrink-0">
                  <div className="text-lg font-bold font-mono text-slate-200">{it.urgencyScore}</div>
                  <div className="w-full h-1.5 rounded-full bg-slate-700 mt-1 overflow-hidden">
                    <div className={`h-full ${style.bar}`} style={{ width: `${Math.min(it.urgencyScore, 100)}%` }}></div>
                  </div>
                </div>

                {/* Main info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`px-2 py-0.5 rounded text-[11px] font-medium border ${style.badge}`}>
                      {it.priority}
                    </span>
                    {it.flagForReview && (
                      <span className="flex items-center gap-1 text-[11px] text-amber-300">
                        <FiAlertTriangle className="w-3 h-3" /> Review
                      </span>
                    )}
                    {it.tumorType && (
                      <span className="text-[11px] text-slate-400">{it.tumorType}</span>
                    )}
                  </div>
                  <div className="text-sm text-slate-200 truncate">{it.fileName}</div>
                  <div className="flex items-center gap-3 text-[11px] text-slate-500 mt-1">
                    {it.patient?.name && <span>{it.patient.name}</span>}
                    <span>{it.volume} cm³</span>
                    <span>{Math.round(it.confidence)}% conf</span>
                    <span className="flex items-center gap-1">
                      <FiClock className="w-3 h-3" />
                      {new Date(it.uploadDate).toLocaleDateString()}
                    </span>
                  </div>
                  {it.reasons?.length > 0 && (
                    <div className="text-[11px] text-slate-400 mt-1.5 truncate">
                      {it.reasons.join(' • ')}
                    </div>
                  )}
                </div>

                <FiChevronRight className="text-slate-600 group-hover:text-slate-300 shrink-0" />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default WorklistPanel;
