import React, { useState, useEffect } from 'react';
import { getUserScans } from '../../services/segmentationService';
import { FiClock, FiFile, FiCheckCircle, FiXCircle } from 'react-icons/fi';

const HistoryPanel = ({ onSelectScan, backendOnline }) => {
  const [scans, setScans] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchScans = async () => {
      if (!backendOnline) {
        setLoading(false);
        return;
      }
      try {
        const response = await getUserScans();
        if (response.success) {
          setScans(response.data);
        }
      } catch (err) {
        console.error("Error fetching scans");
      } finally {
        setLoading(false);
      }
    };
    fetchScans();
  }, [backendOnline]);

  if (loading) {
      return (
          <div className="flex items-center justify-center h-full text-slate-400 animate-pulse space-x-3">
             <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
             <span>Loading patient history...</span>
          </div>
      );
  }

  if (!backendOnline) {
    return (
      <div className="flex items-center justify-center h-full text-slate-400">
        Backend is not reachable. Start the backend server at http://localhost:8880 to view scan history.
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto py-8">
      <h2 className="text-3xl font-bold mb-8 flex items-center">
         <FiClock className="mr-3 text-indigo-400" />
         Patient Scan History
      </h2>
      
      {scans.length === 0 ? (
        <div className="bg-slate-800 rounded-xl p-12 text-center border border-slate-700 shadow-xl">
           <FiFile className="w-16 h-16 text-slate-600 mx-auto mb-4" />
           <h3 className="text-xl font-medium text-slate-300">No scans found</h3>
           <p className="text-slate-500 mt-2">Upload a DICOM file to start analysis</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {scans.map((scan) => (
            <div 
              key={scan._id} 
              className="bg-slate-800 rounded-xl p-6 border border-slate-700 hover:border-indigo-500/50 hover:bg-slate-750 transition-all cursor-pointer shadow-lg group"
              onClick={() => scan.status === 'completed' && onSelectScan(scan._id)}
            >
              <div className="flex justify-between items-center">
                 <div className="flex items-start space-x-4">
                     <div className="w-12 h-12 rounded-lg bg-indigo-500/10 flex items-center justify-center shrink-0">
                        <FiFile className="text-indigo-400 w-6 h-6" />
                     </div>
                     <div>
                         <h4 className="font-semibold text-lg text-slate-200 group-hover:text-indigo-300 transition-colors">
                            {scan.fileName}
                         </h4>
                         <p className="text-sm text-slate-400 mt-1">
                            {new Date(scan.uploadDate).toLocaleString()}
                         </p>
                     </div>
                 </div>
                 
                 <div className="flex flex-col items-end">
                     {scan.status === 'completed' ? (
                         <div className="flex items-center text-green-400 bg-green-400/10 px-3 py-1 rounded-full text-sm font-medium">
                            <FiCheckCircle className="mr-1 mt-0.5" /> Completed
                         </div>
                     ) : scan.status === 'processing' ? (
                         <div className="flex items-center text-yellow-400 bg-yellow-400/10 px-3 py-1 rounded-full text-sm font-medium">
                            <div className="w-3 h-3 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin mr-2"></div>
                             Processing
                         </div>
                     ) : (
                         <div className="flex items-center text-red-400 bg-red-400/10 px-3 py-1 rounded-full text-sm font-medium">
                            <FiXCircle className="mr-1" /> Failed
                         </div>
                     )}
                     
                     {scan.status === 'completed' && scan.segmentationData && (
                         <span className="text-xs text-slate-500 mt-2">Vol: {scan.segmentationData.tumorVolume}cm³ | {scan.segmentationData.location}</span>
                     )}
                 </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default HistoryPanel;
