import React, { useState, useEffect } from 'react';
import { Chart as ChartJS, ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement, PointElement, LineElement, Filler } from 'chart.js';
import { Pie, Bar, Line } from 'react-chartjs-2';
import api from '../../services/api';
import { FiActivity, FiUsers, FiCheckCircle, FiTrendingUp, FiBarChart2, FiPieChart } from 'react-icons/fi';

ChartJS.register(ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement, PointElement, LineElement, Filler);

const CHART_COLORS = [
  'rgba(99, 102, 241, 0.8)',   // indigo
  'rgba(236, 72, 153, 0.8)',   // pink
  'rgba(34, 211, 238, 0.8)',   // cyan
  'rgba(250, 204, 21, 0.8)',   // yellow
  'rgba(74, 222, 128, 0.8)',   // green
  'rgba(251, 146, 60, 0.8)',   // orange
  'rgba(167, 139, 250, 0.8)',  // violet
  'rgba(248, 113, 113, 0.8)',  // red
];

const AnalyticsPanel = () => {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await api.get('/analytics/dashboard');
        if (res.data.success) {
          setStats(res.data.data);
        }
      } catch (err) {
        setError('Failed to load analytics. Make sure the backend is running.');
        console.error('Analytics fetch error:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchStats();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-12 h-12 border-4 border-slate-700 border-t-indigo-500 rounded-full animate-spin"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-red-400">{error}</p>
      </div>
    );
  }

  const { summary, locationDistribution, characteristicsSummary, volumeDistribution, scanTimeline } = stats;

  // Chart configs
  const locationChartData = {
    labels: locationDistribution.map(l => l.name),
    datasets: [{
      data: locationDistribution.map(l => l.count),
      backgroundColor: CHART_COLORS.slice(0, locationDistribution.length),
      borderColor: 'rgba(15, 23, 42, 0.8)',
      borderWidth: 2,
    }]
  };

  const volumeChartData = {
    labels: volumeDistribution.map(v => `${v.label} cm³`),
    datasets: [{
      label: 'Scans',
      data: volumeDistribution.map(v => v.count),
      backgroundColor: 'rgba(99, 102, 241, 0.6)',
      borderColor: 'rgba(99, 102, 241, 1)',
      borderWidth: 1,
      borderRadius: 6,
    }]
  };

  const timelineChartData = {
    labels: scanTimeline.map(t => t.date.split('-').slice(1).join('/')),
    datasets: [{
      label: 'Scans',
      data: scanTimeline.map(t => t.count),
      borderColor: 'rgba(99, 102, 241, 1)',
      backgroundColor: 'rgba(99, 102, 241, 0.1)',
      fill: true,
      tension: 0.4,
      pointBackgroundColor: 'rgba(99, 102, 241, 1)',
      pointRadius: 4,
    }]
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        labels: { color: '#94a3b8', font: { size: 11 } }
      }
    },
    scales: {
      x: {
        ticks: { color: '#64748b', font: { size: 10 } },
        grid: { color: 'rgba(51, 65, 85, 0.5)' }
      },
      y: {
        ticks: { color: '#64748b', font: { size: 10 }, stepSize: 1 },
        grid: { color: 'rgba(51, 65, 85, 0.5)' }
      }
    }
  };

  const pieOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'bottom',
        labels: { color: '#94a3b8', font: { size: 11 }, padding: 12 }
      }
    }
  };

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex items-center gap-3 mb-8">
        <div className="w-10 h-10 rounded-xl bg-indigo-500/20 flex items-center justify-center">
          <FiActivity className="w-5 h-5 text-indigo-400" />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-slate-100">Analytics Dashboard</h2>
          <p className="text-sm text-slate-400">Overview of all scan processing activity</p>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 mb-8">
        <SummaryCard icon={<FiBarChart2 />} label="Total Scans" value={summary.totalScans} color="indigo" />
        <SummaryCard icon={<FiCheckCircle />} label="Completed" value={summary.completedScans} color="green" />
        <SummaryCard icon={<FiTrendingUp />} label="Avg Confidence" value={`${summary.avgConfidence}%`} color="cyan" />
        <SummaryCard icon={<FiPieChart />} label="Avg Volume" value={`${summary.avgVolume} cm³`} color="pink" />
        <SummaryCard icon={<FiUsers />} label="Total Users" value={summary.totalUsers} color="yellow" />
        <SummaryCard icon={<FiActivity />} label="Success Rate" value={`${summary.successRate}%`} color="green" />
      </div>

      {/* Charts Row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Location Distribution Pie */}
        <div className="bg-slate-800 rounded-xl border border-slate-700 p-6">
          <h3 className="text-base font-semibold text-slate-200 mb-4 flex items-center gap-2">
            <FiPieChart className="text-indigo-400" /> Tumor Location Distribution
          </h3>
          <div className="h-64">
            {locationDistribution.length > 0 ? (
              <Pie data={locationChartData} options={pieOptions} />
            ) : (
              <div className="flex items-center justify-center h-full text-slate-500">No data yet</div>
            )}
          </div>
        </div>

        {/* Volume Distribution Bar */}
        <div className="bg-slate-800 rounded-xl border border-slate-700 p-6">
          <h3 className="text-base font-semibold text-slate-200 mb-4 flex items-center gap-2">
            <FiBarChart2 className="text-indigo-400" /> Volume Distribution
          </h3>
          <div className="h-64">
            <Bar data={volumeChartData} options={chartOptions} />
          </div>
        </div>
      </div>

      {/* Charts Row 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Scan Timeline */}
        <div className="bg-slate-800 rounded-xl border border-slate-700 p-6">
          <h3 className="text-base font-semibold text-slate-200 mb-4 flex items-center gap-2">
            <FiTrendingUp className="text-indigo-400" /> Scan Activity (Last 30 Days)
          </h3>
          <div className="h-64">
            {scanTimeline.length > 0 ? (
              <Line data={timelineChartData} options={chartOptions} />
            ) : (
              <div className="flex items-center justify-center h-full text-slate-500">No recent activity</div>
            )}
          </div>
        </div>

        {/* Tumor Characteristics */}
        <div className="bg-slate-800 rounded-xl border border-slate-700 p-6">
          <h3 className="text-base font-semibold text-slate-200 mb-4 flex items-center gap-2">
            <FiActivity className="text-indigo-400" /> Tumor Characteristics Prevalence
          </h3>
          <div className="flex flex-col justify-center h-64 space-y-6">
            <CharacteristicBar label="Enhancing Tumor" percentage={characteristicsSummary.enhancing} color="bg-red-500" />
            <CharacteristicBar label="Necrotic Core" percentage={characteristicsSummary.necrotic} color="bg-purple-500" />
            <CharacteristicBar label="Peritumoral Edema" percentage={characteristicsSummary.edema} color="bg-blue-500" />
          </div>
        </div>
      </div>
    </div>
  );
};

const SummaryCard = ({ icon, label, value, color }) => {
  const colorMap = {
    indigo: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/30',
    green: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
    cyan: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30',
    pink: 'bg-pink-500/10 text-pink-400 border-pink-500/30',
    yellow: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30',
  };

  return (
    <div className={`rounded-xl border p-4 ${colorMap[color] || colorMap.indigo}`}>
      <div className="flex items-center gap-2 mb-2 text-sm opacity-80">
        {icon} {label}
      </div>
      <div className="text-2xl font-bold">{value}</div>
    </div>
  );
};

const CharacteristicBar = ({ label, percentage, color }) => (
  <div>
    <div className="flex justify-between text-sm mb-1.5">
      <span className="text-slate-300">{label}</span>
      <span className="text-slate-400 font-mono">{percentage}%</span>
    </div>
    <div className="w-full h-3 bg-slate-700 rounded-full overflow-hidden">
      <div
        className={`h-full rounded-full ${color} transition-all duration-1000 ease-out`}
        style={{ width: `${percentage}%` }}
      />
    </div>
  </div>
);

export default AnalyticsPanel;
