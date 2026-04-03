'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Navigation from '@/components/Navigation';
import RefreshButton from '@/components/RefreshButton';
import { PortfolioSummary, Position, Transaction } from '@/types';
import { getTransactions, calculatePositions, fetchPrices, calculatePortfolioSummary, getHoldingsReference } from '@/lib/portfolio';

const formatCurrency = (value: number): string =>
  `£${value.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const formatPercent = (value: number): string =>
  `${value >= 0 ? '+' : ''}${value.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;

// ── Sector colours ─────────────────────────────────────────────────────────────

const sectorColors: Record<string, string> = {
  Technology:  '#ef4444',  // red
  Energy:      '#f97316',  // orange
  Industrials: '#eab308',  // yellow
  Utilities:   '#84cc16',  // lime
  Materials:   '#22c55e',  // green
  Healthcare:  '#14b8a6',  // teal
  Aerospace:   '#3b82f6',  // blue
  Financials:  '#a855f7',  // purple
  Consumer:    '#ec4899',  // pink
  Other:       '#94a3b8',  // slate
};

// ── Pie chart ──────────────────────────────────────────────────────────────────

const PieChart = ({ data }: { data: { sector: string; value: number; color: string; holdings: string[] }[] }) => {
  const [expanded, setExpanded] = useState<string | null>(null);
  const total = data.reduce((sum, item) => sum + item.value, 0);
  const center = 110;
  const radius = 100;

  const segments = data.reduce<{ path: string; color: string; sector: string; value: number; percentage: number; holdings: string[] }[]>(
    (acc, item) => {
      const previousAngle = acc.reduce((sum, seg) => sum + (seg.value / total) * 360, 0);
      const angle = (item.value / total) * 360;
      const startRad = (previousAngle * Math.PI) / 180;
      const endRad   = ((previousAngle + angle) * Math.PI) / 180;
      const x1 = center + radius * Math.cos(startRad);
      const y1 = center + radius * Math.sin(startRad);
      const x2 = center + radius * Math.cos(endRad);
      const y2 = center + radius * Math.sin(endRad);
      acc.push({
        path: `M ${center} ${center} L ${x1} ${y1} A ${radius} ${radius} 0 ${angle > 180 ? 1 : 0} 1 ${x2} ${y2} Z`,
        color: item.color,
        sector: item.sector,
        value: item.value,
        percentage: (item.value / total) * 100,
        holdings: item.holdings,
      });
      return acc;
    }, []
  );

  return (
    <div className="flex flex-col items-center gap-6 md:flex-row md:items-center md:gap-8">
      <svg viewBox="0 0 220 220" className="w-full max-w-[300px] mx-auto md:flex-1 md:max-w-none flex-shrink-0">
        {segments.map((seg, idx) => (
          <path key={idx} d={seg.path} fill={seg.color} stroke="#1f2937" strokeWidth="1.5"
            className="transition-opacity hover:opacity-80 cursor-pointer">
            <title>{`${seg.sector}: ${formatCurrency(seg.value)} (${seg.percentage.toFixed(1)}%)`}</title>
          </path>
        ))}
        <circle cx={center} cy={center} r="50" fill="#1f2937" stroke="#374151" strokeWidth="1.5" />
        <text x={center} y={center + 5} textAnchor="middle" fill="#9ca3af" fontSize="12" fontWeight="bold">
          {data.length} Sectors
        </text>
      </svg>
      <div className="w-full md:w-40 grid grid-cols-2 md:grid-cols-1 gap-3">
        {segments.map((seg, idx) => {
          const isOpen = expanded === seg.sector;
          return (
            <div key={idx}>
              <button
                onClick={() => setExpanded(isOpen ? null : seg.sector)}
                className="w-full flex items-center gap-2 p-2 bg-gray-800/30 rounded-lg hover:bg-gray-800/50 transition-colors"
              >
                <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: seg.color }} />
                <span className="text-gray-300 text-sm flex-1 text-left">{seg.sector}</span>
                <span className="text-white text-sm font-medium">{seg.percentage.toFixed(1)}%</span>
                <span className="text-gray-500 text-xs ml-1">{isOpen ? '▲' : '▼'}</span>
              </button>
              {isOpen && (
                <div className="mt-1 ml-5 flex flex-col gap-0.5">
                  {seg.holdings.map((name, i) => (
                    <span key={i} className="text-gray-400 text-xs">{name}</span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ── Treemap ────────────────────────────────────────────────────────────────────

interface TreemapRect {
  holdingId: number;
  name: string;
  percentage: number;
  currentValue: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

function buildTreemap(
  items: { holdingId: number; name: string; percentage: number; currentValue: number }[],
  x: number, y: number, w: number, h: number,
): TreemapRect[] {
  if (items.length === 0) return [];
  if (items.length === 1) return [{ ...items[0], x, y, w, h }];
  const total = items.reduce((s, i) => s + i.percentage, 0);
  let running = 0, splitIdx = items.length - 1;
  for (let i = 0; i < items.length - 1; i++) {
    running += items[i].percentage;
    if (running >= total / 2) { splitIdx = i + 1; break; }
  }
  const ratio = items.slice(0, splitIdx).reduce((s, i) => s + i.percentage, 0) / total;
  if (w >= h) {
    const w1 = w * ratio;
    return [...buildTreemap(items.slice(0, splitIdx), x, y, w1, h),
            ...buildTreemap(items.slice(splitIdx), x + w1, y, w - w1, h)];
  } else {
    const h1 = h * ratio;
    return [...buildTreemap(items.slice(0, splitIdx), x, y, w, h1),
            ...buildTreemap(items.slice(splitIdx), x, y + h1, w, h - h1)];
  }
}

const WeightingHeatMap = ({ holdings, totalValue }: { holdings: Position[]; totalValue: number }) => {
  const sorted = [...holdings]
    .sort((a, b) => b.currentValue - a.currentValue)
    .map(h => ({ holdingId: h.holdingId, name: h.name, percentage: (h.currentValue / totalValue) * 100, currentValue: h.currentValue }));

  const rects = buildTreemap(sorted, 0, 0, 100, 100);

  const getColor = (pct: number) => {
    if (pct >= 15) return '#dc2626';
    if (pct >= 11) return '#ea580c';
    if (pct >= 8)  return '#d97706';
    if (pct >= 5)  return '#eab308';
    if (pct >= 3)  return '#16a34a';
    return '#15803d';
  };

  return (
    <div>
      <h3 className="text-white font-semibold text-sm mb-3 flex items-center gap-2">
        <span>🎯</span> Portfolio Weighting
        <span className="text-xs text-gray-500 font-normal">(block size = portfolio weight)</span>
      </h3>
      <div className="relative w-full rounded-lg overflow-hidden" style={{ height: '340px' }}>
        {rects.map(rect => {
          const areaApprox = rect.w * rect.h;
          return (
            <div key={rect.holdingId}
              className="absolute flex items-center justify-center hover:brightness-110 cursor-help transition-all"
              style={{
                left:            `calc(${rect.x}% + 2px)`,
                top:             `calc(${rect.y}% + 2px)`,
                width:           `calc(${rect.w}% - 4px)`,
                height:          `calc(${rect.h}% - 4px)`,
                backgroundColor: getColor(rect.percentage),
                borderRadius:    '6px',
              }}
              title={`${rect.name}: ${rect.percentage.toFixed(1)}% · ${formatCurrency(rect.currentValue)}`}
            >
              {areaApprox > 40 && (
                <p className="text-center px-2 text-sm font-bold text-white leading-tight w-full truncate">
                  {rect.name.split(' ')[0]}
                </p>
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
        {[
          { color: '#dc2626', label: '>15%' }, { color: '#ea580c', label: '11–15%' },
          { color: '#d97706', label: '8–11%' }, { color: '#eab308', label: '5–8%' },
          { color: '#16a34a', label: '3–5%' }, { color: '#15803d', label: '<3%' },
        ].map(({ color, label }) => (
          <span key={label} className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded inline-block" style={{ backgroundColor: color }} />{label}
          </span>
        ))}
      </div>
    </div>
  );
};

// ── Page ───────────────────────────────────────────────────────────────────────

const SOY_DATE = '2026-01-02';

// ── Holdings row (open + closed) ───────────────────────────────────────────────

interface HoldingRow {
  holdingId: number;
  name: string;
  ticker: string;
  firstPurchaseDate: string | null;
  lastSellDate: string | null;
  soyShares: number;
  curShares: number;
  curPrice: number;
  curValue: number;
  costBasis: number;   // current cost basis (0 for closed)
  isNew: boolean;
  isClosed: boolean;
  sharesChanged: boolean;
}

function buildHoldingRows(
  transactions: Transaction[],
  holdingsRef: Array<{ id: number; name: string; ticker: string; sector: string }>,
  livePrices: Record<string, number>,
): HoldingRow[] {
  const holdingInfo = new Map(holdingsRef.map(h => [h.id, h]));
  const allIds = new Set(transactions.map(tx => tx.holdingId));

  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 3);
  const sixMonthsAgoStr = sixMonthsAgo.toISOString().split('T')[0];

  // First purchase dates and last sell dates
  const firstPurchaseDates = new Map<number, string>();
  const lastSellDates = new Map<number, string>();
  for (const tx of transactions) {
    if (tx.type === 'buy') {
      const ex = firstPurchaseDates.get(tx.holdingId);
      if (!ex || tx.date < ex) firstPurchaseDates.set(tx.holdingId, tx.date);
    } else if (tx.type === 'sell') {
      const ex = lastSellDates.get(tx.holdingId);
      if (!ex || tx.date > ex) lastSellDates.set(tx.holdingId, tx.date);
    }
  }

  const rows: HoldingRow[] = [];

  for (const holdingId of allIds) {
    const info = holdingInfo.get(holdingId);
    if (!info) continue;

    const txs = [...transactions.filter(tx => tx.holdingId === holdingId)]
      .sort((a, b) => a.date.localeCompare(b.date));

    // Current position (all transactions)
    let curShares = 0, curCost = 0;
    for (const tx of txs) {
      if (tx.type === 'buy') { curShares += tx.shares; curCost += tx.totalCost; }
      else if (tx.type === 'sell') {
        const avg = curShares > 0 ? curCost / curShares : 0;
        curShares -= tx.shares; curCost -= avg * tx.shares;
      }
    }
    curShares = Math.max(0, curShares);

    // SOY position (transactions up to SOY_DATE)
    let soyShares = 0, soyCost = 0;
    for (const tx of txs.filter(t => t.date <= SOY_DATE)) {
      if (tx.type === 'buy') { soyShares += tx.shares; soyCost += tx.totalCost; }
      else if (tx.type === 'sell') {
        const avg = soyShares > 0 ? soyCost / soyShares : 0;
        soyShares -= tx.shares; soyCost -= avg * tx.shares;
      }
    }
    soyShares = Math.max(0, soyShares);

    const curPrice = livePrices[info.ticker] ?? 0;

    rows.push({
      holdingId,
      name:              info.name,
      ticker:            info.ticker,
      firstPurchaseDate: firstPurchaseDates.get(holdingId) ?? null,
      lastSellDate:      lastSellDates.get(holdingId) ?? null,
      soyShares,
      curShares,
      curPrice,
      curValue:    curPrice * curShares,
      costBasis:   curCost,
      isNew:       curShares > 0.001 && (firstPurchaseDates.get(holdingId) ?? '') >= sixMonthsAgoStr,
      isClosed:    curShares <= 0.001,
      sharesChanged: soyShares > 0.001 && curShares > 0.001 && Math.abs(soyShares - curShares) > 0.001,
    });
  }

  // Open positions: newest first; closed positions at the very bottom
  return rows.sort((a, b) => {
    if (a.isClosed !== b.isClosed) return a.isClosed ? 1 : -1;
    const da = a.firstPurchaseDate ?? '';
    const db = b.firstPurchaseDate ?? '';
    return db.localeCompare(da); // newest first
  });
}

export default function OverviewPage() {
  const [portfolio,     setPortfolio]     = useState<PortfolioSummary | null>(null);
  const [holdingRows,   setHoldingRows]   = useState<HoldingRow[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [lastUpdated,   setLastUpdated]   = useState<Date | null>(null);
  const [error,         setError]         = useState<string | null>(null);
  const [holdingsOpen,  setHoldingsOpen]  = useState(false);
  const [viewMode,      setViewMode]      = useState<'ytd' | '1year' | 'purchase'>('purchase');
  const [soyPrices,     setSoyPrices]     = useState<Record<string, number>>({});
  const [oneYearPrices, setOneYearPrices] = useState<Record<string, number>>({});

  const fetchData = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const oneYearDate = new Date();
      oneYearDate.setFullYear(oneYearDate.getFullYear() - 1);
      const oneYearDateStr = oneYearDate.toISOString().split('T')[0];

      const [transactions, prices, soyData, oneYearData, holdingsRef] = await Promise.all([
        getTransactions(),
        fetchPrices(),
        fetch(`/api/historical-prices?date=${SOY_DATE}`).then(r => r.ok ? r.json() : {}),
        fetch(`/api/historical-prices?date=${oneYearDateStr}`).then(r => r.ok ? r.json() : {}),
        getHoldingsReference(),
      ]);
      const positions = await calculatePositions(transactions, prices);
      setPortfolio(calculatePortfolioSummary(positions));
      setSoyPrices(soyData);
      setOneYearPrices(oneYearData);
      setHoldingRows(buildHoldingRows(transactions, holdingsRef, prices));
      setLastUpdated(new Date());
    } catch (error) {
      console.error('Error fetching data:', error);
      setError('Failed to load portfolio data. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const quickStats = useMemo(() => {
    if (!portfolio) return null;
    const h = portfolio.holdings;
    return {
      bestPerformer:  h.length ? h.reduce((b, c) => c.pnlPercent > b.pnlPercent ? c : b) : null,
      worstPerformer: h.length ? h.reduce((b, c) => c.pnlPercent < b.pnlPercent ? c : b) : null,
      averageReturn:  h.reduce((s, x) => s + x.pnlPercent, 0) / (h.length || 1),
      winningCount:   h.filter(x => x.pnlPercent > 0).length,
    };
  }, [portfolio]);

  const pieData = useMemo(() => {
    if (!portfolio) return [];
    const allocation: Record<string, number> = {};
    portfolio.holdings.forEach(h => {
      allocation[h.sector] = (allocation[h.sector] || 0) + h.currentValue;
    });
    return Object.entries(allocation).map(([sector, value]) => ({
      sector, value, color: sectorColors[sector] || sectorColors.Other,
      holdings: portfolio.holdings.filter(h => h.sector === sector).map(h => h.name),
    }));
  }, [portfolio]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
      <Navigation />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {/* Header — always rendered immediately for LCP */}
        <div className="flex justify-between items-center mb-8 flex-wrap gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">MESI Investment Portfolio</h1>
            <p className="text-sm text-gray-400 mt-1">UK stocks · Live prices from Yahoo Finance</p>
          </div>
          <RefreshButton onRefresh={fetchData} />
        </div>

        {/* Error state */}
        {error && (
          <div className="bg-red-900/30 border border-red-700 rounded-xl p-6 text-center mb-8">
            <p className="text-red-400">{error}</p>
            <button onClick={fetchData} className="mt-4 px-4 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700">
              Try Again
            </button>
          </div>
        )}

        {/* Loading skeleton */}
        {loading && !error && (
          <div className="flex items-center justify-center h-64">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-500 mx-auto" />
              <p className="mt-4 text-gray-400">Loading portfolio data...</p>
            </div>
          </div>
        )}

        {portfolio && (<>

        {lastUpdated && (
          <div className="text-right text-xs text-gray-500 mb-4">
            Last updated: {lastUpdated.toLocaleTimeString()}
          </div>
        )}

        {/* Stat cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <div className="bg-gray-800/50 backdrop-blur-sm rounded-xl p-5 border border-gray-700 hover:border-gray-600 transition-all">
            <p className="text-xs text-gray-400 uppercase tracking-wide">Market Value</p>
            <p className="text-2xl font-bold text-white mt-1">{formatCurrency(portfolio.totalValue)}</p>
            <p className="text-xs text-gray-500 mt-1">{portfolio.holdingCount} holdings</p>
          </div>
          <div className="hidden sm:block bg-gray-800/50 backdrop-blur-sm rounded-xl p-5 border border-gray-700 hover:border-gray-600 transition-all">
            <p className="text-xs text-gray-400 uppercase tracking-wide">Cost Basis</p>
            <p className="text-2xl font-bold text-white mt-1">{formatCurrency(portfolio.totalCost)}</p>
            <p className="text-xs text-gray-500 mt-1">amount invested</p>
          </div>
          <div className="hidden sm:block bg-gray-800/50 backdrop-blur-sm rounded-xl p-5 border border-gray-700 hover:border-gray-600 transition-all">
            <p className="text-xs text-gray-400 uppercase tracking-wide">Overall Gain / Loss</p>
            <p className={`text-2xl font-bold mt-1 ${portfolio.totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {portfolio.totalPnl >= 0 ? formatCurrency(portfolio.totalPnl) : `-${formatCurrency(Math.abs(portfolio.totalPnl))}`}
            </p>
            <p className={`text-xs mt-1 ${portfolio.totalPnlPercent >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {formatPercent(portfolio.totalPnlPercent)}
            </p>
          </div>
          <div className="hidden sm:block bg-gray-800/50 backdrop-blur-sm rounded-xl p-5 border border-gray-700 hover:border-gray-600 transition-all">
            <p className="text-xs text-gray-400 uppercase tracking-wide">Best Performer</p>
            {quickStats?.bestPerformer ? (
              <>
                <p className="text-lg font-semibold text-white mt-1 truncate">{quickStats.bestPerformer.name}</p>
                <p className="text-xs text-emerald-400 mt-1">{formatPercent(quickStats.bestPerformer.pnlPercent)}</p>
              </>
            ) : (
              <p className="text-lg font-semibold text-gray-400 mt-1">—</p>
            )}
          </div>
        </div>

        {/* Portfolio weighting + Sector allocation */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          <div className="bg-gray-900/50 rounded-xl border border-gray-800 p-6">
            <WeightingHeatMap holdings={portfolio.holdings} totalValue={portfolio.totalValue} />
          </div>
          <div className="bg-gray-900/50 rounded-xl border border-gray-800 p-6">
            <h2 className="text-white font-semibold mb-4">Sector Allocation</h2>
            {pieData.length > 0
              ? <PieChart data={pieData} />
              : <div className="text-center text-gray-400 py-8">No sector data available</div>
            }
          </div>
        </div>

        {/* Holdings — collapsible */}
        <div className="bg-gray-900/50 rounded-xl border border-gray-800 overflow-hidden backdrop-blur-sm">
          <button
            onClick={() => setHoldingsOpen(o => !o)}
            className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-800/40 transition-colors"
          >
            <div className="text-left">
              <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                <span>📋</span> Holdings
              </h2>
              <p className="text-xs text-gray-500 mt-0.5">
                {holdingsOpen ? 'Click to collapse' : 'Click to expand · click any ticker to view on Yahoo Finance'}
              </p>
            </div>
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-colors text-sm font-medium
              ${holdingsOpen
                ? 'border-gray-600 bg-gray-700 text-white'
                : 'border-emerald-700 bg-emerald-900/40 text-emerald-400'}`}>
              {holdingsOpen ? 'Collapse' : 'Expand'}
              <svg className={`w-4 h-4 transition-transform duration-200 ${holdingsOpen ? 'rotate-180' : ''}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </button>

          {holdingsOpen && (
            <>
              {/* Toggle bar */}
              <div className="px-6 py-3 border-t border-gray-800 flex items-center justify-between flex-wrap gap-3">
                <p className="hidden sm:block text-xs text-gray-500">
                  {viewMode === 'ytd'      ? 'Comparing 2 Jan 2026 value vs today'
                   : viewMode === '1year'  ? 'Comparing value 12 months ago vs today'
                   : 'Comparing cost basis vs current value'}
                </p>
                <div className="hidden sm:flex rounded-lg border border-gray-700 overflow-hidden text-xs">
                  {(['ytd', '1year', 'purchase'] as const).map((mode, i) => (
                    <button
                      key={mode}
                      onClick={() => setViewMode(mode)}
                      className={`px-3 py-1.5 transition-colors ${i > 0 ? 'border-l border-gray-700' : ''} ${
                        viewMode === mode ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300'
                      }`}
                    >
                      {mode === 'ytd' ? 'YTD' : mode === '1year' ? '12 Months' : 'Since Purchase'}
                    </button>
                  ))}
                </div>
              </div>

              <div className="overflow-x-hidden sm:overflow-x-auto border-t border-gray-800">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-10">
                    <tr className="border-b border-gray-800 bg-gray-900">
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Company</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Ticker</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">First Purchased</th>
                      <th className="hidden sm:table-cell px-6 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wider">Shares</th>
                      <th className="hidden sm:table-cell px-6 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wider">
                        {viewMode === 'ytd' ? '2 Jan Value' : viewMode === '1year' ? '1 Year Ago' : 'Cost Basis'}
                      </th>
                      <th className="hidden sm:table-cell px-6 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wider">Current Price</th>
                      <th className="hidden sm:table-cell px-6 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wider">Value</th>
                      <th className="hidden sm:table-cell px-6 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wider">
                        {viewMode === 'ytd' ? 'YTD Change' : viewMode === '1year' ? '12M Change' : 'Total Return'}
                      </th>
                      <th className="hidden sm:table-cell px-6 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wider">
                        {viewMode === 'ytd' ? 'YTD %' : viewMode === '1year' ? '12M %' : 'Return %'}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800">
                    {holdingRows.map(row => {
                      const refValue = viewMode === 'ytd'
                        ? (soyPrices[row.ticker] ?? 0) * row.soyShares
                        : viewMode === '1year'
                        ? (oneYearPrices[row.ticker] ?? 0) * row.curShares
                        : row.costBasis;
                      const change    = row.curValue - refValue;
                      const changePct = refValue > 0 ? (change / refValue) * 100 : 0;

                      const rowBg = row.isNew
                        ? 'bg-blue-900/10 hover:bg-blue-900/20'
                        : row.isClosed
                        ? 'bg-gray-800/20 opacity-60 hover:opacity-80'
                        : row.sharesChanged
                        ? 'bg-amber-900/10 hover:bg-amber-900/20'
                        : 'hover:bg-gray-800/50';

                      const changeColor = row.isClosed
                        ? 'text-red-400'
                        : row.isNew
                        ? 'text-gray-400'
                        : change >= 0 ? 'text-emerald-400' : 'text-red-400';

                      return (
                        <tr key={row.holdingId} className={`transition-colors ${rowBg}`}>
                          {/* Company + badges */}
                          <td className={`px-6 py-4 font-medium ${row.isClosed ? 'text-gray-500' : 'text-white'}`}>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span>{row.name}</span>
                              {row.isNew && (
                                <span className="text-xs px-1.5 py-0.5 rounded-full bg-blue-900/50 text-blue-400 border border-blue-700/50 font-normal">New</span>
                              )}
                              {row.isClosed && (
                                <span className="text-xs px-1.5 py-0.5 rounded-full bg-gray-800 text-gray-500 border border-gray-700 font-normal">Sold</span>
                              )}
                              {row.sharesChanged && (
                                <span className="text-xs px-1.5 py-0.5 rounded-full bg-amber-900/50 text-amber-400 border border-amber-700/50 font-normal">Rebalanced</span>
                              )}
                            </div>
                          </td>
                          {/* Ticker */}
                          <td className="px-6 py-4">
                            <a href={`https://uk.finance.yahoo.com/quote/${row.ticker}`}
                              target="_blank" rel="noopener noreferrer"
                              className="text-emerald-400 hover:text-emerald-300 font-mono text-xs hover:underline transition-colors">
                              {row.ticker}
                            </a>
                          </td>
                          {/* First purchased / sold */}
                          <td className="px-6 py-4 text-gray-400 text-xs">
                            <div>{row.firstPurchaseDate
                              ? new Date(row.firstPurchaseDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
                              : '—'}
                            </div>
                            {row.isClosed && row.lastSellDate && (
                              <div className="text-gray-500 mt-0.5">
                                → {new Date(row.lastSellDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                              </div>
                            )}
                          </td>
                          {/* Shares */}
                          <td className="hidden sm:table-cell px-6 py-4 text-right font-mono text-xs text-gray-300 whitespace-nowrap">
                            {row.isClosed ? (
                              <span className="text-gray-500">{row.soyShares > 0 ? `${row.soyShares.toFixed(2)} → 0` : '—'}</span>
                            ) : row.isNew ? (
                              <span className="text-blue-400">0 → {row.curShares.toFixed(2)}</span>
                            ) : row.sharesChanged ? (
                              <span className="text-amber-400">{row.soyShares.toFixed(2)} → {row.curShares.toFixed(2)}</span>
                            ) : (
                              <span>{row.curShares.toLocaleString()}</span>
                            )}
                          </td>
                          {/* Reference value */}
                          <td className="hidden sm:table-cell px-6 py-4 text-right text-gray-400">
                            {refValue > 0 ? formatCurrency(refValue) : '—'}
                          </td>
                          {/* Current price */}
                          <td className="hidden sm:table-cell px-6 py-4 text-right font-mono text-gray-300">
                            {row.curPrice > 0 ? formatCurrency(row.curPrice) : '—'}
                          </td>
                          {/* Current value */}
                          <td className="hidden sm:table-cell px-6 py-4 text-right text-gray-300">
                            {row.curValue > 0 ? formatCurrency(row.curValue) : '—'}
                          </td>
                          {/* Change £ */}
                          <td className={`hidden sm:table-cell px-6 py-4 text-right font-medium ${refValue > 0 ? changeColor : 'text-gray-500'}`}>
                            {refValue > 0 ? `${change >= 0 ? '+' : ''}${formatCurrency(change)}` : '—'}
                          </td>
                          {/* Change % */}
                          <td className={`hidden sm:table-cell px-6 py-4 text-right font-medium ${refValue > 0 ? changeColor : 'text-gray-500'}`}>
                            {refValue > 0 ? formatPercent(changePct) : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="bg-gray-900 border-t border-gray-800">
                    {(() => {
                      const refTotal = viewMode === 'ytd'
                        ? holdingRows.reduce((s, r) => s + (soyPrices[r.ticker] ?? 0) * r.soyShares, 0)
                        : viewMode === '1year'
                        ? holdingRows.reduce((s, r) => s + (oneYearPrices[r.ticker] ?? 0) * r.curShares, 0)
                        : holdingRows.reduce((s, r) => s + r.costBasis, 0);
                      const curTotal       = holdingRows.reduce((s, r) => s + r.curValue, 0);
                      const totalChange    = curTotal - refTotal;
                      const totalChangePct = refTotal > 0 ? (totalChange / refTotal) * 100 : 0;
                      const pos = totalChange >= 0;
                      return (
                        <tr>
                          <td colSpan={3} className="px-6 py-4 text-right font-semibold text-gray-300">Total Portfolio</td>
                          <td className="hidden sm:table-cell" />
                          <td className="hidden sm:table-cell px-6 py-4 text-right font-bold text-gray-300">
                            {formatCurrency(refTotal)}
                          </td>
                          <td className="hidden sm:table-cell" />
                          <td className="px-6 py-4 text-right font-bold text-white">{formatCurrency(curTotal)}</td>
                          <td className={`hidden sm:table-cell px-6 py-4 text-right font-bold ${pos ? 'text-emerald-400' : 'text-red-400'}`}>
                            {pos ? '+' : ''}{formatCurrency(totalChange)}
                          </td>
                          <td className={`px-6 py-4 text-right font-bold ${pos ? 'text-emerald-400' : 'text-red-400'}`}>
                            {formatPercent(totalChangePct)}
                          </td>
                        </tr>
                      );
                    })()}
                  </tfoot>
                </table>
              </div>
            </>
          )}
        </div>

        </>)}
      </div>
    </div>
  );
}
