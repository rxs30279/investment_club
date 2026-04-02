'use client';

import { useState, useEffect } from 'react';
import Navigation from '@/components/Navigation';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import {
  getUnitValues,
  fetchBenchmarkData,
  calcPerformanceSummary,
  rebaseUnitValues,
  type UnitValue,
  type BenchmarkPoint,
} from '@/lib/performance';

// ── Helpers ───────────────────────────────────────────────────────────────────

const formatDate = (dateStr: string) =>
  new Date(dateStr).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });

const formatDateLong = (dateStr: string) =>
  new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

const fmt2 = (n: number) => n.toFixed(2);
const fmt4 = (n: number) => n.toFixed(4);
const fmtPct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;

// ── Chart data merger ─────────────────────────────────────────────────────────
// Merges portfolio rebased series with FTSE 100 + 250 into one array for Recharts

interface ChartPoint {
  date: string;
  label: string;
  portfolio?: number;
  ftse100?: number;
  ftse250?: number;
}

function mergeChartData(
  portfolio: BenchmarkPoint[],
  ftse100: BenchmarkPoint[],
  ftse250: BenchmarkPoint[]
): ChartPoint[] {
  const map = new Map<string, ChartPoint>();

  portfolio.forEach(p => {
    map.set(p.date, { date: p.date, label: formatDate(p.date), portfolio: p.value });
  });

  // API now returns data keyed to the exact portfolio dates, so exact lookup always works
  ftse100.forEach(p => { const e = map.get(p.date); if (e) e.ftse100 = p.value; });
  ftse250.forEach(p => { const e = map.get(p.date); if (e) e.ftse250 = p.value; });

  return Array.from(map.values()).sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );
}

// ── Custom tooltip ────────────────────────────────────────────────────────────

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-xl p-3 shadow-2xl text-xs">
      <p className="text-gray-400 mb-2 font-medium">{label}</p>
      {payload.map((entry: any) => (
        <div key={entry.dataKey} className="flex items-center gap-2 mb-1">
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: entry.color }} />
          <span className="text-gray-300">{entry.name}:</span>
          <span className="text-white font-semibold ml-auto pl-4">
            {entry.value != null ? `${entry.value.toFixed(2)}` : '—'}
          </span>
        </div>
      ))}
    </div>
  );
};

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: 'green' | 'red' | 'blue' | 'neutral';
}) {
  const accentClass = {
    green:   'text-emerald-400',
    red:     'text-red-400',
    blue:    'text-blue-400',
    neutral: 'text-white',
  }[accent ?? 'neutral'];

  return (
    <div className="bg-gray-900/50 rounded-xl border border-gray-800 px-4 py-4 sm:px-5 sm:py-5">
      <p className="text-gray-500 text-xs uppercase tracking-wider mb-1">{label}</p>
      <p className={`text-xl sm:text-2xl font-bold ${accentClass}`}>{value}</p>
      {sub && <p className="text-gray-500 text-xs mt-1">{sub}</p>}
    </div>
  );
}

// ── Toggle pill ───────────────────────────────────────────────────────────────

function Toggle({
  label,
  color,
  active,
  onClick,
}: {
  label: string;
  color: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all border ${
        active
          ? 'border-transparent text-white'
          : 'border-gray-700 text-gray-500 bg-transparent'
      }`}
      style={active ? { backgroundColor: color + '33', borderColor: color, color } : {}}
    >
      <span
        className="w-2 h-2 rounded-full flex-shrink-0"
        style={{ backgroundColor: active ? color : '#4b5563' }}
      />
      {label}
    </button>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function PerformancePage() {
  const [unitValues, setUnitValues]       = useState<UnitValue[]>([]);
  const [chartData, setChartData]         = useState<ChartPoint[]>([]);
  const [loading, setLoading]             = useState(true);
  const [benchmarkLoading, setBenchmarkLoading] = useState(true);
  const [error, setError]                 = useState<string | null>(null);

  // Series visibility toggles
  const [showPortfolio, setShowPortfolio] = useState(true);
  const [showFtse100,   setShowFtse100]   = useState(true);
  const [showFtse250,   setShowFtse250]   = useState(true);

  // Chart mode: rebased (all start at 100) or raw unit value
  const [chartMode, setChartMode]         = useState<'rebased' | 'raw'>('rebased');
  const [breakdownOpen, setBreakdownOpen] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const uvs = await getUnitValues();
        setUnitValues(uvs);

        if (uvs.length === 0) {
          setLoading(false);
          setBenchmarkLoading(false);
          return;
        }

        // Build initial chart with portfolio only
        const rebasedPortfolio = rebaseUnitValues(uvs);
        setChartData(mergeChartData(rebasedPortfolio, [], []));
        setLoading(false);

        // Fetch benchmarks in background — pass exact dates so Yahoo daily closes align perfectly
        const fromDate = uvs[0].valuation_date;
        const allDates = uvs.map(uv => uv.valuation_date);
        const benchmarks = await fetchBenchmarkData(fromDate, allDates);
        setChartData(mergeChartData(rebasedPortfolio, benchmarks.ftse100, benchmarks.ftse250));
        setBenchmarkLoading(false);
      } catch (err) {
        console.error('Performance page error:', err);
        setError('Failed to load performance data.');
        setLoading(false);
        setBenchmarkLoading(false);
      }
    }
    load();
  }, []);

  // Raw chart data (unit value, no rebase)
  const rawChartData: ChartPoint[] = unitValues.map(uv => ({
    date:      uv.valuation_date,
    label:     formatDate(uv.valuation_date),
    portfolio: uv.unit_value,
  }));

  const displayData = chartMode === 'rebased' ? chartData : rawChartData;
  const summary     = calcPerformanceSummary(unitValues);

  // Latest valuation month label
  const latestUV = unitValues.length ? unitValues[unitValues.length - 1] : null;
  const latestMonthLabel = latestUV
    ? new Date(latestUV.valuation_date).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
    : null;

  // FTSE 12-month returns (using rebased chart data)
  const ftse100Return = (() => {
    const points = chartData.filter(p => p.ftse100 != null);
    if (points.length < 2) return null;
    const latest = points[points.length - 1];
    const cutoff = new Date(latest.date);
    cutoff.setFullYear(cutoff.getFullYear() - 1);
    const base = points.filter(p => new Date(p.date) <= cutoff).at(-1);
    if (!base) return null;
    return ((latest.ftse100! - base.ftse100!) / base.ftse100!) * 100;
  })();
  const ftse250Return = (() => {
    const points = chartData.filter(p => p.ftse250 != null);
    if (points.length < 2) return null;
    const latest = points[points.length - 1];
    const cutoff = new Date(latest.date);
    cutoff.setFullYear(cutoff.getFullYear() - 1);
    const base = points.filter(p => new Date(p.date) <= cutoff).at(-1);
    if (!base) return null;
    return ((latest.ftse250! - base.ftse250!) / base.ftse250!) * 100;
  })();

  // 12-month return: find the unit value from ~12 months before the latest valuation
  const twelveMonthReturn = (() => {
    if (unitValues.length < 2) return null;
    const sorted = [...unitValues].sort(
      (a, b) => new Date(a.valuation_date).getTime() - new Date(b.valuation_date).getTime()
    );
    const latest     = sorted[sorted.length - 1];
    const cutoff     = new Date(latest.valuation_date);
    cutoff.setFullYear(cutoff.getFullYear() - 1);
    // Find the closest point at or just before the 12-month cutoff
    const base = sorted
      .filter(uv => new Date(uv.valuation_date) <= cutoff)
      .at(-1);
    if (!base) return null;
    return ((latest.unit_value - base.unit_value) / base.unit_value) * 100;
  })();

  // ── Render ──────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
        <Navigation />
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-emerald-500 mx-auto" />
            <p className="mt-3 text-gray-400 text-sm">Loading performance data...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
        <Navigation />
        <div className="max-w-7xl mx-auto px-4 py-8">
          <div className="bg-red-900/30 border border-red-700 rounded-xl p-6 text-center">
            <p className="text-red-400">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
      <Navigation />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6 lg:py-8">

        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">Unit Value Performance</h1>
          <p className="text-sm text-gray-400 mt-1">
            {latestMonthLabel ? `Valued ${latestMonthLabel}` : 'Unit value progression'}
          </p>
        </div>

        {/* Summary stats */}
        {summary && (
          <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
            <StatCard
              label="Current Unit Value"
              value={`£${fmt2(summary.currentUnitValue)}`}
              sub={latestMonthLabel ?? undefined}
              accent="neutral"
            />
            <StatCard
              label="Portfolio Return"
              value={twelveMonthReturn != null ? fmtPct(twelveMonthReturn) : '—'}
              sub="Last 12 months"
              accent={twelveMonthReturn != null ? (twelveMonthReturn >= 0 ? 'green' : 'red') : 'neutral'}
            />
            <div className="hidden sm:block">
              <StatCard
                label="FTSE 100"
                value={ftse100Return != null ? fmtPct(ftse100Return) : benchmarkLoading ? 'Loading…' : '—'}
                sub="Last 12 months"
                accent={ftse100Return != null ? (ftse100Return >= 0 ? 'green' : 'red') : 'neutral'}
              />
            </div>
            <div className="hidden sm:block">
              <StatCard
                label="FTSE 250"
                value={ftse250Return != null ? fmtPct(ftse250Return) : benchmarkLoading ? 'Loading…' : '—'}
                sub="Last 12 months"
                accent={ftse250Return != null ? (ftse250Return >= 0 ? 'green' : 'red') : 'neutral'}
              />
            </div>
          </div>
        )}

        {/* Chart card */}
        <div className="bg-gray-900/50 rounded-xl border border-gray-800 p-4 sm:p-6 mb-6">

          {/* Chart controls */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
            <div>
              <h2 className="text-white font-semibold text-sm sm:text-base">
                {chartMode === 'rebased' ? 'Relative Performance (rebased to 100)' : 'Unit Value (£)'}
              </h2>
              {benchmarkLoading && chartMode === 'rebased' && (
                <p className="text-gray-500 text-xs mt-0.5">Loading benchmark data...</p>
              )}
            </div>

            <div className="flex flex-wrap gap-2 items-center">
              {/* Chart mode toggle */}
              <div className="flex rounded-lg border border-gray-700 overflow-hidden text-xs">
                <button
                  onClick={() => setChartMode('rebased')}
                  className={`px-3 py-1.5 transition-colors ${
                    chartMode === 'rebased'
                      ? 'bg-gray-700 text-white'
                      : 'text-gray-500 hover:text-gray-300'
                  }`}
                >
                  Relative
                </button>
                <button
                  onClick={() => setChartMode('raw')}
                  className={`px-3 py-1.5 transition-colors ${
                    chartMode === 'raw'
                      ? 'bg-gray-700 text-white'
                      : 'text-gray-500 hover:text-gray-300'
                  }`}
                >
                  Unit Value
                </button>
              </div>

              {/* Series toggles — only in rebased mode */}
              {chartMode === 'rebased' && (
                <div className="flex gap-1.5 flex-wrap">
                  <Toggle label="MESI" color="#10b981" active={showPortfolio} onClick={() => setShowPortfolio(v => !v)} />
                  <Toggle label="FTSE 100" color="#3b82f6" active={showFtse100} onClick={() => setShowFtse100(v => !v)} />
                  <Toggle label="FTSE 250" color="#f59e0b" active={showFtse250} onClick={() => setShowFtse250(v => !v)} />
                </div>
              )}
            </div>
          </div>

          {/* Chart */}
          {unitValues.length === 0 ? (
            <div className="flex items-center justify-center h-64 text-gray-500 text-sm">
              No performance data yet — upload PDFs and run Sync on the Treasurer page.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={340}>
              <LineChart data={displayData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                <XAxis
                  dataKey="label"
                  tick={{ fill: '#6b7280', fontSize: 11 }}
                  axisLine={{ stroke: '#374151' }}
                  tickLine={false}
                />
                <YAxis
                    domain={['auto', 'auto']}
                    tick={{ fill: '#6b7280', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    width={chartMode === 'raw' ? 55 : 45}
                    tickFormatter={v => chartMode === 'raw' ? `£${v.toFixed(0)}` : `${v}`}
                  />
                <Tooltip content={<CustomTooltip />} />

                {/* Portfolio line — always shown in raw mode */}
                {(showPortfolio || chartMode === 'raw') && (
                  <Line
                    type="monotone"
                    dataKey="portfolio"
                    name="MESI"
                    stroke="#10b981"
                    strokeWidth={2.5}
                    dot={{ fill: '#10b981', r: 3, strokeWidth: 0 }}
                    activeDot={{ r: 5, strokeWidth: 0 }}
                    connectNulls
                  />
                )}

                {chartMode === 'rebased' && showFtse100 && (
                  <Line
                    type="monotone"
                    dataKey="ftse100"
                    name="FTSE 100"
                    stroke="#3b82f6"
                    strokeWidth={1.5}
                    dot={false}
                    activeDot={{ r: 4, strokeWidth: 0 }}
                    strokeDasharray="4 2"
                    connectNulls
                  />
                )}

                {chartMode === 'rebased' && showFtse250 && (
                  <Line
                    type="monotone"
                    dataKey="ftse250"
                    name="FTSE 250"
                    stroke="#f59e0b"
                    strokeWidth={1.5}
                    dot={false}
                    activeDot={{ r: 4, strokeWidth: 0 }}
                    strokeDasharray="4 2"
                    connectNulls
                  />
                )}
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Monthly breakdown table */}
        {unitValues.length > 0 && (
          <div className="bg-gray-900/50 rounded-xl border border-gray-800 overflow-hidden">
            <button
              onClick={() => setBreakdownOpen(o => !o)}
              className="w-full px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between hover:bg-gray-800/40 transition-colors"
            >
              <h2 className="text-white font-semibold text-sm sm:text-base">Monthly Breakdown</h2>
              <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-colors text-xs font-medium
                ${breakdownOpen
                  ? 'border-gray-600 bg-gray-700 text-white'
                  : 'border-emerald-700 bg-emerald-900/40 text-emerald-400'}`}>
                {breakdownOpen ? 'Collapse' : 'Expand'}
                <svg className={`w-4 h-4 transition-transform duration-200 ${breakdownOpen ? 'rotate-180' : ''}`}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </button>
            {breakdownOpen && <div className="overflow-x-auto border-t border-gray-800">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-800">
                    <th className="text-left text-gray-500 text-xs uppercase tracking-wider px-4 sm:px-6 py-3 font-medium">Date</th>
                    <th className="text-right text-gray-500 text-xs uppercase tracking-wider px-4 sm:px-6 py-3 font-medium">Unit Value</th>
                    <th className="text-right text-gray-500 text-xs uppercase tracking-wider px-4 sm:px-6 py-3 font-medium">Monthly Change</th>
                    <th className="text-right text-gray-500 text-xs uppercase tracking-wider px-4 sm:px-6 py-3 font-medium">Since Inception</th>
                  </tr>
                </thead>
                <tbody>
                  {[...unitValues]
                    .sort((a, b) => new Date(b.valuation_date).getTime() - new Date(a.valuation_date).getTime())
                    .map((uv, idx, arr) => {
                      const prev = arr[idx + 1];
                      const monthlyChange = prev
                        ? ((uv.unit_value - prev.unit_value) / prev.unit_value) * 100
                        : null;
                      const inceptionChange =
                        ((uv.unit_value - unitValues[0].unit_value) / unitValues[0].unit_value) * 100;

                      return (
                        <tr
                          key={uv.id}
                          className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors"
                        >
                          <td className="px-4 sm:px-6 py-3 text-gray-300">
                            {formatDateLong(uv.valuation_date)}
                          </td>
                          <td className="px-4 sm:px-6 py-3 text-right text-white font-mono font-medium">
                            £{fmt4(uv.unit_value)}
                          </td>
                          <td className={`px-4 sm:px-6 py-3 text-right font-mono font-medium ${
                            monthlyChange == null
                              ? 'text-gray-500'
                              : monthlyChange >= 0
                              ? 'text-emerald-400'
                              : 'text-red-400'
                          }`}>
                            {monthlyChange == null ? '—' : fmtPct(monthlyChange)}
                          </td>
                          <td className={`px-4 sm:px-6 py-3 text-right font-mono font-medium ${
                            inceptionChange >= 0 ? 'text-emerald-400' : 'text-red-400'
                          }`}>
                            {fmtPct(inceptionChange)}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>}
          </div>
        )}

        <div className="mt-6 text-center text-xs text-gray-500">
          Unit values extracted from monthly treasurer reports · Benchmarks via Yahoo Finance
        </div>
      </div>
    </div>
  );
}
