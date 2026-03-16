import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { register } from '../../services/authService';

const Register = () => {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    role: 'patient'
  });
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();
  const isDark = true;

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (formData.password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    setIsLoading(true);
    setError('');
    try {
      const result = await register(formData);
      if (result.success) {
        navigate('/dashboard');
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Registration failed. Please try again.');
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden py-10 bg-slate-900">
      {/* Animated background blobs */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
        <div style={{
          position:'absolute', top:'-15%', right:'-10%',
          width:'500px', height:'500px',
          background:'radial-gradient(circle, rgba(99,102,241,0.12) 0%, transparent 70%)',
          borderRadius:'50%', animation:'pulse 5s ease-in-out infinite'
        }} />
        <div style={{
          position:'absolute', bottom:'-15%', left:'-10%',
          width:'600px', height:'600px',
          background:'radial-gradient(circle, rgba(79,70,229,0.1) 0%, transparent 70%)',
          borderRadius:'50%', animation:'pulse 7s ease-in-out infinite'
        }} />
      </div>

      <div className="relative w-full max-w-md px-4">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-indigo-600 mb-4 shadow-lg shadow-indigo-500/30">
            <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.5" className="w-8 h-8">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23-.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" />
            </svg>
          </div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight">Onco-Cure Vision</h1>
          <p className="text-slate-400 text-sm mt-1">Create your secure medical account</p>
        </div>

        {/* Card */}
        <div
          style={{
            background: 'linear-gradient(135deg, rgba(30,41,59,0.95) 0%, rgba(15,23,42,0.98) 100%)',
            backdropFilter: 'blur(20px)',
            border: '1px solid rgba(99,102,241,0.2)',
            boxShadow: '0 25px 50px rgba(0,0,0,0.5), 0 0 0 1px rgba(99,102,241,0.1)'
          }}
          className="rounded-2xl p-8"
        >
          <h2 className="text-xl font-bold text-white mb-1">Create Account</h2>
          <p className="text-slate-400 text-sm mb-6">Join the Onco-Cure Vision imaging platform</p>

          {error && (
            <div className="mb-4 bg-red-500/10 border border-red-500/50 rounded-lg px-4 py-3 flex items-center gap-2 text-red-400 text-sm">
              <svg className="w-4 h-4 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Name */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">Full Name</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                </div>
                <input
                  id="register-name"
                  name="name"
                  type="text"
                  required
                  value={formData.name}
                  onChange={handleChange}
                  placeholder="Dr. Jane Smith"
                  style={{ background: 'rgba(15,23,42,0.6)', border: '1px solid rgba(71,85,105,0.6)', color: 'white' }}
                  className="w-full pl-10 pr-4 py-3 rounded-lg text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>

            {/* Email */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">Email Address</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                </div>
                <input
                  id="register-email"
                  name="email"
                  type="email"
                  required
                  value={formData.email}
                  onChange={handleChange}
                  placeholder="doctor@hospital.com"
                  style={{ background: 'rgba(15,23,42,0.6)', border: '1px solid rgba(71,85,105,0.6)', color: 'white' }}
                  className="w-full pl-10 pr-4 py-3 rounded-lg text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">Password</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                </div>
                <input
                  id="register-password"
                  name="password"
                  type="password"
                  required
                  value={formData.password}
                  onChange={handleChange}
                  placeholder="Min. 6 characters"
                  style={{ background: 'rgba(15,23,42,0.6)', border: '1px solid rgba(71,85,105,0.6)', color: 'white' }}
                  className="w-full pl-10 pr-4 py-3 rounded-lg text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>

            {/* Role selector */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">I am a...</label>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { value: 'doctor', label: 'Doctor', desc: 'Neurosurgeon / Radiologist', icon: '🩺' },
                  { value: 'patient', label: 'Patient', desc: 'View my reports', icon: '👤' }
                ].map(option => (
                  <div
                    key={option.value}
                    onClick={() => setFormData({ ...formData, role: option.value })}
                    style={{
                      border: formData.role === option.value
                        ? '1px solid rgba(99,102,241,0.8)'
                        : '1px solid rgba(71,85,105,0.5)',
                      background: formData.role === option.value
                        ? 'rgba(99,102,241,0.15)'
                        : 'rgba(15,23,42,0.4)',
                      transition: 'all 0.2s',
                      cursor: 'pointer'
                    }}
                    className="p-3 rounded-lg text-center"
                  >
                    <div className="text-2xl mb-1">{option.icon}</div>
                    <div className="text-sm font-semibold text-white">{option.label}</div>
                    <div className="text-xs text-slate-400">{option.desc}</div>
                  </div>
                ))}
              </div>
              <input type="hidden" name="role" value={formData.role} />
            </div>

            {/* Submit */}
            <button
              id="register-submit-btn"
              type="submit"
              disabled={isLoading}
              style={{
                background: isLoading
                  ? 'rgba(79,70,229,0.5)'
                  : 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
                boxShadow: isLoading ? 'none' : '0 4px 15px rgba(99,102,241,0.4)',
                transition: 'all 0.2s'
              }}
              className="w-full py-3 px-4 text-white font-semibold rounded-lg text-sm flex items-center justify-center gap-2 mt-2 hover:opacity-90 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <>
                  <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                  </svg>
                  Creating Account...
                </>
              ) : (
                'Create Account'
              )}
            </button>
          </form>

          {/* Divider */}
          <div className="flex items-center my-6">
            <div className="flex-1 h-px bg-slate-700" />
            <span className="px-3 text-xs text-slate-500">Already have an account?</span>
            <div className="flex-1 h-px bg-slate-700" />
          </div>

          <Link
            to="/login"
            className="block w-full text-center py-2.5 px-4 rounded-lg text-sm font-medium text-indigo-400 border border-indigo-500/30 hover:bg-indigo-500/10 transition-colors"
          >
            Sign in instead
          </Link>
        </div>

        <p className="text-center text-xs text-slate-600 mt-6">
          HIPAA-Compliant • Encrypted Communications • Secure Data
        </p>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.05); opacity: 0.8; }
        }
      `}</style>
    </div>
  );
};

export default Register;
