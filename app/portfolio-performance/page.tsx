'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
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

// Volatility helpers: colour by risk band and scale the axis to a rounded max.
const volColor = (v: number) => v < 20 ? '#10b981' : v <= 40 ? '#f59e0b' : '#ef4444';
const volAxisMax = (values: number[]) =>
  values.length ? Math.max(40, Math.ceil(Math.max(...values) / 10) * 10) : 40;
const fmtVol = (v: number) => `${v.toFixed(1)}%`;

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

function HorizontalBarChart({
  items, title, valueLabel, sub, action,
  colorFn, tooltipFormat, axisMin, axisMax, showWinLoss = true, footer,
}: {
  items: BarItem[]; title: string; valueLabel: string; sub?: string; action?: React.ReactNode;
  colorFn?: (v: number) => string;
  tooltipFormat?: (v: number) => string;
  axisMin?: number;
  axisMax?: number;
  showWinLoss?: boolean;
  footer?: React.ReactNode;
}) {
  const chartRef      = useRef<HTMLCanvasElement>(null);
  const chartInstance = useRef<Chart | null>(null);
  const height        = Math.max(300, items.length * 32);

  useEffect(() => {
    if (!chartRef.current || items.length === 0) return;
    chartInstance.current?.destroy();
    const color = colorFn ?? ((v: number) => v >= 0 ? '#10b981' : '#ef4444');
    const tooltip = tooltipFormat ?? ((v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`);
    const colors = items.map(i => color(i.value));
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
            callbacks: { label: ctx => tooltip(ctx.raw as number) },
            backgroundColor: 'rgba(0,0,0,0.9)', titleColor: '#fff', bodyColor: '#ccc',
          },
        },
        scales: {
          x: { min: axisMin, max: axisMax, grid: { color: 'rgba(75,85,99,0.2)' },
            ticks: { color: '#9ca3af', callback: v => `${v}%`, font: { size: 11 } } },
          y: { grid: { display: false },
            ticks: { color: '#9ca3af', font: { size: 10 }, autoSkip: false } },
        },
        layout: { padding: { left: 4, right: 4, top: 8, bottom: 8 } },
      },
    });
    return () => { chartInstance.current?.destroy(); };
  }, [items, colorFn, tooltipFormat, axisMin, axisMax]);

  const winners = items.filter(i => i.value > 0).length;
  const losers  = items.filter(i => i.value < 0).length;
  const best    = items.length ? items.reduce((a, b) => b.value > a.value ? b : a) : null;
  const worst   = items.length ? items.reduce((a, b) => b.value < a.value ? b : a) : null;

  return (
    <div className="bg-gray-900/50 rounded-xl border border-gray-800 p-4">
      <div className="flex justify-between items-center mb-3 flex-wrap gap-2">
        <div>
          <h2 className="text-white font-semibold text-base">{title}</h2>
          {sub && <p className="text-gray-500 text-xs mt-0.5">{sub}</p>}
        </div>
        {action && <div>{action}</div>}
        {showWinLoss ? (
          <div className="flex gap-3 text-xs flex-wrap">
            <span className="text-gray-400"><span className="text-emerald-400 font-medium">▲ {winners}</span> winners</span>
            <span className="text-gray-400"><span className="text-red-400 font-medium">▼ {losers}</span> losers</span>
            {best  && <span className="text-gray-400">Best: <span className="text-emerald-400 font-medium">{fmtPct(best.value)}</span></span>}
            {worst && <span className="text-gray-400">Worst: <span className="text-red-400 font-medium">{fmtPct(worst.value)}</span></span>}
          </div>
        ) : footer}
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
  const [portfolio,         setPortfolio]         = useState<PortfolioSummary | null>(null);
  const [transactions,      setTransactions]      = useState<Transaction[]>([]);
  const [monthlyPerfMap,    setMonthlyPerfMap]    = useState<Record<string, number>>({});
  const [volMap,            setVolMap]            = useState<Record<string, number>>({});
  const [volLoading,        setVolLoading]        = useState(true);
  const [soyPrices,         setSoyPrices]         = useState<Record<string, number>>({});
  const [sincePurchaseSort, setSincePurchaseSort] = useState<'performance' | 'date'>('performance');
  const [showVolatility,    setShowVolatility]    = useState(false);
  const [bottomChartMode,   setBottomChartMode]   = useState<'monthly' | 'ytd'>('monthly');
  const [loading,           setLoading]           = useState(true);
  const [monthlyLoading,    setMonthlyLoading]    = useState(true);
  const [error,             setError]             = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [txs, prices, soyData] = await Promise.all([
        getTransactions(),
        fetchPrices(),
        fetch('/api/historical-prices?date=2026-01-02').then(r => r.ok ? r.json() : {}),
      ]);
      const positions = await calculatePositions(txs, prices);
      const summary   = calculatePortfolioSummary(positions);
      setTransactions(txs); setPortfolio(summary); setSoyPrices(soyData);
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
      const data = await res.json() as Record<string, { changePercent: number }>;
      const map: Record<string, number> = {};
      for (const [ticker, val] of Object.entries(data))
        map[ticker] = val.changePercent;
      setMonthlyPerfMap(map);
    } catch (err) {
      console.error('Monthly perf error:', err);
    } finally {
      setMonthlyLoading(false);
    }
  }, []);

  const loadVolatility = useCallback(async (holdings: HoldingWithPrice[]) => {
    setVolLoading(true);
    try {
      const tickers = holdings.map(h => h.ticker).filter(Boolean);
      const res = await fetch(`/api/watchlist/quote?tickers=${encodeURIComponent(tickers.join(','))}`);
      const data = await res.json() as Record<string, { volatility?: number }>;
      const map: Record<string, number> = {};
      for (const [ticker, val] of Object.entries(data))
        if (val.volatility && val.volatility > 0) map[ticker] = val.volatility;
      setVolMap(map);
    } catch (err) {
      console.error('Volatility error:', err);
    } finally {
      setVolLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => {
    if (portfolio?.holdings.length) {
      loadMonthlyPerf(portfolio.holdings);
      loadVolatility(portfolio.holdings);
    }
  }, [portfolio, loadMonthlyPerf, loadVolatility]);

  const purchaseDates = firstPurchaseDates(transactions);

  // Shared ordering for the left chart; the volatility chart reuses it in "match" mode
  // so the two charts line up row-for-row.
  const sortedHoldings = (portfolio?.holdings ?? [])
    .slice()
    .sort((a, b) => sincePurchaseSort === 'date'
      ? (purchaseDates.get(b.holdingId) ?? '').localeCompare(purchaseDates.get(a.holdingId) ?? '')
      : b.pnlPercent - a.pnlPercent);

  const sincePurchaseItems: BarItem[] = sortedHoldings.map(h => ({
    label:    h.name.split(' ')[0],
    subLabel: purchaseDates.has(h.holdingId) ? fmtDate(purchaseDates.get(h.holdingId)!) : undefined,
    value:    h.pnlPercent,
  }));

  const volHoldings = sortedHoldings.filter(h => volMap[h.ticker] != null);
  const toVolItems = (holdings: HoldingWithPrice[]): BarItem[] =>
    holdings.map(h => ({ label: h.name.split(' ')[0], value: volMap[h.ticker] }));
  // Always ranked low → high volatility.
  const volatilityItems = toVolItems(
    volHoldings.slice().sort((a, b) => volMap[a.ticker] - volMap[b.ticker]));

  const thisMonthItems: BarItem[] = (portfolio?.holdings ?? [])
    .filter(h => monthlyPerfMap[h.ticker] != null)
    .map(h => ({
      label: h.name.split(' ')[0],
      value: monthlyPerfMap[h.ticker],
    }))
    .sort((a, b) => b.value - a.value);

  const ytdItems: BarItem[] = (portfolio?.holdings ?? [])
    .filter(h => soyPrices[h.ticker] != null && soyPrices[h.ticker] > 0)
    .map(h => ({
      label: h.name.split(' ')[0],
      value: ((h.currentPrice - soyPrices[h.ticker]) / soyPrices[h.ticker]) * 100,
    }))
    .sort((a, b) => b.value - a.value);

  const bottomToggle = (
    <div className="flex rounded-lg border border-gray-700 overflow-hidden text-xs">
      {(['monthly', 'ytd'] as const).map((mode, i) => (
        <button
          key={mode}
          onClick={() => setBottomChartMode(mode)}
          className={`px-3 py-1.5 transition-colors ${i > 0 ? 'border-l border-gray-700' : ''} ${
            bottomChartMode === mode ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300'
          }`}
        >
          {mode === 'monthly' ? '30 Days' : 'YTD'}
        </button>
      ))}
    </div>
  );

  const bottomItems    = bottomChartMode === 'monthly' ? thisMonthItems : ytdItems;
  const bottomTitle    = bottomChartMode === 'monthly'
    ? 'Performance of Stocks — Last 30 Days'
    : `Year-to-Date Performance — ${new Date().getFullYear()}`;
  const bottomValueLabel = bottomChartMode === 'monthly' ? '30-day change (%)' : 'YTD change (%)';
  const bottomSub      = bottomChartMode === 'monthly'
    ? 'Rolling 30-day window'
    : '2 Jan 2026 → today';

  // 1-year volatility chart. Rendered once, inside the collapsible dropdown at
  // the bottom of the page; always ranked low → high.
  const renderVolChart = (items: BarItem[], action?: React.ReactNode) =>
    volLoading ? (
      <div className="bg-gray-900/50 rounded-xl border border-gray-800 p-6 flex items-center justify-center min-h-[300px]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-emerald-500 mx-auto" />
          <p className="mt-2 text-gray-400 text-xs">Calculating volatility from Yahoo Finance...</p>
        </div>
      </div>
    ) : items.length > 0 ? (
      <HorizontalBarChart
        items={items}
        title="Volatility (1-Year)"
        valueLabel="Annualized volatility (%)"
        sub="Annualized stdev of daily returns"
        colorFn={volColor}
        tooltipFormat={fmtVol}
        axisMin={0}
        axisMax={volAxisMax(items.map(i => i.value))}
        showWinLoss={false}
        action={action}
        footer={
          <div className="flex gap-3 text-xs flex-wrap text-gray-400">
            <span><span className="text-emerald-400 font-medium">●</span> Low &lt;20%</span>
            <span><span className="text-amber-400 font-medium">●</span> Med 20–40%</span>
            <span><span className="text-red-400 font-medium">●</span> High &gt;40%</span>
          </div>
        }
      />
    ) : (
      <div className="bg-gray-900/50 rounded-xl border border-gray-800 p-6 flex items-center justify-center min-h-[300px] text-gray-500 text-sm">
        No volatility data available
      </div>
    );

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
          <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">Stock Performance</h1>
          <p className="text-sm text-gray-400 mt-1">
            Performance since purchase
          </p>
        </div>

        {/* Performance since purchase — full width (volatility moved to a dropdown below) */}
        <div className="mb-6">
          {sincePurchaseItems.length > 0 && (
            <HorizontalBarChart
              items={sincePurchaseItems}
              title="Performance of Individual Stocks Since Purchase"
              valueLabel="Return since purchase (%)"
              action={
                <div className="flex rounded-lg border border-gray-700 overflow-hidden text-xs">
                  <button
                    onClick={() => setSincePurchaseSort('performance')}
                    className={`px-3 py-1.5 transition-colors ${sincePurchaseSort === 'performance' ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300'}`}
                  >
                    Performance
                  </button>
                  <button
                    onClick={() => setSincePurchaseSort('date')}
                    className={`px-3 py-1.5 transition-colors ${sincePurchaseSort === 'date' ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300'}`}
                  >
                    Date
                  </button>
                </div>
              }
            />
          )}
        </div>

        {/* Performance of stock this month / YTD */}
        <div className="mb-6">
          {monthlyLoading && bottomChartMode === 'monthly' ? (
            <div className="bg-gray-900/50 rounded-xl border border-gray-800 p-6 flex items-center justify-center h-40">
              <div className="text-center">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-emerald-500 mx-auto" />
                <p className="mt-2 text-gray-400 text-xs">Fetching monthly prices from Yahoo Finance...</p>
              </div>
            </div>
          ) : bottomItems.length > 0 ? (
            <HorizontalBarChart
              items={bottomItems}
              title={bottomTitle}
              valueLabel={bottomValueLabel}
              sub={bottomSub}
              action={bottomToggle}
            />
          ) : (
            <div className="bg-gray-900/50 rounded-xl border border-gray-800 p-6 text-center text-gray-500 text-sm">
              No price data available
            </div>
          )}
        </div>

        {/* 1-year volatility — hidden by default, revealed via this dropdown */}
        <div className="mb-6">
          <button
            onClick={() => setShowVolatility(v => !v)}
            aria-expanded={showVolatility}
            className="w-full flex items-center justify-between gap-2 px-4 py-3 bg-gray-900/50 rounded-xl border border-gray-800 text-left hover:bg-gray-800/50 transition-colors"
          >
            <span className="text-white font-medium text-sm">Volatility (1-Year)</span>
            <svg
              className={`w-5 h-5 text-gray-400 transition-transform ${showVolatility ? 'rotate-180' : ''}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {showVolatility && (
            <div className="mt-4">{renderVolChart(volatilityItems)}</div>
          )}
        </div>

      </div>
    </div>
  );
}
