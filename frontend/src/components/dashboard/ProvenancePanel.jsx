import React, { useState, useEffect } from 'react';
import {
  getModelCard, getAuditTrail, recordClinicianAction, getFhirReport,
} from '../../services/segmentationService';
import {
  FiShield, FiCheckCircle, FiEdit3, FiDownload, FiClock, FiCpu, FiAlertCircle,
} from 'react-icons/fi';

const ACTION_LABELS = {
  scan_uploaded: 'Scan uploaded',
  segmentation_completed: 'AI segmentation completed',
  segmentation_failed: 'Segmentation failed',
  report_generated: 'Report exported',
  comparison_run: 'Comparison run',
  clinician_acknowledged: 'Clinician acknowledged',
  clinician_overrode: 'Clinician overrode',
};

const ProvenancePanel = ({ scanData, scanId }) => {
  const [card, setCard] = useState(null);
  const [trail, setTrail] = useState([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => { getModelCard().then(r => r.success && setCard(r.data)).catch(() => {}); }, []);

  const loadTrail = () => {
    if (!scanId) return;
    getAuditTrail(scanId).then(r => r.success && setTrail(r.data)).catch(() => setTrail([]));
  };
  useEffect(() => { loadTrail(); }, [scanId]);

  const handleAction = async (action) => {
    if (!scanId) return;
    setBusy(true); setMsg('');
    try {
      let note = null;
      if (action === 'clinician_overrode') {
        note = window.prompt('Reason for overriding the AI finding:') || 'No reason given';
      }
      await recordClinicianAction(scanId, action, note);
      setMsg(action === 'clinician_acknowledged' ? 'Acknowledged and logged.' : 'Override logged.');
      loadTrail();
    } catch (e) {
      setMsg(e.response?.data?.error || 'Action failed');
    } finally { setBusy(false); }
  };

  const handleFhirExport = async () => {
    if (!scanId) return;
    try {
      const bundle = await getFhirReport(scanId);
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/fhir+json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `fhir_diagnostic_report_${scanId}.json`; a.click();
      URL.revokeObjectURL(url);
      loadTrail();
    } catch (e) {
      setMsg('FHIR export failed');
    }
  };

  const prov = scanData?.provenance;

  return (
    <div className="animate-fade-in max-w-4xl mx-auto space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
          <FiShield className="text-indigo-400" /> Provenance &amp; Audit
        </h2>
        <p className="text-sm text-slate-400">What produced this result, its limits, and a defensible trail of AI outputs.</p>
      </div>

      {/* Model card */}
      {card && (
        <div className="bg-slate-800 rounded-xl border border-slate-700 p-5">
          <div className="flex items-center gap-2 mb-3">
            <FiCpu className="text-indigo-400" />
            <h3 className="text-sm font-semibold text-slate-200">Model Card</h3>
            <span className="ml-auto text-[11px] font-mono text-slate-500">{card.version}</span>
          </div>
          <div className="grid md:grid-cols-2 gap-4 text-sm">
            <div>
              <Field label="Task" value={card.task} />
              <Field label="Architecture" value={card.architecture} />
              <Field label="Training data" value={card.trainingData} />
              <Field label="Regulatory status" value={card.regulatoryStatus} warn />
            </div>
            <div>
              <div className="text-xs text-slate-400 mb-1">Performance (Dice)</div>
              <div className="grid grid-cols-2 gap-1 text-xs font-mono text-slate-300 mb-3">
                <span>Mean: {card.performance.meanDice}</span>
                <span>Edema: {card.performance.edemaDice}</span>
                <span>Enhancing: {card.performance.enhancingTumorDice}</span>
                <span>Necrotic: {card.performance.necroticCoreDice}</span>
              </div>
              <Field label="Intended use" value={card.intendedUse} />
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-slate-700">
            <div className="text-xs text-amber-400/90 flex items-center gap-1 mb-1"><FiAlertCircle /> Known limitations</div>
            <ul className="text-[11px] text-slate-400 list-disc list-inside space-y-0.5">
              {card.limitations.map((l, i) => <li key={i}>{l}</li>)}
            </ul>
          </div>
        </div>
      )}

      {/* Per-scan provenance + actions */}
      {scanId ? (
        <>
          <div className="bg-slate-800 rounded-xl border border-slate-700 p-5">
            <h3 className="text-sm font-semibold text-slate-200 mb-3">This Result</h3>
            {prov ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs font-mono">
                <Stat label="Model" value={prov.modelVersion} />
                <Stat label="Weights hash" value={prov.modelHash} />
                <Stat label="Input hash" value={prov.inputHash} />
                <Stat label="TTA passes" value={prov.ttaPasses} />
              </div>
            ) : (
              <p className="text-xs text-slate-500">No provenance recorded for this scan.</p>
            )}

            <div className="flex flex-wrap gap-2 mt-4">
              <button onClick={() => handleAction('clinician_acknowledged')} disabled={busy}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg bg-green-600/20 text-green-300 border border-green-600/40 hover:bg-green-600/30 disabled:opacity-50">
                <FiCheckCircle /> Acknowledge
              </button>
              <button onClick={() => handleAction('clinician_overrode')} disabled={busy}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg bg-amber-600/20 text-amber-300 border border-amber-600/40 hover:bg-amber-600/30 disabled:opacity-50">
                <FiEdit3 /> Override
              </button>
              <button onClick={handleFhirExport}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg bg-slate-700 text-slate-200 border border-slate-600 hover:bg-slate-600">
                <FiDownload /> Export FHIR
              </button>
              {msg && <span className="text-xs text-slate-400 self-center">{msg}</span>}
            </div>
          </div>

          {/* Audit trail */}
          <div className="bg-slate-800 rounded-xl border border-slate-700 p-5">
            <h3 className="text-sm font-semibold text-slate-200 mb-3">Audit Trail</h3>
            {trail.length === 0 ? (
              <p className="text-xs text-slate-500">No audit entries yet.</p>
            ) : (
              <ol className="relative border-l border-slate-700 ml-2">
                {trail.map((e) => (
                  <li key={e._id} className="mb-4 ml-4">
                    <span className="absolute -left-1.5 w-3 h-3 rounded-full bg-indigo-500 border-2 border-slate-800"></span>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-slate-200">{ACTION_LABELS[e.action] || e.action}</span>
                      <span className="text-[11px] text-slate-500 flex items-center gap-1">
                        <FiClock className="w-3 h-3" />{new Date(e.timestamp).toLocaleString()}
                      </span>
                    </div>
                    {e.user?.name && <div className="text-[11px] text-slate-500">by {e.user.name}</div>}
                    {e.note && <div className="text-[11px] text-slate-400 italic mt-0.5">“{e.note}”</div>}
                    {e.details?.confidence != null && (
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        confidence {e.details.confidence}% · {e.details.flagForReview ? 'flagged for review' : 'not flagged'}
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </div>
        </>
      ) : (
        <p className="text-sm text-slate-500">Select a scan (via History or Worklist) to see its provenance and audit trail.</p>
      )}
    </div>
  );
};

const Field = ({ label, value, warn }) => (
  <div className="mb-2">
    <div className="text-xs text-slate-400">{label}</div>
    <div className={`text-sm ${warn ? 'text-amber-300' : 'text-slate-200'}`}>{value}</div>
  </div>
);

const Stat = ({ label, value }) => (
  <div className="bg-slate-900 rounded-lg border border-slate-700 p-2.5">
    <div className="text-[10px] text-slate-500 mb-0.5">{label}</div>
    <div className="text-slate-300 truncate">{value ?? '—'}</div>
  </div>
);

export default ProvenancePanel;
