import React from 'react';
import { useNavigate } from 'react-router-dom';
import { LuArrowRight, LuBrain, LuEye, LuFileText, LuUpload, LuShield } from 'react-icons/lu';
import { getCurrentUser, logout } from '../../services/authService';

const OncoCureLanding = () => {
  const user = getCurrentUser();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-[#0a0c10] text-[#e5e7eb] font-sans antialiased">
      {/* Simple Navigation */}
      {/* Keep navbar consistent (does not change with theme) */}
      <header className="fixed top-0 w-full bg-[#0a0c10] text-white border-b border-[#1a1e24] z-50">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <a href="/" className="flex items-center gap-2">
            <LuBrain className="w-5 h-5 text-blue-400" />
            <span className="text-sm font-medium tracking-tight text-white">Onco-Cure Vision</span>
          </a>
          <div className="flex items-center gap-3">
            {!user && (
              <>
                <a href="/login" className="text-sm text-neutral-300 hover:text-white px-3 py-2 transition">
                  Login
                </a>
                <a 
                  href="/register" 
                  className="text-sm bg-blue-500 text-white px-4 py-2 rounded-md hover:bg-blue-600 transition"
                >
                  Sign up
                </a>
              </>
            )}
            {user && (
              <>
                <span className="text-sm text-neutral-200">Hi, {user.name}</span>
                <button
                  onClick={handleLogout}
                  className="text-sm text-neutral-300 hover:text-white px-3 py-2 rounded-md border border-[#1a1e24] hover:border-blue-500 transition"
                >
                  Logout
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="pt-24 pb-16">
        <div className="max-w-6xl mx-auto px-6">
          {/* Hero - Clean and direct */}
          <div className="max-w-3xl mb-20">
            <h1 className="text-4xl md:text-5xl font-light tracking-tight mb-4">
              AI-Powered Brain Tumor 
              <span className="text-blue-500 font-normal"> Analysis</span>
            </h1>
            <p className="text-neutral-500 dark:text-neutral-400 text-lg mb-8 max-w-2xl">
              Upload MRI, get instant 3D visualization and clinical reports.
            </p>
            <div className="flex gap-4">
              <a 
                href={user ? "/dashboard" : "/register"}
                className="bg-blue-500 text-white px-6 py-3 text-sm rounded-md hover:bg-blue-600 transition inline-flex items-center gap-2"
              >
                Start analysis <LuArrowRight className="w-4 h-4" />
              </a>
              <a 
                href="#how-it-works"
                className="border border-neutral-200 dark:border-neutral-800 px-6 py-3 text-sm rounded-md hover:border-neutral-300 dark:hover:border-neutral-700 transition"
              >
                How it works
              </a>
            </div>
          </div>

          {/* Feature Grid - Clean cards */}
          <div className="grid md:grid-cols-3 gap-4 mb-20">
            {[
              { icon: LuUpload, title: 'DICOM upload', desc: 'Drag & drop MRI files', stat: 'All formats' },
              { icon: LuEye, title: '3D visualization', desc: 'Tumor highlighted in brain', stat: '0.23mm accuracy' },
              { icon: LuFileText, title: 'AI reports', desc: 'Doctor & patient versions', stat: '94% confidence' }
            ].map((item, i) => (
              <div key={i} className="border border-neutral-200 dark:border-neutral-800 rounded-lg p-6 hover:border-neutral-300 dark:hover:border-neutral-700 transition">
                <item.icon className="w-5 h-5 text-blue-500 mb-4" />
                <h3 className="font-medium mb-1">{item.title}</h3>
                <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-3">{item.desc}</p>
                <span className="text-xs text-blue-500">{item.stat}</span>
              </div>
            ))}
          </div>

          {/* How it works - Minimal steps */}
          <div id="how-it-works" className="mb-20">
            <div className="flex items-center gap-2 mb-8">
              <span className="text-xs font-mono text-blue-500"></span>
              <h2 className="text-sm font-medium tracking-wider text-neutral-500 dark:text-neutral-400">PROCESS</h2>
            </div>
            <div className="flex flex-wrap gap-8">
              {['Upload', 'Segment', 'Reconstruct', 'Report'].map((step, i) => (
                <div key={step} className="flex items-center gap-3">
                  <span className="text-xs text-blue-500 font-mono">0{i+1}</span>
                  <span className="text-sm">{step}</span>
                  {i < 3 && <span className="text-neutral-300 dark:text-neutral-700">→</span>}
                </div>
              ))}
            </div>
          </div>

          {/* Trust indicator - Subtle */}
          <div className="border-t border-neutral-200 dark:border-neutral-800 pt-8 flex items-center justify-between text-sm text-neutral-500 dark:text-neutral-400">
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1">
                <LuShield className="w-4 h-4 text-blue-500" /> HIPAA
              </span>
              <span>★ 4.9 (200+ reviews)</span>
            </div>
            <a href={user ? "/dashboard" : "/register"} className="text-blue-500 hover:text-blue-600 dark:hover:text-blue-400 transition">
              Get started →
            </a>
          </div>
        </div>
      </main>

      {/* Simple footer */}
      <footer className="border-t border-neutral-200 dark:border-neutral-800 py-6">
        <div className="max-w-6xl mx-auto px-6 flex items-center justify-between text-xs text-neutral-500 dark:text-neutral-500">
          <span>© 2026 Onco-Cure Vision</span>
          <div className="flex gap-6">
            <a href="#" className="hover:text-neutral-700 dark:hover:text-neutral-300">Privacy</a>
            <a href="#" className="hover:text-neutral-700 dark:hover:text-neutral-300">Terms</a>
            <a href="#" className="hover:text-neutral-700 dark:hover:text-neutral-300">Contact</a>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default OncoCureLanding;
