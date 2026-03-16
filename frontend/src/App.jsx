import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Login from './components/auth/Login';
import Register from './components/auth/Register';
import PrivateRoute from './components/auth/PrivateRoute';
import Dashboard from './components/dashboard/Dashboard';
import Landing from './components/landing/Landing';

function App() {
  return (
    <Router>
      <div className="w-full min-h-screen">
        <Routes>
          {/* Public Routes */}
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />

          {/* Protected Routes */}
          <Route element={<PrivateRoute />}>
            <Route path="/dashboard" element={<Dashboard />} />
            {/* Add more protected routes here if needed */}
          </Route>

          {/* Marketing / default */}
          <Route path="/" element={<Landing />} />

          {/* 404 handler */}
          <Route
            path="*"
            element={
              <div className="min-h-screen flex flex-col items-center justify-center font-mono">
                <h1 className="text-6xl font-bold text-indigo-500 mb-4">404</h1>
                <p className="text-xl text-slate-400">Page not found</p>
                <a
                  href="/"
                  className="mt-8 px-6 py-2 bg-slate-800 border border-slate-700 rounded-lg hover:bg-slate-700 hover:text-white transition-colors"
                >
                  Return to Mission Control
                </a>
              </div>
            }
          />
        </Routes>
      </div>
    </Router>
  );
}

export default App;
