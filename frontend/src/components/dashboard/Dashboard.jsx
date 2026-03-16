import React, { useState, useEffect } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import UploadSection from './UploadSection';
import ControlPanel from './ControlPanel';
import HistoryPanel from './HistoryPanel';
import BrainViewer from '../viewer3d/BrainViewer';
import ReportPanel from '../reports/ReportPanel';
import { getCurrentUser, logout } from '../../services/authService';
import { getScan } from '../../services/segmentationService';
import { FiLogOut, FiUser } from 'react-icons/fi';
import api from '../../services/api';

const Dashboard = () => {
  const [activeTab, setActiveTab] = useState('upload'); // 'upload', 'viewer', 'history'
  const [currentScanId, setCurrentScanId] = useState(null);
  const [scanData, setScanData] = useState(null);
  const [transparency, setTransparency] = useState(0.3);
  const [visibleLayers, setVisibleLayers] = useState({
    brain: true,
    tumor: true,
    edema: true
  });
  const [backendOnline, setBackendOnline] = useState(true);
  const [backendError, setBackendError] = useState('');
  const navigate = useNavigate();
  const user = getCurrentUser();
  const isDark = true; // fixed dark UI

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const handleScanSelect = async (id, preloadedData = null) => {
    setCurrentScanId(id);
    setActiveTab('viewer');
    if (preloadedData) {
      setScanData(preloadedData);
      return;
    }
    try {
      const res = await getScan(id);
      if(res.success) {
          setScanData(res.data);
      }
    } catch (err) {
       console.error("Failed to load scan");
    }
  };

  useEffect(() => {
    let cancelled = false;
    const checkHealth = async () => {
      try {
        await api.get('/health');
        if (!cancelled) {
          setBackendOnline(true);
          setBackendError('');
        }
      } catch (err) {
        if (!cancelled) {
          setBackendOnline(false);
          setBackendError('Backend is not reachable. Please start the server at http://localhost:8880 before uploading or viewing scans.');
        }
      }
    };
    checkHealth();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!user) {
    return <Navigate to="/login" />;
  }

  return (
    <div
      className="flex flex-col h-screen overflow-hidden font-sans bg-slate-900 text-slate-100"
    >
      {/* Top Navbar stays consistent */}
      <header className="h-16 border-b border-slate-800 bg-slate-900 text-white flex items-center justify-between px-6 shadow-md z-10 shrink-0">
        <div className="flex items-center space-x-4">
          <button
            onClick={() => navigate('/')}
            className="text-left text-xl font-bold bg-gradient-to-r from-blue-400 to-indigo-500 bg-clip-text text-transparent"
            aria-label="Go to home"
          >
            Onco-Cure Vision
          </button>
          <nav className="hidden md:flex space-x-1 ml-8">
            <button 
              onClick={() => setActiveTab('upload')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${activeTab === 'upload' ? 'bg-slate-800 text-white' : 'text-slate-300 hover:text-white hover:bg-slate-800/50'}`}
            >
              Upload
            </button>
            <button 
              onClick={() => setActiveTab('viewer')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${activeTab === 'viewer' ? 'bg-slate-800 text-white' : 'text-slate-300 hover:text-white hover:bg-slate-800/50'}`}
              disabled={!currentScanId && !scanData}
            >
              3D Viewer
            </button>
            <button 
               onClick={() => setActiveTab('history')}
               className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${activeTab === 'history' ? 'bg-slate-800 text-white' : 'text-slate-300 hover:text-white hover:bg-slate-800/50'}`}
            >
              History
            </button>
            <button 
               onClick={() => setActiveTab('reports')}
               className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${activeTab === 'reports' ? 'bg-slate-800 text-white' : 'text-slate-300 hover:text-white hover:bg-slate-800/50'}`}
            >
              AI PDF Report
            </button>
          </nav>
        </div>
        
        <div className="flex items-center space-x-4">
          <div className={`flex items-center space-x-2 ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
            <FiUser className="w-5 h-5 text-indigo-400"/>
            <span className="text-sm font-medium">
              {user?.name}{' '}
              <span
                className={`text-xs px-2 py-0.5 rounded ml-1 uppercase ${
                  isDark
                    ? 'text-slate-500 bg-slate-800 border border-slate-700'
                    : 'text-slate-600 bg-slate-100 border border-slate-200'
                }`}
              >
                {user?.role}
              </span>
            </span>
          </div>
          <button 
            onClick={handleLogout}
            className={`p-2 transition-colors rounded-full ${
              isDark
                ? 'text-slate-400 hover:text-red-400 hover:bg-slate-800'
                : 'text-slate-500 hover:text-red-600 hover:bg-slate-100'
            }`}
            title="Logout"
          >
            <FiLogOut className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Backend offline banner */}
      {!backendOnline && backendError && (
        <div className="bg-red-500/10 border-b border-red-500/40 text-red-300 text-sm px-6 py-2">
          {backendError}
        </div>
      )}

      {/* Main Content Area */}
      <main className="flex-1 overflow-hidden relative">
        {activeTab === 'upload' && (
          <div className="h-full flex items-center justify-center p-6 bg-slate-900 absolute inset-0">
             <div className="w-full max-w-2xl bg-slate-800 rounded-xl shadow-2xl border border-slate-700 p-8 transform transition-all">
                <h2 className="text-2xl font-bold mb-6 text-slate-100 flex items-center">
                   <div className="w-8 h-8 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center mr-3">1</div>
                   Upload Patient Scan
                </h2>
                <UploadSection onScanComplete={handleScanSelect} backendOnline={backendOnline} />
             </div>
          </div>
        )}

        {activeTab === 'viewer' && (
           <div className="h-full flex divide-x divide-slate-700 absolute inset-0">
            {/* Left Panel: Controls */}
            <div className="w-72 bg-slate-800 shrink-0 flex flex-col h-full overflow-y-auto custom-scrollbar">
                <ControlPanel 
                  transparency={transparency} 
                  setTransparency={setTransparency}
                  visibleLayers={visibleLayers}
                  setVisibleLayers={setVisibleLayers}
                  scanData={scanData}
                />
             </div>
             
             {/* Center Panel: 3D Render */}
             <div className="flex-1 bg-black relative flex flex-col items-center justify-center">
                {scanData ? (
                    <BrainViewer 
                      scanData={scanData} 
                      transparency={transparency} 
                      visibleLayers={visibleLayers} 
                    />
                ) : (
                    <div className="text-slate-500 flex flex-col items-center">
                        <div className="w-16 h-16 border-4 border-slate-700 border-t-indigo-500 rounded-full animate-spin mb-4"></div>
                        <p>Loading rendering context...</p>
                    </div>
                )}
             </div>

            {/* Right Panel: Data & Reports */}
            <div className="w-[420px] bg-slate-800 shrink-0 flex flex-col h-full border-l border-slate-700">
                <ReportPanel scanData={scanData} userRole={user?.role} scanId={currentScanId} />
             </div>
           </div>
        )}

        {activeTab === 'history' && (
            <div className="h-full bg-slate-900 p-8 overflow-y-auto custom-scrollbar absolute inset-0">
              <HistoryPanel onSelectScan={handleScanSelect} backendOnline={backendOnline} />
            </div>
        )}

        {activeTab === 'reports' && (
          <div className="h-full bg-slate-900 p-8 flex items-center justify-center absolute inset-0 overflow-y-auto custom-scrollbar">
             <div className="w-full max-w-3xl h-[80vh] bg-slate-800 rounded-xl shadow-2xl border border-slate-700 flex flex-col overflow-hidden">
                <ReportPanel scanData={null} userRole={user?.role} scanId={null} />
             </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default Dashboard;
