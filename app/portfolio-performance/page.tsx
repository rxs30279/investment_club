'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Navigation from '@/components/Navigation';
import Chart from 'chart.js/auto';
import { HoldingWithPrice, Transaction, Dividend, PortfolioSummary } from '@/types';
import { supabase } from '@/lib/supabase';
import {
  getTransactions,
  calculatePositions,
  fetchPrices,
  calculatePortfolioSummary,
  getDividends,
  saveDividends,
  fetchFTSEData,
} from '@/lib/portfolio';

// ── Formatters ────────────────────────────────────────────────────────────────

const fmtCurrency = (v: number) =>
  `£${v.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtPct = (v: number) =>
  `${v >= 0 ? '+' : ''}${v.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' });

// ── Cost calculations ─────────────────────────────────────────────────────────

const DEALING_FEE = 9;
const STAMP_DUTY  = 0.005;

function calcYTDCosts(
  transactions: Transaction[],
  stampDutyEnabled: boolean,
  stampDutyExclusions: Set<number>
): { dealing: number; stampDuty: number; total: number } {
  const yearStart = new Date(new Date().getFullYear(), 0, 1);
  const ytd = transactions.filter(tx => new Date(tx.date) >= yearStart);
  let dealing = 0, stampDuty = 0;
  for (const tx of ytd) {
    dealing += DEALING_FEE;
    if (tx.type === 'buy' && stampDutyEnabled && !stampDutyExclusions.has(tx.holdingId))
      stampDuty += tx.totalCost * STAMP_DUTY;
  }
  return { dealing, stampDuty, total: dealing + stampDuty };
}

function calcYTDDividends(dividends: Dividend[]): number {
  const yearStart = new Date(new Date().getFullYear(), 0, 1);
  return dividends.filter(d => new Date(d.date) >= yearStart).reduce((s, d) => s + d.amount, 0);
}

function calcYTDCustodyFee(portfolioValue: number): { quartersElapsed: number; total: number } {
  const month = new Date().getMonth();
  const quartersElapsed = Math.floor(month / 3) + 1;
  const feePerQuarter = portfolioValue * 0.0005;
  return { quartersElapsed, total: feePerQuarter * quartersElapsed };
}

function firstPurchaseDates(transactions: Transaction[]): Map<number, string> {
  const map = new Map<number, string>();
  for (const tx of transactions) {
    if (tx.type !== 'buy') continue;
    const ex = map.get(tx.holdingId);
    if (!ex || tx.date < ex) map.set(tx.holdingId, tx.date);
  }
  return map;
}

// ── Build monthly returns from unit_values ────────────────────────────────────

interface MonthlyReturn { month: string; portfolioReturn: number; ftse100Return: number; ftse250Return: number; }

function buildFtseMonthlyMap(data: { date: string; value: number }[]): Map<string, number> {
  const monthMap = new Map<string, { first: number; last: number }>();
  for (const point of data) {
    const ym = point.date.slice(0, 7);
    const existing = monthMap.get(ym);
    if (!existing) monthMap.set(ym, { first: point.value, last: point.value });
    else existing.last = point.value;
  }
  const result = new Map<string, number>();
  const months = Array.from(monthMap.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  for (let i = 1; i < months.length; i++) {
    const [ym, { last }] = months[i];
    const prevLast = months[i - 1][1].last;
    result.set(ym, ((last - prevLast) / prevLast) * 100);
  }
  return result;
}

function buildMonthlyReturns(
  unitValues: { valuation_date: string; unit_value: number }[],
  ftse100Map: Map<string, number>,
  ftse250Map: Map<string, number>,
): MonthlyReturn[] {
  const sorted = [...unitValues].sort(
    (a, b) => new Date(a.valuation_date).getTime() - new Date(b.valuation_date).getTime()
  );
  const results: MonthlyReturn[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    const month = new Date(curr.valuation_date)
      .toLocaleDateString('en-GB', { month: 'short' })
      .toUpperCase();
    const portfolioReturn = ((curr.unit_value - prev.unit_value) / prev.unit_value) * 100;
    const ym = curr.valuation_date.slice(0, 7);
    results.push({
      month,
      portfolioReturn,
      ftse100Return: ftse100Map.get(ym) ?? 0,
      ftse250Return: ftse250Map.get(ym) ?? 0,
    });
  }
  return results;
}

// ── Horizontal bar chart ──────────────────────────────────────────────────────

interface BarItem { label: string; value: number; subLabel?: string; }

function HorizontalBarChart({ items, title, valueLabel }: {
  items: BarItem[]; title: string; valueLabel: string;
}) {
  const chartRef      = useRef<HTMLCanvasElement>(null);
  const chartInstance = useRef<Chart | null>(null);
  const height        = Math.max(300, items.length * 32);

  useEffect(() => {
    if (!chartRef.current || items.length === 0) return;
    chartInstance.current?.destroy();
    const colors = items.map(i => i.value >= 0 ? '#10b981' : '#ef4444');
    chartInstance.current = new Chart(chartRef.current, {
      type: 'bar',
      data: {
        labels: items.map(i => i.subLabel ? [i.label, i.subLabel] : i.label),
        datasets: [{ label: valueLabel, data: items.map(i => i.value),
          backgroundColor: colors, borderColor: colors, borderWidth: 1,
          borderRadius: 4, barPercentage: 0.75, categoryPercentage: 0.9 }],
      },
      options: {
        responsive: true, maintainAspectRatio: false, indexAxis: 'y',
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: { label: ctx => `${(ctx.raw as number) >= 0 ? '+' : ''}${(ctx.raw as number).toFixed(2)}%` },
            backgroundColor: 'rgba(0,0,0,0.9)', titleColor: '#fff', bodyColor: '#ccc',
          },
        },
        scales: {
          x: { grid: { color: 'rgba(75,85,99,0.2)' },
            ticks: { color: '#9ca3af', callback: v => `${v}%`, font: { size: 11 } } },
          y: { grid: { display: false },
            ticks: { color: '#9ca3af', font: { size: 10 }, autoSkip: false } },
        },
        layout: { padding: { left: 8, right: 20, top: 8, bottom: 8 } },
      },
    });
    return () => { chartInstance.current?.destroy(); };
  }, [items]);

  const winners = items.filter(i => i.value > 0).length;
  const losers  = items.filter(i => i.value < 0).length;
  const best    = items.length ? items.reduce((a, b) => b.value > a.value ? b : a) : null;
  const worst   = items.length ? items.reduce((a, b) => b.value < a.value ? b : a) : null;

  return (
    <div className="bg-gray-900/50 rounded-xl border border-gray-800 p-4">
      <div className="flex justify-between items-center mb-3 flex-wrap gap-2">
        <h2 className="text-white font-semibold text-base">{title}</h2>
        <div className="flex gap-3 text-xs flex-wrap">
          <span className="text-gray-400"><span className="text-emerald-400 font-medium">▲ {winners}</span> winners</span>
          <span className="text-gray-400"><span className="text-red-400 font-medium">▼ {losers}</span> losers</span>
          {best  && <span className="text-gray-400">Best: <span className="text-emerald-400 font-medium">{fmtPct(best.value)}</span></span>}
          {worst && <span className="text-gray-400">Worst: <span className="text-red-400 font-medium">{fmtPct(worst.value)}</span></span>}
        </div>
      </div>
      <div style={{ height: `${height}px`, minHeight: '300px' }}>
        <canvas ref={chartRef} style={{ width: '100%', height: '100%' }} />
      </div>
    </div>
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, accent }: {
  label: string; value: string; sub?: string;
  accent?: 'green' | 'red' | 'blue' | 'amber' | 'neutral';
}) {
  const cls = { green: 'text-emerald-400', red: 'text-red-400', blue: 'text-blue-400',
    amber: 'text-amber-400', neutral: 'text-white' }[accent ?? 'neutral'];
  return (
    <div className="bg-gray-900/50 rounded-xl border border-gray-800 px-4 py-4 sm:px-5 sm:py-5">
      <p className="text-gray-500 text-xs uppercase tracking-wider mb-1">{label}</p>
      <p className={`text-xl sm:text-2xl font-bold ${cls}`}>{value}</p>
      {sub && <p className="text-gray-500 text-xs mt-1">{sub}</p>}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function PortfolioPerformancePage() {
  const [portfolio,       setPortfolio]       = useState<PortfolioSummary | null>(null);
  const [transactions,    setTransactions]    = useState<Transaction[]>([]);
  const [dividends,       setDividends]       = useState<Dividend[]>([]);
  const [monthlyPerfMap,  setMonthlyPerfMap]  = useState<Record<string, number>>({});
  const [monthlyTableData,setMonthlyTableData]= useState<MonthlyReturn[]>([]);
  const [monthlyView,     setMonthlyView]     = useState<'portfolio' | 'ftse100' | 'ftse250'>('portfolio');
  const [loading,         setLoading]         = useState(true);
  const [monthlyLoading,  setMonthlyLoading]  = useState(true);
  const [error,           setError]           = useState<string | null>(null);

  const [stampDutyEnabled,    setStampDutyEnabled]    = useState(true);
  const [stampDutyExclusions, setStampDutyExclusions] = useState<Set<number>>(new Set());
  const [showStampDuty,       setShowStampDuty]       = useState(false);

  const [showAddDividend, setShowAddDividend] = useState(false);
  const [newDividend, setNewDividend] = useState({
    holdingId: 0, date: new Date().toISOString().split('T')[0], amount: 0, notes: '',
  });

  const loadData = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [txs, divs, prices] = await Promise.all([getTransactions(), getDividends(), fetchPrices()]);
      const positions = await calculatePositions(txs, prices);
      const summary   = calculatePortfolioSummary(positions);
      setTransactions(txs); setDividends(divs); setPortfolio(summary);

      // Fetch unit values from Supabase for monthly returns
      const { data: uvData } = await supabase
        .from('unit_values')
        .select('valuation_date, unit_value')
        .order('valuation_date', { ascending: true });

      // Fetch FTSE 100 + 250 from the shared benchmarks endpoint (one Yahoo Finance call)
      let ftse100Map = new Map<string, number>();
      let ftse250Map = new Map<string, number>();
      try {
        const twoYearsAgo = new Date();
        twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
        const fromDate = twoYearsAgo.toISOString().split('T')[0];
        const ftseData = await fetchFTSEData(fromDate);
        ftse100Map = buildFtseMonthlyMap(ftseData.ftse100);
        ftse250Map = buildFtseMonthlyMap(ftseData.ftse250);
      } catch { /* FTSE optional */ }

      setMonthlyTableData(buildMonthlyReturns(uvData || [], ftse100Map, ftse250Map));
    } catch (err) {
      console.error(err);
      setError('Failed to load data. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMonthlyPerf = useCallback(async (holdings: HoldingWithPrice[]) => {
    setMonthlyLoading(true);
    try {
      const tickers = holdings.map(h => h.ticker).filter(Boolean);
      const res = await fetch('/api/monthly-performance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tickers }),
      });
      const data = await res.json();
      const map: Record<string, number> = {};
      for (const [ticker, val] of Object.entries(data as any))
        map[ticker] = (val as any).changePercent;
      setMonthlyPerfMap(map);
    } catch (err) {
      console.error('Monthly perf error:', err);
    } finally {
      setMonthlyLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => {
    if (portfolio?.holdings.length) loadMonthlyPerf(portfolio.holdings);
  }, [portfolio, loadMonthlyPerf]);

  const purchaseDates  = firstPurchaseDates(transactions);
  const custodyFee     = calcYTDCustodyFee(portfolio?.totalValue ?? 0);
  const ytdDividends   = calcYTDDividends(dividends);
  const ytdCosts       = calcYTDCosts(transactions, stampDutyEnabled, stampDutyExclusions);
  const totalDividends = dividends.reduce((s, d) => s + d.amount, 0);

  const ytdReturn = (() => {
    if (!portfolio) return 0;
    const yearStart = new Date(new Date().getFullYear(), 0, 1);
    const ytdBuyCost = transactions
      .filter(tx => tx.type === 'buy' && new Date(tx.date) >= yearStart)
      .reduce((s, t) => s + t.totalCost, 0);
    return ytdBuyCost > 0
      ? ((portfolio.totalValue - ytdBuyCost) / ytdBuyCost) * 100
      : portfolio.totalPnlPercent;
  })();

  const sincePurchaseItems: BarItem[] = (portfolio?.holdings ?? [])
    .sort((a, b) => b.pnlPercent - a.pnlPercent)
    .map(h => ({
      label:    h.name.length > 22 ? h.name.slice(0, 20) + '…' : h.name,
      subLabel: purchaseDates.has(h.holdingId) ? fmtDate(purchaseDates.get(h.holdingId)!) : undefined,
      value:    h.pnlPercent,
    }));

  const thisMonthItems: BarItem[] = (portfolio?.holdings ?? [])
    .filter(h => monthlyPerfMap[h.ticker] != null)
    .map(h => ({
      label: h.name.length > 22 ? h.name.slice(0, 20) + '…' : h.name,
      value: monthlyPerfMap[h.ticker],
    }))
    .sort((a, b) => b.value - a.value);

  // Show all months that have data from unit_values
  const currentYear = new Date().getFullYear();
  const monthsToShow = monthlyTableData.filter(m => {
    // Keep all months — unit_values covers full history
    return true;
  });

  const handleAddDividend = async () => {
    if (!newDividend.holdingId || newDividend.amount <= 0) {
      alert('Please select a holding and enter a valid amount'); return;
    }
    const div: Dividend = {
      id: Math.max(...dividends.map(d => d.id), 0) + 1,
      holdingId: newDividend.holdingId, date: newDividend.date,
      amount: newDividend.amount, currency: 'GBP', notes: newDividend.notes,
    };
    const updated = [...dividends, div];
    await saveDividends(updated);
    setDividends(updated);
    setShowAddDividend(false);
    setNewDividend({ holdingId: 0, date: new Date().toISOString().split('T')[0], amount: 0, notes: '' });
  };

  const handleDeleteDividend = async (id: number) => {
    if (!confirm('Delete this dividend?')) return;
    const updated = dividends.filter(d => d.id !== id);
    await saveDividends(updated); setDividends(updated);
  };

  const toggleStampDutyExclusion = (holdingId: number) => {
    setStampDutyExclusions(prev => {
      const next = new Set(prev);
      next.has(holdingId) ? next.delete(holdingId) : next.add(holdingId);
      return next;
    });
  };

  if (loading) return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
      <Navigation />
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-emerald-500 mx-auto" />
          <p className="mt-3 text-gray-400 text-sm">Loading portfolio performance...</p>
        </div>
      </div>
    </div>
  );

  if (error || !portfolio) return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
      <Navigation />
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="bg-red-900/30 border border-red-700 rounded-xl p-6 text-center">
          <p className="text-red-400">{error ?? 'Failed to load data'}</p>
          <button onClick={loadData} className="mt-3 px-4 py-2 bg-red-600 text-white rounded-lg text-sm">Try Again</button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
      <Navigation />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6 lg:py-8">

        {/* Header */}
        <div className="mb-6">
          <h1 className="text-xl sm:text-2xl font-bold text-white">Portfolio Performance</h1>
          <p className="text-xs sm:text-sm text-gray-400 mt-1">
            Year-to-date · {new Date().getFullYear()} · Costs &amp; dividends reset each January
          </p>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          <StatCard
            label="Total Portfolio Value"
            value={fmtCurrency(portfolio.totalValue)}
            sub={`${fmtPct(portfolio.totalPnlPercent)} since inception`}
            accent="neutral"
          />
          <StatCard
            label="YTD Dividends"
            value={fmtCurrency(ytdDividends)}
            sub={`${fmtCurrency(totalDividends)} all time`}
            accent="green"
          />
          <StatCard
            label="YTD Running Costs"
            value={fmtCurrency(ytdCosts.total)}
            sub={`Dealing ${fmtCurrency(ytdCosts.dealing)} · Stamp ${fmtCurrency(ytdCosts.stampDuty)}`}
            accent="amber"
          />
          <StatCard
            label="YTD Custody Fee (est.)"
            value={fmtCurrency(custodyFee.total)}
            sub={`${custodyFee.quartersElapsed}Q × ${fmtCurrency(portfolio.totalValue * 0.0005)} @ 0.2% p.a.`}
            accent="amber"
          />
        </div>

        {/* Performance since purchase */}
        {sincePurchaseItems.length > 0 && (
          <div className="mb-6">
            <HorizontalBarChart
              items={sincePurchaseItems}
              title="Performance Since Purchase"
              valueLabel="Return since purchase (%)"
            />
          </div>
        )}

        {/* Performance this month */}
        <div className="mb-6">
          {monthlyLoading ? (
            <div className="bg-gray-900/50 rounded-xl border border-gray-800 p-6 flex items-center justify-center h-40">
              <div className="text-center">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-emerald-500 mx-auto" />
                <p className="mt-2 text-gray-400 text-xs">Fetching monthly prices from Yahoo Finance...</p>
              </div>
            </div>
          ) : thisMonthItems.length > 0 ? (
            <HorizontalBarChart
              items={thisMonthItems}
              title={`Performance This Month — ${new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}`}
              valueLabel="Monthly change (%)"
            />
          ) : (
            <div className="bg-gray-900/50 rounded-xl border border-gray-800 p-6 text-center text-gray-500 text-sm">
              No monthly price data available
            </div>
          )}
        </div>

        {/* Monthly returns boxes */}
        <div className="bg-gray-900/50 rounded-xl border border-gray-800 p-4 sm:p-6 mb-6">
          <div className="flex justify-between items-center mb-4 flex-wrap gap-3">
            <h2 className="text-white font-semibold">Monthly Returns</h2>
            <div className="flex gap-2">
              {([
                { key: 'portfolio', label: 'Portfolio', activeClass: 'bg-emerald-600 text-white' },
                { key: 'ftse100',   label: 'FTSE 100',  activeClass: 'bg-blue-600 text-white' },
                { key: 'ftse250',   label: 'FTSE 250',  activeClass: 'bg-amber-600 text-white' },
              ] as const).map(({ key, label, activeClass }) => (
                <button key={key} onClick={() => setMonthlyView(key)}
                  className={`px-3 py-1 text-xs rounded-lg transition-colors ${
                    monthlyView === key ? activeClass : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                  }`}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {monthsToShow.length === 0 ? (
            <p className="text-gray-500 text-sm text-center py-4">No monthly data yet — upload PDFs and sync.</p>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                {monthsToShow.map((m, idx) => {
                  const val = monthlyView === 'portfolio' ? m.portfolioReturn : monthlyView === 'ftse100' ? m.ftse100Return : m.ftse250Return;
                  const pos = val >= 0;
                  return (
                    <div key={idx} className={`rounded-lg p-3 ${pos
                      ? 'bg-emerald-500/10 border-l-2 border-emerald-500'
                      : 'bg-red-500/10 border-l-2 border-red-500'}`}>
                      <p className="text-gray-400 text-xs uppercase font-medium text-center">{m.month}</p>
                      <p className={`text-xl font-bold mt-1 text-center ${pos ? 'text-emerald-400' : 'text-red-400'}`}>
                        {fmtPct(val)}
                      </p>
                    </div>
                  );
                })}
              </div>

              {(() => {
                const vals = monthsToShow.map(m =>
                  monthlyView === 'portfolio' ? m.portfolioReturn : monthlyView === 'ftse100' ? m.ftse100Return : m.ftse250Return);
                const best   = Math.max(...vals);
                const worst  = Math.min(...vals);
                const bestM  = monthsToShow[vals.indexOf(best)];
                const worstM = monthsToShow[vals.indexOf(worst)];
                return (
                  <div className="mt-4 flex justify-between text-xs text-gray-500 border-t border-gray-800 pt-3 flex-wrap gap-2">
                    <span>🟢 Positive month · 🔴 Negative month</span>
                    <span>
                      Best: <span className="text-emerald-400">{bestM?.month} {fmtPct(best)}</span>
                      <span className="mx-2">|</span>
                      Worst: <span className="text-red-400">{worstM?.month} {fmtPct(worst)}</span>
                    </span>
                  </div>
                );
              })()}
            </>
          )}
        </div>

        {/* Dividends */}
        <div className="bg-gray-900/50 rounded-xl border border-gray-800 overflow-hidden mb-6">
          <div className="flex justify-between items-center px-4 sm:px-6 py-4 border-b border-gray-800">
            <h2 className="text-white font-semibold">Dividend Income</h2>
            <button onClick={() => setShowAddDividend(!showAddDividend)}
              className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs">
              + Add Dividend
            </button>
          </div>

          {showAddDividend && (
            <div className="p-4 sm:p-6 border-b border-gray-800 bg-gray-800/30">
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                <select value={newDividend.holdingId}
                  onChange={e => setNewDividend({ ...newDividend, holdingId: parseInt(e.target.value) })}
                  className="bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-white text-sm">
                  <option value={0}>Select Holding</option>
                  {portfolio.holdings.map(h => (
                    <option key={h.holdingId} value={h.holdingId}>{h.name}</option>
                  ))}
                </select>
                <input type="date" value={newDividend.date}
                  onChange={e => setNewDividend({ ...newDividend, date: e.target.value })}
                  className="bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-white text-sm" />
                <input type="number" placeholder="Amount (£)" value={newDividend.amount || ''}
                  onChange={e => setNewDividend({ ...newDividend, amount: parseFloat(e.target.value) })}
                  step="0.01"
                  className="bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-white text-sm" />
                <input type="text" placeholder="Notes (optional)" value={newDividend.notes}
                  onChange={e => setNewDividend({ ...newDividend, notes: e.target.value })}
                  className="bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-white placeholder-gray-500 text-sm" />
              </div>
              <div className="flex gap-2 mt-4">
                <button onClick={handleAddDividend}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm">
                  Save Dividend
                </button>
                <button onClick={() => setShowAddDividend(false)}
                  className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm">
                  Cancel
                </button>
              </div>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800">
                  {['Date', 'Company', 'Amount', 'Notes', 'Actions'].map((h, i) => (
                    <th key={h} className={`text-gray-500 text-xs uppercase tracking-wider px-4 sm:px-6 py-3 font-medium ${
                      i === 2 ? 'text-right' : i === 4 ? 'text-center' : 'text-left'}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...dividends].reverse().map(div => (
                  <tr key={div.id} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                    <td className="px-4 sm:px-6 py-3 text-gray-300">{div.date}</td>
                    <td className="px-4 sm:px-6 py-3 text-white">
                      {portfolio.holdings.find(h => h.holdingId === div.holdingId)?.name ?? `Holding ${div.holdingId}`}
                    </td>
                    <td className="px-4 sm:px-6 py-3 text-right text-emerald-400 font-mono">{fmtCurrency(div.amount)}</td>
                    <td className="px-4 sm:px-6 py-3 text-gray-400">{div.notes || '—'}</td>
                    <td className="px-4 sm:px-6 py-3 text-center">
                      <button onClick={() => handleDeleteDividend(div.id)}
                        className="text-red-400 hover:text-red-300 text-xs">Delete</button>
                    </td>
                  </tr>
                ))}
                {dividends.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-6 py-8 text-center text-gray-500 text-sm">
                      No dividends recorded — click "+ Add Dividend" to start tracking.
                    </td>
                  </tr>
                )}
              </tbody>
              <tfoot className="border-t border-gray-800">
                <tr>
                  <td colSpan={2} className="px-4 sm:px-6 py-3 text-right text-gray-400 text-sm font-medium">Total Dividends</td>
                  <td className="px-4 sm:px-6 py-3 text-right font-bold text-emerald-400 font-mono">{fmtCurrency(totalDividends)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* Stamp Duty Settings — collapsible, at bottom */}
        <div className="bg-gray-900/50 rounded-xl border border-gray-800 mb-6">
          <button
            onClick={() => setShowStampDuty(v => !v)}
            className="w-full flex justify-between items-center px-4 sm:px-6 py-4 text-left"
          >
            <h2 className="text-white font-semibold text-sm">Stamp Duty Settings</h2>
            <span className="text-gray-400 text-xs">{showStampDuty ? '▲ Hide' : '▼ Show'}</span>
          </button>

          {showStampDuty && (
            <div className="px-4 sm:px-6 pb-4 border-t border-gray-800 pt-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-3">
                <p className="text-gray-400 text-xs">Enable or disable stamp duty (0.5%) on buy transactions</p>
                <label className="flex items-center gap-2 cursor-pointer" onClick={() => setStampDutyEnabled(v => !v)}>
                  <div className={`w-10 h-5 rounded-full transition-colors relative ${stampDutyEnabled ? 'bg-emerald-600' : 'bg-gray-700'}`}>
                    <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${stampDutyEnabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
                  </div>
                  <span className="text-gray-300 text-xs">Stamp Duty (0.5%) on buys</span>
                </label>
              </div>

              {stampDutyEnabled && (
                <div className="mb-3">
                  <p className="text-gray-500 text-xs mb-2">Click a holding to exclude it from stamp duty (e.g. ETFs, Investment Trusts):</p>
                  <div className="flex flex-wrap gap-2">
                    {portfolio.holdings.map(h => {
                      const excluded = stampDutyExclusions.has(h.holdingId);
                      return (
                        <button key={h.holdingId} onClick={() => toggleStampDutyExclusion(h.holdingId)}
                          className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
                            excluded
                              ? 'border-gray-600 text-gray-500'
                              : 'border-emerald-600 text-emerald-400 bg-emerald-600/10'
                          }`}>
                          {excluded ? '✕ ' : '✓ '}{h.name.length > 18 ? h.name.slice(0, 16) + '…' : h.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs pt-3 border-t border-gray-800">
                <div>
                  <span className="text-gray-500">Dealing fee</span>
                  <p className="text-white font-medium mt-0.5">£9 per buy &amp; sell</p>
                </div>
                <div>
                  <span className="text-gray-500">Stamp duty</span>
                  <p className="text-white font-medium mt-0.5">0.5% on buys</p>
                </div>
                <div>
                  <span className="text-gray-500">YTD transactions</span>
                  <p className="text-white font-medium mt-0.5">
                    {transactions.filter(tx =>
                      new Date(tx.date) >= new Date(new Date().getFullYear(), 0, 1)
                    ).length} trades
                  </p>
                </div>
                <div>
                  <span className="text-gray-500">Custody fee</span>
                  <p className="text-white font-medium mt-0.5">0.2% p.a. charged quarterly</p>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="text-center text-xs text-gray-500 pb-4">
          £9 dealing fee per transaction · 0.5% stamp duty on buys (where applicable) · 0.2% p.a. custody fee (est.) · Resets each 1 January
        </div>
      </div>
    </div>
  );
}
