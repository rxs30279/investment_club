'use client';

import { useEffect, useState, useCallback } from 'react';
import Navigation from '@/components/Navigation';
import RefreshButton from '@/components/RefreshButton';
import { getTransactions, fetchPrices, getHoldingsReference } from '@/lib/portfolio';
import { Transaction } from '@/types';

// ─── Types ────────────────────────────────────────────────────────────────────

interface HoldingSnapshot {
  holdingId: number;
  name: string;
  ticker: string;
  sector: string;
  shares: number;
  value: number;
}

interface PerformanceSnapshot {
  totalValue: number;
  holdings: HoldingSnapshot[];
}

interface HoldingCompare {
  holdingId: number;
  name: string;
  ticker: string;
  firstPurchaseDate: string | null;
  soyShares: number;
  soyValue: number;
  curShares: number;
  curValue: number;
  valueChange: number;
  valueChangePct: number;
  isNew: boolean;
  isClosed: boolean;
  sharesChanged: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SOY_DATE = '2026-01-02';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildSnapshot(
  transactions: Transaction[],
  holdingInfo: Map<number, { name: string; ticker: string; sector: string }>,
  prices: Record<string, number>,
  upToDate: string
): PerformanceSnapshot {
  const posMap = new Map<number, { shares: number; totalCost: number }>();

  const sorted = [...transactions]
    .filter(tx => tx.date <= upToDate)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  for (const tx of sorted) {
    let pos = posMap.get(tx.holdingId);
    if (!pos) {
      pos = { shares: 0, totalCost: 0 };
      posMap.set(tx.holdingId, pos);
    }
    if (tx.type === 'buy') {
      pos.shares += tx.shares;
      pos.totalCost += tx.totalCost;
    } else if (tx.type === 'sell') {
      const avg = pos.shares > 0 ? pos.totalCost / pos.shares : 0;
      pos.shares -= tx.shares;
      pos.totalCost -= avg * tx.shares;
    }
  }

  const holdings: HoldingSnapshot[] = [];
  let totalValue = 0;

  posMap.forEach((pos, holdingId) => {
    if (pos.shares <= 0.001) return;
    const info = holdingInfo.get(holdingId);
    const ticker = info?.ticker ?? '';
    const price = prices[ticker] ?? 0;
    const value = price * pos.shares;
    totalValue += value;
    holdings.push({
      holdingId,
      name: info?.name ?? `Holding ${holdingId}`,
      ticker,
      sector: info?.sector ?? 'Other',
      shares: pos.shares,
      value,
    });
  });

  holdings.sort((a, b) => b.value - a.value);
  return { totalValue, holdings };
}

function buildFirstPurchaseDates(transactions: Transaction[]): Map<number, string> {
  const map = new Map<number, string>();
  for (const tx of transactions) {
    if (tx.type !== 'buy') continue;
    const existing = map.get(tx.holdingId);
    if (!existing || tx.date < existing) map.set(tx.holdingId, tx.date);
  }
  return map;
}

function buildComparison(
  soy: PerformanceSnapshot,
  cur: PerformanceSnapshot,
  firstPurchaseDates: Map<number, string>,
): HoldingCompare[] {
  const all = new Map<number, HoldingCompare>();

  for (const h of soy.holdings) {
    all.set(h.holdingId, {
      holdingId: h.holdingId,
      name: h.name,
      ticker: h.ticker,
      firstPurchaseDate: firstPurchaseDates.get(h.holdingId) ?? null,
      soyShares: h.shares,
      soyValue: h.value,
      curShares: 0,
      curValue: 0,
      valueChange: 0,
      valueChangePct: 0,
      isNew: false,
      isClosed: true,
      sharesChanged: false,
    });
  }

  for (const h of cur.holdings) {
    const existing = all.get(h.holdingId);
    if (existing) {
      existing.curShares = h.shares;
      existing.curValue = h.value;
      existing.isClosed = false;
      existing.sharesChanged = Math.abs(existing.soyShares - h.shares) > 0.001;
    } else {
      all.set(h.holdingId, {
        holdingId: h.holdingId,
        name: h.name,
        ticker: h.ticker,
        firstPurchaseDate: firstPurchaseDates.get(h.holdingId) ?? null,
        soyShares: 0,
        soyValue: 0,
        curShares: h.shares,
        curValue: h.value,
        valueChange: 0,
        valueChangePct: 0,
        isNew: true,
        isClosed: false,
        sharesChanged: false,
      });
    }
  }

  all.forEach(item => {
    item.valueChange = item.curValue - item.soyValue;
    item.valueChangePct = item.soyValue > 0 ? (item.valueChange / item.soyValue) * 100 : 0;
  });

  return Array.from(all.values()).sort((a, b) => {
    // Closed positions always sink to the bottom
    if (a.isClosed !== b.isClosed) return a.isClosed ? 1 : -1;
    // Then sort by first purchase date ascending (oldest first)
    if (a.firstPurchaseDate && b.firstPurchaseDate)
      return b.firstPurchaseDate.localeCompare(a.firstPurchaseDate);
    if (a.firstPurchaseDate) return -1;
    if (b.firstPurchaseDate) return 1;
    return 0;
  });
}

const formatCurrency = (value: number): string =>
  `£${value.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const formatPercent = (value: number): string =>
  `${value >= 0 ? '+' : ''}${value.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function HistoryPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [soy, setSoy] = useState<PerformanceSnapshot | null>(null);
  const [cur, setCur] = useState<PerformanceSnapshot | null>(null);
  const [comparison, setComparison] = useState<HoldingCompare[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchData = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const [transactions, livePrices, soyPrices, holdingsRef] = await Promise.all([
        getTransactions(),
        fetchPrices(),                                                              // uses /api/prices → regularMarketPrice, matches Overview
        fetch(`/api/historical-prices?date=${SOY_DATE}`).then(r => r.ok ? r.json() : {}),
        getHoldingsReference(),
      ]);

      const holdingInfo = new Map<number, { name: string; ticker: string; sector: string }>();
      holdingsRef.forEach((h: any) =>
        holdingInfo.set(h.id, { name: h.name, ticker: h.ticker, sector: h.sector })
      );

      const today = new Date().toISOString().split('T')[0];
      const soySS = buildSnapshot(transactions, holdingInfo, soyPrices, SOY_DATE);
      const curSS = buildSnapshot(transactions, holdingInfo, livePrices, today);
      const firstPurchaseDates = buildFirstPurchaseDates(transactions);

      setSoy(soySS);
      setCur(curSS);
      setComparison(buildComparison(soySS, curSS, firstPurchaseDates));
      setLastUpdated(new Date());
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load history data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const ytdChange = soy && cur ? cur.totalValue - soy.totalValue : 0;
  const ytdChangePct = soy && soy.totalValue > 0 ? (ytdChange / soy.totalValue) * 100 : 0;
  const isPositive = ytdChange >= 0;

  // ── Loading ──
  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
        <Navigation />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="flex items-center justify-center h-64">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-500 mx-auto" />
              <p className="mt-4 text-gray-400">Loading history data...</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Error ──
  if (error || !soy || !cur) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
        <Navigation />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="bg-red-900/30 border border-red-700 rounded-xl p-6 text-center">
            <p className="text-red-400">{error ?? 'Failed to load history data'}</p>
            <button
              onClick={fetchData}
              className="mt-4 px-4 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700"
            >
              Try Again
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Main ──
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
      <Navigation />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {/* Header */}
        <div className="flex justify-between items-center mb-8 flex-wrap gap-4">
          <div>
            <h1 className="text-3xl font-bold text-white tracking-tight">History</h1>
            <p className="text-sm text-gray-400 mt-1">
              Year to date · 2 Jan 2026 → Today
            </p>
          </div>
          <RefreshButton onRefresh={fetchData} />
        </div>

        {/* Last updated */}
        {lastUpdated && (
          <div className="text-right text-xs text-gray-500 mb-4">
            Last updated: {lastUpdated.toLocaleTimeString()}
          </div>
        )}


        {/* Holdings table — always visible */}
        <div className="bg-gray-900/50 rounded-xl border border-gray-800 overflow-hidden backdrop-blur-sm">

          <div className="px-6 py-4 border-b border-gray-800 flex items-center justify-between flex-wrap gap-3">
            <div>
              <h2 className="text-lg font-semibold text-white">
                Holdings History
              </h2>
              <p className="hidden sm:block text-xs text-gray-500 mt-1">
                Comparing positions on 2 Jan 2026 vs today
              </p>
              <p className="sm:hidden text-xs text-gray-500 mt-0.5">Ordered by purchase date</p>
            </div>
            {/* Legend */}
            <div className="flex items-center gap-3 text-xs">
              <span className="flex items-center gap-1.5 text-blue-400">
                <span className="w-2 h-2 rounded-full bg-blue-400 inline-block" /> New position
              </span>
              <span className="flex items-center gap-1.5 text-amber-400">
                <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" /> Rebalanced
              </span>
              <span className="flex items-center gap-1.5 text-gray-500">
                <span className="w-2 h-2 rounded-full bg-gray-500 inline-block" /> Closed
              </span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 bg-gray-900/80">
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Company</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">First Purchased</th>
                  <th className="hidden sm:table-cell px-6 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wider">Shares</th>
                  <th className="hidden sm:table-cell px-6 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wider">2 Jan Value</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wider">Current Value</th>
                  <th className="hidden sm:table-cell px-6 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wider">YTD Change</th>
                  <th className="hidden sm:table-cell px-6 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wider">YTD %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {comparison.map(item => {
                  const rowBg = item.isNew
                    ? 'bg-blue-900/10 hover:bg-blue-900/20'
                    : item.isClosed
                    ? 'bg-gray-800/20 opacity-60 hover:opacity-80'
                    : item.sharesChanged
                    ? 'bg-amber-900/10 hover:bg-amber-900/20'
                    : 'hover:bg-gray-800/50';

                  const changeColor = item.isNew
                    ? 'text-gray-400'
                    : item.isClosed
                    ? 'text-red-400'
                    : item.valueChange >= 0 ? 'text-emerald-400' : 'text-red-400';

                  return (
                    <tr key={item.holdingId} className={`transition-colors ${rowBg}`}>
                      {/* Name + badge */}
                      <td className="px-6 py-4 font-medium text-white">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span>{item.name}</span>
                          {item.isNew && (
                            <span className="text-xs px-1.5 py-0.5 rounded-full bg-blue-900/50 text-blue-400 border border-blue-700/50 font-normal">
                              New
                            </span>
                          )}
                          {item.isClosed && (
                            <span className="text-xs px-1.5 py-0.5 rounded-full bg-gray-800 text-gray-500 border border-gray-700 font-normal">
                              Closed
                            </span>
                          )}
                          {item.sharesChanged && (
                            <span className="text-xs px-1.5 py-0.5 rounded-full bg-amber-900/50 text-amber-400 border border-amber-700/50 font-normal">
                              Rebalanced
                            </span>
                          )}
                        </div>
                      </td>

                      {/* First purchased */}
                      <td className="px-6 py-4 text-gray-400 text-xs">
                        {item.firstPurchaseDate
                          ? new Date(item.firstPurchaseDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
                          : '—'}
                      </td>

                      {/* Shares */}
                      <td className="hidden sm:table-cell px-6 py-4 text-right font-mono text-xs text-gray-300">
                        {item.isClosed ? (
                          <span className="text-gray-500">{item.soyShares.toFixed(2)} → 0</span>
                        ) : item.isNew ? (
                          <span className="text-blue-400">0 → {item.curShares.toFixed(2)}</span>
                        ) : item.sharesChanged ? (
                          <span className="text-amber-400">
                            {item.soyShares.toFixed(2)} → {item.curShares.toFixed(2)}
                          </span>
                        ) : (
                          item.curShares.toLocaleString()
                        )}
                      </td>

                      {/* 2 Jan value */}
                      <td className="hidden sm:table-cell px-6 py-4 text-right text-gray-400">
                        {item.soyValue > 0 ? formatCurrency(item.soyValue) : '—'}
                      </td>

                      {/* Current value */}
                      <td className="px-6 py-4 text-right text-gray-300">
                        {item.curValue > 0 ? formatCurrency(item.curValue) : '—'}
                      </td>

                      {/* YTD £ */}
                      <td className={`hidden sm:table-cell px-6 py-4 text-right font-medium ${changeColor}`}>
                        {item.isNew ? '—' : `${item.valueChange >= 0 ? '+' : ''}${formatCurrency(item.valueChange)}`}
                      </td>

                      {/* YTD % */}
                      <td className={`hidden sm:table-cell px-6 py-4 text-right font-medium ${changeColor}`}>
                        {item.isNew ? '—' : formatPercent(item.valueChangePct)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>

              {/* Totals row */}
              <tfoot className="bg-gray-900 border-t border-gray-700">
                <tr>
                  <td colSpan={2} className="px-6 py-4 text-right font-semibold text-gray-300">
                    Total Portfolio
                  </td>
                  <td className="hidden sm:table-cell" />
                  <td className="hidden sm:table-cell px-6 py-4 text-right font-bold text-gray-300">
                    {formatCurrency(soy.totalValue)}
                  </td>
                  <td className="px-6 py-4 text-right font-bold text-white">
                    {formatCurrency(cur.totalValue)}
                  </td>
                  <td className={`hidden sm:table-cell px-6 py-4 text-right font-bold ${isPositive ? 'text-emerald-400' : 'text-red-400'}`}>
                    {isPositive ? '+' : ''}{formatCurrency(ytdChange)}
                  </td>
                  <td className={`hidden sm:table-cell px-6 py-4 text-right font-bold ${isPositive ? 'text-emerald-400' : 'text-red-400'}`}>
                    {formatPercent(ytdChangePct)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-6 text-center text-xs text-gray-500">
          Click any ticker to view on Yahoo Finance · 2 Jan prices sourced from Yahoo historical data
        </div>
      </div>
    </div>
  );
}
