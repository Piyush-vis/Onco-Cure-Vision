import React from 'react';
import { FiLayers, FiEye, FiEyeOff } from 'react-icons/fi';

const ControlPanel = ({ transparency, setTransparency, visibleLayers, setVisibleLayers, scanData }) => {
  const toggleLayer = (layer) => {
    setVisibleLayers(prev => ({ ...prev, [layer]: !prev[layer] }));
  };

  return (
    <div className="p-6 h-full flex flex-col space-y-8 animate-fade-in">
      <div>
        <h3 className="text-xl font-bold border-b border-slate-700 pb-2 mb-4 flex items-center">
            <FiLayers className="mr-2 text-indigo-400" />
            Visualization Controls
        </h3>
        
        {/* Layer Toggles */}
        <div className="space-y-3">
          <LayerToggle 
            label="Brain Tissue" 
            visible={visibleLayers.brain} 
            onToggle={() => toggleLayer('brain')} 
            color="text-slate-300"
          />
          <LayerToggle 
            label="Tumor Mass" 
            visible={visibleLayers.tumor} 
            onToggle={() => toggleLayer('tumor')} 
            color="text-red-400"
          />
          <LayerToggle 
            label="Edema" 
            visible={visibleLayers.edema} 
            onToggle={() => toggleLayer('edema')} 
            color="text-blue-400"
          />
        </div>
      </div>

      {/* Transparency Slider */}
      <div className="p-4 bg-slate-700/30 rounded-lg border border-slate-700">
        <label className="block text-sm font-medium mb-2 flex justify-between">
            <span>Brain Opacity</span>
            <span className="text-indigo-400 font-mono">{Math.round(transparency * 100)}%</span>
        </label>
        <input 
          type="range" 
          min="0.1" 
          max="1.0" 
          step="0.05"
          value={transparency} 
          onChange={(e) => setTransparency(parseFloat(e.target.value))}
          className="w-full accent-indigo-500 bg-slate-600 h-2 rounded-lg appearance-none cursor-pointer"
        />
        <div className="flex justify-between text-xs text-slate-500 mt-2">
            <span>Clear</span>
            <span>Opaque</span>
        </div>
      </div>

      {/* Scan Summary briefly */}
      {scanData && (
        <>
          <div className="mt-8 bg-slate-900 border border-slate-700 rounded-lg p-4">
            <h4 className="text-sm font-medium text-slate-400 uppercase tracking-wide mb-3">
              Scan Context
            </h4>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">File</span>
                <span
                  className="truncate max-w-[120px]"
                  title={scanData.fileName}
                >
                  {scanData.fileName}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Date</span>
                <span>{new Date(scanData.uploadDate).toLocaleDateString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Confidence</span>
                <span
                  className={`${
                    scanData.segmentationData.confidence < 80
                      ? 'text-yellow-400'
                      : 'text-green-400'
                  } font-medium`}
                >
                  {scanData.segmentationData.confidence.toFixed(1)}%
                </span>
              </div>
            </div>

            {scanData.segmentationData.confidence < 80 && (
              <div className="mt-4 p-3 bg-red-500/10 border border-red-500/50 rounded-lg text-xs text-red-300">
                <strong>Low Confidence warning.</strong> The generated mesh falls
                back to an atlas reference model to guarantee a recognizable brain
                structure.
              </div>
            )}
          </div>

          {/* Tumor characteristics on left side */}
          <div className="mt-4 bg-slate-900 border border-slate-700 rounded-lg p-4">
            <h4 className="text-sm font-medium text-slate-400 uppercase tracking-wide mb-3">
              Tumor Characteristics
            </h4>
            <div className="space-y-2 text-sm text-slate-300">
              <div className="flex justify-between">
                <span>Enhancing</span>
                <span className="font-mono">
                  {scanData.segmentationData.characteristics?.enhancing
                    ? 'Yes'
                    : 'No'}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Necrotic core</span>
                <span className="font-mono">
                  {scanData.segmentationData.characteristics?.necrotic
                    ? 'Yes'
                    : 'No'}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Edema present</span>
                <span className="font-mono">
                  {scanData.segmentationData.characteristics?.edema ? 'Yes' : 'No'}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Margins</span>
                <span className="font-mono">
                  {scanData.segmentationData.characteristics?.margins || 'N/A'}
                </span>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

const LayerToggle = ({ label, visible, onToggle, color }) => (
  <div className="flex items-center justify-between p-3 bg-slate-800 border border-slate-600 rounded-lg hover:border-slate-500 transition-colors cursor-pointer shadow-sm" onClick={onToggle}>
    <div className="flex items-center space-x-3">
        <div className={`w-3 h-3 rounded-full ${color.replace('text-', 'bg-')}`}></div>
        <span className="font-medium">{label}</span>
    </div>
    <button className={`text-xl ${visible ? 'text-indigo-400' : 'text-slate-600'}`}>
        {visible ? <FiEye /> : <FiEyeOff />}
    </button>
  </div>
);

export default ControlPanel;
