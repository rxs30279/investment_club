'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Navigation from '@/components/Navigation';
import Chart from 'chart.js/auto';
import { HoldingWithPrice, Transaction, PortfolioSummary } from '@/types';
import {
  getTransactions,
  calculatePositions,
  fetchPrices,
  calculatePortfolioSummary,
} from '@/lib/portfolio';

// ── Formatters ────────────────────────────────────────────────────────────────

const fmtCurrency = (v: number) =>
  `£${v.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtPct = (v: number) =>
  `${v >= 0 ? '+' : ''}${v.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' });

function firstPurchaseDates(transactions: Transaction[]): Map<number, string> {
  const map = new Map<number, string>();
  for (const tx of transactions) {
    if (tx.type !== 'buy') continue;
    const ex = map.get(tx.holdingId);
    if (!ex || tx.date < ex) map.set(tx.holdingId, tx.date);
  }
  return map;
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
        layout: { padding: { left: 4, right: 4, top: 8, bottom: 8 } },
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
      <div style={{ position: 'relative', width: '100%', height: `${height}px`, minHeight: '300px' }}>
        <canvas ref={chartRef} />
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
  const [portfolio,        setPortfolio]        = useState<PortfolioSummary | null>(null);
  const [transactions,     setTransactions]     = useState<Transaction[]>([]);
  const [monthlyPerfMap,   setMonthlyPerfMap]   = useState<Record<string, number>>({});
  const [loading,          setLoading]          = useState(true);
  const [monthlyLoading,   setMonthlyLoading]   = useState(true);
  const [error,            setError]            = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [txs, prices] = await Promise.all([getTransactions(), fetchPrices()]);
      const positions = await calculatePositions(txs, prices);
      const summary   = calculatePortfolioSummary(positions);
      setTransactions(txs); setPortfolio(summary);
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

  const purchaseDates = firstPurchaseDates(transactions);

  const sincePurchaseItems: BarItem[] = (portfolio?.holdings ?? [])
    .sort((a, b) => b.pnlPercent - a.pnlPercent)
    .map(h => ({
      label:    h.name.split(' ')[0],
      subLabel: purchaseDates.has(h.holdingId) ? fmtDate(purchaseDates.get(h.holdingId)!) : undefined,
      value:    h.pnlPercent,
    }));

  const thisMonthItems: BarItem[] = (portfolio?.holdings ?? [])
    .filter(h => monthlyPerfMap[h.ticker] != null)
    .map(h => ({
      label: h.name.split(' ')[0],
      value: monthlyPerfMap[h.ticker],
    }))
    .sort((a, b) => b.value - a.value);

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
          <h1 className="text-xl sm:text-2xl font-bold text-white">Stock Performance</h1>
          <p className="text-xs sm:text-sm text-gray-400 mt-1">
            Year-to-date · {new Date().getFullYear()}
          </p>
        </div>

        {/* Performance of stock since purchase */}
        {sincePurchaseItems.length > 0 && (
          <div className="mb-6">
            <HorizontalBarChart
              items={sincePurchaseItems}
              title="Performance of Stock Since Purchase"
              valueLabel="Return since purchase (%)"
            />
          </div>
        )}

        {/* Performance of stock this month */}
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
              title={`Performance of Stock This Month — ${new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}`}
              valueLabel="Monthly change (%)"
            />
          ) : (
            <div className="bg-gray-900/50 rounded-xl border border-gray-800 p-6 text-center text-gray-500 text-sm">
              No monthly price data available
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
