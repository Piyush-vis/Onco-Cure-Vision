import React, { useState, useEffect } from 'react';
import { generateReport, generateReportFromPdf } from '../../services/segmentationService';
import { FiFileText, FiRefreshCcw, FiChevronDown, FiChevronUp, FiDownload, FiUploadCloud } from 'react-icons/fi';

const ReportPanel = ({ scanData, userRole, scanId }) => {
  const [reports, setReports] = useState(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState(userRole === 'doctor' ? 'clinical' : 'patient');
  const [expandedSection, setExpandedSection] = useState('characteristics');
  const [selectedFile, setSelectedFile] = useState(null);

  const handleGenerate = async () => {
    if (!selectedFile) return;
    
    try {
      setLoading(true);
      // Pass null as scanId if this is a standalone PDF
      const res = await generateReportFromPdf(scanId || null, selectedFile);
      if (res.success) {
        setReports(res.data);
      }
    } catch (err) {
      console.error('Failed to generate PDF report', err);
    } finally {
        setLoading(false);
    }
  };

  const handleExport = () => {
     const content = activeTab === 'clinical' ? reports.doctorReport : reports.patientReport;
     const blob = new Blob([content], { type: 'text/markdown' });
     const url = URL.createObjectURL(blob);
     const a = document.createElement('a');
     a.href = url;
     a.download = `Onco-Cure_Vision_Report_${activeTab}_${scanId}.md`;
     a.click();
  };

  const segmentationData = scanData?.segmentationData;

  return (
    <div className="flex flex-col h-full bg-slate-900 custom-scrollbar overflow-y-auto">
      {/* Header Info */}
      <div className="p-6 border-b border-slate-700 bg-slate-800 shrink-0">
        <h3 className="text-xl font-bold mb-4 flex items-center">
            <FiFileText className="mr-2 text-indigo-400" />
            AI Insights
        </h3>

        {/* Key Metrics Grid - Only show if we have 3D scan data */}
        {segmentationData ? (
          <div className="grid grid-cols-2 gap-3 mb-2">
              <MetricCard label="Volume" value={`${segmentationData.tumorVolume || 0} cm³`} />
              <MetricCard label="Location" value={segmentationData.location || "N/A"} highlight />
              <MetricCard label="Confidence" value={`${segmentationData.confidence || 0}%`} color={segmentationData.confidence > 80 ? 'text-green-400' : 'text-yellow-400'} />
              <MetricCard label="Status" value="Analyzed" color="text-indigo-400" />
          </div>
        ) : (
          <div className="text-sm text-slate-400">
             Standalone PDF Report Analysis Mode
          </div>
        )}
      </div>

      {/* Report Section */}
      <div className="p-6 flex-1 flex flex-col h-full overflow-hidden">
        {reports ? (
            <div className="flex flex-col h-full overflow-hidden">
                {/* Tabs */}
                <div className="flex space-x-2 bg-slate-800 p-1 rounded-lg mb-4 shrink-0">
                    {userRole === 'doctor' && (
                        <button 
                        onClick={() => setActiveTab('clinical')}
                        className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-all ${activeTab === 'clinical' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'}`}
                        >
                            Clinical Report
                        </button>
                    )}
                    <button 
                       onClick={() => setActiveTab('patient')}
                       className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-all ${activeTab === 'patient' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'}`}
                    >
                        Patient Friendly
                    </button>
                </div>
                
                {/* Content */}
                <div className="flex-1 bg-slate-800 rounded-lg border border-slate-700 p-5 overflow-y-auto custom-scrollbar relative">
                     <button onClick={handleExport} className="absolute top-2 right-2 p-2 text-slate-400 hover:text-white bg-slate-700 hover:bg-slate-600 rounded" title="Export Markdown">
                         <FiDownload />
                     </button>
                     <div className="prose prose-invert prose-sm max-w-none text-slate-300">
                         {activeTab === 'clinical' ? formatMarkdown(reports.doctorReport) : formatMarkdown(reports.patientReport)}
                     </div>
                </div>
            </div>
        ) : (
             <div className="flex-1 flex flex-col items-center justify-center text-center p-6 bg-slate-800 rounded-xl border border-slate-700">
                  <FiFileText className="w-12 h-12 text-slate-500 mb-4" />
                  <h4 className="text-lg font-medium mb-1">Generate AI Summary</h4>
                  <p className="text-sm text-slate-400 mb-6">Upload the official Doctor's MRI PDF Report to extract actionable insights, treatments, and a patient-friendly summary using AI.</p>
                  
                  <div className="w-full mb-6">
                      <label className={`w-full flex flex-col items-center px-4 py-6 bg-slate-900 text-indigo-400 rounded-lg shadow-inner border border-dashed border-indigo-500/50 cursor-pointer hover:bg-slate-800/80 transition-all ${selectedFile ? 'border-green-500 text-green-400' : ''}`}>
                          <FiUploadCloud className="w-8 h-8 mb-2" />
                          <span className="text-sm font-medium">
                              {selectedFile ? selectedFile.name : 'Select MRI Report (.pdf)'}
                          </span>
                          <input type='file' accept=".pdf" className="hidden" onChange={(e) => setSelectedFile(e.target.files[0])} />
                      </label>
                  </div>

                  <button 
                     onClick={handleGenerate} 
                     disabled={loading || !selectedFile} 
                     className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-700 disabled:text-slate-500 font-medium py-3 rounded-lg flex justify-center items-center transition-all"
                  >
                      {loading ? (
                          <><FiRefreshCcw className="animate-spin mr-2" /> Parsing PDF...</>
                      ) : (
                          <>Generate Report with AI</>
                      )}
                  </button>
             </div>
        )}
      </div>
    </div>
  );
};

const MetricCard = ({ label, value, highlight, color }) => (
    <div className={`p-3 rounded-lg border ${highlight ? 'bg-indigo-900/30 border-indigo-500/50' : 'bg-slate-900 border-slate-700'}`}>
        <div className="text-xs text-slate-400 mb-1">{label}</div>
        <div className={`font-bold font-mono tracking-tight ${color || 'text-slate-100'} ${highlight ? 'text-indigo-300' : ''}`}>{value}</div>
    </div>
);

// Simple MD formatter since we don't have react-markdown installed yet
const formatMarkdown = (text) => {
    if (!text) return null;
    return text.split('\n').map((line, i) => {
        if (line.startsWith('## ')) return <h3 key={i} className="text-lg font-bold text-white mt-4 mb-2">{line.replace('## ', '')}</h3>;
        if (line.startsWith('# ')) return <h2 key={i} className="text-xl font-bold text-white mt-4 mb-2">{line.replace('# ', '')}</h2>;
        if (line.startsWith('**') && line.endsWith('**')) return <p key={i} className="font-bold my-2">{line.replace(/\*\*/g, '')}</p>;
        if (line.startsWith('- ')) return <li key={i} className="ml-4 mb-1">{line.replace('- ', '')}</li>;
        if (line.trim() === '') return <br key={i} />;
        
        // Inline bold parsing
        const parts = line.split(/(\*\*.*?\*\*)/).map((part, j) => {
           if (part.startsWith('**') && part.endsWith('**')) return <strong key={j} className="text-slate-200">{part.replace(/\*\*/g, '')}</strong>;
           return part;
        });

        return <p key={i} className="my-1.5 leading-relaxed">{parts}</p>;
    });
};

export default ReportPanel;
